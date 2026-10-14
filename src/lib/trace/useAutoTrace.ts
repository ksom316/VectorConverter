import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceResult, TracingSettings } from "../types";
import { runTraceInWorker } from "./runTrace";
import { tracingSettingsKey } from "./tracingLimits";

type TraceFunction = (imageData: ImageData, settings: TracingSettings, signal?: AbortSignal) => Promise<TraceResult>;

export interface AutoTraceOptions {
  /** The prepared (rotated/cropped) drawing to trace, or null when none is loaded. */
  canvas: HTMLCanvasElement | null;
  settings: TracingSettings;
  /** Quiet period after the last settings change before a trace starts. */
  debounceMs?: number;
  /** Must be referentially stable. Defaults to the Web Worker runner. */
  trace?: TraceFunction;
}

export interface AutoTraceState {
  /** The latest completed trace for the current drawing. It can lag the settings while `isTracing`. */
  result: TraceResult | null;
  /** True from the moment inputs change until their trace has finished or failed. */
  isTracing: boolean;
  /** The failure of the trace for the current inputs, if it failed and was not dismissed. */
  error: string | null;
  /** Skips the debounce and traces the current inputs now. */
  retrace: () => void;
  dismissError: () => void;
}

interface Settled {
  key: string;
  canvas: HTMLCanvasElement;
  result: TraceResult | null;
  error: string | null;
}

const canvasIds = new WeakMap<HTMLCanvasElement, number>();
let nextCanvasId = 1;
function canvasId(canvas: HTMLCanvasElement): number {
  let id = canvasIds.get(canvas);
  if (id === undefined) {
    id = nextCanvasId++;
    canvasIds.set(canvas, id);
  }
  return id;
}

/**
 * Retraces automatically whenever the drawing or any tracing setting changes.
 *
 * - Changes are debounced, so dragging a slider starts one trace after it settles rather than one
 *   per pixel moved. The first trace of a newly loaded drawing, and an explicit retrace(), start
 *   immediately.
 * - Starting a new trace aborts the previous one (terminating its Web Worker), and every request
 *   carries an id, so a slow, superseded response can never overwrite a newer preview.
 * - `isTracing` is derived from "is there a settled outcome for exactly the current inputs", not
 *   from a flag that has to be reset, so a failure or an abort cannot leave it stuck on.
 */
export function useAutoTrace({ canvas, settings, debounceMs = 250, trace = runTraceInWorker }: AutoTraceOptions): AutoTraceState {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const lastStarted = useRef<{ canvas: HTMLCanvasElement | null; nonce: number }>({ canvas: null, nonce: -1 });

  const settingsKey = tracingSettingsKey(settings);
  const key = canvas ? `${canvasId(canvas)}|${settingsKey}|${nonce}` : "";

  useEffect(() => {
    if (!canvas) return;
    const myRequest = ++requestId.current;
    const controller = new AbortController();
    const immediate = lastStarted.current.canvas !== canvas || lastStarted.current.nonce !== nonce;

    const timer = setTimeout(
      async () => {
        lastStarted.current = { canvas, nonce };
        try {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas 2D context unavailable.");
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = await trace(imageData, settings, controller.signal);
          if (requestId.current !== myRequest) return; // a newer request has taken over
          setSettled({ key, canvas, result, error: null });
        } catch (err) {
          if (requestId.current !== myRequest) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          const message = err instanceof Error ? err.message : "Tracing failed unexpectedly. Please try again.";
          // keep the last good preview for this drawing visible next to the error
          setSettled((previous) => ({ key, canvas, result: previous?.canvas === canvas ? previous.result : null, error: message }));
        }
      },
      immediate ? 0 : debounceMs,
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` covers canvas identity, every tracing setting and the retrace nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canvas, debounceMs]);

  const retrace = useCallback(() => setNonce((n) => n + 1), []);
  const dismissError = useCallback(() => setDismissedKey(key), [key]);

  const current = settled && canvas && settled.canvas === canvas ? settled : null;
  return {
    result: current?.result ?? null,
    isTracing: canvas !== null && settled?.key !== key,
    error: current && current.key === key && dismissedKey !== key ? current.error : null,
    retrace,
    dismissError,
  };
}
