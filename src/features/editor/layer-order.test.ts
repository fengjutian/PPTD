import { describe, expect, it } from "vitest";
import { createDocument, emu, type ElementId, type ShapeElement, type Slide } from "../../core/document-model";
import {
  arrayInsertionIndex,
  blockMoved,
  dragBlockIds,
  groupOfElement,
  insertionIndex,
  layerRangeIds,
  layerRows,
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
});
