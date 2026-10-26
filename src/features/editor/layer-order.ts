import type { ElementId, Slide, SlideElement, SlideGroup } from "../../core/document-model";
import { ICON_LABELS } from "./icon-options";

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

const SHAPE_LABELS = {
  rectangle: "矩形",
  ellipse: "椭圆",
  triangle: "三角形",
  diamond: "菱形",
  pentagon: "五边形",
  hexagon: "六边形",
  chevron: "V 形",
  arrow: "箭头",
  star: "星形",
  parallelogram: "平行四边形",
  trapezoid: "梯形",
} as const;

/** The kind of an element, used by the row's accessible name and the search. */
export function elementKind(element: SlideElement): string {
  if (element.type === "text") return "文本";
  if (element.type === "image") return "图片";
  if (element.type === "chart") return "图表";
  if (element.type === "table") return "表格";
  if (element.type === "line") return "线条";
  if (element.type === "icon") return "图标";
  return SHAPE_LABELS[element.shape];
}

/** The name read from the object itself, used when no custom name exists. */
export function derivedElementName(element: SlideElement): string {
  if (element.type === "text") return element.text.replace(/\s+/g, " ").trim().slice(0, 80) || "文本";
  if (element.type === "image") return element.altText.trim().slice(0, 80) || "图片";
  if (element.type === "icon") return ICON_LABELS[element.name];
  return elementKind(element);
}

/** The layer name: the user's name when set, otherwise the derived one. */
export function fullElementName(element: SlideElement): string {
  return element.name?.trim() || derivedElementName(element);
}

/**
 * Rows that match a layer search.
 *
 * Both the derived name and the kind are searched, so typing "图片" finds every
 * picture even when its alternative text does not contain the word. A blank
 * query returns the list unchanged.
 */
export function filterLayerRows(rows: readonly SlideElement[], query: string): SlideElement[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...rows];
  return rows.filter((element) =>
    `${elementKind(element)} ${fullElementName(element)}`.toLocaleLowerCase().includes(needle),
  );
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
 * The one group the current selection completely covers, if the selection is
 * exactly a group. A mixed selection of a group and unrelated objects is not a
 * group and must not offer "取消组合".
 */
export function selectedGroup(slide: Slide, selectedElementIds: readonly ElementId[]): SlideGroup | undefined {
  const selected = new Set(selectedElementIds);
  if (selected.size === 0) return undefined;
  const groups = (slide.groups ?? []).filter((group) => group.elementIds.some((id) => selected.has(id)));
  if (groups.length !== 1) return undefined;
  const group = groups[0]!;
  if (selected.size !== group.elementIds.length) return undefined;
  return group.elementIds.every((id) => selected.has(id)) ? group : undefined;
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

/** Where a block should move for a menu or keyboard layer command. */
export type LayerMoveTarget = "front" | "back" | "up" | "down";

/**
 * The `reorder-elements` index for one step (or jump) of a block.
 *
 * The panel thinks top-down while the command thinks bottom-up. A block whose
 * members are not adjacent is compacted to the new position, the same way a drag
 * already compacts it; `null` means the move would not change anything.
 */
export function blockMoveIndex(
  elements: readonly SlideElement[],
  blockIds: readonly ElementId[],
  target: LayerMoveTarget,
): number | null {
  const block = new Set(blockIds);
  if (block.size === 0) return null;
  const display = [...elements].reverse();
  const firstBlockIndex = display.findIndex((element) => block.has(element.id));
  if (firstBlockIndex < 0) return null;
  const others = display.filter((element) => !block.has(element.id));
  // Count only the rows above the block's topmost member, so a block that is
  // already at the top of the list cannot step above itself.
  const above = display.slice(0, firstBlockIndex).filter((element) => !block.has(element.id)).length;
  const insertion =
    target === "front" ? 0 : target === "back" ? others.length : target === "up" ? above - 1 : above + 1;
  const clamped = Math.max(0, Math.min(others.length, insertion));
  const toIndex = others.length - clamped;
  return blockMoved(elements, blockIds, toIndex) ? toIndex : null;
}

export interface LayerMenuState {
  /** The block the menu acts on, exactly as a drag of this row would move it. */
  blockIds: ElementId[];
  anyLocked: boolean;
  allLocked: boolean;
  allHidden: boolean;
  /** The one group the selection is, when "取消组合" is possible. */
  groupId?: string;
  canGroup: boolean;
  canUngroup: boolean;
  deletableIds: ElementId[];
  canMove: Record<LayerMoveTarget, boolean>;
}

/**
 * What the context menu of one row can do.
 *
 * It is a pure function so the menu and its tests agree on the disabled states;
 * the component only renders the commands.
 */
export function layerMenuState(
  slide: Slide,
  elementId: ElementId,
  selectedElementIds: readonly ElementId[],
): LayerMenuState {
  const blockIds = dragBlockIds(slide, elementId, selectedElementIds);
  const elements = blockIds
    .map((id) => slide.elements.find((element) => element.id === id))
    .filter((element): element is SlideElement => Boolean(element));
  const anyLocked = elements.some((element) => element.locked);
  const allLocked = elements.length > 0 && elements.every((element) => element.locked);
  const group = selectedGroup(slide, selectedElementIds);
  const alreadyGrouped = (slide.groups ?? []).some((candidate) =>
    candidate.elementIds.some((id) => selectedElementIds.includes(id)),
  );
  const canMove = (target: LayerMoveTarget) => !anyLocked && blockMoveIndex(slide.elements, blockIds, target) !== null;
  return {
    blockIds,
    anyLocked,
    allLocked,
    allHidden: elements.length > 0 && elements.every((element) => element.hidden === true),
    ...(group ? { groupId: group.id } : {}),
    canGroup: selectedElementIds.length >= 2 && !anyLocked && !alreadyGrouped,
    canUngroup: group !== undefined,
    deletableIds: blockIds.filter((id) => !(slide.elements.find((element) => element.id === id)?.locked ?? false)),
    canMove: {
      front: canMove("front"),
      back: canMove("back"),
      up: canMove("up"),
      down: canMove("down"),
    },
  };
}
