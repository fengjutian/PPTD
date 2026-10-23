import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, type ElementId } from "../document-model";

function twoElementDocument() {
  const document = createDocument();
  const slide = document.slides[0]!;
  applyCommand(document, { type: "add-text", slideId: slide.id });
  applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
  return { document, slide };
}

describe("selection groups", () => {
  it("groups two objects as design metadata and ungroups them", () => {
    const { document, slide } = twoElementDocument();
    const ids = slide.elements.slice(0, 2).map((element) => element.id);
    applyCommand(document, { type: "group-elements", slideId: slide.id, elementIds: ids });
    expect(slide.groups).toHaveLength(1);
    expect(slide.groups![0]!.elementIds).toEqual(ids);
    expect(commandDomain({ type: "group-elements", slideId: slide.id, elementIds: ids })).toBe("design");

    applyCommand(document, { type: "ungroup-elements", slideId: slide.id, groupId: slide.groups![0]!.id });
    expect(slide.groups).toBeUndefined();
  });

  it("refuses one object, a locked object, an unknown id and a second group", () => {
    const { document, slide } = twoElementDocument();
    const [first, second] = slide.elements;
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "group-elements",
          slideId: slide.id,
          elementIds: [first!.id],
        }),
      ),
    ).toThrow("GROUP_TOO_SMALL");
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "group-elements",
          slideId: slide.id,
          elementIds: [first!.id, crypto.randomUUID() as ElementId],
        }),
      ),
    ).toThrow("ELEMENT_NOT_FOUND");

    first!.locked = true;
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "group-elements",
          slideId: slide.id,
          elementIds: [first!.id, second!.id],
        }),
      ),
    ).toThrow("ELEMENT_LOCKED");
    first!.locked = false;

    applyCommand(document, { type: "group-elements", slideId: slide.id, elementIds: [first!.id, second!.id] });
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "group-elements",
          slideId: slide.id,
          elementIds: [first!.id, second!.id],
        }),
      ),
    ).toThrow("ELEMENT_ALREADY_GROUPED");
  });

  it("drops the group when a member is deleted", () => {
    const { document, slide } = twoElementDocument();
    const [first, second] = slide.elements;
    applyCommand(document, {
      type: "group-elements",
      slideId: slide.id,
      elementIds: [first!.id, second!.id],
    });
    applyCommand(document, { type: "delete-element", slideId: slide.id, elementId: first!.id });
    expect(slide.groups).toBeUndefined();
    expect(slide.elements.some((element) => element.id === second!.id)).toBe(true);
  });

  it("starts a duplicated slide without groups that point at old ids", () => {
    const { document, slide } = twoElementDocument();
    const ids = slide.elements.map((element) => element.id);
    applyCommand(document, { type: "group-elements", slideId: slide.id, elementIds: ids });
    applyCommand(document, { type: "duplicate-slide", slideId: slide.id });
    expect(document.slides[1]!.groups).toBeUndefined();
    expect(document.slides[1]!.elements).toHaveLength(ids.length);
  });
});
