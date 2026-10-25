import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { createDocument, emu, type ElementId, type ShapeElement } from "../document-model";
import { applyCommand, commandDomain } from "./commands";

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

function threeShapes() {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.elements = [shape("a"), shape("b"), shape("c")];
  return { document, slide };
}

describe("reorder-elements", () => {
  it("moves a block together and keeps the relative order inside it", () => {
    const { document, slide } = threeShapes();
    const reordered = produce(document, (draft) =>
      applyCommand(draft, {
        type: "reorder-elements",
        slideId: slide.id,
        elementIds: ["c" as ElementId, "a" as ElementId],
        toIndex: 1,
      }),
    );
    // The array is bottom-up: [b] then the block [a, c], in its original order.
    expect(reordered.slides[0]!.elements.map((element) => element.id)).toEqual(["b", "a", "c"]);
    expect(reordered.slides[0]!.content).toEqual(document.slides[0]!.content);
  });

  it("accepts the bottom and the top of the remaining stack", () => {
    const { document, slide } = threeShapes();
    const lowest = produce(document, (draft) =>
      applyCommand(draft, {
        type: "reorder-elements",
        slideId: slide.id,
        elementIds: ["c" as ElementId],
        toIndex: 0,
      }),
    );
    expect(lowest.slides[0]!.elements.map((element) => element.id)).toEqual(["c", "a", "b"]);

    const highest = produce(document, (draft) =>
      applyCommand(draft, {
        type: "reorder-elements",
        slideId: slide.id,
        elementIds: ["a" as ElementId],
        toIndex: 2,
      }),
    );
    expect(highest.slides[0]!.elements.map((element) => element.id)).toEqual(["b", "c", "a"]);
  });

  it("refuses unknown, locked or out-of-range targets instead of writing a half move", () => {
    const { document, slide } = threeShapes();
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "reorder-elements",
          slideId: slide.id,
          elementIds: ["missing" as ElementId],
          toIndex: 0,
        }),
      ),
    ).toThrow("ELEMENT_NOT_FOUND");

    const locked = produce(document, (draft) => {
      draft.slides[0]!.elements[0]!.locked = true;
    });
    expect(() =>
      produce(locked, (draft) =>
        applyCommand(draft, {
          type: "reorder-elements",
          slideId: slide.id,
          elementIds: ["a" as ElementId],
          toIndex: 2,
        }),
      ),
    ).toThrow("ELEMENT_LOCKED");

    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "reorder-elements",
          slideId: slide.id,
          elementIds: ["a" as ElementId],
          toIndex: 9,
        }),
      ),
    ).toThrow("ELEMENT_INDEX_OUT_OF_RANGE");
  });

  it("is a design command", () => {
    expect(commandDomain({ type: "reorder-elements", slideId: "s" as never, elementIds: [], toIndex: 0 })).toBe(
      "design",
    );
  });
});
