import { describe, expect, it } from "vitest";
import {
  buildImageTracerOptions,
  noiseReductionToBlurRadius,
  smoothingToSimplifyEpsilonPx,
} from "../traceOptions";
import { DEFAULT_TRACING_SETTINGS } from "../../types";

describe("buildImageTracerOptions", () => {
  it("maps higher smoothing to looser line/curve error tolerances", () => {
    const low = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing: 0 });
    const high = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing: 10 });
    expect(high.ltres).toBeGreaterThan(low.ltres);
    expect(high.qtres).toBeGreaterThan(low.qtres);
  });

  it("keeps both fitting tolerances in 0.5-0.7 across the whole smoothing range, equal and non-decreasing", () => {
    let previous = { ltres: -Infinity, qtres: -Infinity };
    for (let smoothing = 0; smoothing <= 10; smoothing++) {
      const { ltres, qtres } = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing });
      expect(ltres, `smoothing ${smoothing}`).toBeGreaterThanOrEqual(0.5);
      expect(ltres, `smoothing ${smoothing}`).toBeLessThanOrEqual(0.7 + 1e-9);
      expect(qtres, `smoothing ${smoothing}`).toBe(ltres);
      expect(ltres, `smoothing ${smoothing}`).toBeGreaterThanOrEqual(previous.ltres);
      previous = { ltres, qtres };
    }
    expect(buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing: 0 }).ltres).toBeCloseTo(0.5, 10);
    expect(buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing: 10 }).ltres).toBeCloseTo(0.7, 10);
  });

  it("does not let the smoothing slider change anything except the two tolerances", () => {
    const { ltres: _l0, qtres: _q0, ...rest0 } = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing: 0 });
    const { ltres: _l1, qtres: _q1, ...rest10 } = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, smoothing: 10 });
    expect(rest10).toEqual(rest0);
  });

  it("maps higher detail preservation to a smaller pathomit (keeps smaller paths)", () => {
    const low = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, detail: 0 });
    const high = buildImageTracerOptions({ ...DEFAULT_TRACING_SETTINGS, detail: 10 });
    expect(high.pathomit).toBeLessThan(low.pathomit);
  });

  it("always requests a 2-color (black/white) palette since input is pre-binarized", () => {
    const options = buildImageTracerOptions(DEFAULT_TRACING_SETTINGS);
    expect(options.numberofcolors).toBe(2);
  });
});

describe("noiseReductionToBlurRadius", () => {
  it("applies no blur at the default slider value, to avoid erasing thin real linework", () => {
    expect(noiseReductionToBlurRadius(DEFAULT_TRACING_SETTINGS.noiseReduction)).toBe(0);
  });

  it("applies no blur anywhere in the low half of the slider range", () => {
    for (let n = 0; n <= 4; n++) {
      expect(noiseReductionToBlurRadius(n)).toBe(0);
    }
  });

  it("ramps up blur radius only once the user explicitly asks for stronger denoising", () => {
    expect(noiseReductionToBlurRadius(5)).toBe(1);
    expect(noiseReductionToBlurRadius(7)).toBe(1);
    expect(noiseReductionToBlurRadius(8)).toBe(2);
    expect(noiseReductionToBlurRadius(10)).toBe(2);
  });

  it("never exceeds a 2px radius, to limit how much thin detail aggressive denoising costs", () => {
    for (let n = 0; n <= 10; n++) {
      expect(noiseReductionToBlurRadius(n)).toBeLessThanOrEqual(2);
    }
  });
});

describe("smoothingToSimplifyEpsilonPx", () => {
  it("stays within a small sub-2px range across the whole slider", () => {
    for (let s = 0; s <= 10; s++) {
      const eps = smoothingToSimplifyEpsilonPx(s);
      expect(eps).toBeGreaterThan(0);
      expect(eps).toBeLessThanOrEqual(1.5);
    }
  });

  it("increases monotonically with the smoothing slider", () => {
    expect(smoothingToSimplifyEpsilonPx(10)).toBeGreaterThan(smoothingToSimplifyEpsilonPx(0));
    expect(smoothingToSimplifyEpsilonPx(5)).toBeGreaterThan(smoothingToSimplifyEpsilonPx(0));
    expect(smoothingToSimplifyEpsilonPx(10)).toBeGreaterThan(smoothingToSimplifyEpsilonPx(5));
  });
});
