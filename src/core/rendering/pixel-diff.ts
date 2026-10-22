import type { PixelImage } from "./png";

/** The area of a picture that differs between two renderings. */
export interface ChangedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelDiffOptions {
  /**
   * How far a colour channel may drift before the pixel counts as changed.
   *
   * A renderer is not bit exact: anti aliasing and hinting move a pixel by a
   * few levels between two runs. Without a tolerance every run would look
   * like a regression.
   */
  channelTolerance?: number;
  /** Whether to build a picture that marks the changed pixels. */
  includeDiffImage?: boolean;
}

export interface PixelDiffResult {
  kind: "identical" | "different" | "dimension-mismatch";
  width: number;
  height: number;
  changedPixels: number;
  /** The share of the picture that changed, between 0 and 1. */
  changedRatio: number;
  /** The area that changed, when the two pictures have the same size. */
  bounds?: ChangedBounds;
  /** A picture that marks the changed pixels, when it was asked for. */
  diff?: PixelImage;
}

const DEFAULT_TOLERANCE = 8;

function channelDiffers(left: number, right: number, tolerance: number): boolean {
  const difference = left - right;
  return difference > tolerance || difference < -tolerance;
}

/**
 * Compares two pictures pixel by pixel.
 *
 * Pictures of a different size are not compared: a resize is a layout change,
 * not a rendering difference, and reporting it as "everything changed" would
 * hide the real cause.
 */
export function comparePixels(
  expected: PixelImage,
  actual: PixelImage,
  options: PixelDiffOptions = {},
): PixelDiffResult {
  const tolerance = Math.max(0, Math.min(255, Math.round(options.channelTolerance ?? DEFAULT_TOLERANCE)));

  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      kind: "dimension-mismatch",
      width: expected.width,
      height: expected.height,
      changedPixels: Math.max(expected.width * expected.height, actual.width * actual.height),
      changedRatio: 1,
    };
  }

  const { width, height } = expected;
  const changedOffsets: number[] = [];
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const differs =
        channelDiffers(expected.data[offset]!, actual.data[offset]!, tolerance) ||
        channelDiffers(expected.data[offset + 1]!, actual.data[offset + 1]!, tolerance) ||
        channelDiffers(expected.data[offset + 2]!, actual.data[offset + 2]!, tolerance) ||
        channelDiffers(expected.data[offset + 3]!, actual.data[offset + 3]!, tolerance);
      if (!differs) continue;
      count += 1;
      changedOffsets.push(offset);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const total = width * height;
  const result: PixelDiffResult = {
    kind: count === 0 ? "identical" : "different",
    width,
    height,
    changedPixels: count,
    changedRatio: total === 0 ? 0 : count / total,
  };
  if (maxX >= 0) {
    result.bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }
  if (options.includeDiffImage) {
    result.diff = buildDiffImage(expected, changedOffsets);
  }
  return result;
}

/**
 * Builds the picture that shows what changed: the original in pale grey, the
 * changed pixels in red.
 */
function buildDiffImage(expected: PixelImage, changedOffsets: number[]): PixelImage {
  const { width, height } = expected;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    const grey = Math.round(
      (expected.data[offset]! * 0.299 + expected.data[offset + 1]! * 0.587 + expected.data[offset + 2]! * 0.114) *
        0.25 +
        191,
    );
    data[offset] = grey;
    data[offset + 1] = grey;
    data[offset + 2] = grey;
    data[offset + 3] = 255;
  }
  for (const offset of changedOffsets) {
    data[offset] = 220;
    data[offset + 1] = 30;
    data[offset + 2] = 40;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}
