import { DEFAULT_TRACING_SETTINGS, type TracingSettings } from "../lib/types";
import { NUMERIC_TRACING_SETTINGS } from "../lib/trace/tracingLimits";
import { NumberSliderField } from "./NumberSliderField";

interface TracingControlsProps {
  settings: TracingSettings;
  onChange: (settings: TracingSettings) => void;
  /** Re-runs the trace right now, skipping the short wait after a change. */
  onRetrace: () => void;
  isTracing: boolean;
  pathCount: number | null;
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"
    />
  );
}

export function TracingControls({ settings, onChange, onRetrace, isTracing, pathCount }: TracingControlsProps) {
  const isDefault = NUMERIC_TRACING_SETTINGS.every((spec) => settings[spec.key] === DEFAULT_TRACING_SETTINGS[spec.key]) &&
    settings.autoThreshold === DEFAULT_TRACING_SETTINGS.autoThreshold;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Trace settings</h3>
        <p className="mt-1 text-xs text-slate-500">
          The preview updates automatically a moment after each change. Tuned for scanned line drawings.
        </p>
      </div>

      <div role="status" aria-live="polite" className="min-h-4 text-xs text-slate-400">
        {isTracing ? (
          <span className="flex items-center gap-2 text-indigo-300">
            <Spinner />
            Updating preview…
          </span>
        ) : pathCount === null ? null : pathCount === 0 ? (
          <span className="text-amber-300">
            No paths were found with these settings — try raising the threshold or lowering noise reduction.
          </span>
        ) : (
          <span>
            Preview is up to date · {pathCount} path{pathCount === 1 ? "" : "s"} traced
          </span>
        )}
      </div>

      <label className="flex items-start gap-2 text-xs font-medium text-slate-300">
        <input
          type="checkbox"
          checked={settings.autoThreshold}
          onChange={(e) => onChange({ ...settings, autoThreshold: e.target.checked })}
          className="mt-0.5 accent-indigo-500"
        />
        <span>
          Auto threshold (Otsu)
          <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
            Picks the black/white threshold from the image instead of the value below.
          </span>
        </span>
      </label>

      {NUMERIC_TRACING_SETTINGS.map((spec) => (
        <NumberSliderField
          key={spec.key}
          label={spec.label}
          hint={spec.hint}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={settings[spec.key]}
          disabled={spec.key === "threshold" && settings.autoThreshold}
          onChange={(value) => onChange({ ...settings, [spec.key]: value })}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetrace}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          Retrace now
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_TRACING_SETTINGS })}
          disabled={isDefault}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
