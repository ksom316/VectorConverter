import type { CropRect, RotationDegrees } from "../types";

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(source, 0, 0);
  return out;
}

export function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: RotationDegrees,
): HTMLCanvasElement {
  if (degrees === 0) return cloneCanvas(source);

  const swapDims = degrees === 90 || degrees === 270;
  const out = document.createElement("canvas");
  out.width = swapDims ? source.height : source.width;
  out.height = swapDims ? source.width : source.height;

  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);

  return out;
}

export function cropCanvas(source: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.max(1, Math.min(Math.round(rect.width), source.width - x));
  const height = Math.max(1, Math.min(Math.round(rect.height), source.height - y));

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height);
  return out;
}
