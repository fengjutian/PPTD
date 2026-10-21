import { beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document-model";
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

  it("adds and selects text as one content and design transaction", () => {
    const slideId = useEditorStore.getState().activeSlideId;
    useEditorStore.getState().execute({ type: "add-text", slideId });
    const state = useEditorStore.getState();
    expect(state.document.slides[0]!.elements).toHaveLength(2);
    expect(state.selectedElementId).toBe(state.document.slides[0]!.elements[1]!.id);
    expect(state.document.revisions).toEqual({ document: 1, content: 1, design: 1 });
    state.undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(1);
  });
});
