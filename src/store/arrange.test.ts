import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../core/commands";
import { createDocument } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 多选锁定是一个意图：一次命令、一个撤销项。
 */
describe("batch lock in the editor store", () => {
  beforeEach(() => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    useEditorStore.setState({
      document,
      activeSlideId: slide.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("locks all selected objects as one undo step", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const ids = slide.elements.map((element) => element.id);
    state.execute({ type: "set-elements-lock", slideId: slide.id, elementIds: ids, locked: true });

    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.slides[0]!.elements.every((element) => element.locked)).toBe(true);

    after.undo();
    expect(useEditorStore.getState().document.slides[0]!.elements.some((element) => element.locked)).toBe(false);
  });
});
