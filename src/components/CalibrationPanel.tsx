import type { Calibration, LengthUnit } from "../lib/types";
import { describeCalibration } from "../lib/calibration/calibration";

interface CalibrationPanelProps {
  isPicking: boolean;
  pickedPointCount: 0 | 1 | 2;
  calibration: Calibration | null;
  distanceInput: string;
  unit: LengthUnit;
  onStartPicking: () => void;
  onCancelPicking: () => void;
  onDistanceChange: (value: string) => void;
  onUnitChange: (unit: LengthUnit) => void;
  onSave: () => void;
  onClear: () => void;
}

export function CalibrationPanel({
  isPicking,
  pickedPointCount,
  calibration,
  distanceInput,
  unit,
  onStartPicking,
  onCancelPicking,
  onDistanceChange,
  onUnitChange,
  onSave,
  onClear,
}: CalibrationPanelProps) {
  const distanceValue = Number(distanceInput);
  const canSave = pickedPointCount === 2 && distanceValue > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Scale calibration (optional)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Pick two points on the drawing with a known real-world distance between them so the
          DXF export uses real measurements instead of raw image pixels.
        </p>
      </div>

      {calibration && !isPicking && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          Calibrated: {describeCalibration(calibration)}
        </div>
      )}

      {!calibration && !isPicking && (
        <div className="rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          Not calibrated — exports will use image-relative units (1 unit = 1 source pixel), not
          real-world dimensions.
        </div>
      )}

      {isPicking ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-400">
            Click two points in the preview ({pickedPointCount}/2 selected)
          </p>
          {pickedPointCount === 2 && (
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-300">
                Real-world distance
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={distanceInput}
                  onChange={(e) => onDistanceChange(e.target.value)}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  placeholder="e.g. 3200"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                Unit
                <select
                  value={unit}
                  onChange={(e) => onUnitChange(e.target.value as LengthUnit)}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save calibration
            </button>
            <button
              type="button"
              onClick={onCancelPicking}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onStartPicking}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            {calibration ? "Recalibrate" : "Pick two points"}
          </button>
          {calibration && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
