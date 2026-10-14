import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { buildDxfFromGeometry, unitsPerPixel } from "../buildDxf";
import { validateDxfString } from "../validateDxf";
import { buildSvgFromGeometry } from "../../svg/buildSvg";
import type { Calibration, VectorGeometry } from "../../types";

const squareGeometry: VectorGeometry = {
  width: 100,
  height: 100,
  contours: [
    {
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 90 },
        { x: 10, y: 90 },
      ],
      holes: [
        [
          { x: 30, y: 30 },
          { x: 70, y: 30 },
          { x: 70, y: 70 },
          { x: 30, y: 70 },
        ],
      ],
      colorHex: "#000000",
    },
  ],
};

describe("buildDxfFromGeometry", () => {
  it("produces a DXF with one entity per contour and one per hole", () => {
    const dxf = buildDxfFromGeometry(squareGeometry);
    const result = validateDxfString(dxf);
    expect(result.valid).toBe(true);
    expect(result.entityCount).toBe(2); // outer contour + 1 hole
  });

  it("flips the Y axis so image-space top-left maps to DXF bottom-left", () => {
    const dxf = buildDxfFromGeometry(squareGeometry);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = new DxfParser().parseSync(dxf) as any;
    const outer = parsed.entities.find((e: { vertices?: unknown[] }) => (e.vertices?.length ?? 0) === 4);
    // Source point (10, 10) in a 100-tall image should become (10, 90) in DXF space.
    const matchesFlippedPoint = outer.vertices.some(
      (v: { x: number; y: number }) => v.x === 10 && v.y === 90,
    );
    expect(matchesFlippedPoint).toBe(true);
  });

  it("exports unitless 1:1 pixel coordinates when uncalibrated", () => {
    const dxf = buildDxfFromGeometry(squareGeometry);
    expect(dxf).toMatch(/\$INSUNITS[\s\S]*?\n\s*0\s*\n/);
  });

  it("scales coordinates according to calibration when provided", () => {
    const calibration: Calibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 10, y: 0 },
      realDistance: 100,
      unit: "mm",
    };
    expect(unitsPerPixel(calibration)).toBeCloseTo(10);

    const dxf = buildDxfFromGeometry(squareGeometry, { calibration });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = new DxfParser().parseSync(dxf) as any;
    const outer = parsed.entities.find((e: { vertices?: unknown[] }) => (e.vertices?.length ?? 0) === 4);
    // (10, 10) scaled by 10 units/px -> x = 100; y flipped and scaled -> (100 - 10) * 10 = 900
    const matchesScaledPoint = outer.vertices.some(
      (v: { x: number; y: number }) => v.x === 100 && v.y === 900,
    );
    expect(matchesScaledPoint).toBe(true);
  });

  it("produces a DXF with zero entities for empty geometry, which fails validation", () => {
    const empty: VectorGeometry = { width: 100, height: 100, contours: [] };
    const dxf = buildDxfFromGeometry(empty);
    const result = validateDxfString(dxf);
    expect(result.valid).toBe(false);
    expect(result.entityCount).toBe(0);
  });
});

describe("two-point contours export as LINE entities", () => {
  type Pt = { x: number; y: number };
  const square: Pt[] = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ];
  const validHole: Pt[] = [
    { x: 30, y: 30 },
    { x: 70, y: 30 },
    { x: 70, y: 70 },
    { x: 30, y: 70 },
  ];
  const stroke: Pt[] = [
    { x: 20, y: 95 },
    { x: 60, y: 95 },
  ];
  const geometryOf = (...contours: { points: Pt[]; holes?: Pt[][] }[]): VectorGeometry => ({
    width: 100,
    height: 100,
    contours: contours.map((c) => ({ points: c.points, holes: c.holes ?? [], colorHex: "#000000" })),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = (dxf: string) => new DxfParser().parseSync(dxf) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ofType = (parsed: any, type: string) => parsed.entities.filter((e: { type: string }) => e.type === type);

  it("exports a distinct two-point contour as exactly one LINE and no polyline", () => {
    const parsed = parse(buildDxfFromGeometry(geometryOf({ points: stroke })));
    expect(ofType(parsed, "LINE")).toHaveLength(1);
    expect(ofType(parsed, "LWPOLYLINE")).toHaveLength(0);
    expect(parsed.entities).toHaveLength(1);
  });

  it("still exports a valid contour as a closed polyline, and a valid hole as a closed polyline", () => {
    const parsed = parse(buildDxfFromGeometry(geometryOf({ points: square, holes: [validHole] })));
    expect(ofType(parsed, "LINE")).toHaveLength(0);
    const polylines = ofType(parsed, "LWPOLYLINE");
    expect(polylines).toHaveLength(2);
    for (const polyline of polylines) {
      expect(polyline.shape).toBe(true);
      expect(polyline.vertices).toHaveLength(4);
    }
  });

  it("never converts a two-point hole to a LINE: it stays a closed two-vertex polyline", () => {
    const parsed = parse(buildDxfFromGeometry(geometryOf({ points: square, holes: [stroke] })));
    expect(ofType(parsed, "LINE")).toHaveLength(0);
    const polylines = ofType(parsed, "LWPOLYLINE");
    expect(polylines).toHaveLength(2);
    expect(polylines.filter((p: { vertices: unknown[] }) => p.vertices.length === 2)).toHaveLength(1);
    expect(polylines.every((p: { shape: boolean }) => p.shape === true)).toBe(true);
  });

  it("keeps a zero-length two-point contour on the existing polyline path (no zero-length LINE)", () => {
    const point: Pt[] = [
      { x: 40, y: 40 },
      { x: 40, y: 40 },
    ];
    const parsed = parse(buildDxfFromGeometry(geometryOf({ points: point })));
    expect(ofType(parsed, "LINE")).toHaveLength(0);
    const polylines = ofType(parsed, "LWPOLYLINE");
    expect(polylines).toHaveLength(1);
    expect(polylines[0].vertices).toHaveLength(2);
    expect(polylines[0].shape).toBe(true);
  });

  it("uses the same Y flip and unitless scale as polylines, with z = 0 on the default layer", () => {
    const parsed = parse(buildDxfFromGeometry(geometryOf({ points: stroke })));
    const [line] = ofType(parsed, "LINE");
    // Source (20, 95) / (60, 95) in a 100-tall image -> (20, 5) / (60, 5) in DXF space.
    expect(line.vertices).toHaveLength(2);
    expect([line.vertices[0].x, line.vertices[0].y]).toEqual([20, 5]);
    expect([line.vertices[1].x, line.vertices[1].y]).toEqual([60, 5]);
    expect(line.vertices[0].z ?? 0).toBe(0);
    expect(line.vertices[1].z ?? 0).toBe(0);
    expect(line.layer).toBe("0");
  });

  it("scales LINE endpoints like polylines and sets the matching $INSUNITS for mm, cm and m", () => {
    const expectedUnitsCode = { mm: 4, cm: 5, m: 6 } as const;
    for (const unit of ["mm", "cm", "m"] as const) {
      // 10px between the picked points = 250 units -> 25 units per pixel
      const calibration: Calibration = { pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, realDistance: 250, unit };
      const dxf = buildDxfFromGeometry(geometryOf({ points: stroke }, { points: square }), { calibration });
      const parsed = parse(dxf);
      const [line] = ofType(parsed, "LINE");
      expect([line.vertices[0].x, line.vertices[0].y], unit).toEqual([20 * 25, 5 * 25]);
      expect([line.vertices[1].x, line.vertices[1].y], unit).toEqual([60 * 25, 5 * 25]);
      // the valid polyline is scaled by the same factor: source (10, 10) -> (250, 2250)
      const [polyline] = ofType(parsed, "LWPOLYLINE");
      expect(polyline.vertices.some((v: Pt) => v.x === 250 && v.y === 2250), unit).toBe(true);
      const units = /\$INSUNITS\s*\n\s*70\s*\n\s*(\d+)/.exec(dxf);
      expect(Number(units?.[1]), unit).toBe(expectedUnitsCode[unit]);
    }
  });

  it("produces the expected LINE and LWPOLYLINE counts for mixed geometry", () => {
    const zeroLength: Pt[] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    const geometry = geometryOf(
      { points: square, holes: [validHole, stroke] }, // polyline + valid hole + two-point hole (all polylines)
      { points: stroke }, // LINE
      { points: zeroLength }, // polyline
      {
        points: [
          { x: 1, y: 1 },
          { x: 11, y: 1 },
          { x: 11, y: 11 },
        ],
      }, // valid triangle -> polyline
    );
    const dxf = buildDxfFromGeometry(geometry);
    const parsed = parse(dxf);
    expect(ofType(parsed, "LINE")).toHaveLength(1);
    expect(ofType(parsed, "LWPOLYLINE")).toHaveLength(5);
    expect(parsed.entities).toHaveLength(6);
    expect(validateDxfString(dxf).valid).toBe(true);
  });

  it("introduces no zero-length LINEs and no non-finite coordinates", () => {
    const geometry = geometryOf(
      { points: stroke },
      {
        points: [
          { x: 0.5, y: 1.25 },
          { x: 33.125, y: 77.5 },
        ],
      },
      {
        points: [
          { x: 7, y: 7 },
          { x: 7, y: 7 },
        ],
      },
      { points: square, holes: [validHole] },
    );
    const parsed = parse(buildDxfFromGeometry(geometry));
    const lines = ofType(parsed, "LINE");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const [a, b] = line.vertices;
      expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
    }
    for (const poly of ofType(parsed, "LWPOLYLINE")) {
      expect(poly.vertices.every((v: Pt) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
    }
  });

  it("leaves the SVG byte-identical for the same geometry, whether or not a DXF was built", () => {
    const geometry = geometryOf({ points: square, holes: [validHole] }, { points: stroke });
    const expectedSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">',
      '  <rect x="0" y="0" width="100" height="100" fill="#ffffff" />',
      "  <g>",
      '    <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 70 30 L 70 70 L 30 70 Z" fill="#000000" fill-rule="evenodd" />',
      '    <path d="M 20 95 L 60 95 Z" fill="#000000" fill-rule="evenodd" />',
      "  </g>",
      "</svg>",
    ].join("\n");
    const before = buildSvgFromGeometry(geometry);
    buildDxfFromGeometry(geometry);
    const after = buildSvgFromGeometry(geometry);
    expect(before).toBe(expectedSvg);
    expect(after).toBe(before);
    // the two-point contour is still a (zero-area) subpath in the SVG, unchanged
    expect(after).toContain("M 20 95 L 60 95 Z");
  });
});
