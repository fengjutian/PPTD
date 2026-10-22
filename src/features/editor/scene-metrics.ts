import { EMU_PER_INCH } from "../../core/document-model";

/**
 * How many CSS pixels one EMU covers on the surface a page is drawn on.
 *
 * The canvas and the thumbnail draw the same page with the same code, so both
 * read the geometry of a page in the same unit. A thumbnail is only a canvas
 * that is drawn smaller.
 */
export type SceneScale = number;

/** The scale of a surface that is `widthPx` pixels wide. */
export function sceneScale(widthPx: number, pageWidth: number): SceneScale {
  if (widthPx <= 0 || pageWidth <= 0) return 0;
  return widthPx / pageWidth;
}

/** A length in points as CSS pixels on a surface with the given scale. */
export function ptToPx(points: number, scale: SceneScale): number {
  return points * (EMU_PER_INCH / 72) * scale;
}
