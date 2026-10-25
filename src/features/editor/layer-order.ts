import type { ElementId, Slide, SlideElement, SlideGroup } from "../../core/document-model";

/**
 * Geometry of one row of the layer panel.
 *
 * Only the vertical span matters: a drop is decided by the half of the row the
 * pointer is in, so the list can show the insertion line exactly where the
 * object will land.
 */
export interface LayerRowRect {
  top: number;
  height: number;
}

/** The rows of the panel, topmost element first. */
export function layerRows(slide: Slide): SlideElement[] {
  return [...slide.elements].reverse();
}

/** The selection group an element belongs to, if any. */
export function groupOfElement(slide: Slide, elementId: ElementId): SlideGroup | undefined {
  return slide.groups?.find((group) => group.elementIds.includes(elementId));
}

/**
 * The block one drag moves.
 *
 * Dragging a row that is already selected moves the whole selection, which is
 * what makes dragging a multi-selection feel like one object. Dragging an
 * unselected row moves just that row; a grouped row expands to its group
 * because a click on any member selects the group.
 */
export function dragBlockIds(
  slide: Slide,
  elementId: ElementId,
  selectedElementIds: readonly ElementId[],
): ElementId[] {
  if (selectedElementIds.includes(elementId)) return [...selectedElementIds];
  const group = groupOfElement(slide, elementId);
  return group ? [...group.elementIds] : [elementId];
}

/** The inclusive run of rows between two rows, in the order the panel shows them. */
export function layerRangeIds(rows: readonly SlideElement[], fromId: ElementId, toId: ElementId): ElementId[] {
  const from = rows.findIndex((row) => row.id === fromId);
  const to = rows.findIndex((row) => row.id === toId);
  if (from < 0 || to < 0) return [];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return rows.slice(start, end + 1).map((row) => row.id);
}

/**
 * Where a pointer at `pointerY` would drop, counted among the rows the dragged
 * block does not occupy. The result is an insertion index in that reduced list:
 * `0` means above its first row, `rows.length` means below its last row.
 */
export function insertionIndex(rows: readonly LayerRowRect[], pointerY: number): number {
  let index = 0;
  for (const row of rows) {
    if (pointerY < row.top + row.height / 2) return index;
    index += 1;
  }
  return index;
}

/**
 * Converts a top-down insertion index into the array index the document
 * command expects.
 *
 * The panel lists the topmost element first while `slide.elements` stores the
 * bottom element first, so a drop at the top of the list is an insertion at the
 * end of the remaining array.
 */
export function arrayInsertionIndex(remainingCount: number, displayIndex: number): number {
  return Math.max(0, Math.min(remainingCount, remainingCount - displayIndex));
}

/** Whether moving the block would change the z-order at all. */
export function blockMoved(
  elements: readonly SlideElement[],
  blockIds: readonly ElementId[],
  toIndex: number,
): boolean {
  const block = new Set(blockIds);
  const remaining = elements.filter((element) => !block.has(element.id)).map((element) => element.id);
  const ordered = elements.filter((element) => block.has(element.id)).map((element) => element.id);
  const next = [...remaining.slice(0, toIndex), ...ordered, ...remaining.slice(toIndex)];
  return next.some((id, index) => id !== elements[index]?.id);
}
