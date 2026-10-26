import { describe, expect, it } from "vitest";
import {
  createDocument,
  emu,
  type ElementId,
  type ShapeElement,
  type Slide,
  type TextElement,
} from "../../core/document-model";
import {
  arrayInsertionIndex,
  blockMoved,
  blockMoveIndex,
  dragBlockIds,
  elementKind,
  filterLayerRows,
  fullElementName,
  groupOfElement,
  insertionIndex,
  layerRangeIds,
  layerRows,
  selectedGroup,
  layerMenuState,
} from "./layer-order";

function shape(id: string): ShapeElement {
  return {
    id: id as ElementId,
    type: "shape",
    shape: "rectangle",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    style: { fill: "#ffffff", stroke: "#000000", strokeWidthPt: 0, radiusPt: 0 },
  };
}

function text(id: string, value: string): TextElement {
  return {
    id: id as ElementId,
    type: "text",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    text: value,
    style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#17181c", bold: false, align: "left" },
  };
}

function slideWith(ids: string[]): Slide {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.elements = ids.map(shape);
  return slide;
}

describe("layer order helpers", () => {
  it("lists the topmost element first", () => {
    const slide = slideWith(["a", "b", "c"]);
    expect(layerRows(slide).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("drags the selection when the row is part of it, otherwise the row or its group", () => {
    const slide = slideWith(["a", "b", "c"]);
    expect(dragBlockIds(slide, "b" as ElementId, ["a" as ElementId, "b" as ElementId])).toEqual(["a", "b"]);
    expect(dragBlockIds(slide, "b" as ElementId, [])).toEqual(["b"]);
    slide.groups = [{ id: "g", elementIds: ["b" as ElementId, "c" as ElementId] }];
    expect(dragBlockIds(slide, "c" as ElementId, [])).toEqual(["b", "c"]);
    expect(groupOfElement(slide, "a" as ElementId)).toBeUndefined();
  });

  it("selects an inclusive range of rows in either direction", () => {
    const slide = slideWith(["a", "b", "c", "d"]);
    const rows = layerRows(slide);
    // The range follows the panel: topmost row first, either drag direction.
    expect(layerRangeIds(rows, "d" as ElementId, "b" as ElementId)).toEqual(["d", "c", "b"]);
    expect(layerRangeIds(rows, "a" as ElementId, "z" as ElementId)).toEqual([]);
  });

  it("drops above a row by its top half and below it by its bottom half", () => {
    const rows = [
      { top: 0, height: 40 },
      { top: 40, height: 40 },
      { top: 80, height: 40 },
    ];
    expect(insertionIndex(rows, 10)).toBe(0);
    expect(insertionIndex(rows, 30)).toBe(1);
    expect(insertionIndex(rows, 50)).toBe(1);
    expect(insertionIndex(rows, 90)).toBe(2);
    expect(insertionIndex(rows, 200)).toBe(3);
    expect(insertionIndex([], 12)).toBe(0);
  });

  it("turns a top-down drop into the bottom-up array index the command expects", () => {
    expect(arrayInsertionIndex(3, 0)).toBe(3);
    expect(arrayInsertionIndex(3, 1)).toBe(2);
    expect(arrayInsertionIndex(3, 3)).toBe(0);
    expect(arrayInsertionIndex(3, 9)).toBe(0);
  });

  it("knows when a drop would not change the order", () => {
    const slide = slideWith(["a", "b", "c"]);
    expect(blockMoved(slide.elements, ["b" as ElementId], 1)).toBe(false);
    expect(blockMoved(slide.elements, ["b" as ElementId], 2)).toBe(true);
    expect(blockMoved(slide.elements, ["a" as ElementId, "b" as ElementId], 0)).toBe(false);
    expect(blockMoved(slide.elements, ["a" as ElementId, "b" as ElementId], 1)).toBe(true);
    expect(blockMoved(slide.elements, ["a" as ElementId, "c" as ElementId], 0)).toBe(true);
  });

  it("computes one-step and jump moves for the menu and the keyboard", () => {
    const slide = slideWith(["a", "b", "c"]);
    const block = (id: string) => [id as ElementId];
    expect(blockMoveIndex(slide.elements, block("b"), "front")).toBe(2);
    expect(blockMoveIndex(slide.elements, block("b"), "back")).toBe(0);
    expect(blockMoveIndex(slide.elements, block("b"), "up")).toBe(2);
    expect(blockMoveIndex(slide.elements, block("b"), "down")).toBe(0);
    // The top row cannot move further up, the bottom row cannot move further down.
    expect(blockMoveIndex(slide.elements, block("c"), "front")).toBeNull();
    expect(blockMoveIndex(slide.elements, block("c"), "up")).toBeNull();
    expect(blockMoveIndex(slide.elements, block("c"), "down")).toBe(1);
    expect(blockMoveIndex(slide.elements, block("a"), "back")).toBeNull();
    expect(blockMoveIndex(slide.elements, block("a"), "down")).toBeNull();
    expect(blockMoveIndex(slide.elements, block("a"), "up")).toBe(1);
    // A block with a hole is compacted, like a drag of the same selection.
    expect(blockMoveIndex(slide.elements, ["a" as ElementId, "c" as ElementId], "front")).toBe(1);
    expect(blockMoveIndex(slide.elements, ["a" as ElementId, "c" as ElementId], "back")).toBe(0);
  });

  it("filters rows by the derived name and by the element kind", () => {
    const slide = slideWith(["a", "b"]);
    slide.elements.push(text("t", "Alphabet 2023 年报"), {
      id: "i" as ElementId,
      type: "image",
      frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
      altText: "财经杂志摄影",
    });
    const rows = layerRows(slide);
    expect(filterLayerRows(rows, "").map((row) => row.id)).toEqual(["i", "t", "b", "a"]);
    expect(filterLayerRows(rows, "  ").map((row) => row.id)).toEqual(["i", "t", "b", "a"]);
    expect(filterLayerRows(rows, "alphabet").map((row) => row.id)).toEqual(["t"]);
    expect(filterLayerRows(rows, "财经").map((row) => row.id)).toEqual(["i"]);
    // The kind is searched as well, so every picture is found by typing 图片.
    expect(filterLayerRows(rows, "图片").map((row) => row.id)).toEqual(["i"]);
    expect(filterLayerRows(rows, "矩形").map((row) => row.id)).toEqual(["b", "a"]);
    expect(filterLayerRows(rows, "不存在")).toEqual([]);
  });

  it("names and kinds are stable for empty objects", () => {
    expect(elementKind(text("t", ""))).toBe("文本");
    expect(fullElementName(text("t", "   "))).toBe("文本");
    expect(fullElementName(shape("s"))).toBe("矩形");
  });

  it("prefers a custom layer name for display and search", () => {
    const element = text("t", "原文内容");
    element.name = "主视觉";
    expect(fullElementName(element)).toBe("主视觉");
    expect(filterLayerRows([element], "主视觉")).toEqual([element]);
    // The custom name is what the row shows, so it is what the search matches.
    expect(filterLayerRows([element], "原文内容")).toEqual([]);
  });

  it("only treats an exactly selected group as ungroupable", () => {
    const slide = slideWith(["a", "b", "c"]);
    slide.groups = [{ id: "g", elementIds: ["a" as ElementId, "b" as ElementId] }];
    expect(selectedGroup(slide, ["a" as ElementId, "b" as ElementId])?.id).toBe("g");
    expect(selectedGroup(slide, ["a" as ElementId])).toBeUndefined();
    expect(selectedGroup(slide, ["a" as ElementId, "b" as ElementId, "c" as ElementId])).toBeUndefined();
    // Two groups in one selection are not one group.
    slide.groups = [
      { id: "g1", elementIds: ["a" as ElementId, "b" as ElementId] },
      { id: "g2", elementIds: ["c" as ElementId] },
    ];
    expect(selectedGroup(slide, ["a" as ElementId, "b" as ElementId, "c" as ElementId])).toBeUndefined();
  });

  it("summarises the context menu state of a row", () => {
    const slide = slideWith(["a", "b", "c"]);
    const top = layerMenuState(slide, "c" as ElementId, ["c" as ElementId]);
    expect(top.blockIds).toEqual(["c"]);
    expect(top.anyLocked).toBe(false);
    expect(top.allLocked).toBe(false);
    expect(top.canGroup).toBe(false);
    expect(top.canUngroup).toBe(false);
    expect(top.canMove).toEqual({ front: false, back: true, up: false, down: true });
    expect(top.deletableIds).toEqual(["c"]);
    expect(top.allHidden).toBe(false);

    const hiddenRow = slideWith(["a", "b"]);
    hiddenRow.elements[1]!.hidden = true;
    expect(layerMenuState(hiddenRow, "b" as ElementId, ["b" as ElementId]).allHidden).toBe(true);

    const locked = slideWith(["a", "b"]);
    locked.elements[1]!.locked = true;
    const lockedState = layerMenuState(locked, "b" as ElementId, ["b" as ElementId]);
    expect(lockedState.allLocked).toBe(true);
    expect(lockedState.canMove).toEqual({ front: false, back: false, up: false, down: false });
    expect(lockedState.deletableIds).toEqual([]);

    slide.groups = [{ id: "g", elementIds: ["a" as ElementId, "b" as ElementId] }];
    const grouped = layerMenuState(slide, "a" as ElementId, ["a" as ElementId, "b" as ElementId]);
    expect(grouped.blockIds).toEqual(["a", "b"]);
    expect(grouped.groupId).toBe("g");
    expect(grouped.canGroup).toBe(false);
    expect(grouped.canUngroup).toBe(true);
  });
});
