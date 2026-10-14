import type { VectorGeometry } from "../types";

function pointsToSubpath(points: { x: number; y: number }[]): string {
  const [first, ...rest] = points;
  const commands = rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
  return `M ${first.x} ${first.y} ${commands} Z`;
}

/**
 * Builds a valid, self-contained SVG document from traced contour geometry.
 * Holes are rendered as sub-paths of their parent using the evenodd fill rule,
 * so interior loops (e.g. the inside of a door opening) appear as true holes.
 */
export function buildSvgFromGeometry(
  geometry: VectorGeometry,
  options: { background?: boolean } = {},
): string {
  const { width, height, contours } = geometry;
  const { background = true } = options;

  const pathElements = contours
    .map((contour) => {
      const d = [pointsToSubpath(contour.points), ...contour.holes.map(pointsToSubpath)].join(
        " ",
      );
      return `<path d="${d}" fill="${contour.colorHex}" fill-rule="evenodd" />`;
    })
    .join("\n    ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    background
      ? `  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />`
      : "",
    `  <g>`,
    `    ${pathElements}`,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface SvgValidationResult {
  valid: boolean;
  pathCount: number;
  error?: string;
}

/** Parses the generated SVG back with DOMParser to confirm it is well-formed and non-empty. */
export function validateSvgString(svg: string): SvgValidationResult {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      return { valid: false, pathCount: 0, error: "Generated SVG is not well-formed XML." };
    }
    const root = doc.documentElement;
    if (root.nodeName !== "svg" || !root.getAttribute("viewBox")) {
      return { valid: false, pathCount: 0, error: "Generated SVG is missing a root viewBox." };
    }
    const pathCount = doc.querySelectorAll("path").length;
    return { valid: true, pathCount };
  } catch (err) {
    return { valid: false, pathCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
