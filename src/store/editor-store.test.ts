import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, inches } from "../core/document-model";
import { useEditorStore } from "./editor-store";

describe("editor history", () => {
  beforeEach(() => {
    const document = createDocument();
    useEditorStore.setState({ document, activeSlideId: document.slides[0]!.id, selectedElementId: null, undoStack: [], redoStack: [] });
  });

  it("undoes and redoes one user command with its revisions", () => {
    const slideId = useEditorStore.getState().activeSlideId;
    useEditorStore.getState().execute({ type: "add-shape", slideId, shape: "rectangle" });
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(2);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(1);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 0, content: 0, design: 0 });

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(2);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });
  });

  it("treats duplicating a slide as one content and design transaction", () => {
    const slideId = useEditorStore.getState().activeSlideId;
    useEditorStore.getState().execute({ type: "duplicate-slide", slideId });
    expect(useEditorStore.getState().document.slides).toHaveLength(2);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 1, design: 1 });
    expect(useEditorStore.getState().activeSlideId).not.toBe(slideId);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides).toHaveLength(1);
    expect(useEditorStore.getState().activeSlideId).toBe(slideId);
  });

  it("undoes element duplication as one design transaction", () => {
    const state = useEditorStore.getState();
    const elementId = state.document.slides[0]!.elements[0]!.id;
    state.execute({ type: "duplicate-element", slideId: state.activeSlideId, elementId });
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(2);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    expect(useEditorStore.getState().selectedElementId).not.toBe(elementId);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(1);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 0, content: 0, design: 0 });
  });

  it("adds and selects decorative text as one design transaction", () => {
    const slideId = useEditorStore.getState().activeSlideId;
    useEditorStore.getState().execute({ type: "add-text", slideId });
    const state = useEditorStore.getState();
    expect(state.document.slides[0]!.elements).toHaveLength(2);
    expect(state.selectedElementId).toBe(state.document.slides[0]!.elements[1]!.id);
    expect(state.document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    state.undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(1);
  });

  it("commits a complete transform as one design transaction", () => {
    const state = useEditorStore.getState();
    const element = state.document.slides[0]!.elements[0]!;
    const frame = { x: inches(2), y: inches(2), width: inches(6), height: inches(1) };
    state.execute({ type: "transform-element", slideId: state.activeSlideId, elementId: element.id, frame, rotationMilliDegree: 30_000 });
    expect(useEditorStore.getState().document.slides[0]!.elements[0]).toMatchObject({ frame, rotationMilliDegree: 30_000 });
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements[0]!.frame).toEqual(element.frame);
  });

  it("keeps the content hash stable across design edits and refreshes it for content edits", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const title = slide.elements[0]!;
    const originalHash = slide.content.contentHash;
    expect(originalHash).toMatch(/^[0-9a-f]{16}$/);
    state.execute({ type: "transform-element", slideId: slide.id, elementId: title.id, frame: { ...title.frame, x: inches(1) }, rotationMilliDegree: 0 });
    expect(useEditorStore.getState().document.slides[0]!.content.contentHash).toBe(originalHash);
    useEditorStore.getState().execute({ type: "edit-text", slideId: slide.id, elementId: title.id, text: "新的已审核标题" });
    const edited = useEditorStore.getState().document.slides[0]!;
    expect(edited.content.title).toBe("新的已审核标题");
    expect(edited.content.contentHash).not.toBe(originalHash);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 2, content: 1, design: 1 });
  });

  it("replaces a generated document as one undoable transaction", () => {
    const generated = createDocument();
    generated.title = "AI 生成文稿";
    generated.slides[0]!.content.title = "新标题";
    useEditorStore.getState().replaceDocument(generated, "both");
    const state = useEditorStore.getState();
    expect(state.document.title).toBe("AI 生成文稿");
    expect(state.document.revisions).toEqual({ document: 1, content: 1, design: 1 });
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(useEditorStore.getState().document.title).toBe("未命名演示文稿");
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 0, content: 0, design: 0 });
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().document.title).toBe("AI 生成文稿");
  });
});
