import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../core/commands";
import { createDocument, type ElementId, type SlideId } from "../core/document-model";
import { useEditorStore } from "./editor-store";

describe("layer visibility and naming in the editor store", () => {
  let slideId: SlideId;
  let ids: ElementId[];

  beforeEach(() => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "ellipse" });
    slideId = slide.id;
    ids = slide.elements.map((element) => element.id);
    useEditorStore.setState({
      document,
      activeSlideId: slide.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("renames a layer as one undo step", () => {
    useEditorStore.getState().execute({
      type: "rename-element",
      slideId,
      elementId: ids[1]!,
      name: "底板",
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().document.slides[0]!.elements[1]!.name).toBe("底板");

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements[1]!.name).toBeUndefined();
  });

  it("hides a batch as one undo step and skips a no-op", () => {
    useEditorStore.getState().execute({
      type: "set-elements-hidden",
      slideId,
      elementIds: ids,
      hidden: true,
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().document.slides[0]!.elements.every((element) => element.hidden)).toBe(true);

    // Hiding again is not an edit.
    useEditorStore.getState().execute({
      type: "set-elements-hidden",
      slideId,
      elementIds: ids,
      hidden: true,
    });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements.every((element) => element.hidden)).toBe(false);
  });
});
