import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { runTraceInWorker } from "../lib/trace/runTrace";
import { loadImageFile } from "../lib/image/loadImage";
import type { TraceResult, TracingSettings } from "../lib/types";

vi.mock("../lib/trace/runTrace", () => ({ runTraceInWorker: vi.fn() }));
vi.mock("../lib/image/canvasTransform", () => ({ rotateCanvas: (c: unknown) => c, cropCanvas: (c: unknown) => c }));
vi.mock("../lib/image/loadImage", () => ({
  SUPPORTED_MIME_TYPES: ["image/png", "image/jpeg"],
  ImageLoadError: class ImageLoadError extends Error {},
  loadImageFile: vi.fn(),
}));

const trace = vi.mocked(runTraceInWorker);

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 100,
    height: 80,
    toDataURL: () => "data:image/png;base64,AAAA",
    getContext: () => ({ getImageData: () => ({ width: 100, height: 80, data: new Uint8ClampedArray(100 * 80 * 4) }) }),
  } as unknown as HTMLCanvasElement;
}

const resultWith = (pathCount: number): TraceResult => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"></svg>`,
  geometry: { width: 100, height: 80, contours: [] },
  pathCount,
  isEmpty: pathCount === 0,
});

interface Pending {
  settings: TracingSettings;
  signal?: AbortSignal;
  resolve: (r: TraceResult) => void;
  reject: (e: unknown) => void;
}
let pending: Pending[] = [];

beforeEach(() => {
  pending = [];
  trace.mockReset();
  trace.mockImplementation(
    (_imageData, settings, signal) =>
      new Promise<TraceResult>((resolve, reject) => {
        pending.push({ settings, signal, resolve, reject });
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  vi.mocked(loadImageFile).mockImplementation(async (file: File) => ({ fileName: file.name, width: 100, height: 80, canvas: fakeCanvas() }));
});

async function uploadDrawing(user: ReturnType<typeof userEvent.setup>) {
  const { container } = render(<App />);
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  await user.upload(input, new File(["x"], "plan.png", { type: "image/png" }));
  await screen.findByText(/plan\.png/);
  await user.click(screen.getByRole("button", { name: "trace" }));
  return container;
}

describe("App: automatic retracing", () => {
  it("traces a loaded drawing with the default settings without any button press", async () => {
    const user = userEvent.setup();
    await uploadDrawing(user);
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(1));
    expect(pending[0].settings).toEqual({ threshold: 175, autoThreshold: false, noiseReduction: 1, smoothing: 4, detail: 6 });
    expect(screen.getByRole("status", { name: "" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generate vector/i })).toBeNull();

    await act(async () => pending[0].resolve(resultWith(4)));
    expect(await screen.findByText(/Preview is up to date · 4 paths traced/)).toBeInTheDocument();
  });

  it("retraces once, with the final value, after several quick changes from the plus button", async () => {
    const user = userEvent.setup();
    await uploadDrawing(user);
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(1));
    await act(async () => pending[0].resolve(resultWith(1)));

    const plus = screen.getByLabelText("Increase Smoothing");
    await user.click(plus);
    await user.click(plus);
    await user.click(plus);
    expect(await screen.findByText("Updating preview…")).toBeInTheDocument();
    expect(trace).toHaveBeenCalledTimes(1); // nothing started during the quiet period

    await waitFor(() => expect(trace).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(pending[1].settings.smoothing).toBe(7);
    await new Promise((r) => setTimeout(r, 500));
    expect(trace).toHaveBeenCalledTimes(2); // and no redundant jobs afterwards
  });

  it("retraces for typed values and for the Reset button too", async () => {
    const user = userEvent.setup();
    await uploadDrawing(user);
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(1));
    await act(async () => pending[0].resolve(resultWith(1)));

    await user.click(screen.getByLabelText("Black/white threshold"));
    await user.keyboard("176");
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(pending[1].settings.threshold).toBe(176);
    await act(async () => pending[1].resolve(resultWith(2)));

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(pending[2].settings.threshold).toBe(175);
  });

  it("never lets a slow, superseded response overwrite the newer preview", async () => {
    const user = userEvent.setup();
    await uploadDrawing(user);
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(1)); // trace A pending

    await user.click(screen.getByLabelText("Increase Detail preservation"));
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(2), { timeout: 2000 }); // trace B starts, A is aborted
    expect(pending[0].signal?.aborted).toBe(true);

    await act(async () => pending[1].resolve(resultWith(22)));
    await act(async () => pending[0].resolve(resultWith(11))); // late and stale
    expect(await screen.findByText(/22 paths traced/)).toBeInTheDocument();
    expect(screen.queryByText(/11 paths traced/)).toBeNull();
  });

  it("shows the error and leaves the interface usable instead of loading forever", async () => {
    const user = userEvent.setup();
    await uploadDrawing(user);
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(1));
    await act(async () => pending[0].reject(new Error("The tracer crashed")));

    expect(await screen.findByText("The tracer crashed")).toBeInTheDocument();
    expect(screen.queryByText("Updating preview…")).toBeNull();

    // changing a setting recovers: it traces again and the error goes away
    await user.click(screen.getByLabelText("Increase Smoothing"));
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await act(async () => pending[1].resolve(resultWith(3)));
    expect(await screen.findByText(/3 paths traced/)).toBeInTheDocument();
    expect(screen.queryByText("The tracer crashed")).toBeNull();
  });

  it("only offers exports once the preview matches the settings", async () => {
    const user = userEvent.setup();
    await uploadDrawing(user);
    await waitFor(() => expect(trace).toHaveBeenCalledTimes(1));
    await act(async () => pending[0].resolve(resultWith(5)));
    await user.click(screen.getByRole("button", { name: "export" }));
    expect(screen.getByRole("button", { name: "Download SVG" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "trace" }));
    await user.click(screen.getByLabelText("Increase Smoothing"));
    await user.click(screen.getByRole("button", { name: "export" }));
    expect(screen.getByRole("button", { name: "Download SVG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download DXF" })).toBeDisabled();
    expect(screen.getByText(/Updating the preview…/)).toBeInTheDocument();

    await waitFor(() => expect(trace).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await act(async () => pending[1].resolve(resultWith(6)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Download SVG" })).toBeEnabled());
  });
});
