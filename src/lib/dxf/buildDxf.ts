import { DxfWriter, LWPolylineFlags, Units, point2d, point3d } from "@tarikjabiri/dxf";
import type { Calibration, LengthUnit, VectorGeometry } from "../types";

const UNIT_TO_DXF: Record<LengthUnit, Units> = {
  mm: Units.Millimeters,
  cm: Units.Centimeters,
  m: Units.Meters,
};

export interface DxfBuildOptions {
  /** When set, coordinates are scaled from pixels to real-world units using this calibration. */
  calibration?: Calibration;
}

/** units-per-pixel derived from a two-point calibration measurement. */
export function unitsPerPixel(calibration: Calibration): number {
  const dx = calibration.pointB.x - calibration.pointA.x;
  const dy = calibration.pointB.y - calibration.pointA.y;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  if (pixelDist === 0) return 1;
  return calibration.realDistance / pixelDist;
}

/** True for a ring of exactly two points that are not the same point (a line segment, not a polygon). */
function isDistinctTwoPointContour(points: { x: number; y: number }[]): boolean {
  return points.length === 2 && (points[0].x !== points[1].x || points[0].y !== points[1].y);
}

/**
 * Builds a DXF document from traced vector geometry.
 *
 * Coordinate handling:
 * - Image pixel space has Y increasing downward; DXF (and CAD convention) has Y increasing
 *   upward, so every Y coordinate is inverted against the image height.
 * - Without calibration, geometry is exported 1 drawing-unit = 1 source pixel (unitless) —
 *   this is explicitly NOT a real-world measurement.
 * - With calibration, coordinates are scaled by `unitsPerPixel` and the DXF $INSUNITS header
 *   is set to the calibration's chosen unit (mm/cm/m).
 *
 * Curve approximation: ImageTracer's quadratic Bezier segments were already flattened to
 * straight line segments (8 samples per curve, see lib/trace/geometry.ts) before reaching
 * this builder, so every contour here is exported as a closed polyline (LWPOLYLINE) of
 * straight segments — no DXF spline entities are used, and tight curves are approximated, not
 * exact.
 *
 * One exception: a contour with exactly two distinct points has zero area and is a stroke
 * fragment, not a polygon (ImageTracer collapses tiny 1px strokes to this). It is exported as a
 * LINE entity so CAD software sees a line rather than a closed two-vertex polygon. This applies
 * to contours only — holes always stay closed polylines — and the SVG output is unaffected.
 */
export function buildDxfFromGeometry(geometry: VectorGeometry, options: DxfBuildOptions = {}): string {
  const writer = new DxfWriter();
  const { calibration } = options;
  const scale = calibration ? unitsPerPixel(calibration) : 1;

  if (calibration) {
    writer.setUnits(UNIT_TO_DXF[calibration.unit]);
  } else {
    writer.setUnits(Units.Unitless);
  }

  const toDxfVertex = (p: { x: number; y: number }) => ({
    point: point2d(p.x * scale, (geometry.height - p.y) * scale),
  });

  for (const contour of geometry.contours) {
    if (isDistinctTwoPointContour(contour.points)) {
      const [start, end] = contour.points;
      writer.addLine(
        point3d(start.x * scale, (geometry.height - start.y) * scale, 0),
        point3d(end.x * scale, (geometry.height - end.y) * scale, 0),
      );
    } else if (contour.points.length >= 2) {
      writer.addLWPolyline(contour.points.map(toDxfVertex), {
        flags: LWPolylineFlags.Closed,
      });
    }
    for (const hole of contour.holes) {
      if (hole.length >= 2) {
        writer.addLWPolyline(hole.map(toDxfVertex), {
          flags: LWPolylineFlags.Closed,
        });
      }
    }
  }

  return writer.stringify();
}
