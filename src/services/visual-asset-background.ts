import { analyzeImageBackdrop, hasNearBlackBackdrop } from "../core/rendering/image-backdrop";

/**
 * Measures the backdrop of a generated picture.
 *
 * The model that draws the picture cannot be trusted to respect a "light
 * background" instruction: the scene description wins. This probe is the last
 * line of defence, so a near-black picture never reaches a page (ADR 0110).
 *
 * The picture is downsampled to a small square before measuring. Edge colours
 * survive the downscale, and a 64×64 read is cheap next to the image request
 * itself.
 */

/** Resolution of the probe canvas. */
const PROBE_EDGE = 64;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("VISUAL_ASSET_IMAGE_FAILED"));
    image.src = source;
  });
}

/**
 * Whether a generated picture paints a near-black backdrop.
 *
 * A picture that cannot be decoded is not rejected: the probe is a guard
 * against a known bad result, not another way for image handling to fail.
 */
export async function hasBlackBackdrop(dataUrl: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  try {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = PROBE_EDGE;
    canvas.height = PROBE_EDGE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    // Stretching to a square is enough for an edge measurement: the aspect
    // ratio does not change which pixels are at the border.
    context.drawImage(image, 0, 0, PROBE_EDGE, PROBE_EDGE);
    const pixels = context.getImageData(0, 0, PROBE_EDGE, PROBE_EDGE).data;
    return hasNearBlackBackdrop(analyzeImageBackdrop(pixels, PROBE_EDGE, PROBE_EDGE));
  } catch {
    return false;
  }
}
