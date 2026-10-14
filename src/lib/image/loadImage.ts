import type { LoadedImage } from "../types";

export const SUPPORTED_MIME_TYPES = ["image/png", "image/jpeg"];
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_DIMENSION_PX = 8000;

export class ImageLoadError extends Error {}

function validateFile(file: File): void {
  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    throw new ImageLoadError(
      `Unsupported file type "${file.type || "unknown"}". Please upload a PNG or JPG image.`,
    );
  }
  if (file.size === 0) {
    throw new ImageLoadError("This file is empty (0 bytes) and cannot be opened.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new ImageLoadError(
      `This file is ${mb} MB, which exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit. Please use a smaller image.`,
    );
  }
}

function decodeImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new ImageLoadError(
          "This image could not be read. The file may be corrupt or not a valid image.",
        ),
      );
    };
    img.src = url;
  });
}

function checkBlank(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 100));
  const { data } = ctx.getImageData(0, 0, width, height);
  let first = -1;
  let allSame = true;
  for (let y = 0; y < height && allSame; y += sampleStep) {
    for (let x = 0; x < width && allSame; x += sampleStep) {
      const i = (y * width + x) * 4;
      const v = data[i] + data[i + 1] + data[i + 2];
      if (first === -1) {
        first = v;
      } else if (Math.abs(v - first) > 2) {
        allSame = false;
      }
    }
  }
  if (allSame) {
    throw new ImageLoadError(
      "This image appears to be blank (a single solid color). There is nothing to trace.",
    );
  }
}

/**
 * Validates, decodes, and loads an image file onto an off-DOM canvas for processing.
 * All work happens locally in the browser; the file is never uploaded anywhere.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  validateFile(file);
  const img = await decodeImageElement(file);

  if (img.naturalWidth === 0 || img.naturalHeight === 0) {
    throw new ImageLoadError("This image has no visible content (zero dimensions).");
  }
  if (img.naturalWidth > MAX_DIMENSION_PX || img.naturalHeight > MAX_DIMENSION_PX) {
    throw new ImageLoadError(
      `This image is ${img.naturalWidth}x${img.naturalHeight}px, which exceeds the ${MAX_DIMENSION_PX}px limit per side. Please downscale it first.`,
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageLoadError("Your browser does not support canvas image processing.");
  }
  ctx.drawImage(img, 0, 0);

  checkBlank(canvas);

  return {
    fileName: file.name,
    width: canvas.width,
    height: canvas.height,
    canvas,
  };
}
