import { beforeEach, describe, expect, it } from "vitest";
import {
  createDocument,
  hashSlideContent,
  inches,
  presentationDocumentSchema,
  type ContentBlock,
  type TextElement,
} from "../core/document-model";
import { useEditorStore } from "./editor-store";

describe("editor history", () => {
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

  it("renames a project as one undoable content transaction", () => {
    const original = useEditorStore.getState().document.title;
    useEditorStore.getState().execute({ type: "rename-document", title: "季度复盘" });
    expect(useEditorStore.getState().document.title).toBe("季度复盘");
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 1, design: 0 });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.title).toBe(original);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 0, content: 0, design: 0 });
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
    expect(useEditorStore.getState().selectedElementIds).not.toContain(elementId);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(1);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 0, content: 0, design: 0 });
  });

  it("adds and selects decorative text as one design transaction", () => {
    const slideId = useEditorStore.getState().activeSlideId;
    useEditorStore.getState().execute({ type: "add-text", slideId });
    const state = useEditorStore.getState();
    expect(state.document.slides[0]!.elements).toHaveLength(2);
    expect(state.selectedElementIds).toEqual([state.document.slides[0]!.elements[1]!.id]);
    expect(state.document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    state.undo();
    expect(useEditorStore.getState().document.slides[0]!.elements).toHaveLength(1);
  });

  it("commits a complete transform as one design transaction", () => {
    const state = useEditorStore.getState();
    const element = state.document.slides[0]!.elements[0]!;
    const frame = { x: inches(2), y: inches(2), width: inches(6), height: inches(1) };
    state.execute({
      type: "transform-element",
      slideId: state.activeSlideId,
      elementId: element.id,
      frame,
      rotationMilliDegree: 30_000,
    });
    expect(useEditorStore.getState().document.slides[0]!.elements[0]).toMatchObject({
      frame,
      rotationMilliDegree: 30_000,
    });
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
    state.execute({
      type: "transform-element",
      slideId: slide.id,
      elementId: title.id,
      frame: { ...title.frame, x: inches(1) },
      rotationMilliDegree: 0,
    });
    expect(useEditorStore.getState().document.slides[0]!.content.contentHash).toBe(originalHash);
    useEditorStore
      .getState()
      .execute({ type: "edit-text", slideId: slide.id, elementId: title.id, text: "新的已审核标题" });
    const edited = useEditorStore.getState().document.slides[0]!;
    expect(edited.content.title).toBe("新的已审核标题");
    expect(edited.content.contentHash).not.toBe(originalHash);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 2, content: 1, design: 1 });
  });

  it("keeps the selected element through design edits and clears it after deletion", () => {
    const state = useEditorStore.getState();
    const element = state.document.slides[0]!.elements[0]!;
    state.selectElement(element.id);
    state.execute({
      type: "move-element",
      slideId: state.activeSlideId,
      elementId: element.id,
      x: inches(2),
      y: inches(2),
    });
    expect(useEditorStore.getState().selectedElementIds).toEqual([element.id]);
    state.execute({ type: "delete-element", slideId: state.activeSlideId, elementId: element.id });
    expect(useEditorStore.getState().selectedElementIds).toEqual([]);
  });

  it("commits a style change as one design transaction and keeps reviewed content frozen", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const title = slide.elements[0]!;
    const originalHash = slide.content.contentHash;
    const originalSize = title.type === "text" ? title.style.fontSizePt : 0;
    state.execute({
      type: "set-text-style",
      slideId: slide.id,
      elementId: title.id,
      style: { fontSizePt: 44, bold: true },
    });
    const restyled = useEditorStore.getState().document.slides[0]!.elements[0]!;
    expect(restyled.type === "text" && restyled.style.fontSizePt).toBe(44);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    expect(useEditorStore.getState().document.slides[0]!.content.contentHash).toBe(originalHash);
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    useEditorStore.getState().undo();
    const reverted = useEditorStore.getState().document.slides[0]!.elements[0]!;
    expect(reverted.type === "text" && reverted.style.fontSizePt).toBe(originalSize);
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 0, content: 0, design: 0 });
  });

  it("commits an emphasis as one design transaction and keeps reviewed content frozen", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const title = slide.elements[0]!;
    const originalHash = slide.content.contentHash;
    state.execute({
      type: "set-text-emphasis",
      slideId: slide.id,
      elementId: title.id,
      start: 0,
      end: 2,
      style: { bold: true },
    });
    const emphasised = useEditorStore.getState().document.slides[0]!.elements[0]!;
    expect(emphasised.type === "text" ? emphasised.runs : undefined).toEqual([{ start: 0, end: 2, bold: true }]);
    // The emphasis is design: the approved copy stays frozen.
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });
    expect(useEditorStore.getState().document.slides[0]!.content.contentHash).toBe(originalHash);

    useEditorStore.getState().undo();
    const reverted = useEditorStore.getState().document.slides[0]!.elements[0]!;
    expect(reverted.type === "text" ? reverted.runs : undefined).toBeUndefined();
  });

  it("commits a picture crop as one design transaction and can undo it", () => {
    const state = useEditorStore.getState();
    const slide = state.document.slides[0]!;
    const originalHash = slide.content.contentHash;
    state.execute({
      type: "add-image",
      slideId: slide.id,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mimeType: "image/png",
      altText: "样例",
    });
    const image = useEditorStore.getState().document.slides[0]!.elements[1]!;
    if (image.type !== "image") throw new Error("expected an image");

    state.execute({
      type: "set-image-crop",
      slideId: slide.id,
      elementId: image.id,
      crop: { top: 0.25, bottom: 0, left: 0, right: 0 },
    });
    const cropped = useEditorStore.getState().document.slides[0]!.elements[1]!;
    expect(cropped.type === "image" ? cropped.crop : undefined).toEqual({ top: 0.25, bottom: 0, left: 0, right: 0 });
    // A crop only changes the design. The reviewed content stays frozen.
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 2, content: 0, design: 2 });
    expect(useEditorStore.getState().document.slides[0]!.content.contentHash).toBe(originalHash);
    expect(useEditorStore.getState().undoStack).toHaveLength(2);

    useEditorStore.getState().undo();
    const reverted = useEditorStore.getState().document.slides[0]!.elements[1]!;
    expect(reverted.type === "image" ? reverted.crop : "missing").toBeUndefined();
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 0, design: 1 });

    useEditorStore.getState().redo();
    const restored = useEditorStore.getState().document.slides[0]!.elements[1]!;
    expect(restored.type === "image" ? restored.crop : undefined).toEqual({ top: 0.25, bottom: 0, left: 0, right: 0 });
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

  it("confirms edited content as one undoable content transaction", () => {
    const state = useEditorStore.getState();
    const slideId = state.activeSlideId;
    const title = state.document.slides[0]!.elements.find(
      (element) => element.type === "text" && element.contentRef === "title",
    )!;

    useEditorStore.getState().execute({ type: "approve-slide-content", slideId });
    expect(useEditorStore.getState().document.slides[0]!.content.status).toBe("approved");
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 1, content: 1, design: 0 });

    // Editing the approved title is a content change: the page needs review again.
    useEditorStore.getState().execute({ type: "edit-text", slideId, elementId: title.id, text: "改过的标题" });
    expect(useEditorStore.getState().document.slides[0]!.content.status).toBe("changed");
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 2, content: 2, design: 0 });

    // Confirming the edit closes the loop without touching the words.
    useEditorStore.getState().execute({ type: "approve-slide-content", slideId });
    expect(useEditorStore.getState().document.slides[0]!.content.status).toBe("approved");
    expect(useEditorStore.getState().document.slides[0]!.content.title).toBe("改过的标题");
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 3, content: 3, design: 0 });

    // Confirming an already confirmed page adds no undo entry.
    useEditorStore.getState().execute({ type: "approve-slide-content", slideId });
    expect(useEditorStore.getState().undoStack).toHaveLength(3);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.slides[0]!.content.status).toBe("changed");
    expect(useEditorStore.getState().document.revisions).toEqual({ document: 2, content: 2, design: 0 });
  });

  it("records a metric edit as one undoable content transaction", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const metric: Extract<ContentBlock, { type: "metric" }> = {
      id: crypto.randomUUID(),
      type: "metric",
      label: "收入",
      value: "38万",
    };
    slide.content.blocks = [metric];
    slide.content.status = "approved";
    slide.content.contentHash = hashSlideContent(slide.content);
    const card: TextElement = {
      id: crypto.randomUUID() as never,
      type: "text",
      text: "38万",
      contentRef: "decorative",
      contentBlockRef: { blockId: metric.id, field: "value" },
      frame: { x: inches(1), y: inches(1), width: inches(2), height: inches(1) },
      rotationMilliDegree: 0,
      locked: false,
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 18, color: "#17181c", bold: true, align: "center" },
    };
    slide.elements.push(card);
    useEditorStore.setState({
      document,
      activeSlideId: slide.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
    const hashBefore = slide.content.contentHash;

    useEditorStore
      .getState()
      .execute({ type: "set-metric", slideId: slide.id, blockId: metric.id, field: "value", value: "42万" });

    const after = useEditorStore.getState().document;
    expect(after.revisions).toEqual({ document: 1, content: 1, design: 0 });
    expect(after.slides[0]!.content.status).toBe("changed");
    expect(after.slides[0]!.content.blocks).toEqual([{ ...metric, value: "42万" }]);
    // The reviewed copy changed, so the hash must change with it.
    expect(after.slides[0]!.content.contentHash).not.toBe(hashBefore);

    useEditorStore.getState().undo();
    const undone = useEditorStore.getState().document;
    expect(undone.revisions).toEqual({ document: 0, content: 0, design: 0 });
    expect(undone.slides[0]!.content.status).toBe("approved");
    expect(undone.slides[0]!.content.blocks).toEqual([metric]);
    expect(undone.slides[0]!.content.contentHash).toBe(hashBefore);
  });

  it("keeps the template binding of a designed document", () => {
    // The generated pages carry a reference to the template layout they were
    // designed against. Dropping the layout registry would leave every
    // reference dangling: the saved file could no longer be read back and the
    // exporter would lose the slide master.
    const generated = createDocument();
    const layoutId = crypto.randomUUID();
    generated.title = "带模板的文稿";
    generated.theme = {
      name: "昆佰泰",
      majorFont: "思源黑体",
      minorFont: "思源宋体",
      colors: [{ name: "accent1", value: "#C04A32" }],
    };
    generated.layouts = [{ id: layoutId, name: "内页（浅色）1", backgroundColor: "#FFFFFF" }];
    generated.slides[0]!.layoutId = layoutId;

    useEditorStore.getState().replaceDocument(generated, "both");

    const document = useEditorStore.getState().document;
    expect(document.layouts).toEqual(generated.layouts);
    expect(document.theme).toEqual(generated.theme);
    expect(document.slides[0]!.layoutId).toBe(layoutId);
    // A document that cannot be read back is a lost document.
    expect(() => presentationDocumentSchema.parse(document)).not.toThrow();
  });
});
