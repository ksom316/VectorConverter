import { describe, expect, it } from "vitest";
import { describeCalibration, pixelDistanceBetween, unitsPerPixel } from "../calibration";
import type { Calibration } from "../../types";

describe("calibration math", () => {
  it("computes pixel distance between two points", () => {
    expect(pixelDistanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
  });

  it("derives units-per-pixel from a reference measurement", () => {
    const calibration: Calibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 50, y: 0 },
      realDistance: 500,
      unit: "cm",
    };
    expect(unitsPerPixel(calibration)).toBeCloseTo(10);
  });

  it("falls back to a scale of 1 when the two points coincide", () => {
    const calibration: Calibration = {
      pointA: { x: 5, y: 5 },
      pointB: { x: 5, y: 5 },
      realDistance: 100,
      unit: "mm",
    };
    expect(unitsPerPixel(calibration)).toBe(1);
  });

  it("describes the calibration scale in human-readable form", () => {
    const calibration: Calibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 100, y: 0 },
      realDistance: 1000,
      unit: "mm",
    };
    expect(describeCalibration(calibration)).toContain("mm");
    expect(describeCalibration(calibration)).toContain("1000 mm");
  });
});
