import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewWorkspace } from "../components/PreviewWorkspace";

const source = (relative: string) => readFileSync(resolve(__dirname, "..", relative), "utf8");

/**
 * Regression guards for the "content disappears / cannot scroll when the window is narrow or split"
 * bug. Its cause was structural: a root fixed to the viewport height (h-full on #root and the app
 * wrapper) with min-h-0 flex-1 children, so a stacked sidebar squeezed the preview to almost nothing
 * and the page could not grow. Real layout is verified in a browser; these keep the cause out.
 */
describe("page layout contract", () => {
  it("does not pin html, body or #root to the viewport height", () => {
    const css = source("index.css");
    expect(css).not.toMatch(/(html|body|#root)[^{}]*\{[^}]*\bheight:\s*100%/);
  });

  it("lets the app grow with its content instead of being a viewport-height flex column", () => {
    const app = source("App.tsx");
    expect(app).not.toMatch(/className="[^"]*(?<![-\w:])h-full\b/);
    expect(app).not.toMatch(/className="[^"]*(?<![-\w:])h-screen\b/);
    expect(app).toMatch(/min-h-screen/);
    // the preview column can shrink below its content width and is never squeezed by min-h-0 + flex-1
    expect(app).toMatch(/<main className="[^"]*\bmin-w-0\b/);
    expect(app).not.toMatch(/<main className="[^"]*(?<![-\w:])min-h-0\b/);
  });

  it("only pins the sidebar beside the preview from the lg breakpoint up, and stacks the preview first below it", () => {
    const app = source("App.tsx");
    const aside = /<aside className="([^"]*)"/.exec(app)![1];
    for (const cls of aside.split(/\s+/).filter((c) => /sticky|overflow-y-auto|max-h-screen/.test(c))) {
      expect(cls.startsWith("lg:"), cls).toBe(true);
    }
    expect(aside).toMatch(/\border-2\b/);
    expect(aside).toMatch(/\blg:order-1\b/);
  });

  it("does not nest overflow-hidden or fixed heights around the preview", () => {
    const preview = source("components/PreviewWorkspace.tsx");
    expect(preview).not.toMatch(/overflow-hidden/);
    expect(preview).not.toMatch(/\bh-full flex-col\b/);
    expect(preview).not.toMatch(/min-h-0/);
  });
});

function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return { width, height, toDataURL: () => "data:image/png;base64,AAAA" } as unknown as HTMLCanvasElement;
}

describe("PreviewWorkspace", () => {
  const baseProps = {
    originalCanvas: fakeCanvas(100, 80),
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"></svg>',
    overlaySvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"></svg>',
    isTracing: false,
    isPicking: false,
    pickedPoints: [],
    onPickPoint: () => {},
  };

  it("keeps the image's exact aspect ratio, so clicks map to image pixels without letterbox error", async () => {
    const user = userEvent.setup();
    const onPickPoint = vi.fn();
    render(<PreviewWorkspace {...baseProps} isPicking onPickPoint={onPickPoint} />);
    const original = screen.getByAltText("Original upload");
    // the element that receives the click is the frame around the image
    const frame = original.parentElement as HTMLElement;
    frame.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 320, right: 410, bottom: 340, x: 10, y: 20, toJSON: () => ({}) });
    await user.pointer({ target: frame, coords: { clientX: 210, clientY: 180 }, keys: "[MouseLeft]" });
    // (210 - 10) / 400 * 100 = 50, (180 - 20) / 320 * 80 = 40: both axes use their own exact scale
    expect(onPickPoint).toHaveBeenCalledWith({ x: 50, y: 40 });
  });

  it("zooms by growing the content inside a scrollable frame, so the zoomed drawing can be panned", async () => {
    const user = userEvent.setup();
    render(<PreviewWorkspace {...baseProps} />);
    const original = screen.getByAltText("Original upload");
    const inner = original.parentElement as HTMLElement;
    expect(inner.style.width).toBe("100%");
    await user.click(screen.getByLabelText("Zoom in"));
    await user.click(screen.getByLabelText("Zoom in"));
    expect(inner.style.width).toBe("150%");
    expect(screen.getByText(/scroll inside a preview to pan/)).toBeInTheDocument();
    expect((inner.parentElement as HTMLElement).className).toMatch(/overflow-auto/);
    await user.click(screen.getByRole("button", { name: "Fit" }));
    expect(inner.style.width).toBe("100%");
  });

  it("shows a subtle updating badge over the existing vector while retracing, and none when idle", () => {
    const { rerender } = render(<PreviewWorkspace {...baseProps} />);
    expect(screen.queryByText("Updating…")).toBeNull();
    rerender(<PreviewWorkspace {...baseProps} isTracing />);
    expect(screen.getByText("Updating…")).toBeInTheDocument();
  });

  it("says tracing is under way when there is no vector yet, instead of asking for a button press", () => {
    render(<PreviewWorkspace {...baseProps} svg={null} overlaySvg={null} isTracing />);
    expect(screen.getByText("Tracing…")).toBeInTheDocument();
    expect(screen.queryByText(/Generate vector/i)).toBeNull();
  });

  it("offers both comparison modes and the background and zoom controls", async () => {
    const user = userEvent.setup();
    render(<PreviewWorkspace {...baseProps} />);
    expect(screen.getByAltText("Original upload")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Overlay" }));
    expect(screen.getByText("Original + vector overlay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit" })).toBeInTheDocument();
  });
});
