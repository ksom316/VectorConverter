/**
 * Pure ImageData transforms used to prepare a scanned/sketched drawing for tracing.
 * These run identically on the main thread or inside the trace worker (no DOM access needed).
 */

export function toGrayscale(imageData: ImageData): ImageData {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = lum;
    data[i + 1] = lum;
    data[i + 2] = lum;
  }
  return imageData;
}

/**
 * Sliding-window maximum (or minimum) over a (2*radius+1) square, as two separable O(n) passes
 * using a monotonic queue. Used for the grayscale closing in flattenPaperTone().
 */
function slidingExtreme(src: Uint8Array, width: number, height: number, radius: number, takeMax: boolean): Uint8Array {
  const tmp = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  const queue = new Int32Array(Math.max(width, height));
  const pass = (from: Uint8Array, to: Uint8Array, length: number, lines: number, step: number, lineStep: number) => {
    for (let line = 0; line < lines; line++) {
      const base = line * lineStep;
      let head = 0;
      let tail = 0;
      let next = 0;
      for (let i = 0; i < length; i++) {
        const last = Math.min(length - 1, i + radius);
        while (next <= last) {
          const value = from[base + next * step];
          while (tail > head) {
            const back = from[base + queue[tail - 1] * step];
            if (takeMax ? back <= value : back >= value) tail--;
            else break;
          }
          queue[tail++] = next++;
        }
        while (queue[head] < i - radius) head++;
        to[base + i * step] = from[base + queue[head] * step];
      }
    }
  };
  pass(src, tmp, width, height, 1, width); // along rows
  pass(tmp, out, height, width, width, 1); // along columns
  return out;
}

/** Separable box sum over a (2*radius+1) square window, clamped at the borders. */
function boxSum(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += src[y * width + x];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum;
      const add = x + radius + 1;
      const drop = x - radius;
      if (add < width) sum += src[y * width + add];
      if (drop >= 0) sum -= src[y * width + drop];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum;
      const add = y + radius + 1;
      const drop = y - radius;
      if (add < height) sum += tmp[add * width + x];
      if (drop >= 0) sum -= tmp[drop * width + x];
    }
  }
  return out;
}

export interface PaperToneOptions {
  /** Window radius of the grayscale closing: dark strokes thinner than 2*radius+1 px are treated as ink, not paper. */
  closingRadius?: number;
  /** Radius over which the local paper brightness is averaged. */
  smoothingRadius?: number;
  /** The most any pixel may be brightened or darkened, in gray levels. */
  maxShift?: number;
  /** Closing values this far below the median paper level are not paper (thick dark ink) and are ignored. */
  paperTolerance?: number;
}

/**
 * Flattens uneven paper tone on a grayscale image so that one global threshold means the same
 * thing across the whole sheet.
 *
 * Scans of old drawings have a paper brightness that drifts by tens of gray levels (stains,
 * folds, lighting), while a stroke is a roughly constant amount darker than the paper next to
 * it. With a single cutoff, the same hatching is picked up in one part of the sheet and dropped
 * in another. This estimates the local paper brightness (a grayscale closing removes strokes
 * thinner than the window; paper-only pixels are then averaged over a larger window, so thick
 * black walls do not drag the estimate down) and shifts each pixel by the difference between the
 * typical paper level and its local paper level, limited to +-maxShift. Pixels keep their
 * contrast; only their baseline moves.
 *
 * A page whose paper is uniform (for example a clean white CAD export) gets a shift of zero
 * everywhere and is returned unchanged. Expects R = G = B (call after toGrayscale()).
 */
export function flattenPaperTone(imageData: ImageData, options: PaperToneOptions = {}): ImageData {
  const { closingRadius = 5, smoothingRadius = 20, maxShift = 20, paperTolerance = 40 } = options;
  const { width, height, data } = imageData;
  const size = width * height;
  if (size === 0 || maxShift <= 0) return imageData;

  const gray = new Uint8Array(size);
  for (let i = 0; i < size; i++) gray[i] = data[i * 4];

  const closing = slidingExtreme(slidingExtreme(gray, width, height, closingRadius, true), width, height, closingRadius, false);

  const histogram = new Uint32Array(256);
  for (let i = 0; i < size; i++) histogram[closing[i]]++;
  let median = 0;
  for (let seen = 0; median < 255; median++) {
    seen += histogram[median];
    if (seen * 2 >= size) break;
  }

  const paperSum = new Float32Array(size);
  const paperCount = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    if (closing[i] >= median - paperTolerance) {
      paperSum[i] = closing[i];
      paperCount[i] = 1;
    }
  }
  const sums = boxSum(paperSum, width, height, smoothingRadius);
  const counts = boxSum(paperCount, width, height, smoothingRadius);

  const paper = new Float32Array(size);
  const levelHistogram = new Uint32Array(256);
  let paperPixels = 0;
  for (let i = 0; i < size; i++) {
    paper[i] = counts[i] > 0 ? sums[i] / counts[i] : median;
    if (paperCount[i] === 1) {
      levelHistogram[Math.min(255, Math.max(0, Math.round(paper[i])))]++;
      paperPixels++;
    }
  }
  let reference = median;
  if (paperPixels > 0) {
    for (let level = 0, seen = 0; level < 256; level++) {
      seen += levelHistogram[level];
      if (seen * 2 >= paperPixels) {
        reference = level;
        break;
      }
    }
  }

  for (let i = 0; i < size; i++) {
    const shift = Math.max(-maxShift, Math.min(maxShift, reference - paper[i]));
    const value = Math.max(0, Math.min(255, Math.round(gray[i] + shift)));
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
  }
  return imageData;
}

/**
 * Simple separable box blur, used for light noise suppression before thresholding.
 *
 * Operates on a single channel: this is always called after toGrayscale(), which already
 * sets R=G=B per pixel, so blurring all three channels would triple both the compute and
 * the temporary buffer's memory footprint for no visual difference. The result is still
 * written back into all three RGB channels so applyThreshold's `data[i]` read stays valid.
 */
export function boxBlur(imageData: ImageData, radius: number): ImageData {
  if (radius <= 0) return imageData;
  const { width, height, data } = imageData;
  const tmp = new Float32Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = x + dx;
        if (sx < 0 || sx >= width) continue;
        sum += data[(y * width + sx) * 4];
        count++;
      }
      tmp[y * width + x] = sum / count;
    }
  }

  // Vertical pass, writing back into imageData
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        sum += tmp[sy * width + x];
        count++;
      }
      const v = sum / count;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }

  return imageData;
}

/** Binarizes a grayscale image to pure black/white foreground/background. */
export function applyThreshold(imageData: ImageData, cutoff: number): ImageData {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] < cutoff ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return imageData;
}

/** Otsu's method: picks a threshold that best separates foreground/background. */
export function computeOtsuThreshold(imageData: ImageData): number {
  const histogram = new Array(256).fill(0);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]]++;
  }
  const total = data.length / 4;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * A component's bounding-box longest side divided by its shortest side. Compact blobs
 * (real noise specks) sit close to 1; thin strokes, dimension ticks, and thin gaps between
 * parallel lines are long and narrow and score much higher.
 */
const ELONGATION_THRESHOLD = 4;

/**
 * Removes small connected blobs by flipping them to the opposite color. Ink (black) blobs are
 * 8-connected and background (white) blobs are 4-connected, so a one-pixel diagonal stroke is a
 * single component rather than a row of isolated pixels, while a thin diagonal white gap is
 * still treated as separate pinholes. Operates on a binarized (pure black/white) image and
 * handles both small dark specks on a light background and small light pinholes inside dark
 * strokes.
 *
 * Blob area alone is a poor noise signal for line drawings: a short run of a 1px-wide wall
 * line, or the thin white gap between two closely-spaced parallel lines (double wall lines,
 * window/door frames), can have the same pixel area as genuine noise speckles despite being
 * real content. To avoid erasing or merging that content, components whose bounding box is
 * elongated (longest side more than ELONGATION_THRESHOLD times the shortest side) are only
 * removed if they are a handful of pixels — effectively isolated noise pixels/short hairs —
 * rather than being held to the same area threshold as compact, speckle-shaped blobs.
 */
export function despeckle(imageData: ImageData, minArea: number): ImageData {
  if (minArea <= 0) return imageData;
  const { width, height, data } = imageData;
  const size = width * height;
  const isBlack = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    isBlack[i] = data[i * 4] < 128 ? 1 : 0;
  }

  const visited = new Uint8Array(size);
  const stack = new Int32Array(size);
  const tinyNoiseCeiling = Math.min(minArea, 4);

  for (let start = 0; start < size; start++) {
    if (visited[start]) continue;
    const color = isBlack[start];
    let stackLen = 0;
    stack[stackLen++] = start;
    visited[start] = 1;
    const component: number[] = [start];

    let minX = start % width;
    let maxX = minX;
    let minY = (start - minX) / width;
    let maxY = minY;

    while (stackLen > 0) {
      const idx = stack[--stackLen];
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ];
      if (color === 1) {
        // Ink is 8-connected: a 1px diagonal stroke only touches itself corner to corner.
        neighbors.push(
          x > 0 && y > 0 ? idx - width - 1 : -1,
          x < width - 1 && y > 0 ? idx - width + 1 : -1,
          x > 0 && y < height - 1 ? idx + width - 1 : -1,
          x < width - 1 && y < height - 1 ? idx + width + 1 : -1,
        );
      }
      for (const n of neighbors) {
        if (n >= 0 && !visited[n] && isBlack[n] === color) {
          visited[n] = 1;
          stack[stackLen++] = n;
          component.push(n);
        }
      }
    }

    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const longest = Math.max(bboxWidth, bboxHeight);
    const shortest = Math.max(1, Math.min(bboxWidth, bboxHeight));
    const isElongated = longest / shortest > ELONGATION_THRESHOLD;
    const threshold = isElongated ? tinyNoiseCeiling : minArea;

    if (component.length < threshold) {
      const flipped = color === 1 ? 255 : 0;
      for (const idx of component) {
        const i = idx * 4;
        data[i] = flipped;
        data[i + 1] = flipped;
        data[i + 2] = flipped;
      }
    }
  }

  return imageData;
}
