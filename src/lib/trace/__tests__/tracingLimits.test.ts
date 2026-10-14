import { describe, expect, it } from "vitest";
import { clampToSpec, NUMERIC_TRACING_SETTINGS, tracingSettingsKey } from "../tracingLimits";
import { buildImageTracerOptions, noiseReductionToBlurRadius, smoothingToSimplifyEpsilonPx } from "../traceOptions";
import { DEFAULT_TRACING_SETTINGS } from "../../types";

const spec = (key: string) => NUMERIC_TRACING_SETTINGS.find((s) => s.key === key)!;

describe("numeric tracing setting limits", () => {
  it("covers every numeric setting of TracingSettings exactly once", () => {
    const keys = NUMERIC_TRACING_SETTINGS.map((s) => s.key).sort();
    const numericKeys = Object.keys(DEFAULT_TRACING_SETTINGS)
      .filter((k) => typeof DEFAULT_TRACING_SETTINGS[k as keyof typeof DEFAULT_TRACING_SETTINGS] === "number")
      .sort();
    expect(keys).toEqual(numericKeys);
  });

  it("uses the ranges the mappings are defined over: threshold 0-255, everything else 0-10, whole steps", () => {
    expect([spec("threshold").min, spec("threshold").max]).toEqual([0, 255]);
    for (const key of ["noiseReduction", "smoothing", "detail"]) expect([spec(key).min, spec(key).max]).toEqual([0, 10]);
    for (const s of NUMERIC_TRACING_SETTINGS) expect(s.step).toBe(1);
  });

  it("keeps the application defaults inside every range", () => {
    for (const s of NUMERIC_TRACING_SETTINGS) {
      const value = DEFAULT_TRACING_SETTINGS[s.key];
      expect(value).toBeGreaterThanOrEqual(s.min);
      expect(value).toBeLessThanOrEqual(s.max);
    }
  });

  it("produces sane mapped values at both ends of every range (the limits are not arbitrary)", () => {
    for (const smoothing of [spec("smoothing").min, spec("smoothing").max]) {
      const { ltres } = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing });
      expect(ltres).toBeGreaterThanOrEqual(0.5);
      expect(ltres).toBeLessThanOrEqual(0.7 + 1e-9);
      expect(smoothingToSimplifyEpsilonPx(smoothing)).toBeGreaterThan(0);
    }
    for (const detail of [spec("detail").min, spec("detail").max]) {
      expect(buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, detail }).pathomit).toBeGreaterThanOrEqual(2);
    }
    expect(noiseReductionToBlurRadius(spec("noiseReduction").max)).toBe(2);
  });

  it("clamps and rounds into range, and falls back to the minimum for non-finite input", () => {
    expect(clampToSpec(spec("threshold"), 300)).toBe(255);
    expect(clampToSpec(spec("threshold"), -5)).toBe(0);
    expect(clampToSpec(spec("smoothing"), 4.4)).toBe(4);
    expect(clampToSpec(spec("smoothing"), 4.6)).toBe(5);
    expect(clampToSpec(spec("detail"), Number.NaN)).toBe(0);
    expect(clampToSpec(spec("detail"), Infinity)).toBe(0);
  });

  it("gives a different key whenever any tracing setting changes, and the same key otherwise", () => {
    const base = tracingSettingsKey(DEFAULT_TRACING_SETTINGS);
    expect(tracingSettingsKey({ ...DEFAULT_TRACING_SETTINGS })).toBe(base);
    const changed = [
      { threshold: 129 },
      { autoThreshold: true },
      { noiseReduction: 2 },
      { smoothing: 5 },
      { detail: 7 },
    ];
    for (const change of changed) expect(tracingSettingsKey({ ...DEFAULT_TRACING_SETTINGS, ...change })).not.toBe(base);
  });
});
