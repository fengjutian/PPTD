/**
 * Stand-ins for the pictures a preview does not generate.
 *
 * The batch and the whole-deck preview deliberately skip image generation: it is
 * the expensive half of a deck, and paying for eight versions of it to throw
 * seven away is not worth it. What those previews then showed, though, was not
 * "a deck without pictures" — it was a page whose text occupies half of its
 * width and whose other half is empty, because the design had reserved that
 * space for a picture. The composition read as broken, and the user judged the
 * design on a page the renderer could not draw.
 *
 * A placeholder asset restores the composition: the image element is laid out
 * where the real picture will go, in the aspect ratio the real one will have,
 * and the page is judged on the layout it will actually have.
 */

import type { AiSlideDesign, AiVisualAssetData } from "../core/commands";
import { VISUAL_ASSET_REQUEST_SIZE, type AiVisualAssetRole } from "../core/commands/visual-asset";
import { encodePng, type PixelImage } from "../core/rendering/png";

/** The ratio a preview placeholder is generated at; it is never shown full size. */
const PLACEHOLDER_SCALE = 0.5;
const MIN_EDGE = 128;

type Rgb = [number, number, number];

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

/**
 * A neutral picture-shaped field: soft vertical tint, a dashed keyline and a
 * faint diagonal hatch. It must not look like a design element — a flat grey
 * panel reads as a filled shape, a hatched outline reads as "a picture goes
 * here".
 */
export function placeholderPixels(width: number, height: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const top: Rgb = [237, 241, 246];
  const bottom: Rgb = [225, 231, 239];
  const hatch: Rgb = [214, 222, 232];
  const keyline: Rgb = [197, 207, 219];
  const border = Math.max(1, Math.round(Math.min(width, height) * 0.012));
  const dash = Math.max(6, Math.round(Math.min(width, height) * 0.06));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      let color = mix(top, bottom, height > 1 ? y / (height - 1) : 0);
      // 45° hatch, one pixel wide every twelve: enough to read as a stand-in
      // without turning the picture area into a pattern.
      if ((x + y) % 12 === 0) color = mix(color, hatch, 0.6);
      const onKeyline = x < border || y < border || x >= width - border || y >= height - border;
      if (onKeyline && (x + y) % (dash * 2) < dash) color = keyline;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function toBase64(bytes: Uint8Array): string {
  // The bundle runs in a WebView; Buffer is not available there.
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

const cache = new Map<AiVisualAssetRole, string>();

/** A placeholder of the right shape for one image role, as a data URL. */
export function previewPlaceholderDataUrl(role: AiVisualAssetRole): string {
  const cached = cache.get(role);
  if (cached) return cached;
  const size = VISUAL_ASSET_REQUEST_SIZE[role];
  const width = Math.max(MIN_EDGE, Math.round(size.width * PLACEHOLDER_SCALE));
  const height = Math.max(MIN_EDGE, Math.round(size.height * PLACEHOLDER_SCALE));
  const url = `data:image/png;base64,${toBase64(encodePng(placeholderPixels(width, height)))}`;
  cache.set(role, url);
  return url;
}

/** The role the command layer will give this page's picture. */
export function previewAssetRole(design: AiSlideDesign): AiVisualAssetRole {
  if (design.layout === "cover" || design.layout === "section") return "hero";
  return design.visualAsset?.role ?? "side";
}

/**
 * One placeholder per page whose design asks for a picture.
 *
 * Pages that did not ask for one get nothing: adding a picture slot the final
 * deck will not have would be the same lie in the other direction.
 */
export function buildPreviewAssets(designs: readonly AiSlideDesign[]): AiVisualAssetData[] {
  const assets: AiVisualAssetData[] = [];
  designs.forEach((design, slideIndex) => {
    if (!design.visualAsset?.enabled) return;
    const role = previewAssetRole(design);
    const size = VISUAL_ASSET_REQUEST_SIZE[role];
    assets.push({
      slideIndex,
      dataUrl: previewPlaceholderDataUrl(role),
      mimeType: "image/png",
      naturalWidth: Math.max(MIN_EDGE, Math.round(size.width * PLACEHOLDER_SCALE)),
      naturalHeight: Math.max(MIN_EDGE, Math.round(size.height * PLACEHOLDER_SCALE)),
      altText: "配图占位：预览不生成配图",
    });
  });
  return assets;
}
