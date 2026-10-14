import { describe, expect, it } from "vitest";
import {
  applyThreshold,
  boxBlur,
  computeOtsuThreshold,
  despeckle,
  flattenPaperTone,
  toGrayscale,
} from "../preprocess";

function makeImageData(width: number, height: number, fill: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" } as unknown as ImageData;
}

describe("toGrayscale", () => {
  it("averages RGB channels into equal luminance values", () => {
    const data = new Uint8ClampedArray([200, 100, 0, 255]);
    const imageData = { width: 1, height: 1, data } as unknown as ImageData;
    toGrayscale(imageData);
    expect(imageData.data[0]).toBe(imageData.data[1]);
    expect(imageData.data[1]).toBe(imageData.data[2]);
  });
});

describe("applyThreshold", () => {
  it("binarizes pixels to pure black or white around the cutoff", () => {
    const imageData = makeImageData(2, 1, (x) => (x === 0 ? 50 : 200));
    applyThreshold(imageData, 128);
    expect(imageData.data[0]).toBe(0);
    expect(imageData.data[4]).toBe(255);
  });
});

describe("computeOtsuThreshold", () => {
  it("finds a cutoff that separates two distinct intensity clusters", () => {
    const imageData = makeImageData(10, 10, (x) => (x < 5 ? 10 : 240));
    const threshold = computeOtsuThreshold(imageData);
    expect(threshold).toBeGreaterThanOrEqual(10);
    expect(threshold).toBeLessThan(240);
  });
});

describe("boxBlur", () => {
  it("writes identical, averaged values into all three RGB channels", () => {
    // 3x1 strip: black, white, black. The blurred center pixel should land strictly between.
    const imageData = makeImageData(3, 1, (x) => (x === 1 ? 255 : 0));
    boxBlur(imageData, 1);
    const center = 1 * 4;
    expect(imageData.data[center]).toBe(imageData.data[center + 1]);
    expect(imageData.data[center + 1]).toBe(imageData.data[center + 2]);
    expect(imageData.data[center]).toBeGreaterThan(0);
    expect(imageData.data[center]).toBeLessThan(255);
  });

  it("is a no-op for a non-positive radius", () => {
    const imageData = makeImageData(3, 3, (x, y) => (x + y) * 20);
    const before = Uint8ClampedArray.from(imageData.data);
    boxBlur(imageData, 0);
    expect(Array.from(imageData.data)).toEqual(Array.from(before));
  });
});

describe("despeckle", () => {
  it("removes small isolated blobs smaller than the minimum area", () => {
    // 10x10 white field with a single 1px black speck.
    const imageData = makeImageData(10, 10, (x, y) => (x === 5 && y === 5 ? 0 : 255));
    despeckle(imageData, 4);
    expect(imageData.data[(5 * 10 + 5) * 4]).toBe(255);
  });

  it("preserves blobs at or above the minimum area", () => {
    // A solid 4x4 black square (area 16) should survive a minArea of 4.
    const imageData = makeImageData(10, 10, (x, y) => (x >= 3 && x < 7 && y >= 3 && y < 7 ? 0 : 255));
    despeckle(imageData, 4);
    expect(imageData.data[(4 * 10 + 4) * 4]).toBe(0);
  });

  it("preserves a thin 1px-wide line even though its area is below minArea", () => {
    // A 1x20 vertical black line (area 20) on a 30x30 white field. A naive area filter with
    // minArea=25 would erase it entirely, deleting real linework (e.g. a dimension line).
    const imageData = makeImageData(30, 30, (x, y) => (x === 15 && y >= 5 && y < 25 ? 0 : 255));
    despeckle(imageData, 25);
    // Line should still be present (sampled at its midpoint).
    expect(imageData.data[(15 * 30 + 15) * 4]).toBe(0);
  });

  it("does not fill in a thin white gap between two closely-spaced parallel black lines", () => {
    // Two parallel vertical black lines 1px apart, e.g. a double wall line in a floor plan.
    // The 1px-wide white gap between them has a tiny area and must not be merged into black.
    const imageData = makeImageData(30, 30, (x, y) => {
      if (y < 5 || y >= 25) return 255;
      if (x === 14 || x === 16) return 0; // the two lines
      return 255; // includes the x === 15 gap column
    });
    despeckle(imageData, 25);
    expect(imageData.data[(15 * 30 + 15) * 4]).toBe(255);
  });

  it("still removes genuinely tiny elongated noise (a couple of stray pixels)", () => {
    // A 1x2 sliver of noise should still be cleaned up even though it is "elongated".
    const imageData = makeImageData(20, 20, (x, y) => (x === 10 && (y === 10 || y === 11) ? 0 : 255));
    despeckle(imageData, 25);
    expect(imageData.data[(10 * 20 + 10) * 4]).toBe(255);
  });
});

type Pixel = [number, number];

/** A white canvas with the given pixels inked black. */
function imageWithInk(width: number, height: number, pixels: Pixel[]): ImageData {
  const ink = new Set(pixels.map(([x, y]) => y * width + x));
  return makeImageData(width, height, (x, y) => (ink.has(y * width + x) ? 0 : 255));
}

const isInk = (imageData: ImageData, x: number, y: number) =>
  imageData.data[(y * imageData.width + x) * 4] === 0;

const countInk = (imageData: ImageData) => {
  let n = 0;
  for (let i = 0; i < imageData.data.length; i += 4) if (imageData.data[i] === 0) n++;
  return n;
};

/** True if `to` can be reached from `from` through ink pixels, moving in 8 directions. */
function inkReachable8(imageData: ImageData, from: Pixel, to: Pixel): boolean {
  const { width, height } = imageData;
  if (!isInk(imageData, from[0], from[1]) || !isInk(imageData, to[0], to[1])) return false;
  const seen = new Set<number>([from[1] * width + from[0]]);
  const queue: Pixel[] = [from];
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (x === to[0] && y === to[1]) return true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!isInk(imageData, nx, ny) || seen.has(ny * width + nx)) continue;
        seen.add(ny * width + nx);
        queue.push([nx, ny]);
      }
    }
  }
  return false;
}

describe("despeckle with one-pixel diagonal strokes (ink is 8-connected)", () => {
  const MIN_AREA = 12; // the default the noise slider maps to at noise = 3

  it("keeps a one-pixel 45-degree chain longer than the area limit, in both directions", () => {
    const down: Pixel[] = Array.from({ length: 15 }, (_, i) => [5 + i, 5 + i]);
    const up: Pixel[] = Array.from({ length: 15 }, (_, i) => [5 + i, 25 - i]);
    for (const chain of [down, up]) {
      const imageData = imageWithInk(30, 30, chain);
      despeckle(imageData, MIN_AREA);
      expect(countInk(imageData)).toBe(chain.length);
      expect(inkReachable8(imageData, chain[0], chain[chain.length - 1])).toBe(true);
    }
  });

  it("keeps shallow and steep one-pixel diagonal strokes", () => {
    // Bresenham-style lines: the pixels only touch each other along the diagonal steps.
    const shallow: Pixel[] = Array.from({ length: 40 }, (_, x) => [5 + x, 5 + Math.floor(x / 2)]);
    const veryShallow: Pixel[] = Array.from({ length: 45 }, (_, x) => [5 + x, 5 + Math.floor(x / 3)]);
    const steep: Pixel[] = Array.from({ length: 40 }, (_, y) => [5 + Math.floor(y / 2), 5 + y]);
    for (const stroke of [shallow, veryShallow, steep]) {
      const imageData = imageWithInk(60, 60, stroke);
      despeckle(imageData, MIN_AREA);
      expect(countInk(imageData)).toBe(stroke.length);
    }
  });

  it("still removes a free-standing diagonal stroke shorter than the area limit", () => {
    // Known limitation, unchanged from before: the area rule treats any free-standing component
    // under minArea as a speck, so a short isolated diagonal (here 8 px) is removed. Only the
    // connectivity changed; strokes longer than minArea, or touching a larger shape, survive.
    const shortStroke: Pixel[] = Array.from({ length: 8 }, (_, i) => [5 + i, 5 + i]);
    const imageData = imageWithInk(20, 20, shortStroke);
    despeckle(imageData, MIN_AREA);
    expect(countInk(imageData)).toBe(0);
  });

  it("still removes isolated single pixels and small disconnected specks", () => {
    const specks: Pixel[] = [
      [5, 5], // single pixel
      [12, 5], [13, 5], [12, 6], [13, 6], // 2x2 block
      [20, 5], [21, 6], // two pixels touching only at a corner
      [5, 14], [6, 14], [7, 14], [5, 15], [6, 15], [7, 15], [5, 16], [6, 16], [7, 16], // 3x3 block (area 9)
      [15, 15], // lone pixel, 2px away from any other ink
      [17, 17],
    ];
    const imageData = imageWithInk(30, 30, specks);
    despeckle(imageData, MIN_AREA);
    expect(countInk(imageData)).toBe(0);
  });

  it("keeps the 8-connected side effect visible: a speck touching a stroke only at a corner stays with it", () => {
    // Limitation of 8-connectivity: ink touching a large shape diagonally is part of that shape
    // and is no longer treated as a separate speck.
    const bar: Pixel[] = Array.from({ length: 20 }, (_, i) => [10, 5 + i]);
    const cornerSpeck: Pixel = [11, 4]; // touches the bar's top pixel (10, 5) only diagonally
    const imageData = imageWithInk(30, 30, [...bar, cornerSpeck]);
    despeckle(imageData, MIN_AREA);
    expect(isInk(imageData, cornerSpeck[0], cornerSpeck[1])).toBe(true);
    expect(countInk(imageData)).toBe(bar.length + 1);
  });

  it("keeps diagonal hatch strokes connected to a wall, whether they touch it edge-on or at a corner", () => {
    // A 3px-thick vertical wall with two short (6px, below minArea on their own) diagonal strokes.
    const wall: Pixel[] = [];
    for (let x = 10; x <= 12; x++) for (let y = 10; y <= 29; y++) wall.push([x, y]);
    // Edge contact: first pixel is beside the wall, the rest run diagonally away from it.
    const edgeTick: Pixel[] = Array.from({ length: 6 }, (_, i) => [13 + i, 14 - i]);
    // Corner contact: first pixel touches the wall's top-right pixel (12, 10) only diagonally.
    const cornerTick: Pixel[] = Array.from({ length: 6 }, (_, i) => [13 + i, 9 - i]);
    const imageData = imageWithInk(30, 35, [...wall, ...edgeTick, ...cornerTick]);
    despeckle(imageData, MIN_AREA);

    expect(countInk(imageData)).toBe(wall.length + edgeTick.length + cornerTick.length);
    expect(inkReachable8(imageData, [11, 20], edgeTick[edgeTick.length - 1])).toBe(true);
    expect(inkReachable8(imageData, [11, 20], cornerTick[cornerTick.length - 1])).toBe(true);
  });
});

describe("despeckle white pinhole filling (background stays 4-connected)", () => {
  const MIN_AREA = 12;

  it("fills a single-pixel white pinhole inside a solid ink shape", () => {
    const imageData = makeImageData(20, 20, (x, y) => (x === 10 && y === 10 ? 255 : 0));
    despeckle(imageData, MIN_AREA);
    expect(isInk(imageData, 10, 10)).toBe(true);
  });

  it("fills a diagonal white run inside solid ink exactly as before: its pixels are separate pinholes", () => {
    // Background pixels that only touch at corners are NOT one component, so a 1px diagonal
    // white line in a solid ink block is a row of area-1 pinholes and gets filled. If the
    // background were also 8-connected this 15px line would be kept.
    const imageData = makeImageData(30, 30, (x, y) => (x === y && x >= 5 && x < 20 ? 255 : 0));
    despeckle(imageData, MIN_AREA);
    expect(countInk(imageData)).toBe(30 * 30);
  });

  it("still keeps a thin straight white gap between two ink lines", () => {
    const imageData = makeImageData(30, 30, (x, y) => (y >= 5 && y < 25 && (x === 14 || x === 16) ? 0 : 255));
    despeckle(imageData, 25);
    expect(isInk(imageData, 15, 15)).toBe(false);
  });

  it("fills exactly the white pixels a plain 4-connected background rule predicts, on a noisy image", () => {
    // Independent reference of the background rule (4-connected white components, area below
    // minArea, or below min(minArea, 4) when the bounding box is elongated), compared against
    // despeckle() on a seeded pseudo-random image. Ink changes must not leak into this set.
    const width = 48;
    const height = 48;
    let seed = 20240607;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const noisy = makeImageData(width, height, () => (random() < 0.45 ? 0 : 255));
    const before = Uint8ClampedArray.from(noisy.data);

    const expectedFills = new Set<number>();
    const seen = new Set<number>();
    for (let start = 0; start < width * height; start++) {
      if (seen.has(start) || before[start * 4] === 0) continue;
      const component: number[] = [];
      const stack = [start];
      seen.add(start);
      let minX = width, maxX = 0, minY = height, maxY = 0;
      while (stack.length > 0) {
        const p = stack.pop()!;
        component.push(p);
        const x = p % width;
        const y = (p - x) / width;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!seen.has(q) && before[q * 4] !== 0) { seen.add(q); stack.push(q); }
        }
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const elongated = Math.max(w, h) / Math.max(1, Math.min(w, h)) > 4;
      if (component.length < (elongated ? Math.min(MIN_AREA, 4) : MIN_AREA)) {
        component.forEach((p) => expectedFills.add(p));
      }
    }

    despeckle(noisy, MIN_AREA);
    const actualFills = new Set<number>();
    for (let p = 0; p < width * height; p++) {
      if (before[p * 4] !== 0 && noisy.data[p * 4] === 0) actualFills.add(p);
    }
    expect(expectedFills.size).toBeGreaterThan(0);
    expect([...actualFills].sort((a, b) => a - b)).toEqual([...expectedFills].sort((a, b) => a - b));
  });
});

describe("flattenPaperTone", () => {
  const value = (imageData: ImageData, x: number, y: number) => imageData.data[(y * imageData.width + x) * 4];
  const copyOf = (imageData: ImageData) => Uint8ClampedArray.from(imageData.data);

  /** Paper that gets brighter from left to right, with 1px diagonal strokes a constant 45 levels darker than the paper. */
  const driftingHatch = (width: number, height: number, left = 200, right = 236) =>
    makeImageData(width, height, (x, y) => {
      const paper = Math.round(left + ((right - left) * x) / (width - 1));
      return (x + y) % 5 === 0 ? paper - 45 : paper;
    });

  const strokeMean = (imageData: ImageData, x0: number, x1: number) => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < imageData.height; y++) {
      for (let x = x0; x < x1; x++) {
        if ((x + y) % 5 === 0) {
          sum += value(imageData, x, y);
          n++;
        }
      }
    }
    return sum / n;
  };

  const inkShare = (imageData: ImageData, x0: number, x1: number, cutoff: number) => {
    let ink = 0;
    for (let y = 0; y < imageData.height; y++) {
      for (let x = x0; x < x1; x++) if (value(imageData, x, y) < cutoff) ink++;
    }
    return ink / (imageData.height * (x1 - x0));
  };

  it("leaves a page with uniform paper tone exactly unchanged", () => {
    const imageData = makeImageData(120, 80, (x, y) => ((x + y) % 7 === 0 ? 150 : 232));
    const before = copyOf(imageData);
    flattenPaperTone(imageData);
    expect(Array.from(imageData.data)).toEqual(Array.from(before));
  });

  it("leaves a white page with thin strokes, light-gray strokes and a thick black block unchanged", () => {
    const imageData = makeImageData(160, 100, (x, y) => {
      if (x >= 20 && x < 44 && y >= 20 && y < 44) return 20; // thick black block
      if (y === 70) return 192; // light gray thin line
      if (x === 100) return 0; // black thin line
      return 255;
    });
    const before = copyOf(imageData);
    flattenPaperTone(imageData);
    expect(Array.from(imageData.data)).toEqual(Array.from(before));
  });

  it("evens out strokes of constant contrast across drifting paper tone", () => {
    const width = 240;
    const imageData = driftingHatch(width, 60);
    const gapBefore = strokeMean(imageData, 180, 240) - strokeMean(imageData, 0, 60);
    expect(gapBefore).toBeGreaterThan(25); // the problem: same stroke, very different brightness

    flattenPaperTone(imageData);
    const gapAfter = strokeMean(imageData, 180, 240) - strokeMean(imageData, 0, 60);
    expect(Math.abs(gapAfter)).toBeLessThan(8);
  });

  it("makes one global cutoff pick up the same share of hatching on both sides of the sheet", () => {
    const width = 240;
    const cutoff = 178; // above the strokes on the dark side, below them on the bright side
    const raw = driftingHatch(width, 60);
    const rawLeft = inkShare(raw, 0, 60, cutoff);
    const rawRight = inkShare(raw, 180, 240, cutoff);
    expect(rawRight).toBeLessThan(rawLeft * 0.3);

    const flat = driftingHatch(width, 60);
    flattenPaperTone(flat);
    const left = inkShare(flat, 0, 60, cutoff);
    const right = inkShare(flat, 180, 240, cutoff);
    expect(Math.min(left, right) / Math.max(left, right)).toBeGreaterThan(0.75);
  });

  it("keeps stroke contrast: a stroke stays about as much darker than its paper as before", () => {
    const imageData = driftingHatch(240, 60);
    flattenPaperTone(imageData);
    for (const x of [30, 120, 210]) {
      // stroke at (x + y) % 5 === 0 and the paper pixel next to it
      const y = (5 - (x % 5)) % 5 + 10;
      const stroke = value(imageData, x, y);
      const paper = value(imageData, x + 1, y);
      expect(paper - stroke, `x ${x}`).toBeGreaterThanOrEqual(43);
      expect(paper - stroke, `x ${x}`).toBeLessThanOrEqual(47);
    }
  });

  it("is not pulled by a thick black block: strokes next to it keep their value", () => {
    const imageData = makeImageData(200, 120, (x, y) => {
      if (x >= 80 && x < 112 && y >= 40 && y < 72) return 30; // 32px black block
      return y === 56 && (x < 80 || x >= 112) ? 120 : 232; // a 1px line running up to and away from it
    });
    const before = copyOf(imageData);
    flattenPaperTone(imageData);
    // nothing near the block, on either side of it, moves by more than a level or two
    for (const x of [70, 74, 78, 114, 118, 130]) {
      expect(Math.abs(value(imageData, x, 56) - before[(56 * 200 + x) * 4]), `x ${x}`).toBeLessThanOrEqual(2);
    }
    expect(value(imageData, 96, 56)).toBeLessThan(80); // the block itself stays dark
  });

  it("never moves a pixel by more than maxShift, and does nothing when maxShift is 0", () => {
    const imageData = driftingHatch(240, 60, 150, 240);
    const before = copyOf(imageData);
    flattenPaperTone(imageData, { maxShift: 5 });
    let largest = 0;
    for (let i = 0; i < before.length; i += 4) largest = Math.max(largest, Math.abs(imageData.data[i] - before[i]));
    expect(largest).toBeLessThanOrEqual(5);

    const untouched = driftingHatch(240, 60);
    const snapshot = copyOf(untouched);
    flattenPaperTone(untouched, { maxShift: 0 });
    expect(Array.from(untouched.data)).toEqual(Array.from(snapshot));
  });

  it("writes the same value to all three channels", () => {
    const imageData = driftingHatch(120, 40);
    flattenPaperTone(imageData);
    for (let i = 0; i < imageData.data.length; i += 4) {
      expect(imageData.data[i + 1]).toBe(imageData.data[i]);
      expect(imageData.data[i + 2]).toBe(imageData.data[i]);
    }
  });
});
