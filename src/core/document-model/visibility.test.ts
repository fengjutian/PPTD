import { describe, expect, it } from "vitest";
import { createDocument, emu, type ElementId, type ShapeElement } from "./index";
import { hiddenElementCount, isElementVisible, visibleElements, withoutHiddenElements } from "./visibility";

function shape(id: string, hidden = false): ShapeElement {
  return {
    id: id as ElementId,
    type: "shape",
    shape: "rectangle",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    ...(hidden ? { hidden: true } : {}),
    style: { fill: "#ffffff", stroke: "#000000", strokeWidthPt: 0, radiusPt: 0 },
  };
}

describe("element visibility", () => {
  it("treats a missing flag as visible", () => {
    expect(isElementVisible(shape("a"))).toBe(true);
    expect(isElementVisible(shape("a", true))).toBe(false);
  });

  it("filters the elements a canvas or export should draw", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.elements = [shape("a"), shape("b", true), shape("c")];
    expect(visibleElements(slide).map((element) => element.id)).toEqual(["a", "c"]);
    expect(hiddenElementCount(slide)).toBe(1);
  });

  it("drops hidden elements, incomplete groups and their animations from the export snapshot", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.elements = [shape("a"), shape("b", true), shape("c")];
    slide.groups = [
      { id: "full", elementIds: ["a" as ElementId, "c" as ElementId] },
      { id: "partial", elementIds: ["a" as ElementId, "b" as ElementId] },
    ];
    slide.animations = [
      {
        id: "on-a",
        elementId: "a" as ElementId,
        effect: "fade",
        phase: "entrance",
        start: "on-click",
        durationMs: 500,
        delayMs: 0,
        direction: "none",
      },
      {
        id: "on-b",
        elementId: "b" as ElementId,
        effect: "fade",
        phase: "entrance",
        start: "on-click",
        durationMs: 500,
        delayMs: 0,
        direction: "none",
      },
    ];
    const snapshot = withoutHiddenElements(document).slides[0]!;
    expect(snapshot.elements.map((element) => element.id)).toEqual(["a", "c"]);
    expect(snapshot.groups?.map((group) => group.id)).toEqual(["full"]);
    expect(snapshot.animations?.map((animation) => animation.id)).toEqual(["on-a"]);
    // The source document is untouched.
    expect(document.slides[0]!.elements).toHaveLength(3);
    expect(document.slides[0]!.groups).toHaveLength(2);
  });

  it("returns the same document when nothing is hidden", () => {
    const document = createDocument();
    expect(withoutHiddenElements(document)).toBe(document);
  });
});
