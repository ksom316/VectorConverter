import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { extractForegroundGeometry, isDegenerateRing, simplifyContourPoints } from "../geometry";
import { smoothingToSimplifyEpsilonPx } from "../traceOptions";
import { buildSvgFromGeometry } from "../../svg/buildSvg";
import { buildDxfFromGeometry } from "../../dxf/buildDxf";

type P = { x: number; y: number };

/** Builds ImageTracer-style tracedata for one closed ring: the last segment ends on the first point. */
function tracedataFromRing(ring: P[]) {
  const segments = ring.map((p, i) => {
    const next = ring[(i + 1) % ring.length];
    return { type: "L" as const, x1: p.x, y1: p.y, x2: next.x, y2: next.y };
  });
  return {
    palette: [{ r: 0, g: 0, b: 0, a: 255 }],
    layers: [[{ segments, holechildren: [], isholepath: false }]],
  };
}

function extractRing(ring: P[], epsilon: number): P[] {
  return extractForegroundGeometry(tracedataFromRing(ring), 500, 500, epsilon).contours[0].points;
}

const smoothingEpsilons = Array.from({ length: 11 }, (_, s) => ({
  smoothing: s,
  epsilon: smoothingToSimplifyEpsilonPx(s),
}));

const rect = (w: number, h: number): P[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

/** Horizontal wall, 45-degree bay section, then back to horizontal, closed with a sharp return. */
const bayWall: P[] = [
  { x: 0, y: 60 },
  { x: 40, y: 60 },
  { x: 80, y: 20 },
  { x: 120, y: 20 },
  { x: 160, y: 60 },
  { x: 200, y: 60 },
  { x: 200, y: 200 },
  { x: 0, y: 200 },
];

/** A wall with a 3px-wide, 20px-deep slit cut into its top edge. */
const slitWall: P[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 20 },
  { x: 43, y: 20 },
  { x: 43, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
];

/** Two 1px strokes separated by a 1px gap, joined at the left: closely spaced parallel lines. */
const comb: P[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 1 },
  { x: 3, y: 1 },
  { x: 3, y: 2 },
  { x: 100, y: 2 },
  { x: 100, y: 3 },
  { x: 0, y: 3 },
];

/** Straight run that jitters by 1px per step, like a thresholded JPEG edge. */
function jitteredWall(): P[] {
  const ring: P[] = [];
  for (let x = 0; x <= 100; x++) ring.push({ x, y: x % 2 });
  ring.push({ x: 100, y: 60 }, { x: 0, y: 60 });
  return ring;
}

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function selfCrossings(ring: P[]): number {
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

function distToRing(p: P, ring: P[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

function rotate<T>(items: T[], k: number): T[] {
  return items.slice(k).concat(items.slice(0, k));
}

const keyOf = (p: P) => `${p.x},${p.y}`;

describe("closing point handling", () => {
  it("does not carry the repeated start point into a ring, with or without simplification", () => {
    for (const epsilon of [0, 0.81, 1.5]) {
      const ring = extractRing(bayWall, epsilon);
      expect(keyOf(ring[0])).not.toBe(keyOf(ring[ring.length - 1]));
      expect(ring.length).toBeGreaterThanOrEqual(3);
    }
    expect(extractRing(rect(100, 100), 0)).toEqual(rect(100, 100));
  });

  it("removes the closing point from curve-ended paths too", () => {
    const tracedata = {
      palette: [{ r: 0, g: 0, b: 0, a: 255 }],
      layers: [
        [
          {
            segments: [
              { type: "L" as const, x1: 0, y1: 0, x2: 100, y2: 0 },
              { type: "Q" as const, x1: 100, y1: 0, x2: 50, y2: 80, x3: 0, y3: 0 },
            ],
            holechildren: [],
            isholepath: false,
          },
        ],
      ],
    };
    const ring = extractForegroundGeometry(tracedata, 100, 100).contours[0].points;
    expect(keyOf(ring[0])).not.toBe(keyOf(ring[ring.length - 1]));
  });
});

describe("valid contours stay valid at every smoothing setting 0-10", () => {
  const fixtures: [string, P[]][] = [
    ["rectangle", rect(100, 60)],
    ["bay window with 45-degree walls", bayWall],
    ["wall with a narrow slit", slitWall],
    ["closely spaced parallel strokes", comb],
    ["jittered wall", jitteredWall()],
    ["1px hairline", rect(100, 1)],
    ["0.5px hairline", rect(100, 0.5)],
  ];

  for (const [name, ring] of fixtures) {
    it(`${name}: >= 3 distinct vertices, non-zero area, no closing duplicate, no new crossings`, () => {
      expect(isDegenerateRing(ring)).toBe(false);
      for (const { smoothing, epsilon } of smoothingEpsilons) {
        const out = extractRing(ring, epsilon);
        const label = `smoothing ${smoothing}`;
        expect(new Set(out.map(keyOf)).size, label).toBeGreaterThanOrEqual(3);
        expect(isDegenerateRing(out), label).toBe(false);
        expect(keyOf(out[0]), label).not.toBe(keyOf(out[out.length - 1]));
        expect(selfCrossings(out), label).toBeLessThanOrEqual(selfCrossings(ring));
      }
    });
  }
});

describe("fallback when simplification would collapse a valid contour", () => {
  it("keeps a thin closed stroke whose width is below epsilon instead of collapsing it to a line", () => {
    for (const [ring, epsilon] of [
      [rect(100, 1), 1.5],
      [rect(100, 1), 1.27],
      [rect(100, 0.5), 0.81],
    ] as [P[], number][]) {
      expect(extractRing(ring, epsilon)).toEqual(ring);
    }
  });

  it("returns the very same ring from simplifyContourPoints when the result would be degenerate", () => {
    const ring = rect(100, 1);
    expect(simplifyContourPoints(ring, 1.5)).toBe(ring);
  });
});

describe("contours that are already degenerate in the trace", () => {
  it("are returned unchanged and still reported as degenerate, never reported as repaired", () => {
    const twoVertexRing: P[] = [
      { x: 5, y: 5 },
      { x: 60, y: 5 },
    ];
    const collinearRing: P[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    for (const ring of [twoVertexRing, collinearRing]) {
      expect(isDegenerateRing(ring)).toBe(true);
      expect(simplifyContourPoints(ring, 1.5)).toBe(ring);
    }
  });

  it("an ImageTracer ring of [A, B, A] is kept as the two-vertex ring it is", () => {
    const tracedata = {
      palette: [{ r: 0, g: 0, b: 0, a: 255 }],
      layers: [
        [
          {
            segments: [
              { type: "L" as const, x1: 5, y1: 5, x2: 60, y2: 5 },
              { type: "L" as const, x1: 60, y1: 5, x2: 5, y2: 5 },
            ],
            holechildren: [],
            isholepath: false,
          },
        ],
      ],
    };
    const contour = extractForegroundGeometry(tracedata, 100, 100, 1).contours[0];
    expect(contour.points).toEqual([
      { x: 5, y: 5 },
      { x: 60, y: 5 },
    ]);
    expect(isDegenerateRing(contour.points)).toBe(true);
  });
});

describe("closed-ring seam behavior", () => {
  it("drops the collinear start vertex of a rectangle whose start lies midway along an edge", () => {
    const ring: P[] = [
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    const out = extractRing(ring, 1);
    expect(new Set(out.map(keyOf))).toEqual(new Set(["0,0", "100,0", "100,100", "0,100"]));
    expect(out).toHaveLength(4);
  });

  it("gives the same corners for every choice of start vertex on a rectangle with collinear points", () => {
    const ring: P[] = [];
    for (let x = 0; x < 100; x += 10) ring.push({ x, y: 0 });
    for (let y = 0; y < 60; y += 10) ring.push({ x: 100, y });
    for (let x = 100; x > 0; x -= 10) ring.push({ x, y: 60 });
    for (let y = 60; y > 0; y -= 10) ring.push({ x: 0, y });

    const expected = new Set(["0,0", "100,0", "100,60", "0,60"]);
    for (let k = 0; k < ring.length; k++) {
      const out = extractRing(rotate(ring, k), 1);
      expect(new Set(out.map(keyOf)), `start ${k}`).toEqual(expected);
    }
  });

  it("stays within epsilon of the same source whichever vertex the ring starts at", () => {
    const ring = jitteredWall();
    const epsilon = 0.81;
    const baseline = extractRing(ring, epsilon);
    for (let k = 0; k < ring.length; k += 7) {
      const out = extractRing(rotate(ring, k), epsilon);
      // Every source vertex is within epsilon of the simplified ring, whatever the start.
      for (const p of ring) expect(distToRing(p, out), `start ${k}`).toBeLessThanOrEqual(epsilon + 1e-9);
      expect(Math.abs(out.length - baseline.length), `start ${k}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("intentional geometry survives", () => {
  it("keeps 45-degree wall corners and the sharp return corners at every smoothing setting", () => {
    for (const { smoothing, epsilon } of smoothingEpsilons) {
      const keys = new Set(extractRing(bayWall, epsilon).map(keyOf));
      for (const corner of ["40,60", "80,20", "120,20", "160,60", "200,200", "0,200"]) {
        expect(keys.has(corner), `${corner} at smoothing ${smoothing}`).toBe(true);
      }
    }
  });

  it("keeps a 3px-wide, 20px-deep slit at every smoothing setting", () => {
    for (const { smoothing, epsilon } of smoothingEpsilons) {
      const keys = new Set(extractRing(slitWall, epsilon).map(keyOf));
      for (const corner of ["40,20", "43,20"]) {
        expect(keys.has(corner), `${corner} at smoothing ${smoothing}`).toBe(true);
      }
    }
  });

  it("keeps both closely spaced strokes (and the gap between them) at the default smoothing", () => {
    const out = extractRing(comb, smoothingToSimplifyEpsilonPx(4));
    expect(new Set(out.map(keyOf))).toEqual(new Set(comb.map(keyOf)));
  });

  it("never lets simplification create self-crossings on a 1px-gap hairpin", () => {
    const hairpin: P[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 2, y: 10 },
      { x: 2, y: 11 },
      { x: 100, y: 11 },
      { x: 100, y: 21 },
      { x: 0, y: 21 },
    ];
    for (const { smoothing, epsilon } of smoothingEpsilons) {
      const out = extractRing(hairpin, epsilon);
      expect(selfCrossings(out), `smoothing ${smoothing}`).toBe(0);
    }
  });
});

describe("simplification never turns a simple contour into a self-crossing one", () => {
  // Delta-minimised from the largest wall-outline contour of the sample floor plan: a ~20px
  // spike of sub-pixel width. Without the crossing check, ring simplification at the default
  // smoothing (epsilon 0.81) pulls an edge through the spike and the contour crosses itself.
  const spike: P[] = [
    { x: 292, y: 168 },
    { x: 275.5, y: 168 },
    { x: 275, y: 167.5 },
    { x: 276, y: 148.5 },
    { x: 277.125, y: 167.625 },
  ];

  it("keeps the source ring crossing-free and valid at every smoothing setting", () => {
    expect(selfCrossings(spike)).toBe(0);
    for (const { smoothing, epsilon } of smoothingEpsilons) {
      const out = simplifyContourPoints(spike, epsilon);
      expect(selfCrossings(out), `smoothing ${smoothing}`).toBe(0);
      expect(isDegenerateRing(out), `smoothing ${smoothing}`).toBe(false);
    }
  });
});

describe("crossing retry at a smaller epsilon", () => {
  // Same sample contour, minimised differently: at the full default epsilon (0.81) simplification
  // crosses itself, but half that epsilon is crossing-free and still removes vertices.
  const spike: P[] = [
    { x: 292, y: 168 },
    { x: 275.5, y: 168 },
    { x: 275, y: 167.5 },
    { x: 276, y: 148.5 },
    { x: 275.775, y: 165.54166666666669 },
    { x: 275.775, y: 166.375 },
    { x: 276, y: 167 },
    { x: 276.45, y: 167.41666666666669 },
    { x: 277.125, y: 167.625 },
    { x: 780, y: 122 },
  ];

  it("still simplifies the contour, without crossings, instead of giving up on it", () => {
    const out = simplifyContourPoints(spike, smoothingToSimplifyEpsilonPx(4));
    expect(selfCrossings(spike)).toBe(0);
    expect(selfCrossings(out)).toBe(0);
    expect(out.length).toBeLessThan(spike.length);
    expect(isDegenerateRing(out)).toBe(false);
  });
});

describe("SVG and DXF export of simplified closed contours", () => {
  const geometry = extractForegroundGeometry(tracedataFromRing(rect(100, 60)), 120, 80, 1);

  it("writes each vertex once and closes the SVG path with Z", () => {
    const svg = buildSvgFromGeometry(geometry);
    const d = /<path d="([^"]+)"/.exec(svg)![1];
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d.match(/[ML] /g)).toHaveLength(4);
    const coords = d.match(/-?\d+(\.\d+)? -?\d+(\.\d+)?/g)!;
    expect(new Set(coords).size).toBe(coords.length);
  });

  it("writes a closed DXF LWPOLYLINE with each vertex once", () => {
    const dxf = buildDxfFromGeometry(geometry);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = new DxfParser().parseSync(dxf) as any;
    const poly = parsed.entities.find((e: { type: string }) => e.type === "LWPOLYLINE");
    expect(poly.vertices).toHaveLength(4);
    expect(poly.shape).toBe(true);
    const keys = poly.vertices.map((v: P) => `${v.x},${v.y}`);
    expect(new Set(keys).size).toBe(4);
  });
});

/** ImageTracer-style tracedata for one outer path owning `holes`, as in the real layer structure. */
function tracedataWithHoles(outers: { ring: P[]; holes: P[][] }[]) {
  const layer: { segments: ReturnType<typeof segmentsOf>; holechildren: number[]; isholepath: boolean }[] = [];
  for (const { ring, holes } of outers) {
    const parentIndex = layer.length;
    layer.push({ segments: segmentsOf(ring), holechildren: holes.map((_, i) => parentIndex + 1 + i), isholepath: false });
    for (const hole of holes) layer.push({ segments: segmentsOf(hole), holechildren: [], isholepath: true });
  }
  return { palette: [{ r: 0, g: 0, b: 0, a: 255 }], layers: [layer] };
}
function segmentsOf(ring: P[]) {
  return ring.map((p, i) => {
    const next = ring[(i + 1) % ring.length];
    return { type: "L" as const, x1: p.x, y1: p.y, x2: next.x, y2: next.y };
  });
}

describe("degenerate holes are filtered, everything else is kept", () => {
  const outer = rect(100, 100);
  const square = (x: number, y: number, s: number): P[] => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  const twoPointHole: P[] = [{ x: 20, y: 20 }, { x: 22, y: 22 }]; // ImageTracer's collapsed 2x2 pinhole
  const collinearHole: P[] = [{ x: 30, y: 30 }, { x: 32, y: 30 }, { x: 34, y: 30 }];
  const tinyValidHole = square(60, 60, 1); // 1px^2: very small but a real hole
  const smallValidHole = square(40, 40, 2);
  const bigHole = square(70, 20, 15);

  it("removes two-point and collinear holes at every smoothing setting, including no simplification", () => {
    const tracedata = tracedataWithHoles([{ ring: outer, holes: [twoPointHole, collinearHole] }]);
    for (const epsilon of [0, ...smoothingEpsilons.map((s) => s.epsilon)]) {
      const [contour] = extractForegroundGeometry(tracedata as any, 120, 120, epsilon).contours;
      expect(contour.holes, `epsilon ${epsilon}`).toHaveLength(0);
    }
  });

  it("leaves the parent contour exactly as it is without the degenerate hole", () => {
    const withJunk = tracedataWithHoles([{ ring: bayWall, holes: [twoPointHole, collinearHole] }]);
    const without = tracedataWithHoles([{ ring: bayWall, holes: [] }]);
    for (const { epsilon } of smoothingEpsilons) {
      const a = extractForegroundGeometry(withJunk as any, 300, 300, epsilon).contours[0];
      const b = extractForegroundGeometry(without as any, 300, 300, epsilon).contours[0];
      expect(a.points).toEqual(b.points);
      expect(a.colorHex).toBe(b.colorHex);
    }
  });

  it("keeps every valid hole, including a 1px^2 one, mixed in with degenerate ones", () => {
    const holes = [twoPointHole, tinyValidHole, collinearHole, smallValidHole, bigHole];
    const tracedata = tracedataWithHoles([{ ring: outer, holes }]);
    const [contour] = extractForegroundGeometry(tracedata as any, 120, 120, 0).contours;
    expect(contour.holes).toHaveLength(3);
    // order and winding of the surviving holes are exactly the source's
    expect(contour.holes).toEqual([tinyValidHole, smallValidHole, bigHole]);
  });

  it("keeps valid holes valid after simplification at every smoothing setting", () => {
    const tracedata = tracedataWithHoles([{ ring: outer, holes: [twoPointHole, tinyValidHole, smallValidHole, bigHole] }]);
    for (const { smoothing, epsilon } of smoothingEpsilons) {
      const [contour] = extractForegroundGeometry(tracedata as any, 120, 120, epsilon).contours;
      expect(contour.holes, `smoothing ${smoothing}`).toHaveLength(3);
      for (const hole of contour.holes) expect(isDegenerateRing(hole)).toBe(false);
    }
  });

  it("does not touch degenerate contours: they are kept, with or without a degenerate hole", () => {
    const degenerateContour: P[] = [{ x: 5, y: 5 }, { x: 60, y: 5 }];
    const tracedata = tracedataWithHoles([
      { ring: degenerateContour, holes: [] },
      { ring: [{ x: 0, y: 50 }, { x: 10, y: 50 }, { x: 20, y: 50 }], holes: [twoPointHole] },
    ]);
    for (const epsilon of [0, 1.5]) {
      const { contours } = extractForegroundGeometry(tracedata as any, 120, 120, epsilon);
      expect(contours).toHaveLength(2);
      expect(contours[0].points).toEqual(degenerateContour);
      expect(isDegenerateRing(contours[0].points)).toBe(true);
      expect(isDegenerateRing(contours[1].points)).toBe(true);
      expect(contours[1].holes).toHaveLength(0);
    }
  });

  it("keeps SVG subpath and DXF polyline counts consistent, with no zero-area ring in either", () => {
    const tracedata = tracedataWithHoles([
      { ring: outer, holes: [twoPointHole, tinyValidHole, bigHole, collinearHole] },
      { ring: square(200, 200, 30), holes: [] },
    ]);
    const geometry = extractForegroundGeometry(tracedata as any, 300, 300, smoothingToSimplifyEpsilonPx(6));
    const svg = buildSvgFromGeometry(geometry);
    const svgSubpaths = svg.match(/M [-\d.]+ [-\d.]+/g)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dxf = new DxfParser().parseSync(buildDxfFromGeometry(geometry)) as any;
    const polylines = dxf.entities.filter((e: { type: string }) => e.type === "LWPOLYLINE");
    expect(svgSubpaths).toHaveLength(2 + 2 + 0); // 2 contours + 2 valid holes
    expect(polylines).toHaveLength(svgSubpaths.length);
    for (const poly of polylines) {
      expect(poly.shape).toBe(true);
      expect(isDegenerateRing(poly.vertices.map((v: P) => ({ x: v.x, y: v.y })))).toBe(false);
    }
  });
});
