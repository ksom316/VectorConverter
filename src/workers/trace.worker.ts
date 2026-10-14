import ImageTracer from "imagetracerjs";
import {
  applyThreshold,
  boxBlur,
  computeOtsuThreshold,
  despeckle,
  flattenPaperTone,
  toGrayscale,
} from "../lib/trace/preprocess";
import {
  buildImageTracerOptions,
  noiseReductionToBlurRadius,
  smoothingToSimplifyEpsilonPx,
} from "../lib/trace/traceOptions";
import { extractForegroundGeometry } from "../lib/trace/geometry";
import { buildSvgFromGeometry } from "../lib/svg/buildSvg";
import type { TraceResult, TracingSettings } from "../lib/types";

export interface TraceWorkerRequest {
  imageData: ImageData;
  settings: TracingSettings;
}

export type TraceWorkerResponse =
  | { ok: true; result: TraceResult }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<TraceWorkerRequest>) => {
  try {
    const { imageData, settings } = event.data;
    const result = runTrace(imageData, settings);
    const response: TraceWorkerResponse = { ok: true, result };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: TraceWorkerResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

function runTrace(imageData: ImageData, settings: TracingSettings): TraceResult {
  const { width, height } = imageData;

  toGrayscale(imageData);
  // Uneven paper tone (stains, folds, lighting) makes one global cutoff behave differently across
  // the sheet; this is a no-op on a page whose paper is uniform.
  flattenPaperTone(imageData);

  const blurRadius = noiseReductionToBlurRadius(settings.noiseReduction);
  if (blurRadius > 0) {
    boxBlur(imageData, blurRadius);
  }

  const threshold = settings.autoThreshold ? computeOtsuThreshold(imageData) : settings.threshold;
  applyThreshold(imageData, threshold);

  const minSpeckleArea = Math.round((settings.noiseReduction / 10) * 40);
  if (minSpeckleArea > 0) {
    despeckle(imageData, minSpeckleArea);
  }

  const tracerOptions = buildImageTracerOptions(settings);
  const checkedOptions = ImageTracer.checkoptions(tracerOptions);
  const tracedata = ImageTracer.imagedataToTracedata(
    { width, height, data: imageData.data },
    checkedOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const simplifyEpsilonPx = smoothingToSimplifyEpsilonPx(settings.smoothing);
  const geometry = extractForegroundGeometry(tracedata, width, height, simplifyEpsilonPx);
  const svg = buildSvgFromGeometry(geometry);

  return {
    svg,
    geometry,
    pathCount: geometry.contours.length,
    isEmpty: geometry.contours.length === 0,
  };
}
