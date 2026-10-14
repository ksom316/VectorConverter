import { useCallback, useMemo, useRef, useState } from "react";
import type { CropRect } from "../lib/types";

interface PrepareControlsProps {
  previewCanvas: HTMLCanvasElement;
  cropRect: CropRect | null;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onApplyCrop: (rect: CropRect) => void;
  onClearCrop: () => void;
  onReset: () => void;
}

export function PrepareControls({
  previewCanvas,
  cropRect,
  onRotateLeft,
  onRotateRight,
  onApplyCrop,
  onClearCrop,
  onReset,
}: PrepareControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dataUrl = useMemo(() => previewCanvas.toDataURL("image/png"), [previewCanvas]);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const toImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const scaleX = previewCanvas.width / rect.width;
      const scaleY = previewCanvas.height / rect.height;
      return {
        x: Math.min(Math.max(0, (clientX - rect.left) * scaleX), previewCanvas.width),
        y: Math.min(Math.max(0, (clientY - rect.top) * scaleY), previewCanvas.height),
      };
    },
    [previewCanvas],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStart.current = toImageCoords(e.clientX, e.clientY);
    setDragRect(null);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const current = toImageCoords(e.clientX, e.clientY);
    const x = Math.min(dragStart.current.x, current.x);
    const y = Math.min(dragStart.current.y, current.y);
    const width = Math.abs(current.x - dragStart.current.x);
    const height = Math.abs(current.y - dragStart.current.y);
    setDragRect({ x, y, width, height });
  };

  const handlePointerUp = () => {
    dragStart.current = null;
    if (dragRect && dragRect.width > 4 && dragRect.height > 4) {
      onApplyCrop(dragRect);
    }
    setDragRect(null);
  };

  const displayRect = dragRect ?? cropRect;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Prepare</h3>
        <p className="mt-1 text-xs text-slate-500">
          Rotate to straighten the scan, then drag directly on the image to crop to the area you
          want to trace.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRotateLeft}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          ⟲ Rotate left
        </button>
        <button
          type="button"
          onClick={onRotateRight}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          ⟳ Rotate right
        </button>
        <button
          type="button"
          onClick={onClearCrop}
          disabled={!cropRect}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          Clear crop
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-700"
        >
          Reset all
        </button>
      </div>

      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative mx-auto cursor-crosshair select-none overflow-hidden rounded-lg border border-slate-700 bg-white"
        // exact aspect ratio at any size: the width is capped so the height never exceeds 60vh
        style={{
          aspectRatio: `${previewCanvas.width} / ${previewCanvas.height}`,
          width: `min(100%, ${(previewCanvas.width / previewCanvas.height) * 60}vh)`,
        }}
      >
        {dataUrl && (
          <img src={dataUrl} alt="Uploaded drawing preview" className="h-full w-full object-contain" draggable={false} />
        )}
        {displayRect && (
          <div
            className="pointer-events-none absolute border-2 border-indigo-400 bg-indigo-400/15"
            style={{
              left: `${(displayRect.x / previewCanvas.width) * 100}%`,
              top: `${(displayRect.y / previewCanvas.height) * 100}%`,
              width: `${(displayRect.width / previewCanvas.width) * 100}%`,
              height: `${(displayRect.height / previewCanvas.height) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
