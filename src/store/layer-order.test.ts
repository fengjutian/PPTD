import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../core/commands";
import { createDocument, type ElementId, type SlideId } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 图层里拖动一整块（多选或选择组）是一个意图：一次命令、一个撤销项。
 */
describe("layer drag in the editor store", () => {
  let slideId: SlideId;
  let ids: ElementId[];

  beforeEach(() => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "ellipse" });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "triangle" });
    slideId = slide.id;
    // The title stays at the bottom; the three shapes are the moving block.
    ids = slide.elements.slice(1).map((element) => element.id);
    useEditorStore.setState({
      document,
      activeSlideId: slide.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("moves a block with one undo step and restores it in one undo", () => {
    const state = useEditorStore.getState();
    const before = state.document.slides[0]!.elements.map((element) => element.id);
    const contentBefore = state.document.slides[0]!.content;

    state.execute({
      type: "reorder-elements",
      slideId,
      elementIds: [ids[0]!, ids[2]!],
      toIndex: 1,
    });

    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.slides[0]!.elements.map((element) => element.id)).toEqual([
      before[0],
      ids[0],
      ids[2],
      ids[1],
    ]);
    expect(after.document.slides[0]!.content).toEqual(contentBefore);

    after.undo();
    expect(useEditorStore.getState().document.slides[0]!.elements.map((element) => element.id)).toEqual(before);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().document.slides[0]!.elements.map((element) => element.id)).toEqual([
      before[0],
      ids[0],
      ids[2],
      ids[1],
    ]);
  });
});
