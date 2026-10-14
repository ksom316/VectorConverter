import type { Calibration, LengthUnit } from "../types";
import { unitsPerPixel } from "../dxf/buildDxf";

export const UNIT_LABELS: Record<LengthUnit, string> = {
  mm: "millimeters",
  cm: "centimeters",
  m: "meters",
};

export function pixelDistanceBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function describeCalibration(calibration: Calibration): string {
  const scale = unitsPerPixel(calibration);
  return `1 px = ${scale.toFixed(4)} ${calibration.unit} (from a ${calibration.realDistance} ${calibration.unit} reference)`;
}

export { unitsPerPixel };
