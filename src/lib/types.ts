export interface LoadedImage {
  fileName: string;
  width: number;
  height: number;
  /** Canvas holding the image at its current (post rotate/crop) orientation. */
  canvas: HTMLCanvasElement;
}

export type RotationDegrees = 0 | 90 | 180 | 270;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TracingSettings {
  /** 0-255. Pixels darker than this become foreground (black). */
  threshold: number;
  /** Let ImageTracer auto-select threshold layers instead of a single cutoff. */
  autoThreshold: boolean;
  /** Noise reduction / speckle removal strength, 0 (off) - 10 (aggressive). */
  noiseReduction: number;
  /** Path simplification / corner smoothing, 0 (sharp) - 10 (very smooth). */
  smoothing: number;
  /** Detail preservation: lower omits more small paths, 0-10. */
  detail: number;
}

export const DEFAULT_TRACING_SETTINGS: TracingSettings = {
  threshold: 128,
  autoThreshold: false,
  noiseReduction: 1,
  smoothing: 4,
  detail: 6,
};

/** A single flattened (curve-sampled) closed contour, in source pixel space. */
export interface TracedContour {
  points: { x: number; y: number }[];
  /** Nested hole contours (e.g. the inside of a door loop), also flattened to line segments. */
  holes: { x: number; y: number }[][];
  colorHex: string;
}

export interface VectorGeometry {
  width: number;
  height: number;
  contours: TracedContour[];
}

export interface TraceResult {
  svg: string;
  geometry: VectorGeometry;
  pathCount: number;
  isEmpty: boolean;
}

export type LengthUnit = "mm" | "cm" | "m";

export interface Calibration {
  pointA: { x: number; y: number };
  pointB: { x: number; y: number };
  realDistance: number;
  unit: LengthUnit;
}

export type AppPhase = "upload" | "workspace";

export type WorkspaceTab = "prepare" | "trace" | "export";
