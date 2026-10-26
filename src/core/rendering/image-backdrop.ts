import { relativeLuminance } from "./contrast";

/**
 * Whether a generated picture paints its own near-black backdrop.
 *
 * A generated deck puts its pictures inside a page that already owns a colour.
 * A picture whose edges are near-black does not read as a photograph on that
 * page; it reads as a black block, and the page loses its composition. Image
 * models reliably produce that block for "tech", "night" or "glow" scenes even
 * when the prompt asks for an airy frame, so the result is measured instead of
 * trusted.
 *
 * Only the edge band is sampled: the background of a picture lives at its
 * border, while a dark subject in the middle (a machine, a person, a chart) is
 * still allowed on a light field. The rule is deliberately about the backdrop,
 * not about how dark the whole picture is.
 */

/** A pixel at or below this luminance reads as a near-black surface. */
export const NEAR_BLACK_LUMINANCE = 0.08;

/** The share of the edge band that has to be near-black before the backdrop counts. */
export const NEAR_BLACK_SHARE = 0.6;

/** Pixels below this alpha are transparent and cannot be a black field. */
const MINIMUM_ALPHA = 32;

/** How thick the sampled border band is, relative to the shorter side. */
const EDGE_BAND = 0.12;

export interface BackdropSample {
  /** Share of the opaque edge pixels that read as near-black. */
  nearBlackShare: number;
  /** How many opaque pixels the edge band contained. */
  opaquePixels: number;
}

/** Measures the edge band of an RGBA buffer. */
export function analyzeImageBackdrop(pixels: Uint8ClampedArray, width: number, height: number): BackdropSample {
  if (width <= 0 || height <= 0) return { nearBlackShare: 0, opaquePixels: 0 };
  const band = Math.max(1, Math.round(Math.min(width, height) * EDGE_BAND));
  let dark = 0;
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    const inRowBand = y < band || y >= height - band;
    for (let x = 0; x < width; x += 1) {
      const inColumnBand = x < band || x >= width - band;
      if (!inRowBand && !inColumnBand) continue;
      const offset = (y * width + x) * 4;
      if ((pixels[offset + 3] ?? 255) < MINIMUM_ALPHA) continue;
      opaque += 1;
      const luminance = relativeLuminance([pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]);
      if (luminance <= NEAR_BLACK_LUMINANCE) dark += 1;
    }
  }
  return { nearBlackShare: opaque > 0 ? dark / opaque : 0, opaquePixels: opaque };
}

/**
 * Whether the measurement describes a near-black backdrop.
 *
 * A picture with no opaque border (a cut-out or a fully transparent frame) has
 * no backdrop to object to, so it passes.
 */
export function hasNearBlackBackdrop(sample: BackdropSample): boolean {
  return sample.opaquePixels > 0 && sample.nearBlackShare >= NEAR_BLACK_SHARE;
}
