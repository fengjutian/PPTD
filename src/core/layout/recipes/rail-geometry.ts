/**
 * Geometry shared by the two rail recipes.
 *
 * `process-rail` and `timeline-rail` draw different marks — a numbered node, a
 * dated dot — but both stand their stations on one horizontal line and both
 * have to spread them across the content width. Keeping the column maths here
 * means the two pages cannot drift into different margins.
 */

import { layoutRect, layoutRectToNormalized } from "../geometry/coordinate-system";
import { layoutColumns, type LayoutSpacingToken } from "../geometry/layout-functions";

export interface RailStation {
  /** Left edge of the station column, normalized to page width. */
  x: number;
  /** Width of the station column, normalized. */
  width: number;
}

/**
 * Equal normalized-1000 columns across an area, separated by a shared spacing
 * token. Integer remainder allocation is owned by the geometry layer.
 */
export function railStations(
  area: { x: number; width: number },
  count: number,
  gap: LayoutSpacingToken = "lg",
): RailStation[] {
  if (count <= 0) return [];
  const source = layoutRect(Math.round(area.x * 1000), 0, Math.round(area.width * 1000), 1000);
  return layoutColumns(source, count, gap).map((slot) => {
    const normalized = layoutRectToNormalized(slot);
    return { x: normalized.x, width: normalized.width };
  });
}
