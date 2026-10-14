import type { TracedContour, VectorGeometry } from "../types";

interface ImageTracerSegment {
  type: "L" | "Q" | "C";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3?: number;
  y3?: number;
}

interface ImageTracerPath {
  segments: ImageTracerSegment[];
  holechildren: number[];
  isholepath: boolean;
}

interface ImageTracerData {
  layers: ImageTracerPath[][];
  palette: { r: number; g: number; b: number; a: number }[];
}

const CURVE_SAMPLES = 8;

/**
 * Rings no longer carry a repeated closing point, so this is the same cut-off the old
 * "length >= 3" check applied to a closed ring. ImageTracer does emit zero-area two-vertex
 * rings; degenerate contours are kept (and reported by isDegenerateRing) rather than silently
 * dropped, while degenerate holes are filtered out in extractForegroundGeometry().
 */
const MIN_RING_POINTS = 2;

function sampleQuadratic(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let s = 1; s <= CURVE_SAMPLES; s++) {
    const t = s / CURVE_SAMPLES;
    const mt = 1 - t;
    const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    points.push({ x, y });
  }
  return points;
}

function pathToPoints(path: ImageTracerPath): { x: number; y: number }[] {
  const segments = path.segments;
  if (segments.length === 0) return [];
  const points: { x: number; y: number }[] = [{ x: segments[0].x1, y: segments[0].y1 }];

  for (const seg of segments) {
    if (seg.type === "L") {
      points.push({ x: seg.x2, y: seg.y2 });
    } else if (typeof seg.x3 === "number" && typeof seg.y3 === "number") {
      points.push(...sampleQuadratic(seg.x1, seg.y1, seg.x2, seg.y2, seg.x3, seg.y3));
    } else {
      points.push({ x: seg.x2, y: seg.y2 });
    }
  }

  // ImageTracer's last segment ends where the first one starts. Rings here are implicitly
  // closed (SVG "Z", DXF closed flag), so the repeated start point is dropped rather than
  // carried as a zero-length closing edge.
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.x === last.x && first.y === last.y) points.pop();
  }

  return points;
}

type Point = { x: number; y: number };

/** Twice the signed area of an implicitly closed ring (shoelace formula). */
function signedAreaTimes2(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * A ring is degenerate when it has fewer than 3 distinct vertices or encloses no area
 * (all vertices collinear). Such a ring renders as nothing in SVG and as a bare line in DXF.
 */
export function isDegenerateRing(ring: Point[]): boolean {
  const distinct = new Set<string>();
  for (const p of ring) {
    distinct.add(`${p.x},${p.y}`);
    if (distinct.size >= 3) break;
  }
  return distinct.size < 3 || Math.abs(signedAreaTimes2(ring)) < 1e-9;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Counts proper crossings between non-adjacent edges of an implicitly closed ring (a
 * sweep over x, so it stays fast on long contours). Touching and collinear contact is not
 * counted: ImageTracer rings can legitimately touch themselves at pixel corners.
 */
function countSelfCrossings(ring: Point[]): number {
  const n = ring.length;
  if (n < 4) return 0;
  const edges = ring
    .map((a, i) => {
      const b = ring[(i + 1) % n];
      return { i, a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) };
    })
    .sort((e, f) => e.minX - f.minX);

  let crossings = 0;
  let active: typeof edges = [];
  for (const e of edges) {
    active = active.filter((f) => f.maxX >= e.minX);
    for (const f of active) {
      const gap = Math.abs(e.i - f.i);
      if (gap <= 1 || gap === n - 1) continue; // edges that share a vertex
      if (
        orientation(e.a, e.b, f.a) * orientation(e.a, e.b, f.b) < 0 &&
        orientation(f.a, f.b, e.a) * orientation(f.a, f.b, e.b) < 0
      ) {
        crossings++;
      }
    }
    active.push(e);
  }
  return crossings;
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 *
 * Removes points that lie within `epsilon` pixels of the straight line between their
 * neighbors, collapsing pixel-staircase/JPEG-artifact wobble along otherwise-straight runs
 * into a single clean segment. It is intentionally angle-agnostic: a point survives purely
 * because it deviates from its local chord by more than epsilon, not because of its angle.
 * This means genuine corners (any angle, including 45-degree bay-window walls) and the
 * control points of real curves are always kept — they deviate far more than a few pixels
 * from the chord between their neighbors — while nothing gets snapped or rounded to
 * horizontal/vertical. Endpoints are always preserved; for closed contours the endpoints are
 * the anchors chosen by simplifyClosedRing(). Implemented iteratively (an explicit
 * stack) rather than recursively so it stays safe on the largest traced contours (a single
 * connected wall outline in a floor plan can have several thousand raw points).
 */
function simplifyPolyline(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
  if (epsilon <= 0 || points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    if (endIdx <= startIdx + 1) continue;

    const start = points[startIdx];
    const end = points[endIdx];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segLengthSq = dx * dx + dy * dy;

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i++) {
      const p = points[i];
      let dist: number;
      if (segLengthSq === 0) {
        dist = Math.hypot(p.x - start.x, p.y - start.y);
      } else {
        // Perpendicular distance from p to the infinite line through start/end.
        dist = Math.abs(dy * p.x - dx * p.y + end.x * start.y - end.y * start.x) / Math.sqrt(segLengthSq);
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx]);
      stack.push([maxIdx, endIdx]);
    }
  }

  const simplified: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) simplified.push(points[i]);
  }
  return simplified;
}

function farthestIndexFrom(points: Point[], from: number): number {
  const origin = points[from];
  let best = from;
  let bestDistSq = -1;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - origin.x;
    const dy = points[i].y - origin.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > bestDistSq) {
      bestDistSq = distSq;
      best = i;
    }
  }
  return best;
}

/**
 * Simplifies an implicitly closed ring. A ring has no natural endpoints, so instead of
 * letting the arbitrary start vertex act as one (which always keeps it, even mid-wall, and
 * makes the result depend on where ImageTracer began the path), the ring is anchored at two
 * far-apart extreme points and each of the two chains between them is simplified as an open
 * polyline. The anchors approximate the ring's diameter, so they are stable under rotation
 * of the start vertex and are genuine extremities of the shape.
 */
function simplifyClosedRing(ring: Point[], epsilon: number): Point[] {
  if (epsilon <= 0 || ring.length < 4) return ring;

  const q = farthestIndexFrom(ring, farthestIndexFrom(ring, 0));
  const r = farthestIndexFrom(ring, q);
  if (q === r) return ring;
  const lo = Math.min(q, r);
  const hi = Math.max(q, r);

  const chainA = simplifyPolyline(ring.slice(lo, hi + 1), epsilon);
  const chainB = simplifyPolyline(ring.slice(hi).concat(ring.slice(0, lo + 1)), epsilon);
  // chainA runs lo..hi and chainB runs hi..lo, so dropping chainB's endpoints joins them.
  return chainA.concat(chainB.slice(1, -1));
}

/**
 * If simplification makes edges of the ring cross each other (two walls closer together than
 * epsilon get pulled through one another), the contour is retried at these fractions of the
 * requested epsilon before giving up. Degenerate collapse is not retried: it means the
 * feature is thinner than epsilon, so the source ring is kept.
 */
const CROSSING_RETRY_FACTORS = [1, 0.5, 0.25];

/**
 * Simplifies a closed contour, falling back to the original ring whenever simplification
 * would make it invalid: fewer than 3 distinct vertices, zero area, flipped winding, or new
 * self-crossings that persist at every retry epsilon. A source ring that is already
 * degenerate is returned untouched — it is not repaired, only left as ImageTracer produced it.
 */
export function simplifyContourPoints(points: Point[], epsilon: number): Point[] {
  if (epsilon <= 0 || isDegenerateRing(points)) return points;

  const sourceSign = Math.sign(signedAreaTimes2(points));
  let sourceCrossings: number | undefined;
  for (const factor of CROSSING_RETRY_FACTORS) {
    const simplified = simplifyClosedRing(points, epsilon * factor);
    if (simplified.length === points.length) return points;
    if (isDegenerateRing(simplified)) return points;
    if (Math.sign(signedAreaTimes2(simplified)) !== sourceSign) return points;

    const crossings = countSelfCrossings(simplified);
    if (crossings === 0) return simplified;
    sourceCrossings ??= countSelfCrossings(points);
    if (crossings <= sourceCrossings) return simplified;
  }
  return points;
}

function colorToHex(c: { r: number; g: number; b: number }): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

function luminance(c: { r: number; g: number; b: number }): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/**
 * Extracts flattened contour geometry (curves sampled to line segments) from ImageTracer's
 * internal tracedata, keeping only the darkest palette layer — our drawing's ink/strokes —
 * and skipping the full-canvas background rectangle layer that ImageTracer also produces.
 *
 * `simplifyEpsilonPx` (default 0, meaning no simplification) runs each contour and hole
 * through Ramer-Douglas-Peucker simplification at that pixel tolerance, removing the
 * pixel-staircase/JPEG-artifact wobble ImageTracer's own curve fitting can leave behind
 * without snapping any angle — see simplifyPolyline() above.
 */
export function extractForegroundGeometry(
  tracedata: ImageTracerData,
  width: number,
  height: number,
  simplifyEpsilonPx = 0,
): VectorGeometry {
  let darkestLayerIndex = -1;
  let darkestLuminance = Infinity;
  tracedata.palette.forEach((color, index) => {
    const lum = luminance(color);
    if (lum < darkestLuminance) {
      darkestLuminance = lum;
      darkestLayerIndex = index;
    }
  });

  const contours: TracedContour[] = [];
  if (darkestLayerIndex >= 0) {
    const layer = tracedata.layers[darkestLayerIndex];
    const color = colorToHex(tracedata.palette[darkestLayerIndex]);
    layer.forEach((path) => {
      if (path.isholepath) return; // handled as a hole of its parent below
      const rawPoints = pathToPoints(path);
      if (rawPoints.length < MIN_RING_POINTS) return;
      const points = simplifyContourPoints(rawPoints, simplifyEpsilonPx);
      const holes = path.holechildren
        .map((childIndex) => pathToPoints(layer[childIndex]))
        // ImageTracer collapses very small holes to zero-area rings at looser fitting tolerances.
        // They fill nothing in SVG and export as a stray two-point line in DXF, so they are dropped
        // here (any valid hole, however small, is kept). Degenerate contours are left unchanged.
        .filter((holePoints) => !isDegenerateRing(holePoints))
        .map((holePoints) => simplifyContourPoints(holePoints, simplifyEpsilonPx));
      contours.push({ points, holes, colorHex: color });
    });
  }

  return { width, height, contours };
}
