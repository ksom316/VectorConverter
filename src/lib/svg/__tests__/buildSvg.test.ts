import { describe, expect, it } from "vitest";
import { buildSvgFromGeometry, validateSvgString } from "../buildSvg";
import type { VectorGeometry } from "../../types";

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
      holes: [],
      colorHex: "#000000",
    },
  ],
};

describe("buildSvgFromGeometry", () => {
  it("produces a self-contained, valid SVG with the correct viewBox", () => {
    const svg = buildSvgFromGeometry(squareGeometry);
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain("<svg");
    const result = validateSvgString(svg);
    expect(result.valid).toBe(true);
    expect(result.pathCount).toBe(1);
  });

  it("includes a white background rect by default and omits it when disabled", () => {
    const withBg = buildSvgFromGeometry(squareGeometry);
    expect(withBg).toContain('fill="#ffffff"');

    const withoutBg = buildSvgFromGeometry(squareGeometry, { background: false });
    expect(withoutBg).not.toContain('fill="#ffffff"');
  });

  it("renders hole contours as additional evenodd sub-paths", () => {
    const withHole: VectorGeometry = {
      width: 100,
      height: 100,
      contours: [
        {
          points: squareGeometry.contours[0].points,
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
    const svg = buildSvgFromGeometry(withHole);
    expect(svg).toContain("fill-rule=\"evenodd\"");
    expect(svg).toContain("M 30 30");
  });

  it("produces a structurally valid but pathless SVG for empty geometry", () => {
    const empty: VectorGeometry = { width: 100, height: 100, contours: [] };
    const svg = buildSvgFromGeometry(empty);
    const result = validateSvgString(svg);
    expect(result.valid).toBe(true);
    expect(result.pathCount).toBe(0);
  });

  it("flags malformed SVG as invalid", () => {
    const result = validateSvgString("<svg><path d=M 0 0</svg");
    expect(result.valid).toBe(false);
  });
});
