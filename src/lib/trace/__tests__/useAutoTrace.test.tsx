import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoTrace } from "../useAutoTrace";
import { DEFAULT_TRACING_SETTINGS, type TraceResult, type TracingSettings } from "../../types";

interface Deferred {
  settings: TracingSettings;
  signal?: AbortSignal;
  resolve: (result: TraceResult) => void;
  reject: (error: unknown) => void;
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 4,
    height: 4,
    getContext: () => ({ getImageData: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }) }),
  } as unknown as HTMLCanvasElement;
}

const resultWith = (pathCount: number): TraceResult => ({
  svg: `<svg data-paths="${pathCount}"></svg>`,
  geometry: { width: 4, height: 4, contours: [] },
  pathCount,
  isEmpty: pathCount === 0,
});

/** A trace function whose every call stays pending until the test settles it. */
function controllableTrace() {
  const calls: Deferred[] = [];
  const trace = vi.fn(
    (_imageData: ImageData, settings: TracingSettings, signal?: AbortSignal) =>
      new Promise<TraceResult>((resolve, reject) => {
        calls.push({ settings, signal, resolve, reject });
        signal?.addEventListener("abort", () => reject(new DOMException("Trace aborted", "AbortError")));
      }),
  );
  return { trace, calls };
}

const withSettings = (change: Partial<TracingSettings>): TracingSettings => ({ ...DEFAULT_TRACING_SETTINGS, ...change });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useAutoTrace", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial: { canvas: HTMLCanvasElement | null; settings: TracingSettings }, trace: ReturnType<typeof controllableTrace>["trace"]) =>
    renderHook((props: { canvas: HTMLCanvasElement | null; settings: TracingSettings }) => useAutoTrace({ ...props, trace, debounceMs: 250 }), {
      initialProps: initial,
    });

  it("traces a newly loaded drawing right away, without any button press", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { result } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    expect(result.current.isTracing).toBe(true);
    await advance(0);
    expect(trace).toHaveBeenCalledTimes(1);
    await act(async () => calls[0].resolve(resultWith(3)));
    expect(result.current.isTracing).toBe(false);
    expect(result.current.result?.pathCount).toBe(3);
  });

  it("retraces automatically when any tracing setting changes", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { result, rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(1)));

    const changes: Partial<TracingSettings>[] = [{ threshold: 150 }, { noiseReduction: 4 }, { smoothing: 8 }, { detail: 9 }, { autoThreshold: true }];
    for (const [i, change] of changes.entries()) {
      rerender({ canvas, settings: withSettings(change) });
      await advance(250);
      expect(trace).toHaveBeenCalledTimes(i + 2);
      expect(calls[i + 1].settings).toMatchObject(change);
      await act(async () => calls[i + 1].resolve(resultWith(i + 2)));
    }
    expect(result.current.result?.pathCount).toBe(changes.length + 1);
  });

  it("debounces rapid changes into one trace using the latest settings, with no redundant jobs", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(1)));
    trace.mockClear();

    for (let threshold = 130; threshold <= 160; threshold += 5) {
      rerender({ canvas, settings: withSettings({ threshold }) });
      await advance(40); // keeps moving: always inside the quiet period
    }
    expect(trace).not.toHaveBeenCalled();
    await advance(250);
    expect(trace).toHaveBeenCalledTimes(1);
    expect(trace.mock.calls[0][1].threshold).toBe(160);
  });

  it("does not retrace when the settings are re-rendered with identical values", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(1)));
    rerender({ canvas, settings: { ...DEFAULT_TRACING_SETTINGS } });
    await advance(1000);
    expect(trace).toHaveBeenCalledTimes(1);
  });

  it("aborts a superseded trace and never lets its late response overwrite the newer preview", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { result, rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0); // trace A (defaults) starts and stays pending

    rerender({ canvas, settings: withSettings({ threshold: 170 }) });
    await advance(250); // trace B starts; A is aborted
    expect(calls).toHaveLength(2);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);

    await act(async () => calls[1].resolve(resultWith(222))); // B finishes first
    await act(async () => calls[0].resolve(resultWith(111))); // A's late response must be ignored
    expect(result.current.result?.pathCount).toBe(222);
    expect(result.current.isTracing).toBe(false);
  });

  it("keeps showing the previous preview while the next one is being traced", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { result, rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(7)));
    rerender({ canvas, settings: withSettings({ smoothing: 9 }) });
    expect(result.current.isTracing).toBe(true); // already pending during the quiet period
    expect(result.current.result?.pathCount).toBe(7);
    await advance(250);
    expect(result.current.isTracing).toBe(true);
    expect(result.current.result?.pathCount).toBe(7);
  });

  it("reports a failure without leaving the preview stuck loading, and keeps the last good preview", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { result, rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(5)));

    rerender({ canvas, settings: withSettings({ detail: 2 }) });
    await advance(250);
    await act(async () => calls[1].reject(new Error("worker exploded")));
    expect(result.current.isTracing).toBe(false);
    expect(result.current.error).toBe("worker exploded");
    expect(result.current.result?.pathCount).toBe(5);

    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();

    // the next change clears the failure and traces again
    rerender({ canvas, settings: withSettings({ detail: 3 }) });
    await advance(250);
    expect(result.current.error).toBeNull();
    expect(result.current.isTracing).toBe(true);
    await act(async () => calls[2].resolve(resultWith(6)));
    expect(result.current.result?.pathCount).toBe(6);
  });

  it("recovers from a canvas that cannot be read", async () => {
    const { trace } = controllableTrace();
    const broken = { width: 2, height: 2, getContext: () => null } as unknown as HTMLCanvasElement;
    const { result } = setup({ canvas: broken, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    expect(result.current.isTracing).toBe(false);
    expect(result.current.error).toMatch(/Canvas 2D context unavailable/);
    expect(trace).not.toHaveBeenCalled();
  });

  it("retrace() skips the quiet period", async () => {
    const { trace, calls } = controllableTrace();
    const canvas = fakeCanvas();
    const { result, rerender } = setup({ canvas, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(1)));
    rerender({ canvas, settings: withSettings({ threshold: 140 }) });
    await advance(50); // still waiting
    expect(trace).toHaveBeenCalledTimes(1);
    act(() => result.current.retrace());
    await advance(0);
    expect(trace).toHaveBeenCalledTimes(2);
  });

  it("drops the previous drawing's preview when a different drawing is loaded, and stops when there is none", async () => {
    const { trace, calls } = controllableTrace();
    const first = fakeCanvas();
    const { result, rerender } = setup({ canvas: first, settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    await act(async () => calls[0].resolve(resultWith(4)));
    expect(result.current.result?.pathCount).toBe(4);

    const second = fakeCanvas();
    rerender({ canvas: second, settings: DEFAULT_TRACING_SETTINGS });
    expect(result.current.result).toBeNull();
    expect(result.current.isTracing).toBe(true);
    await advance(0); // a new drawing traces immediately, with no quiet period
    expect(trace).toHaveBeenCalledTimes(2);

    rerender({ canvas: null, settings: DEFAULT_TRACING_SETTINGS });
    expect(result.current.isTracing).toBe(false);
    expect(result.current.result).toBeNull();
    expect(calls[1].signal?.aborted).toBe(true);
  });

  it("aborts the running trace when it unmounts", async () => {
    const { trace, calls } = controllableTrace();
    const { unmount } = setup({ canvas: fakeCanvas(), settings: DEFAULT_TRACING_SETTINGS }, trace);
    await advance(0);
    unmount();
    expect(calls[0].signal?.aborted).toBe(true);
  });
});
