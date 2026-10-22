import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, inches } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 多选状态的行为。
 *
 * 选中状态不进文档：它不改变 revision，也不进撤销栈。这一点是这些断言的
 * 主要目的——把选择当成文档的一部分会让每次点选都污染撤销历史。
 */
describe("editor multi selection", () => {
  beforeEach(() => {
    const document = createDocument();
    useEditorStore.setState({ document, activeSlideId: document.slides[0]!.id, selectedElementIds: [], undoStack: [], redoStack: [] });
  });

  it("keeps a single selection as a one item array", () => {
    const state = useEditorStore.getState();
    const elementId = state.document.slides[0]!.elements[0]!.id;
    state.selectElement(elementId);
    expect(useEditorStore.getState().selectedElementIds).toEqual([elementId]);
  });

  it("toggles an element in and out of the selection", () => {
    const state = useEditorStore.getState();
    const [first, second] = state.document.slides[0]!.elements;
    state.toggleElement(first!.id);
    state.toggleElement(second!.id);
    expect(useEditorStore.getState().selectedElementIds).toEqual([first!.id, second!.id]);
    state.toggleElement(first!.id);
    expect(useEditorStore.getState().selectedElementIds).toEqual([second!.id]);
  });

  it("never changes the document revision when the selection changes", () => {
    const state = useEditorStore.getState();
    const before = useEditorStore.getState().document.revisions;
    state.toggleElement(state.document.slides[0]!.elements[0]!.id);
    state.selectElements([state.document.slides[0]!.elements[0]!.id]);
    state.selectElement(null);
    expect(useEditorStore.getState().document.revisions).toEqual(before);
    expect(useEditorStore.getState().undoStack).toHaveLength(0);
  });

  it("drops a selected element that no longer exists", () => {
    const state = useEditorStore.getState();
    const elementId = state.document.slides[0]!.elements[0]!.id;
    state.selectElement(elementId);
    state.execute({ type: "delete-element", slideId: state.activeSlideId, elementId });
    expect(useEditorStore.getState().selectedElementIds).toEqual([]);
  });

  it("deletes a whole group as one undoable command", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const elementIds = slide.elements.map((element) => element.id);
    state.execute({ type: "delete-elements", slideId: slide.id, elementIds });
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(0);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().selectedElementIds).toEqual([]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(elementIds.length);
  });

  it("moves a whole group with one command and one undo step", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const elementIds = slide.elements.map((element) => element.id);
    const before = slide.elements.map((element) => ({ ...element.frame }));
    state.execute({ type: "move-elements", slideId: slide.id, elementIds, dx: inches(1) as never, dy: 0 as never });
    const moved = useEditorStore.getState().document.slides[0]!.elements;
    expect(moved[0]!.frame.x).toBe(before[0]!.x + inches(1));
    expect(moved[1]!.frame.x).toBe(before[1]!.x + inches(1));
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements[0]!.frame.x).toBe(before[0]!.x);
  });

  it("aligns a group against its own bounds as one design transaction", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const elementIds = slide.elements.map((element) => element.id);
    state.execute({ type: "align-elements", slideId: slide.id, elementIds, align: { horizontal: "left" } });
    const aligned = useEditorStore.getState().document.slides[0]!.elements;
    expect(aligned[0]!.frame.x).toBe(aligned[1]!.frame.x);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });
});
