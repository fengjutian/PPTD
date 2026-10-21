import type { ImageCrop } from "../document-model";

/**
 * Geometry of a cropped picture inside its frame.
 *
 * The visible region of the source fills the frame, the same way a PPTX
 * source rectangle stretches the cropped area into the shape. The picture is
 * therefore drawn larger than the frame and shifted out of view, which keeps
 * the canvas and the exported file in agreement.
 */
export interface CropGeometry {
  /** Size of the picture relative to the frame. */
  width: number;
  height: number;
  /** Offset of the picture relative to the frame. */
  left: number;
  top: number;
}

/** A source rectangle in the units OOXML uses: thousandths of a percent. */
export interface SourceRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

const SOURCE_RECT_FULL = 100_000;

function sides(crop: ImageCrop | undefined): { top: number; bottom: number; left: number; right: number } {
  return {
    top: crop?.top ?? 0,
    bottom: crop?.bottom ?? 0,
    left: crop?.left ?? 0,
    right: crop?.right ?? 0,
  };
}

export function cropGeometry(crop: ImageCrop | undefined): CropGeometry {
  const { top, bottom, left, right } = sides(crop);
  const visibleWidth = Math.max(1e-6, 1 - left - right);
  const visibleHeight = Math.max(1e-6, 1 - top - bottom);
  return {
    width: 1 / visibleWidth,
    height: 1 / visibleHeight,
    // The extra zero keeps an untouched side from turning into a negative zero.
    left: -left / visibleWidth + 0,
    top: -top / visibleHeight + 0,
  };
}

/**
 * The source rectangle of a crop, as PowerPoint stores it. A picture without a
 * crop keeps the whole source and therefore gets no rectangle at all.
 */
export function cropSourceRect(crop: ImageCrop | undefined): SourceRect | undefined {
  if (!crop) return undefined;
  const { top, bottom, left, right } = sides(crop);
  if (top === 0 && bottom === 0 && left === 0 && right === 0) return undefined;
  return {
    l: Math.round(left * SOURCE_RECT_FULL),
    t: Math.round(top * SOURCE_RECT_FULL),
    r: Math.round(right * SOURCE_RECT_FULL),
    b: Math.round(bottom * SOURCE_RECT_FULL),
  };
}
