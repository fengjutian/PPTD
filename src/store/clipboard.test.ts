import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, inches, type SlideElement } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 粘贴是一个文档意图：一次粘贴一个撤销项，并选中刚粘贴的副本。
 */
describe("clipboard paste in the editor store", () => {
  beforeEach(() => {
    const document = createDocument();
    useEditorStore.setState({
      document,
      activeSlideId: document.slides[0]!.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("selects the pasted copies and undoes the whole paste at once", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const snapshot: SlideElement[] = structuredClone(slide.elements);
    state.execute({ type: "paste-elements", slideId: slide.id, elements: snapshot, offsetEmu: inches(0.2) });

    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.slides[0]!.elements).toHaveLength(2);
    expect(after.selectedElementIds).toHaveLength(1);
    expect(after.selectedElementIds[0]).toBe(after.document.slides[0]!.elements[1]!.id);

    after.undo();
    const restored = useEditorStore.getState();
    expect(restored.document.slides[0]!.elements).toHaveLength(1);
    expect(restored.document.slides[0]!.elements[0]!.id).toBe(slide.elements[0]!.id);
  });
});
