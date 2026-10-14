import type { Calibration, TraceResult } from "../lib/types";

interface ExportPanelProps {
  traceResult: TraceResult | null;
  calibration: Calibration | null;
  /** True while the preview is being retraced; the result on screen may not match the settings yet. */
  isTracing: boolean;
  onExportSvg: () => void;
  onExportDxf: () => void;
  lastExportError: string | null;
}

export function ExportPanel({
  traceResult,
  calibration,
  isTracing,
  onExportSvg,
  onExportDxf,
  lastExportError,
}: ExportPanelProps) {
  const noResult = !traceResult || traceResult.isEmpty;
  // Exporting while a retrace is pending would save a result that no longer matches the settings.
  const disabled = noResult || isTracing;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Export</h3>
        <p className="mt-1 text-xs text-slate-500">
          Download the traced drawing as a self-contained SVG, or as a DXF for use in CAD
          software.
        </p>
      </div>

      {isTracing && !noResult && (
        <p role="status" className="text-xs text-indigo-300">
          Updating the preview… export is available as soon as it finishes.
        </p>
      )}
      {noResult && !isTracing && (
        <p className="text-xs text-amber-300">
          {traceResult?.isEmpty
            ? "No paths were traced with the current settings — adjust them in the Trace tab."
            : "The vector appears once tracing finishes."}
        </p>
      )}

      <button
        type="button"
        onClick={onExportSvg}
        disabled={disabled}
        className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Download SVG
      </button>

      <button
        type="button"
        onClick={onExportDxf}
        disabled={disabled}
        className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Download DXF
      </button>

      <p className="text-[11px] text-slate-500">
        {calibration
          ? `DXF coordinates will be scaled to real-world ${calibration.unit}.`
          : "DXF coordinates will be in image-relative units (1 unit = 1 pixel) — not a real-world measurement. Use calibration above for accurate dimensions."}
      </p>

      {lastExportError && <p className="text-xs text-red-300">{lastExportError}</p>}
    </div>
  );
}
