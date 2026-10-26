import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, type ElementId, type Slide, type SlideElement } from "../document-model";

function documentWithShape(): {
  document: ReturnType<typeof createDocument>;
  slide: Slide;
  title: SlideElement;
  shape: SlideElement;
} {
  const document = createDocument();
  const slide = document.slides[0]!;
  applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
  return { document, slide, title: slide.elements[0]!, shape: slide.elements[1]! };
}

describe("layer visibility and naming commands", () => {
  it("renames an object with normalized whitespace without touching content", () => {
    const { document, slide, shape } = documentWithShape();
    const contentBefore = document.slides[0]!.content;
    const renamed = produce(document, (draft) =>
      applyCommand(draft, {
        type: "rename-element",
        slideId: slide.id,
        elementId: shape.id,
        name: "  背景   图形 ",
      }),
    );
    expect(renamed.slides[0]!.elements[1]!.name).toBe("背景 图形");
    expect(renamed.slides[0]!.content).toEqual(contentBefore);
  });

  it("clears a custom name with an empty value and treats that as a no-op twice", () => {
    const { document, slide, shape } = documentWithShape();
    const named = produce(document, (draft) =>
      applyCommand(draft, { type: "rename-element", slideId: slide.id, elementId: shape.id, name: "底板" }),
    );
    const cleared = produce(named, (draft) =>
      applyCommand(draft, { type: "rename-element", slideId: slide.id, elementId: shape.id, name: "   " }),
    );
    expect(cleared.slides[0]!.elements[1]!.name).toBeUndefined();
    expect(
      commandDomain({ type: "rename-element", slideId: slide.id, elementId: shape.id, name: "" }, cleared),
    ).toBeNull();
  });

  it("refuses an overlong name but allows renaming and hiding a locked object", () => {
    const { document, slide, shape } = documentWithShape();
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "rename-element",
          slideId: slide.id,
          elementId: shape.id,
          name: "x".repeat(81),
        }),
      ),
    ).toThrow("ELEMENT_NAME_TOO_LONG");

    const locked = produce(document, (draft) =>
      applyCommand(draft, {
        type: "set-element-lock",
        slideId: slide.id,
        elementId: shape.id,
        locked: true,
      }),
    );
    const labelled = produce(locked, (draft) =>
      applyCommand(draft, { type: "rename-element", slideId: slide.id, elementId: shape.id, name: "锁住的背景" }),
    );
    const hidden = produce(labelled, (draft) =>
      applyCommand(draft, { type: "set-elements-hidden", slideId: slide.id, elementIds: [shape.id], hidden: true }),
    );
    expect(hidden.slides[0]!.elements[1]).toMatchObject({ name: "锁住的背景", hidden: true, locked: true });
  });

  it("hides and shows a batch in one command and removes the flag when shown", () => {
    const { document, slide, title, shape } = documentWithShape();
    const hidden = produce(document, (draft) =>
      applyCommand(draft, {
        type: "set-elements-hidden",
        slideId: slide.id,
        elementIds: [title.id, shape.id],
        hidden: true,
      }),
    );
    expect(hidden.slides[0]!.elements.every((element) => element.hidden === true)).toBe(true);

    const shown = produce(hidden, (draft) =>
      applyCommand(draft, {
        type: "set-elements-hidden",
        slideId: slide.id,
        elementIds: [title.id, shape.id],
        hidden: false,
      }),
    );
    expect(shown.slides[0]!.elements.every((element) => element.hidden === undefined)).toBe(true);
    expect(
      commandDomain({ type: "set-elements-hidden", slideId: slide.id, elementIds: [shape.id], hidden: false }, shown),
    ).toBeNull();
  });

  it("rejects unknown targets and keeps a pasted copy visible", () => {
    const { document, slide, shape } = documentWithShape();
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "set-elements-hidden",
          slideId: slide.id,
          elementIds: ["missing" as ElementId],
          hidden: true,
        }),
      ),
    ).toThrow("ELEMENT_NOT_FOUND");

    const prepared = produce(document, (draft) => {
      const target = draft.slides[0]!.elements[1]!;
      target.hidden = true;
      target.name = "底板";
    });
    const duplicated = produce(prepared, (draft) =>
      applyCommand(draft, { type: "duplicate-elements", slideId: slide.id, elementIds: [shape.id] }),
    );
    const copy = duplicated.slides[0]!.elements.at(-1)!;
    expect(copy.hidden).toBeUndefined();
    expect(copy.name).toBe("底板");
  });

  it("is a design-domain command in both cases", () => {
    const { document, slide, shape } = documentWithShape();
    expect(
      commandDomain({ type: "rename-element", slideId: slide.id, elementId: shape.id, name: "底" }, document),
    ).toBe("design");
    expect(
      commandDomain({ type: "set-elements-hidden", slideId: slide.id, elementIds: [shape.id], hidden: true }, document),
    ).toBe("design");
  });
});
