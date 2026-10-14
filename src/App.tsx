import { useCallback, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { UploadZone } from "./components/UploadZone";
import { ErrorBanner } from "./components/ErrorBanner";
import { PrepareControls } from "./components/PrepareControls";
import { TracingControls } from "./components/TracingControls";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { ExportPanel } from "./components/ExportPanel";
import { PreviewWorkspace } from "./components/PreviewWorkspace";
import { ImageLoadError, loadImageFile } from "./lib/image/loadImage";
import { cropCanvas, rotateCanvas } from "./lib/image/canvasTransform";
import { useAutoTrace } from "./lib/trace/useAutoTrace";
import { buildSvgFromGeometry, validateSvgString } from "./lib/svg/buildSvg";
import { buildDxfFromGeometry } from "./lib/dxf/buildDxf";
import { validateDxfString } from "./lib/dxf/validateDxf";
import {
  DEFAULT_TRACING_SETTINGS,
  type Calibration,
  type CropRect,
  type LengthUnit,
  type LoadedImage,
  type RotationDegrees,
  type TracingSettings,
  type WorkspaceTab,
} from "./lib/types";

function downloadTextFile(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, "") || "drawing";
}

export default function App() {
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rotation, setRotation] = useState<RotationDegrees>(0);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("prepare");

  const [tracingSettings, setTracingSettings] = useState<TracingSettings>(DEFAULT_TRACING_SETTINGS);

  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [isPickingCalibration, setIsPickingCalibration] = useState(false);
  const [pickedPoints, setPickedPoints] = useState<{ x: number; y: number }[]>([]);
  const [calibrationDistance, setCalibrationDistance] = useState("1000");
  const [calibrationUnit, setCalibrationUnit] = useState<LengthUnit>("mm");
  const [exportError, setExportError] = useState<string | null>(null);

  // The canvas actually fed into tracing/preview: original -> rotated -> cropped.
  const preparedCanvas = useMemo(() => {
    if (!loadedImage) return null;
    const rotated = rotateCanvas(loadedImage.canvas, rotation);
    return cropRect ? cropCanvas(rotated, cropRect) : rotated;
  }, [loadedImage, rotation, cropRect]);

  // Retraces automatically (debounced) whenever the drawing or any tracing setting changes.
  const {
    result: traceResult,
    isTracing,
    error: traceError,
    retrace,
    dismissError: dismissTraceError,
  } = useAutoTrace({ canvas: preparedCanvas, settings: tracingSettings });

  const handleFileSelected = useCallback(async (file: File) => {
    setLoadError(null);
    try {
      const image = await loadImageFile(file);
      setLoadedImage(image);
      setRotation(0);
      setCropRect(null);
      setCalibration(null);
      setIsPickingCalibration(false);
      setPickedPoints([]);
      setActiveTab("prepare");
    } catch (err) {
      setLoadError(
        err instanceof ImageLoadError
          ? err.message
          : "Something went wrong reading this file. Please try a different image.",
      );
    }
  }, []);

  const handleNewFile = useCallback(() => {
    setLoadedImage(null);
    setLoadError(null);
  }, []);

  const overlaySvg = useMemo(
    () => (traceResult ? buildSvgFromGeometry(traceResult.geometry, { background: false }) : null),
    [traceResult],
  );

  const handleExportSvg = useCallback(() => {
    if (!traceResult || !loadedImage) return;
    setExportError(null);
    const validation = validateSvgString(traceResult.svg);
    if (!validation.valid) {
      setExportError(validation.error ?? "Generated SVG failed validation.");
      return;
    }
    downloadTextFile(`${baseName(loadedImage.fileName)}.svg`, "image/svg+xml", traceResult.svg);
  }, [traceResult, loadedImage]);

  const handleExportDxf = useCallback(() => {
    if (!traceResult || !loadedImage) return;
    setExportError(null);
    try {
      const dxf = buildDxfFromGeometry(traceResult.geometry, {
        calibration: calibration ?? undefined,
      });
      const validation = validateDxfString(dxf);
      if (!validation.valid) {
        setExportError(validation.error ?? "Generated DXF failed validation.");
        return;
      }
      downloadTextFile(`${baseName(loadedImage.fileName)}.dxf`, "application/dxf", dxf);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to build DXF file.");
    }
  }, [traceResult, loadedImage, calibration]);

  const handlePickPoint = useCallback((point: { x: number; y: number }) => {
    setPickedPoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
  }, []);

  const handleSaveCalibration = useCallback(() => {
    const distance = Number(calibrationDistance);
    if (pickedPoints.length !== 2 || !(distance > 0)) return;
    setCalibration({
      pointA: pickedPoints[0],
      pointB: pickedPoints[1],
      realDistance: distance,
      unit: calibrationUnit,
    });
    setIsPickingCalibration(false);
    setPickedPoints([]);
  }, [pickedPoints, calibrationDistance, calibrationUnit]);

  if (!loadedImage || !preparedCanvas) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <main className="flex-1">
          <UploadZone onFileSelected={handleFileSelected} />
          {loadError && (
            <div className="mx-auto max-w-xl px-6 pb-10">
              <ErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    // The page itself scrolls (no viewport-height root): the controls stack below the preview on narrow
    // windows and sits beside it from the lg breakpoint, where it stays in view while the page scrolls.
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <Header
        fileName={loadedImage.fileName}
        width={preparedCanvas.width}
        height={preparedCanvas.height}
        onNewFile={handleNewFile}
      />

      <div className="flex flex-1 flex-col lg:flex-row lg:items-start">
        <aside className="order-2 flex w-full shrink-0 flex-col gap-4 border-t border-slate-800 bg-slate-950/60 p-4 lg:sticky lg:top-0 lg:order-1 lg:max-h-screen lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-r">
          <nav className="flex gap-1 rounded-md border border-slate-800 bg-slate-900 p-1 text-xs">
            {(["prepare", "trace", "export"] as WorkspaceTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded px-2 py-1.5 font-medium capitalize ${
                  activeTab === tab
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>

          {activeTab === "prepare" && (
            <PrepareControls
              previewCanvas={preparedCanvas}
              cropRect={cropRect}
              onRotateLeft={() => {
                // A crop rect is captured in the current orientation's pixel space; rotating
                // without clearing it would silently reapply those coordinates to the new
                // (width/height-swapped) orientation, cropping the wrong region.
                setCropRect(null);
                setRotation((r) => ((r + 270) % 360) as RotationDegrees);
              }}
              onRotateRight={() => {
                setCropRect(null);
                setRotation((r) => ((r + 90) % 360) as RotationDegrees);
              }}
              onApplyCrop={(rect) => setCropRect(rect)}
              onClearCrop={() => setCropRect(null)}
              onReset={() => {
                setRotation(0);
                setCropRect(null);
              }}
            />
          )}

          {activeTab === "trace" && (
            <>
              {traceError && <ErrorBanner message={traceError} onDismiss={dismissTraceError} />}
              <TracingControls
                settings={tracingSettings}
                onChange={setTracingSettings}
                onRetrace={retrace}
                isTracing={isTracing}
                pathCount={traceResult ? traceResult.pathCount : null}
              />
            </>
          )}

          {activeTab === "export" && (
            <>
              <CalibrationPanel
                isPicking={isPickingCalibration}
                pickedPointCount={pickedPoints.length as 0 | 1 | 2}
                calibration={calibration}
                distanceInput={calibrationDistance}
                unit={calibrationUnit}
                onStartPicking={() => {
                  setIsPickingCalibration(true);
                  setPickedPoints([]);
                }}
                onCancelPicking={() => {
                  setIsPickingCalibration(false);
                  setPickedPoints([]);
                }}
                onDistanceChange={setCalibrationDistance}
                onUnitChange={setCalibrationUnit}
                onSave={handleSaveCalibration}
                onClear={() => setCalibration(null)}
              />
              <ExportPanel
                traceResult={traceResult}
                calibration={calibration}
                isTracing={isTracing}
                onExportSvg={handleExportSvg}
                onExportDxf={handleExportDxf}
                lastExportError={exportError}
              />
            </>
          )}
        </aside>

        <main className="order-1 min-w-0 flex-1 p-4 lg:order-2">
          <PreviewWorkspace
            originalCanvas={preparedCanvas}
            svg={traceResult?.svg ?? null}
            overlaySvg={overlaySvg}
            isTracing={isTracing}
            isPicking={isPickingCalibration}
            pickedPoints={pickedPoints}
            onPickPoint={handlePickPoint}
          />
        </main>
      </div>
    </div>
  );
}
