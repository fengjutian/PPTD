/**
 * Geometry shared by the two rail recipes.
 *
 * `process-rail` and `timeline-rail` draw different marks — a numbered node, a
 * dated dot — but both stand their stations on one horizontal line and both
 * have to spread them across the content width. Keeping the column maths here
 * means the two pages cannot drift into different margins.
 */

export interface RailStation {
  /** Left edge of the station column, normalized to page width. */
  x: number;
  /** Width of the station column, normalized. */
  width: number;
}

/**
 * Equal columns across an area, separated by `gap`.
 *
 * The gap is a share of the page width, not a fixed length: the same recipe has
 * to work on a 10in and a 16in page, and a fixed gap would crowd one of them.
 */
export function railStations(area: { x: number; width: number }, count: number, gap: number): RailStation[] {
  if (count <= 0) return [];
  const width = (area.width - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: area.x + index * (width + gap),
    width,
  }));
}
