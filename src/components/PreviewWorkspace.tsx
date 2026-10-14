import { useEffect, useMemo, useRef, useState } from "react";

interface PickedPoint {
  x: number;
  y: number;
}

interface PreviewWorkspaceProps {
  originalCanvas: HTMLCanvasElement;
  svg: string | null;
  overlaySvg: string | null;
  isTracing: boolean;
  isPicking: boolean;
  pickedPoints: PickedPoint[];
  onPickPoint: (point: PickedPoint) => void;
}

type ViewMode = "side-by-side" | "overlay";
type Background = "white" | "checker";

/** The tallest a preview may get, so one drawing never needs more than a screen of scrolling. */
const MAX_PREVIEW_HEIGHT_VH = 85;

/**
 * A frame that has exactly the drawing's aspect ratio, so the image fills it with no letterboxing
 * (which also keeps click positions on the original image exact for scale calibration). Its width
 * is the container width, capped so its height never exceeds MAX_PREVIEW_HEIGHT_VH. Zooming makes
 * the inner content larger than the frame, and the frame scrolls to pan.
 */
function Frame({
  ratio,
  zoom,
  background,
  badge,
  children,
  innerRef,
  innerProps,
}: {
  ratio: number;
  zoom: number;
  background: Background;
  badge?: React.ReactNode;
  children: React.ReactNode;
  innerRef?: React.Ref<HTMLDivElement>;
  innerProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      className="relative mx-auto min-w-0"
      style={{ width: `min(100%, ${ratio * MAX_PREVIEW_HEIGHT_VH}vh)` }}
    >
      <div
        className={`flex overflow-auto rounded-lg border border-slate-800 ${background === "white" ? "bg-white" : "workspace-grid-bg"}`}
        style={{ aspectRatio: `${ratio}` }}
      >
        <div
          ref={innerRef}
          {...innerProps}
          className={`relative m-auto shrink-0 ${innerProps?.className ?? ""}`}
          style={{ width: `${zoom * 100}%`, aspectRatio: `${ratio}` }}
        >
          {children}
        </div>
      </div>
      {badge}
    </div>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
      {children}
    </div>
  );
}

function UpdatingBadge() {
  return (
    <div
      role="status"
      className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] text-indigo-200 shadow"
    >
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent"
      />
      Updating…
    </div>
  );
}

const segmentClass = (active: boolean) =>
  `rounded px-2.5 py-1 ${active ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`;

export function PreviewWorkspace({
  originalCanvas,
  svg,
  overlaySvg,
  isTracing,
  isPicking,
  pickedPoints,
  onPickPoint,
}: PreviewWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [background, setBackground] = useState<Background>("white");
  const [zoom, setZoom] = useState(1);
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const originalDataUrl = useMemo(() => originalCanvas.toDataURL("image/png"), [originalCanvas]);
  const pickingContainerRef = useRef<HTMLDivElement>(null);
  const ratio = originalCanvas.width / originalCanvas.height;

  useEffect(() => {
    if (isPicking) setZoom(1);
  }, [isPicking]);

  const handlePickClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPicking || zoom !== 1) return;
    const el = pickingContainerRef.current;
    if (!el) return;
    // The frame has the image's aspect ratio, so this rectangle is exactly the image.
    const rect = el.getBoundingClientRect();
    onPickPoint({
      x: ((e.clientX - rect.left) * originalCanvas.width) / rect.width,
      y: ((e.clientY - rect.top) * originalCanvas.height) / rect.height,
    });
  };

  const markers = (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${originalCanvas.width} ${originalCanvas.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {pickedPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={Math.max(originalCanvas.width, originalCanvas.height) * 0.01} fill="#f59e0b" stroke="white" strokeWidth={1} />
      ))}
      {pickedPoints.length === 2 && (
        <line
          x1={pickedPoints[0].x}
          y1={pickedPoints[0].y}
          x2={pickedPoints[1].x}
          y2={pickedPoints[1].y}
          stroke="#f59e0b"
          strokeWidth={Math.max(originalCanvas.width, originalCanvas.height) * 0.003}
        />
      )}
    </svg>
  );

  const pickingProps = {
    onClick: handlePickClick,
    className: isPicking ? "cursor-crosshair" : "",
  };

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-1 rounded-md border border-slate-700 bg-slate-900 p-0.5">
          <button type="button" onClick={() => setViewMode("side-by-side")} className={segmentClass(viewMode === "side-by-side")}>
            Side by side
          </button>
          <button type="button" onClick={() => setViewMode("overlay")} className={segmentClass(viewMode === "overlay")}>
            Overlay
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "overlay" && (
            <label className="flex items-center gap-1.5 text-slate-400">
              Vector opacity
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-20 accent-indigo-500"
              />
            </label>
          )}

          <div className="flex gap-1 rounded-md border border-slate-700 bg-slate-900 p-0.5">
            <button type="button" onClick={() => setBackground("white")} className={segmentClass(background === "white")}>
              White
            </button>
            <button type="button" onClick={() => setBackground("checker")} className={segmentClass(background === "checker")}>
              Checker
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="w-10 text-center text-slate-400">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
              aria-label="Zoom in"
            >
              +
            </button>
            <button type="button" onClick={() => setZoom(1)} className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800">
              Fit
            </button>
          </div>
        </div>
      </div>

      {zoom > 1 && !isPicking && <p className="text-xs text-slate-500">Zoomed in — scroll inside a preview to pan.</p>}
      {isPicking && zoom !== 1 && (
        <p className="text-xs text-amber-300">Zoom is reset to Fit while picking calibration points.</p>
      )}

      {viewMode === "side-by-side" ? (
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          <Pane title="Original">
            <Frame ratio={ratio} zoom={zoom} background={background} innerRef={pickingContainerRef} innerProps={pickingProps}>
              {originalDataUrl && (
                <img src={originalDataUrl} alt="Original upload" className="h-full w-full object-contain" draggable={false} />
              )}
              {pickedPoints.length > 0 && markers}
            </Frame>
          </Pane>
          <Pane title="Vector">
            <Frame ratio={ratio} zoom={zoom} background={background} badge={isTracing && svg ? <UpdatingBadge /> : undefined}>
              {svg ? (
                <div
                  className={`h-full w-full transition-opacity [&>svg]:h-full [&>svg]:w-full ${isTracing ? "opacity-60" : ""}`}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-slate-500">
                  {isTracing ? "Tracing…" : "The vector appears here once tracing finishes."}
                </div>
              )}
            </Frame>
          </Pane>
        </div>
      ) : (
        <Pane title="Original + vector overlay">
          <Frame
            ratio={ratio}
            zoom={zoom}
            background={background}
            innerRef={pickingContainerRef}
            innerProps={pickingProps}
            badge={isTracing && overlaySvg ? <UpdatingBadge /> : undefined}
          >
            {originalDataUrl && (
              <img src={originalDataUrl} alt="Original upload" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            )}
            {overlaySvg && (
              <div
                style={{ opacity: isTracing ? overlayOpacity * 0.6 : overlayOpacity }}
                className="absolute inset-0 h-full w-full transition-opacity [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: overlaySvg }}
              />
            )}
            {pickedPoints.length > 0 && markers}
          </Frame>
        </Pane>
      )}
    </div>
  );
}
