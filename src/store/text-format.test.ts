import { beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 批量文本格式必须是一个意图：多选三个文本框加粗，只应产生一个撤销项。
 */
describe("batch text formatting", () => {
  beforeEach(() => {
    const document = createDocument();
    useEditorStore.setState({
      document,
      activeSlideId: document.slides[0]!.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
    const state = useEditorStore.getState();
    state.execute({ type: "add-text", slideId: state.activeSlideId });
    state.execute({ type: "add-text", slideId: state.activeSlideId });
    // The setup itself is not part of what this test asserts.
    useEditorStore.setState({ undoStack: [], redoStack: [] });
  });

  it("formats the whole selection as one undo step", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const textIds = slide.elements.filter((element) => element.type === "text").map((element) => element.id);
    expect(textIds).toHaveLength(3);
    const contentRevision = state.document.revisions.content;
    const designRevision = state.document.revisions.design;

    state.selectElements(textIds);
    state.execute({
      type: "set-text-style-elements",
      slideId: slide.id,
      elementIds: textIds,
      style: { italic: true, bullet: "dot", indentLevel: 1 },
    });

    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.revisions.content).toBe(contentRevision);
    expect(after.document.revisions.design).toBe(designRevision + 1);
    for (const element of after.document.slides[0]!.elements) {
      if (element.type !== "text") continue;
      expect(element.style.italic).toBe(true);
      expect(element.style.bullet).toBe("dot");
      expect(element.style.indentLevel).toBe(1);
    }

    after.undo();
    const restored = useEditorStore.getState().document.slides[0]!.elements;
    for (const element of restored) {
      if (element.type !== "text") continue;
      expect(element.style.italic).toBeUndefined();
      expect(element.style.bullet).toBeUndefined();
      expect(element.style.indentLevel).toBeUndefined();
    }
  });

  it("clears formatting of the whole selection as one undo step", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const textIds = slide.elements.filter((element) => element.type === "text").map((element) => element.id);
    state.execute({
      type: "set-text-style-elements",
      slideId: slide.id,
      elementIds: textIds,
      style: { italic: true, bold: true, fontFamily: "Georgia", fontSizePt: 44 },
    });
    useEditorStore.setState({ undoStack: [] });

    useEditorStore.getState().execute({ type: "clear-text-format", slideId: slide.id, elementIds: textIds });
    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    for (const element of after.document.slides[0]!.elements) {
      if (element.type !== "text") continue;
      const isTitle = element.contentRef === "title";
      expect(element.style.fontFamily).toBe("Microsoft YaHei");
      expect(element.style.fontSizePt).toBe(isTitle ? 28 : 18);
      expect(element.style.italic).toBe(false);
      expect(element.style.bold).toBe(isTitle);
    }
  });
});
