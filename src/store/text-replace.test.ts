import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../core/commands";
import { createDocument } from "../core/document-model";
import { useEditorStore } from "./editor-store";

/**
 * “全部替换”是一个用户意图：整批替换只产生一个撤销项。
 */
describe("replace all in the editor store", () => {
  beforeEach(() => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const title = slide.elements[0]!;
    const decorative = slide.elements[1]!;
    if (title.type !== "text" || decorative.type !== "text") throw new Error("expected text");
    title.text = "旧标题";
    slide.content.title = "旧标题";
    decorative.text = "旧副标题";
    useEditorStore.setState({
      document,
      activeSlideId: slide.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("replaces across content and decorative text as one undo step", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const [title, decorative] = slide.elements;
    if (title!.type !== "text" || decorative!.type !== "text") throw new Error("expected text");
    const contentBefore = state.document.revisions.content;
    const designBefore = state.document.revisions.design;

    state.execute({
      type: "replace-text-edits",
      edits: [
        { slideId: slide.id, elementId: title!.id, text: "新标题" },
        { slideId: slide.id, elementId: decorative!.id, text: "新副标题" },
      ],
    });

    const after = useEditorStore.getState();
    expect(after.undoStack).toHaveLength(1);
    expect(after.document.revisions.content).toBe(contentBefore + 1);
    expect(after.document.revisions.design).toBe(designBefore + 1);
    expect(after.document.slides[0]!.content.title).toBe("新标题");

    after.undo();
    expect(useEditorStore.getState().document.slides[0]!.content.title).toBe("旧标题");
    const restored = useEditorStore.getState().document.slides[0]!.elements;
    expect(restored[0]!.type === "text" ? restored[0]!.text : "").toBe("旧标题");
    expect(restored[1]!.type === "text" ? restored[1]!.text : "").toBe("旧副标题");
  });
});
