import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, pageSizeFromInches } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * 改页面尺寸是一个设计意图：一个撤销项，只递增设计版本。
 */
describe("page size in the editor store", () => {
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

  it("is one undoable design change and keeps the content revision", () => {
    const state = useEditorStore.getState();
    const contentRevision = state.document.revisions.content;
    const designRevision = state.document.revisions.design;
    const originalSize = { ...state.document.pageSize };

    state.execute({ type: "set-page-size", pageSize: pageSizeFromInches(10, 7.5)! });
    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.pageSize).toEqual(pageSizeFromInches(10, 7.5));
    expect(after.document.revisions.content).toBe(contentRevision);
    expect(after.document.revisions.design).toBe(designRevision + 1);

    after.undo();
    expect(useEditorStore.getState().document.pageSize).toEqual(originalSize);
  });
});
