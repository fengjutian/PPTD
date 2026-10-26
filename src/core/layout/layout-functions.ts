import { layoutRect, type LayoutRect, type LayoutUnit } from "./coordinate-system";

export const LAYOUT_SPACING = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 40,
  xl: 64,
} as const;

export type LayoutSpacingToken = keyof typeof LAYOUT_SPACING;

/** A smaller slot cannot hold readable editable content in the 0-1000 space. */
const MIN_SLOT_SIZE = 24;

export function insetLayoutRect(source: LayoutRect, padding: LayoutSpacingToken): LayoutRect {
  const value = LAYOUT_SPACING[padding];
  if (source.width <= value * 2 || source.height <= value * 2) throw new Error("INSUFFICIENT_CAPACITY");
  return layoutRect(source.x + value, source.y + value, source.width - value * 2, source.height - value * 2);
}

function splitAxis(
  source: LayoutRect,
  count: number,
  gap: LayoutSpacingToken,
  axis: "horizontal" | "vertical",
): LayoutRect[] {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("INVALID_LAYOUT_COUNT");
  const gapValue = LAYOUT_SPACING[gap];
  const available = (axis === "horizontal" ? source.width : source.height) - gapValue * (count - 1);
  if (available < count * MIN_SLOT_SIZE) throw new Error("INSUFFICIENT_CAPACITY");
  const base = Math.floor(available / count);
  let remainder = available - base * count;
  let cursor: number = axis === "horizontal" ? source.x : source.y;
  return Array.from({ length: count }, () => {
    const size = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const rect =
      axis === "horizontal"
        ? layoutRect(cursor, source.y, size, source.height)
        : layoutRect(source.x, cursor, source.width, size);
    cursor += size + gapValue;
    return rect;
  });
}

export const layoutColumns = (source: LayoutRect, count: number, gap: LayoutSpacingToken): LayoutRect[] =>
  splitAxis(source, count, gap, "horizontal");

export const layoutRows = (source: LayoutRect, count: number, gap: LayoutSpacingToken): LayoutRect[] =>
  splitAxis(source, count, gap, "vertical");

export function stackLayout(
  source: LayoutRect,
  count: number,
  gap: LayoutSpacingToken,
  distribution: "start" | "center" | "space-between" = "start",
): LayoutRect[] {
  if (distribution === "space-between" && count > 1) {
    const slotHeight = Math.max(1, Math.floor(source.height / Math.max(count * 2 - 1, 1)));
    const remaining = source.height - slotHeight * count;
    const dynamicGap = Math.floor(remaining / (count - 1));
    return Array.from({ length: count }, (_, index) =>
      layoutRect(source.x, source.y + index * (slotHeight + dynamicGap), source.width, slotHeight),
    );
  }
  const rows = layoutRows(source, count, gap);
  if (distribution === "start") return rows;
  const used = rows.at(-1)!.y + rows.at(-1)!.height - rows[0]!.y;
  const offset = Math.max(0, Math.floor((source.height - used) / 2)) as LayoutUnit;
  return rows.map((row) => layoutRect(row.x, row.y + offset, row.width, row.height));
}
