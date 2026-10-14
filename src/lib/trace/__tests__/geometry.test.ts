import { describe, expect, it } from "vitest";
import { extractForegroundGeometry } from "../geometry";

describe("extractForegroundGeometry", () => {
  it("keeps only the darkest palette layer and ignores the background layer", () => {
    const tracedata = {
      palette: [
        { r: 255, g: 255, b: 255, a: 255 }, // background (white)
        { r: 0, g: 0, b: 0, a: 255 }, // foreground (black)
      ],
      layers: [
        [
          {
            segments: [
              { type: "L" as const, x1: 0, y1: 0, x2: 100, y2: 0 },
              { type: "L" as const, x1: 100, y1: 0, x2: 100, y2: 100 },
              { type: "L" as const, x1: 100, y1: 100, x2: 0, y2: 100 },
            ],
            holechildren: [],
            isholepath: false,
          },
        ],
        [
          {
            segments: [
              { type: "L" as const, x1: 10, y1: 10, x2: 20, y2: 10 },
              { type: "L" as const, x1: 20, y1: 10, x2: 20, y2: 20 },
              { type: "L" as const, x1: 20, y1: 20, x2: 10, y2: 20 },
            ],
            holechildren: [1],
            isholepath: false,
          },
          {
            segments: [
              { type: "L" as const, x1: 12, y1: 12, x2: 18, y2: 12 },
              { type: "L" as const, x1: 18, y1: 12, x2: 18, y2: 18 },
              { type: "L" as const, x1: 18, y1: 18, x2: 12, y2: 18 },
            ],
            holechildren: [],
            isholepath: true,
          },
        ],
      ],
    };

    const geometry = extractForegroundGeometry(tracedata, 100, 100);

    expect(geometry.contours).toHaveLength(1);
    expect(geometry.contours[0].colorHex).toBe("#000000");
    expect(geometry.contours[0].points.length).toBeGreaterThanOrEqual(3);
    expect(geometry.contours[0].holes).toHaveLength(1);
  });

  it("samples quadratic curve segments into multiple line points", () => {
    const tracedata = {
      palette: [{ r: 0, g: 0, b: 0, a: 255 }],
      layers: [
        [
          {
            segments: [
              { type: "Q" as const, x1: 0, y1: 0, x2: 50, y2: 50, x3: 100, y3: 0 },
              { type: "L" as const, x1: 100, y1: 0, x2: 0, y2: 0 },
            ],
            holechildren: [],
            isholepath: false,
          },
        ],
      ],
    };

    const geometry = extractForegroundGeometry(tracedata, 100, 100);
    // 1 start point + 8 sampled curve points; the closing line ends back on the start point,
    // which is not repeated.
    expect(geometry.contours[0].points.length).toBe(9);
  });

  it("returns no contours when every path is a hole or the layer is empty", () => {
    const tracedata = { palette: [{ r: 0, g: 0, b: 0, a: 255 }], layers: [[]] };
    const geometry = extractForegroundGeometry(tracedata, 50, 50);
    expect(geometry.contours).toHaveLength(0);
  });

  it("captures an island nested inside a hole (3 levels deep) as its own filled contour", () => {
    // path0: outer ink square, with a hole (path1); path1: the hole, itself containing an
    // island (path2) — e.g. a ring/annulus shape such as a round column with a solid core,
    // or a wall opening with an inner sill detail.
    const tracedata = {
      palette: [{ r: 0, g: 0, b: 0, a: 255 }],
      layers: [
        [
          {
            segments: [
              { type: "L" as const, x1: 0, y1: 0, x2: 100, y2: 0 },
              { type: "L" as const, x1: 100, y1: 0, x2: 100, y2: 100 },
              { type: "L" as const, x1: 100, y1: 100, x2: 0, y2: 100 },
            ],
            holechildren: [1],
            isholepath: false,
          },
          {
            segments: [
              { type: "L" as const, x1: 20, y1: 20, x2: 80, y2: 20 },
              { type: "L" as const, x1: 80, y1: 20, x2: 80, y2: 80 },
              { type: "L" as const, x1: 80, y1: 80, x2: 20, y2: 80 },
            ],
            holechildren: [2],
            isholepath: true,
          },
          {
            segments: [
              { type: "L" as const, x1: 40, y1: 40, x2: 60, y2: 40 },
              { type: "L" as const, x1: 60, y1: 40, x2: 60, y2: 60 },
              { type: "L" as const, x1: 60, y1: 60, x2: 40, y2: 60 },
            ],
            holechildren: [],
            isholepath: false,
          },
        ],
      ],
    };

    const geometry = extractForegroundGeometry(tracedata, 100, 100);

    // Expect two separately filled contours: the outer square (with its hole cut out) and
    // the inner island, so the composite rendering reconstructs the ring correctly.
    expect(geometry.contours).toHaveLength(2);
    const outer = geometry.contours.find((c) => c.holes.length === 1);
    const island = geometry.contours.find((c) => c.holes.length === 0);
    expect(outer).toBeDefined();
    expect(island).toBeDefined();
    expect(island?.points.some((p) => p.x === 40 && p.y === 40)).toBe(true);
  });
});

/** Builds a closed-polygon tracedata fixture directly from a point list, as straight 'L' segments. */
function tracedataFromPoints(points: { x: number; y: number }[]) {
  const segments = points.map((p, i) => {
    const next = points[(i + 1) % points.length];
    return { type: "L" as const, x1: p.x, y1: p.y, x2: next.x, y2: next.y };
  });
  return {
    palette: [{ r: 0, g: 0, b: 0, a: 255 }],
    layers: [[{ segments, holechildren: [], isholepath: false }]],
  };
}

describe("extractForegroundGeometry simplification (simplifyEpsilonPx)", () => {
  it("collapses pixel-staircase wobble along an otherwise-straight wall into far fewer points", () => {
    // A near-vertical "wall" from (0,0) to (0,200) traced as a 1px-jittering staircase, the
    // way a JPEG-compressed straight CAD line commonly comes out after thresholding.
    const points: { x: number; y: number }[] = [];
    for (let y = 0; y <= 200; y++) {
      const jitter = y % 2 === 0 ? 0 : 1;
      points.push({ x: jitter, y });
    }
    // Close the loop with a short return leg so it forms a valid polygon.
    points.push({ x: 3, y: 200 });
    points.push({ x: 3, y: 0 });

    const tracedata = tracedataFromPoints(points);
    const raw = extractForegroundGeometry(tracedata, 10, 210, 0);
    const simplified = extractForegroundGeometry(tracedata, 10, 210, 1.5);

    // tracedataFromPoints wraps the last segment back to the first point; that closing
    // point is not carried into the ring, so the count matches the input list.
    expect(raw.contours[0].points.length).toBe(points.length);
    expect(simplified.contours[0].points.length).toBeLessThan(raw.contours[0].points.length / 5);
  });

  it("preserves a sharp right-angle corner exactly", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const tracedata = tracedataFromPoints(points);
    const geometry = extractForegroundGeometry(tracedata, 100, 100, 1.5);
    expect(geometry.contours[0].points).toContainEqual({ x: 100, y: 0 });
    expect(geometry.contours[0].points).toContainEqual({ x: 0, y: 100 });
  });

  it("preserves a genuine 45-degree diagonal segment without snapping it to horizontal/vertical", () => {
    // An angled bay-window-style wall: horizontal, then a 45-degree diagonal, then horizontal.
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 50 }, // 45-degree corner
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 0, y: 150 },
    ];
    const tracedata = tracedataFromPoints(points);
    const geometry = extractForegroundGeometry(tracedata, 150, 150, 1.5);
    const result = geometry.contours[0].points;
    // The 45-degree corner vertices must survive untouched — not averaged or axis-snapped.
    expect(result).toContainEqual({ x: 50, y: 0 });
    expect(result).toContainEqual({ x: 100, y: 50 });
  });

  it("does not merge or destroy a small notch/opening whose deviation exceeds epsilon", () => {
    // A small rectangular notch cut into an otherwise straight wall (e.g. a narrow opening),
    // 6px deep — well beyond the ~1.5px default simplification tolerance.
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 6 },
      { x: 60, y: 6 },
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const tracedata = tracedataFromPoints(points);
    const geometry = extractForegroundGeometry(tracedata, 100, 100, 1.5);
    const result = geometry.contours[0].points;
    expect(result).toContainEqual({ x: 40, y: 6 });
    expect(result).toContainEqual({ x: 60, y: 6 });
  });

  it("falls back to the unsimplified points if simplification would degenerate the contour", () => {
    // 3 nearly-collinear points where RDP (if unguarded) could in principle drop below a
    // usable polygon; the fallback in simplifyContourPoints keeps the original instead.
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0.1 },
      { x: 100, y: 0 },
    ];
    const tracedata = tracedataFromPoints(points);
    const geometry = extractForegroundGeometry(tracedata, 100, 100, 50); // deliberately huge epsilon
    expect(geometry.contours[0].points).toEqual(points);
  });

  it("is a no-op when simplifyEpsilonPx is 0 (the default)", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0.3 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const tracedata = tracedataFromPoints(points);
    const geometry = extractForegroundGeometry(tracedata, 100, 100);
    expect(geometry.contours[0].points.length).toBe(points.length);
  });
});
