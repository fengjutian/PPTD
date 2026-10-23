import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../core/commands";
import { createDocument } from "../core/document-model";
import { useEditorStore } from "./editor-store";

describe("grouped selection", () => {
  beforeEach(() => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    applyCommand(document, {
      type: "group-elements",
      slideId: slide.id,
      elementIds: [slide.elements[0]!.id, slide.elements[1]!.id],
    });
    useEditorStore.setState({
      document,
      activeSlideId: slide.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("selects the whole group when one member is clicked", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const [, second, third] = slide.elements;
    state.selectElement(second!.id);
    expect(useEditorStore.getState().selectedElementIds).toEqual([slide.elements[0]!.id, second!.id]);

    state.selectElement(third!.id);
    expect(useEditorStore.getState().selectedElementIds).toEqual([third!.id]);
  });

  it("toggles the whole group together", () => {
    const state = useEditorStore.getState();
    const [first] = state.document.slides[0]!.elements;
    state.toggleElement(first!.id);
    expect(useEditorStore.getState().selectedElementIds).toHaveLength(2);
    state.toggleElement(first!.id);
    expect(useEditorStore.getState().selectedElementIds).toHaveLength(0);
  });

  it("expands a marquee selection that touches a grouped member", () => {
    const state = useEditorStore.getState();
    const [first, , third] = state.document.slides[0]!.elements;
    state.selectElements([third!.id, first!.id]);
    expect(new Set(useEditorStore.getState().selectedElementIds)).toEqual(
      new Set([first!.id, state.document.slides[0]!.elements[1]!.id, third!.id]),
    );
  });
});
