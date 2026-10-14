import { describe, expect, it } from "vitest";
import ImageTracer from "imagetracerjs";
import { buildImageTracerOptions, smoothingToSimplifyEpsilonPx } from "../traceOptions";
import { extractForegroundGeometry, isDegenerateRing } from "../geometry";
import { DEFAULT_TRACING_SETTINGS } from "../../types";

type Pixel = [number, number];
interface Feature {
  name: string;
  /** Ink pixels of the feature. */
  ink: Pixel[];
  /** Minimum share of those ink pixels the traced geometry must cover. */
  minCoverage: number;
}

const WIDTH = 200;
const HEIGHT = 130;

const line = (count: number, at: (i: number) => Pixel): Pixel[] => Array.from({ length: count }, (_, i) => at(i));

/** A solid block with a square white hole in its middle. */
function block(x0: number, y0: number, size: number, hole: number): Pixel[] {
  const inset = Math.floor((size - hole) / 2);
  const pixels: Pixel[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inHole = x >= inset && x < inset + hole && y >= inset && y < inset + hole;
      if (!inHole) pixels.push([x0 + x, y0 + y]);
    }
  }
  return pixels;
}

const features: Feature[] = [
  { name: "horizontal 1px line", ink: line(61, (i) => [10 + i, 15]), minCoverage: 0.9 },
  { name: "vertical 1px line", ink: line(61, (i) => [90, 10 + i]), minCoverage: 0.9 },
  { name: "45-degree 1px stroke", ink: line(41, (i) => [110 + i, 10 + i]), minCoverage: 0.85 },
  { name: "shallow 1px diagonal", ink: line(61, (i) => [10 + i, 40 + Math.floor(i / 2)]), minCoverage: 0.85 },
  // five separate 1px hatch strokes, 8px apart
  ...[0, 1, 2, 3, 4].map((k) => ({
    name: `hatch stroke ${k + 1}`,
    ink: line(20, (i): Pixel => [110 + k * 8 + i, 95 - i]),
    minCoverage: 0.8,
  })),
];
// small enclosed features: a 2x2 and a 3x3 counter inside solid blocks
const counters = [
  { name: "2x2 counter", ink: block(20, 100, 9, 2), box: { x0: 20, y0: 100, size: 9 } },
  { name: "3x3 counter", ink: block(50, 100, 12, 3), box: { x0: 50, y0: 100, size: 12 } },
];

function buildImage(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  const all = [...features.flatMap((f) => f.ink), ...counters.flatMap((c) => c.ink)];
  for (const [x, y] of all) {
    const i = (y * WIDTH + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return data;
}

type Geometry = ReturnType<typeof extractForegroundGeometry>;

function trace(smoothing: number): Geometry {
  const settings = { ...DEFAULT_TRACING_SETTINGS, smoothing };
  const options = ImageTracer.checkoptions(buildImageTracerOptions(settings));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracedata = ImageTracer.imagedataToTracedata({ width: WIDTH, height: HEIGHT, data: buildImage() }, options) as any;
  return extractForegroundGeometry(tracedata, WIDTH, HEIGHT, smoothingToSimplifyEpsilonPx(smoothing));
}

/** Scanline even-odd fill of every contour (each with its holes), unioned, sampled at pixel centres. */
function fill(geometry: Geometry): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT);
  for (const contour of geometry.contours) {
    const rows: number[][] = Array.from({ length: HEIGHT }, () => []);
    for (const ring of [contour.points, ...contour.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a.y === b.y) continue;
        const lo = Math.min(a.y, b.y);
        const hi = Math.max(a.y, b.y);
        for (let y = Math.max(0, Math.ceil(lo - 0.5)); y <= Math.min(HEIGHT - 1, Math.ceil(hi - 0.5) - 1); y++) {
          const yc = y + 0.5;
          if (yc >= lo && yc < hi) rows[y].push(a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
    }
    rows.forEach((xs, y) => {
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(WIDTH - 1, Math.ceil(xs[k + 1] - 0.5) - 1); x++) {
          out[y * WIDTH + x] = 1;
        }
      }
    });
  }
  return out;
}

/** 0 when the point is inside the filled geometry, otherwise the distance to the nearest outline edge. */
function distanceToGeometry(geometry: Geometry, px: number, py: number): number {
  let best = Infinity;
  for (const contour of geometry.contours) {
    let inside = false;
    for (const ring of [contour.points, ...contour.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSq));
        best = Math.min(best, Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)));
      }
    }
    if (inside) return 0;
  }
  return best;
}

const SMOOTHING_VALUES = [0, 2, 4, 6, 8, 10];

describe("thin strokes and small features survive tracing at every smoothing setting", () => {
  for (const smoothing of SMOOTHING_VALUES) {
    describe(`smoothing ${smoothing}`, () => {
      const geometry = trace(smoothing);

      it("produces no degenerate (zero-area) contours or holes", () => {
        const rings = geometry.contours.flatMap((c) => [c.points, ...c.holes]);
        expect(rings.length).toBeGreaterThan(0);
        for (const ring of rings) expect(isDegenerateRing(ring)).toBe(false);
      });

      for (const feature of features) {
        it(`keeps the ${feature.name} (>= ${Math.round(feature.minCoverage * 100)}% of its pixels covered)`, () => {
          // A traced outline of a 1px stroke is a straight band or tapered wedge that cannot contain every
          // pixel centre of a stair-stepped stroke, so a pixel counts as kept when its centre lies inside
          // the geometry or within 1px of its outline.
          const covered = feature.ink.filter(([x, y]) => distanceToGeometry(geometry, x + 0.5, y + 0.5) <= 1).length;
          expect(covered / feature.ink.length).toBeGreaterThanOrEqual(feature.minCoverage);
        });
      }

      for (const counter of counters) {
        it(`keeps the ${counter.name} as a hole inside its block`, () => {
          const { x0, y0, size } = counter.box;
          const inside = geometry.contours.flatMap((c) => c.holes).filter((hole) => {
            const cx = hole.reduce((s, p) => s + p.x, 0) / hole.length;
            const cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
            return cx > x0 && cx < x0 + size && cy > y0 && cy < y0 + size;
          });
          expect(inside).toHaveLength(1);
          expect(isDegenerateRing(inside[0])).toBe(false);
        });
      }
    });
  }

  it("keeps the strokes as separate features: neighbouring hatch strokes are not merged", () => {
    for (const smoothing of SMOOTHING_VALUES) {
      const filled = fill(trace(smoothing));
      // between two neighbouring 45-degree strokes (8px apart) the midpoint must stay empty
      for (let k = 0; k < 4; k++) {
        // stroke k passes (110 + 8k + 10, 85) and stroke k+1 passes (110 + 8k + 18, 85): test the middle
        const between: Pixel = [110 + k * 8 + 14, 95 - 10];
        expect(filled[between[1] * WIDTH + between[0]], `smoothing ${smoothing}, gap ${k}`).toBe(0);
      }
    }
  });
});
