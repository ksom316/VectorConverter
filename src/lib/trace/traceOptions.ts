import type { TracingSettings } from "../types";

/**
 * Maps the "noise reduction" slider (0-10) to a box-blur radius in pixels, applied before
 * thresholding.
 *
 * This is deliberately conservative at low/default slider values: blurring before
 * thresholding averages a thin white gap between two closely-spaced lines (e.g. a double
 * wall line) or a thin dark stroke (e.g. a 1px dimension tick) with its neighbors, and a
 * blur radius as small as 1px is already enough to push those averaged pixels across the
 * threshold and erase them. A blur radius of 0 at low settings means low/default noise
 * reduction never touches genuinely thin real linework; the tradeoff only kicks in once the
 * user explicitly asks for stronger denoising (for a visibly dusty/speckled scan), and even
 * then the max radius is capped at 2px rather than 3px to limit how much fine detail that
 * costs.
 */
export function noiseReductionToBlurRadius(noiseReduction: number): number {
  if (noiseReduction <= 4) return 0;
  if (noiseReduction <= 7) return 1;
  return 2;
}

/**
 * Maps the "smoothing" slider (0-10) to a Ramer-Douglas-Peucker simplification tolerance in
 * pixels (see lib/trace/geometry.ts simplifyPolyline). This cleans up pixel-staircase and
 * JPEG-ringing wobble along already-straight or already-curved runs. It is deliberately a
 * small range (0.35px-1.5px): a real corner or a genuine angled wall segment deviates from
 * its neighbors' chord by many pixels, far more than this tolerance, so it is always kept
 * regardless of this value — only redundant near-collinear points are ever removed.
 */
export function smoothingToSimplifyEpsilonPx(smoothing: number): number {
  const factor = smoothing / 10;
  return 0.35 + factor * 1.15; // 0.35px (smoothing=0) - 1.5px (smoothing=10)
}

/**
 * Maps our user-facing TracingSettings sliders onto ImageTracer.js's tuning knobs.
 * The image fed into ImageTracer is already binarized to pure black/white by our own
 * preprocessing pipeline, so ImageTracer only has to find two palette colors.
 */
export function buildImageTracerOptions(settings: TracingSettings) {
  // smoothing 0-10 -> ltres/qtres (ImageTracer's curve-fitting error tolerance), kept deliberately
  // tight: 0.5 - 0.7 px. Strokes in scanned drawings are only 1-2px wide, so a looser fit (this
  // used to climb to 3.0) pulls the fitted outline through the stroke and collapses thin hatching,
  // stair lines and small counters into zero-area paths. Smoothing's visible effect comes from the
  // bounded, safeguarded RDP simplification (smoothingToSimplifyEpsilonPx) instead.
  const smoothingFactor = settings.smoothing / 10;
  const ltres = 0.5 + smoothingFactor * 0.2; // 0.5 - 0.7
  const qtres = 0.5 + smoothingFactor * 0.2; // 0.5 - 0.7

  // detail 0-10 -> pathomit (minimum path length kept). Higher detail = keep smaller paths.
  const detailFactor = settings.detail / 10;
  const pathomit = Math.round(16 - detailFactor * 14); // 16 (coarse) - 2 (fine)

  return {
    numberofcolors: 2,
    colorsampling: 0,
    colorquantcycles: 1,
    mincolorratio: 0,
    ltres,
    qtres,
    pathomit: Math.max(2, pathomit),
    rightangleenhance: true,
    roundcoords: 2,
    scale: 1,
    strokewidth: 0,
    linefilter: true,
    desc: false,
    viewbox: true,
  };
}
