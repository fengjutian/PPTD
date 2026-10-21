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
});
