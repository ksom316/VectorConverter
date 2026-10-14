import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRACING_SETTINGS, type TracingSettings, type VectorGeometry } from "../../lib/types";
import { isDegenerateRing } from "../../lib/trace/geometry";
import type { TraceWorkerResponse } from "../trace.worker";

// Spy on despeckle() while keeping its real implementation, so the noise -> minimum-area
// mapping inside the worker can be observed without changing worker code.
const despeckleSpy = vi.hoisted(() => vi.fn());
vi.mock("../../lib/trace/preprocess", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/trace/preprocess")>();
  despeckleSpy.mockImplementation(original.despeckle);
  return { ...original, despeckle: despeckleSpy };
});

type WorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
};
const scope = self as unknown as WorkerScope;
const postMessageMock = vi.fn();

/** 120x100 white page: a 3px wall outline, a 1px 45-degree stroke attached to it, and a bar. */
function drawingPixels() {
  const width = 120;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  };
  for (let x = 10; x < 90; x++) for (let t = 0; t < 3; t++) { ink(x, 10 + t); ink(x, 70 + t); }
  for (let y = 10; y < 73; y++) for (let t = 0; t < 3; t++) { ink(10 + t, y); ink(87 + t, y); }
  for (let i = 0; i < 25; i++) ink(13 + i, 13 + i); // 1px diagonal, touching the wall corner
  for (let x = 95; x < 115; x++) for (let y = 40; y < 45; y++) ink(x, y);
  return { width, height, data };
}

function runWorker(
  settings: TracingSettings,
  pixels: { width: number; height: number; data: Uint8ClampedArray } = drawingPixels(),
): VectorGeometry {
  const { width, height, data } = pixels;
  postMessageMock.mockClear();
  scope.onmessage!({ data: { imageData: { width, height, data }, settings } });
  const response = postMessageMock.mock.calls.at(-1)![0] as TraceWorkerResponse;
  if (!response.ok) throw new Error(response.error);
  return response.result.geometry;
}

function segmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  const o = (p: typeof a, q: typeof a, r: typeof a) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function selfCrossings(ring: { x: number; y: number }[]): number {
  const n = ring.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) count++;
    }
  }
  return count;
}

beforeAll(async () => {
  scope.postMessage = postMessageMock;
  await import("../trace.worker");
});
beforeEach(() => {
  despeckleSpy.mockClear();
});

describe("default tracing settings", () => {
  it("defaults noise reduction to 1 and leaves every other default unchanged", () => {
    expect(DEFAULT_TRACING_SETTINGS).toEqual({
      threshold: 128,
      autoThreshold: false,
      noiseReduction: 1,
      smoothing: 4,
      detail: 6,
    });
  });
});

describe("noise reduction -> minimum despeckle area (worker mapping unchanged)", () => {
  it("uses round(noise / 10 * 40) for every slider value and skips despeckle at 0", () => {
    const expected = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40];
    for (let noise = 0; noise <= 10; noise++) {
      despeckleSpy.mockClear();
      runWorker({ ...DEFAULT_TRACING_SETTINGS, noiseReduction: noise });
      if (expected[noise] === 0) {
        expect(despeckleSpy, `noise ${noise}`).not.toHaveBeenCalled();
      } else {
        expect(despeckleSpy, `noise ${noise}`).toHaveBeenCalledTimes(1);
        expect(despeckleSpy.mock.calls[0][1], `noise ${noise}`).toBe(expected[noise]);
      }
    }
  });

  it("applies the new default (minimum area 4) when settings come from DEFAULT_TRACING_SETTINGS", () => {
    runWorker(DEFAULT_TRACING_SETTINGS);
    expect(despeckleSpy).toHaveBeenCalledTimes(1);
    expect(despeckleSpy.mock.calls[0][1]).toBe(4);
  });

  it("lets an explicit user-selected noise value override the default", () => {
    runWorker({ ...DEFAULT_TRACING_SETTINGS, noiseReduction: 3 });
    expect(despeckleSpy.mock.calls[0][1]).toBe(12);
    despeckleSpy.mockClear();
    runWorker({ ...DEFAULT_TRACING_SETTINGS, noiseReduction: 0 });
    expect(despeckleSpy).not.toHaveBeenCalled();
  });
});

describe("closed-contour regression matrix at the new default noise", () => {
  for (const smoothing of [0, 2, 4, 6, 8, 10]) {
    it(`smoothing ${smoothing}: no zero-area rings, no self-crossings, diagonal stroke kept`, () => {
      const geometry = runWorker({ ...DEFAULT_TRACING_SETTINGS, smoothing });
      const rings = geometry.contours.flatMap((c) => [c.points, ...c.holes]);
      expect(geometry.contours.length).toBeGreaterThanOrEqual(2);
      for (const ring of rings) {
        expect(isDegenerateRing(ring)).toBe(false);
        expect(selfCrossings(ring)).toBe(0);
        expect(new Set(ring.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThanOrEqual(3);
      }
      // The 1px diagonal runs (13,13)-(37,37) and is 8-connected to the wall corner, so a vertex
      // must survive at its far tip, well inside the room.
      const hasTip = rings.some((ring) => ring.some((p) => p.x >= 34 && p.x <= 41 && p.y >= 34 && p.y <= 41));
      expect(hasTip).toBe(true);
    });
  }
});

describe("uneven paper tone", () => {
  /** Scan-like page: paper brightens from left to right, 1px diagonal hatching a constant 45 levels darker than the paper. */
  function driftingHatchPage() {
    const width = 240;
    const height = 80;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const paper = Math.round(200 + (36 * x) / (width - 1));
        const v = (x + y) % 5 === 0 ? paper - 45 : paper;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width, height, data };
  }

  /** Total filled area (outer rings minus holes) whose bounding-box centre lies in [x0, x1). */
  function filledArea(geometry: VectorGeometry, x0: number, x1: number): number {
    const area = (ring: { x: number; y: number }[]) =>
      Math.abs(ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0)) / 2;
    let total = 0;
    for (const contour of geometry.contours) {
      const xs = contour.points.map((p) => p.x);
      const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
      if (centre >= x0 && centre < x1) total += area(contour.points) - contour.holes.reduce((s, h) => s + area(h), 0);
    }
    return total;
  }

  it("traces the same amount of hatching on the dark and the bright side of the sheet", () => {
    // 178 sits above the strokes on the dark-paper side (about 155-170) but below them on the bright side
    // (about 190), so without paper-tone flattening only the left of the sheet would be traced.
    const geometry = runWorker({ ...DEFAULT_TRACING_SETTINGS, threshold: 178, noiseReduction: 0, smoothing: 2 }, driftingHatchPage());
    const left = filledArea(geometry, 0, 80);
    const right = filledArea(geometry, 160, 240);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.min(left, right) / Math.max(left, right)).toBeGreaterThan(0.7);
  });
});
