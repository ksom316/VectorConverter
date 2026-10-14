import type { TracingSettings } from "../types";

export type NumericSettingKey = "threshold" | "noiseReduction" | "smoothing" | "detail";

export interface NumericSettingSpec {
  key: NumericSettingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}

/**
 * The valid range of every numeric tracing setting, taken from how the setting is consumed:
 * - threshold is compared with 8-bit luma (applyThreshold in lib/trace/preprocess.ts), so 0-255.
 * - noiseReduction, smoothing and detail are 0-10 sliders that the mappings in
 *   lib/trace/traceOptions.ts and workers/trace.worker.ts divide by 10 (noise -> despeckle area
 *   and blur radius, smoothing -> fit tolerance and simplification epsilon, detail -> pathomit).
 * All four are whole numbers.
 */
export const NUMERIC_TRACING_SETTINGS: readonly NumericSettingSpec[] = [
  {
    key: "threshold",
    label: "Black/white threshold",
    min: 0,
    max: 255,
    step: 1,
    hint: "Pixels darker than this become ink. Raise it to pick up fainter lines; lower it to ignore paper texture.",
  },
  {
    key: "noiseReduction",
    label: "Noise reduction",
    min: 0,
    max: 10,
    step: 1,
    hint: "Removes small specks before tracing; 0 keeps everything. Above 4 it also blurs, which can erase thin lines.",
  },
  {
    key: "smoothing",
    label: "Smoothing",
    min: 0,
    max: 10,
    step: 1,
    hint: "Higher values simplify outlines into fewer points; lower values follow the scan more closely.",
  },
  {
    key: "detail",
    label: "Detail preservation",
    min: 0,
    max: 10,
    step: 1,
    hint: "Higher values keep shorter, smaller paths; lower values drop tiny fragments.",
  },
];

/** Rounds to the setting's step and clamps into [min, max]. Non-finite input falls back to min. */
export function clampToSpec(spec: Pick<NumericSettingSpec, "min" | "max" | "step">, value: number): number {
  if (!Number.isFinite(value)) return spec.min;
  const stepped = Math.round(value / spec.step) * spec.step;
  return Math.min(spec.max, Math.max(spec.min, stepped));
}

/** A stable string identifying every setting that affects the traced result. */
export function tracingSettingsKey(settings: TracingSettings): string {
  return [settings.threshold, settings.autoThreshold ? 1 : 0, settings.noiseReduction, settings.smoothing, settings.detail].join(",");
}
