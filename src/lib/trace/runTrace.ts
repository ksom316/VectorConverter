import type { TraceResult, TracingSettings } from "../types";
import type { TraceWorkerRequest, TraceWorkerResponse } from "../../workers/trace.worker";

/**
 * Runs tracing in a dedicated Web Worker so threshold/noise/smoothing adjustments stay
 * responsive even on large scans. Each call spins up a fresh worker and terminates it when
 * done (or when superseded), which also means an in-flight trace is simply dropped if the
 * caller fires a newer request before this one resolves.
 */
export function runTraceInWorker(
  imageData: ImageData,
  settings: TracingSettings,
  signal?: AbortSignal,
): Promise<TraceResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/trace.worker.ts", import.meta.url), {
      type: "module",
    });

    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Trace aborted", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    worker.onmessage = (event: MessageEvent<TraceWorkerResponse>) => {
      cleanup();
      if (event.data.ok) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.error));
      }
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Tracing failed unexpectedly."));
    };

    const request: TraceWorkerRequest = { imageData, settings };
    // Transfer the pixel buffer instead of letting postMessage structured-clone (copy) it —
    // for a large scan that copy is itself a multi-hundred-ms synchronous main-thread stall
    // and doubles peak memory. This neuters `imageData` on the caller's side, which is fine
    // since callers must treat it as consumed once passed here (see App.tsx: a fresh
    // getImageData() call is made for each trace and never reused afterward).
    worker.postMessage(request, [imageData.data.buffer]);
  });
}
