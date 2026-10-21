import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, inches } from "../document-model";

describe("document commands", () => {
  it("keeps design commands out of content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const result = produce(source, (draft) => applyCommand(draft, { type: "move-element", slideId: slide.id, elementId: element.id, x: inches(2), y: inches(2) }));
    expect(commandDomain({ type: "move-element", slideId: slide.id, elementId: element.id, x: inches(2), y: inches(2) })).toBe("design");
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
  });

  it("marks approved content as changed after editing", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const result = produce(source, (draft) => applyCommand(draft, { type: "edit-text", slideId: slide.id, elementId: element.id, text: "新的标题" }));
    expect(result.slides[0]!.content.status).toBe("changed");
    expect(result.slides[0]!.content.title).toBe("新的标题");
  });

  it("duplicates slides with fresh stable IDs", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const result = produce(source, (draft) => applyCommand(draft, { type: "duplicate-slide", slideId: slide.id }));
    expect(result.slides).toHaveLength(2);
    expect(result.slides[1]!.id).not.toBe(slide.id);
    expect(result.slides[1]!.elements[0]!.id).not.toBe(slide.elements[0]!.id);
    expect(result.slides[1]!.content).toEqual(slide.content);
  });

  it("moves and deletes slides while preserving at least one slide", () => {
    const source = createDocument();
    source.slides.push(createDocument().slides[0]!);
    const firstId = source.slides[0]!.id;
    const secondId = source.slides[1]!.id;
    const moved = produce(source, (draft) => applyCommand(draft, { type: "move-slide", slideId: secondId, toIndex: 0 }));
    expect(moved.slides.map((slide) => slide.id)).toEqual([secondId, firstId]);
    const deleted = produce(moved, (draft) => applyCommand(draft, { type: "delete-slide", slideId: secondId }));
    expect(deleted.slides.map((slide) => slide.id)).toEqual([firstId]);
    expect(() => produce(deleted, (draft) => applyCommand(draft, { type: "delete-slide", slideId: firstId }))).toThrow("LAST_SLIDE_CANNOT_BE_DELETED");
  });

  it("duplicates and deletes unlocked elements without changing slide content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const duplicated = produce(source, (draft) => applyCommand(draft, { type: "duplicate-element", slideId: slide.id, elementId: element.id }));
    expect(duplicated.slides[0]!.elements).toHaveLength(2);
    expect(duplicated.slides[0]!.elements[1]!.id).not.toBe(element.id);
    expect(JSON.stringify(duplicated.slides[0]!.content)).toBe(contentBefore);
    const duplicateId = duplicated.slides[0]!.elements[1]!.id;
    const deleted = produce(duplicated, (draft) => applyCommand(draft, { type: "delete-element", slideId: slide.id, elementId: duplicateId }));
    expect(deleted.slides[0]!.elements).toHaveLength(1);
  });

  it("allows unlocking but rejects edits to locked elements", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const locked = produce(source, (draft) => applyCommand(draft, { type: "set-element-lock", slideId: slide.id, elementId: element.id, locked: true }));
    expect(locked.slides[0]!.elements[0]!.locked).toBe(true);
    expect(() => produce(locked, (draft) => applyCommand(draft, { type: "delete-element", slideId: slide.id, elementId: element.id }))).toThrow("ELEMENT_LOCKED");
    const unlocked = produce(locked, (draft) => applyCommand(draft, { type: "set-element-lock", slideId: slide.id, elementId: element.id, locked: false }));
    expect(unlocked.slides[0]!.elements[0]!.locked).toBe(false);
  });

  it("adds independent text without overwriting the slide title when edited", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slideId = source.slides[0]!.id;
    const titleBefore = source.slides[0]!.content.title;
    const added = produce(source, (draft) => applyCommand(draft, { type: "add-text", slideId }));
    const addedText = added.slides[0]!.elements[1]!;
    expect(addedText.type).toBe("text");
    expect(added.slides[0]!.content.status).toBe("changed");
    const edited = produce(added, (draft) => applyCommand(draft, { type: "edit-text", slideId, elementId: addedText.id, text: "补充说明" }));
    expect(edited.slides[0]!.content.title).toBe(titleBefore);
    expect(edited.slides[0]!.elements[1]).toMatchObject({ type: "text", text: "补充说明" });
  });

  it("validates and applies element transforms", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const frame = { x: inches(2), y: inches(1), width: inches(5), height: inches(1) };
    const transformed = produce(source, (draft) => applyCommand(draft, { type: "transform-element", slideId: slide.id, elementId: element.id, frame, rotationMilliDegree: 15_000 }));
    expect(transformed.slides[0]!.elements[0]).toMatchObject({ frame, rotationMilliDegree: 15_000 });
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "transform-element", slideId: slide.id, elementId: element.id, frame: { ...frame, width: 0 as typeof frame.width }, rotationMilliDegree: 0 }))).toThrow("INVALID_ELEMENT_TRANSFORM");
  });

  it("adds a validated embedded image", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const result = produce(source, (draft) => applyCommand(draft, { type: "add-image", slideId, dataUrl, mimeType: "image/png", altText: "sample" }));
    expect(result.slides[0]!.elements[1]).toMatchObject({ type: "image", source: { dataUrl, mimeType: "image/png" }, altText: "sample" });
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "add-image", slideId, dataUrl, mimeType: "image/jpeg", altText: "sample" }))).toThrow("INVALID_IMAGE_SOURCE");
  });

  it("applies an AI draft as one structured document replacement", () => {
    const source = createDocument();
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-draft", title: "AI 战略", slides: [
      { title: "现状", body: "市场增长\n竞争加剧", speakerNotes: "说明背景" },
      { title: "行动", body: "聚焦产品", speakerNotes: "说明计划" },
    ] }));
    expect(result.title).toBe("AI 战略");
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0]!.content).toMatchObject({ title: "现状", body: "市场增长\n竞争加剧", status: "draft" });
    expect(result.slides[0]!.elements).toHaveLength(2);
  });
});
