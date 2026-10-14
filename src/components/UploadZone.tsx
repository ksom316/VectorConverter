import { useCallback, useRef, useState } from "react";
import { SUPPORTED_MIME_TYPES } from "../lib/image/loadImage";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
}

export function UploadZone({ onFileSelected }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFileSelected(file);
    },
    [onFileSelected],
  );

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-10 px-6 py-16">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100">Vector Converter</h1>
        <p className="mt-3 text-slate-400">
          Turn hand-drawn sketches and scanned architectural drawings into editable SVG and DXF
          vector files. Everything runs locally in your browser — your drawings are never
          uploaded anywhere.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-10 py-16 text-center transition-colors ${
          isDragOver
            ? "border-indigo-400 bg-indigo-500/10"
            : "border-slate-700 bg-slate-900/40 hover:border-slate-500"
        }`}
      >
        <svg
          className="h-10 w-10 text-slate-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5 7.5 12M12 7.5V16.5"
          />
        </svg>
        <div>
          <p className="font-medium text-slate-200">Drag & drop a drawing here</p>
          <p className="mt-1 text-sm text-slate-500">or click to browse — PNG or JPG</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={SUPPORTED_MIME_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelected(file);
            e.target.value = "";
          }}
        />
      </div>

      <ol className="grid w-full max-w-xl grid-cols-1 gap-3 text-sm text-slate-400 sm:grid-cols-5">
        {["Upload", "Prepare", "Trace", "Inspect", "Export"].map((step, i) => (
          <li
            key={step}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 sm:flex-col sm:text-center"
          >
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-300">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
