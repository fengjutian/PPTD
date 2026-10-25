import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";

import { createDocument, inches, type ElementId } from "../document-model";

describe("commands 1", () => {
  it("renames the presentation in the content domain", () => {
    const source = createDocument();
    const result = produce(source, (draft) => applyCommand(draft, { type: "rename-document", title: "  新项目名  " }));
    expect(result.title).toBe("新项目名");
    expect(commandDomain({ type: "rename-document", title: "新项目名" })).toBe("content");
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "rename-document", title: "   " }))).toThrow(
      "DOCUMENT_TITLE_INVALID",
    );
  });

  it("keeps design commands out of content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "move-element",
        slideId: slide.id,
        elementId: element.id,
        x: inches(2),
        y: inches(2),
      }),
    );
    expect(
      commandDomain({ type: "move-element", slideId: slide.id, elementId: element.id, x: inches(2), y: inches(2) }),
    ).toBe("design");
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
  });

  it("keeps legacy unannotated title edits and deletes in the content domain", () => {
    const source = createDocument();
    const legacy = structuredClone(source);
    const slide = legacy.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type === "text") delete title.contentRef;
    expect(commandDomain({ type: "edit-text", slideId: slide.id, elementId: title.id, text: "兼容标题" }, legacy)).toBe(
      "content",
    );
    expect(commandDomain({ type: "delete-element", slideId: slide.id, elementId: title.id }, legacy)).toBe("content");
  });

  it("marks approved content as changed after editing", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "edit-text", slideId: slide.id, elementId: element.id, text: "新的标题" }),
    );
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
    const moved = produce(source, (draft) =>
      applyCommand(draft, { type: "move-slide", slideId: secondId, toIndex: 0 }),
    );
    expect(moved.slides.map((slide) => slide.id)).toEqual([secondId, firstId]);
    const deleted = produce(moved, (draft) => applyCommand(draft, { type: "delete-slide", slideId: secondId }));
    expect(deleted.slides.map((slide) => slide.id)).toEqual([firstId]);
    expect(() => produce(deleted, (draft) => applyCommand(draft, { type: "delete-slide", slideId: firstId }))).toThrow(
      "LAST_SLIDE_CANNOT_BE_DELETED",
    );
  });

  it("duplicates and deletes unlocked elements without changing slide content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const duplicated = produce(source, (draft) =>
      applyCommand(draft, { type: "duplicate-element", slideId: slide.id, elementId: element.id }),
    );
    expect(duplicated.slides[0]!.elements).toHaveLength(2);
    expect(duplicated.slides[0]!.elements[1]!.id).not.toBe(element.id);
    expect(JSON.stringify(duplicated.slides[0]!.content)).toBe(contentBefore);
    const duplicateId = duplicated.slides[0]!.elements[1]!.id;
    const deleted = produce(duplicated, (draft) =>
      applyCommand(draft, { type: "delete-element", slideId: slide.id, elementId: duplicateId }),
    );
    expect(deleted.slides[0]!.elements).toHaveLength(1);
  });

  it("adds, edits, reorders and removes entrance animations as design commands", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const firstElement = slide.elements[0]!;
    const secondElement = structuredClone(firstElement);
    secondElement.id = crypto.randomUUID() as ElementId;
    slide.elements.push(secondElement);

    const animated = produce(source, (draft) => {
      applyCommand(draft, {
        type: "add-animation",
        slideId: slide.id,
        elementId: firstElement.id,
        animation: { effect: "fade", start: "on-click", durationMs: 600, delayMs: 0, direction: "none" },
      });
      applyCommand(draft, {
        type: "add-animation",
        slideId: slide.id,
        elementId: secondElement.id,
        animation: { effect: "fly-in", start: "after-previous", durationMs: 800, delayMs: 200, direction: "left" },
      });
    });
    const firstAnimation = animated.slides[0]!.animations![0]!;
    expect(commandDomain({ type: "remove-animation", slideId: slide.id, animationId: firstAnimation.id })).toBe(
      "design",
    );

    const edited = produce(animated, (draft) => {
      applyCommand(draft, {
        type: "set-animation",
        slideId: slide.id,
        animationId: firstAnimation.id,
        changes: { durationMs: 900, start: "with-previous" },
      });
      applyCommand(draft, { type: "move-animation", slideId: slide.id, animationId: firstAnimation.id, toIndex: 1 });
    });
    expect(edited.slides[0]!.animations![1]).toMatchObject({
      id: firstAnimation.id,
      durationMs: 900,
      start: "with-previous",
    });

    const removed = produce(edited, (draft) =>
      applyCommand(draft, { type: "remove-animation", slideId: slide.id, animationId: firstAnimation.id }),
    );
    expect(removed.slides[0]!.animations).toHaveLength(1);

    const cleared = produce(edited, (draft) =>
      applyCommand(draft, { type: "clear-slide-animations", slideId: slide.id }),
    );
    expect(cleared.slides[0]!.animations).toEqual([]);
  });

  it("remaps animations when duplicating an element and removes them when deleting it", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const animated = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-animation",
        slideId: slide.id,
        elementId: element.id,
        animation: { effect: "appear", start: "on-click", durationMs: 300, delayMs: 0, direction: "none" },
      }),
    );
    const duplicated = produce(animated, (draft) =>
      applyCommand(draft, { type: "duplicate-element", slideId: slide.id, elementId: element.id }),
    );
    const duplicate = duplicated.slides[0]!.elements.at(-1)!;
    const duplicateAnimation = duplicated.slides[0]!.animations!.find(
      (animation) => animation.elementId === duplicate.id,
    );
    expect(duplicateAnimation).toBeDefined();
    expect(duplicateAnimation!.id).not.toBe(duplicated.slides[0]!.animations![0]!.id);

    const deleted = produce(duplicated, (draft) =>
      applyCommand(draft, { type: "delete-element", slideId: slide.id, elementId: duplicate.id }),
    );
    expect(deleted.slides[0]!.animations!.some((animation) => animation.elementId === duplicate.id)).toBe(false);
  });

  it("allows unlocking but rejects edits to locked elements", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const locked = produce(source, (draft) =>
      applyCommand(draft, { type: "set-element-lock", slideId: slide.id, elementId: element.id, locked: true }),
    );
    expect(locked.slides[0]!.elements[0]!.locked).toBe(true);
    expect(() =>
      produce(locked, (draft) =>
        applyCommand(draft, { type: "delete-element", slideId: slide.id, elementId: element.id }),
      ),
    ).toThrow("ELEMENT_LOCKED");
    const unlocked = produce(locked, (draft) =>
      applyCommand(draft, { type: "set-element-lock", slideId: slide.id, elementId: element.id, locked: false }),
    );
    expect(unlocked.slides[0]!.elements[0]!.locked).toBe(false);
  });

  it("adds independent decorative text without changing reviewed content", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slideId = source.slides[0]!.id;
    const titleBefore = source.slides[0]!.content.title;
    const added = produce(source, (draft) => applyCommand(draft, { type: "add-text", slideId }));
    const addedText = added.slides[0]!.elements[1]!;
    expect(addedText.type).toBe("text");
    expect(added.slides[0]!.content.status).toBe("approved");
    expect(addedText.type === "text" && addedText.contentRef).toBe("decorative");
    const edited = produce(added, (draft) =>
      applyCommand(draft, { type: "edit-text", slideId, elementId: addedText.id, text: "补充说明" }),
    );
    expect(edited.slides[0]!.content.title).toBe(titleBefore);
    expect(edited.slides[0]!.content.status).toBe("approved");
    expect(edited.slides[0]!.elements[1]).toMatchObject({ type: "text", text: "补充说明" });
  });

  it("reorders elements to change z-order without changing content", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const added = produce(source, (draft) => applyCommand(draft, { type: "add-shape", slideId, shape: "rectangle" }));
    const shapeId = added.slides[0]!.elements[1]!.id;
    const reordered = produce(added, (draft) =>
      applyCommand(draft, { type: "reorder-element", slideId, elementId: shapeId, toIndex: 0 }),
    );
    expect(reordered.slides[0]!.elements[0]).toMatchObject({ id: shapeId, type: "shape" });
    expect(reordered.slides[0]!.content).toEqual(added.slides[0]!.content);
    expect(() =>
      produce(added, (draft) =>
        applyCommand(draft, { type: "reorder-element", slideId, elementId: shapeId, toIndex: 9 }),
      ),
    ).toThrow("ELEMENT_INDEX_OUT_OF_RANGE");
  });

  it("duplicates content-bound text as decorative instead of creating a second content writer", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const titleId = source.slides[0]!.elements[0]!.id;
    const duplicated = produce(source, (draft) =>
      applyCommand(draft, { type: "duplicate-element", slideId, elementId: titleId }),
    );
    const copy = duplicated.slides[0]!.elements[1]!;
    expect(copy.type === "text" && copy.contentRef).toBe("decorative");
    expect(duplicated.slides[0]!.content.title).toBe(source.slides[0]!.content.title);
  });

  it("aligns an element to page edges and center without touching content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const aligned = produce(source, (draft) =>
      applyCommand(draft, { type: "align-element", slideId: slide.id, elementId: element.id, align: "center" }),
    );
    expect(aligned.slides[0]!.elements[0]!.frame.x).toBe(Math.round((source.pageSize.width - element.frame.width) / 2));
    expect(aligned.slides[0]!.content).toEqual(source.slides[0]!.content);
  });

  it("places an element in a corner of the page with one command", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const aligned = produce(source, (draft) =>
      applyCommand(draft, {
        type: "align-element",
        slideId: slide.id,
        elementId: element.id,
        align: { horizontal: "right", vertical: "bottom" },
      }),
    );
    const frame = aligned.slides[0]!.elements[0]!.frame;
    expect(frame.x).toBe(source.pageSize.width - element.frame.width);
    expect(frame.y).toBe(source.pageSize.height - element.frame.height);
  });

  it("leaves the other axis alone when only one of them is aligned", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const aligned = produce(source, (draft) =>
      applyCommand(draft, {
        type: "align-element",
        slideId: slide.id,
        elementId: element.id,
        align: { horizontal: "left" },
      }),
    );
    const frame = aligned.slides[0]!.elements[0]!.frame;
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(element.frame.y);
  });

  it("validates and applies element transforms", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const frame = { x: inches(2), y: inches(1), width: inches(5), height: inches(1) };
    const transformed = produce(source, (draft) =>
      applyCommand(draft, {
        type: "transform-element",
        slideId: slide.id,
        elementId: element.id,
        frame,
        rotationMilliDegree: 15_000,
      }),
    );
    expect(transformed.slides[0]!.elements[0]).toMatchObject({ frame, rotationMilliDegree: 15_000 });
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "transform-element",
          slideId: slide.id,
          elementId: element.id,
          frame: { ...frame, width: 0 as typeof frame.width },
          rotationMilliDegree: 0,
        }),
      ),
    ).toThrow("INVALID_ELEMENT_TRANSFORM");
  });

  it("adds a validated embedded image", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "add-image", slideId, dataUrl, mimeType: "image/png", altText: "sample" }),
    );
    expect(result.slides[0]!.elements[1]).toMatchObject({
      type: "image",
      source: { dataUrl, mimeType: "image/png" },
      altText: "sample",
    });
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, { type: "add-image", slideId, dataUrl, mimeType: "image/jpeg", altText: "sample" }),
      ),
    ).toThrow("INVALID_IMAGE_SOURCE");
  });

  it("restyles text without touching reviewed content", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const command = {
      type: "set-text-style" as const,
      slideId: slide.id,
      elementId: title.id,
      style: { fontSizePt: 36, color: "#112233", bold: true, align: "center" as const },
    };
    expect(commandDomain(command)).toBe("design");
    const result = produce(source, (draft) => applyCommand(draft, command));
    expect(result.slides[0]!.elements[0]).toMatchObject({
      style: { fontSizePt: 36, color: "#112233", bold: true, align: "center" },
    });
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(result.slides[0]!.content.status).toBe("approved");
  });

  it("restyles shapes and image alt text without touching reviewed content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const withShape = produce(source, (draft) =>
      applyCommand(draft, { type: "add-shape", slideId: slide.id, shape: "rectangle" }),
    );
    const shape = withShape.slides[0]!.elements[1]!;
    const restyled = produce(withShape, (draft) =>
      applyCommand(draft, {
        type: "set-shape-style",
        slideId: slide.id,
        elementId: shape.id,
        style: { fill: "#00ff00", strokeWidthPt: 3, radiusPt: 20 },
      }),
    );
    expect(restyled.slides[0]!.elements[1]).toMatchObject({
      style: { fill: "#00ff00", strokeWidthPt: 3, radiusPt: 20 },
    });
    expect(restyled.slides[0]!.content).toEqual(withShape.slides[0]!.content);

    const withImage = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId: slide.id,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        altText: "原描述",
      }),
    );
    const image = withImage.slides[0]!.elements[1]!;
    const described = produce(withImage, (draft) =>
      applyCommand(draft, {
        type: "set-image-alt-text",
        slideId: slide.id,
        elementId: image.id,
        altText: "新的替代文本",
      }),
    );
    expect(described.slides[0]!.elements[1]).toMatchObject({ altText: "新的替代文本" });
    expect(described.slides[0]!.content).toEqual(withImage.slides[0]!.content);
  });

  it("rejects style values the exporter could not round-trip", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-style",
          slideId: slide.id,
          elementId: title.id,
          style: { color: "red" },
        }),
      ),
    ).toThrow("INVALID_TEXT_STYLE");
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-style",
          slideId: slide.id,
          elementId: title.id,
          style: { fontSizePt: 0 },
        }),
      ),
    ).toThrow("INVALID_TEXT_STYLE");
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-shape-style",
          slideId: slide.id,
          elementId: title.id,
          style: { fill: "#ffffff" },
        }),
      ),
    ).toThrow("ELEMENT_NOT_SHAPE");
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, { type: "set-image-alt-text", slideId: slide.id, elementId: title.id, altText: "描述" }),
      ),
    ).toThrow("ELEMENT_NOT_IMAGE");
  });

  it("crops a picture without touching reviewed content and can clear the crop again", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const withImage = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId: slide.id,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        altText: "原描述",
      }),
    );
    const image = withImage.slides[0]!.elements[1]!;
    const command = {
      type: "set-image-crop" as const,
      slideId: slide.id,
      elementId: image.id,
      crop: { top: 0.1, bottom: 0.2, left: 0, right: 0.3 },
    };
    expect(commandDomain(command)).toBe("design");

    const cropped = produce(withImage, (draft) => applyCommand(draft, command));
    expect(cropped.slides[0]!.elements[1]).toMatchObject({ crop: { top: 0.1, bottom: 0.2, left: 0, right: 0.3 } });
    expect(cropped.slides[0]!.content).toEqual(withImage.slides[0]!.content);

    const cleared = produce(cropped, (draft) =>
      applyCommand(draft, { type: "set-image-crop", slideId: slide.id, elementId: image.id, crop: null }),
    );
    expect(
      cleared.slides[0]!.elements[1]!.type === "image" ? cleared.slides[0]!.elements[1]!.crop : "missing",
    ).toBeUndefined();
  });

  it("refuses a crop that would hide the whole picture", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const withImage = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId: slide.id,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        altText: "原描述",
      }),
    );
    const image = withImage.slides[0]!.elements[1]!;
    expect(() =>
      produce(withImage, (draft) =>
        applyCommand(draft, {
          type: "set-image-crop",
          slideId: slide.id,
          elementId: image.id,
          crop: { top: 0.6, bottom: 0.6, left: 0, right: 0 },
        }),
      ),
    ).toThrow("INVALID_IMAGE_CROP");
    expect(() =>
      produce(withImage, (draft) =>
        applyCommand(draft, {
          type: "set-image-crop",
          slideId: slide.id,
          elementId: image.id,
          crop: { top: -0.1, bottom: 0, left: 0, right: 0 },
        }),
      ),
    ).toThrow("INVALID_IMAGE_CROP");
    expect(() =>
      produce(withImage, (draft) =>
        applyCommand(draft, {
          type: "set-image-crop",
          slideId: slide.id,
          elementId: withImage.slides[0]!.elements[0]!.id,
          crop: { top: 0, bottom: 0, left: 0, right: 0 },
        }),
      ),
    ).toThrow("ELEMENT_NOT_IMAGE");
  });

  it("refuses to restyle a locked element", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const locked = produce(source, (draft) =>
      applyCommand(draft, { type: "set-element-lock", slideId: slide.id, elementId: title.id, locked: true }),
    );
    expect(() =>
      produce(locked, (draft) =>
        applyCommand(draft, {
          type: "set-text-style",
          slideId: slide.id,
          elementId: title.id,
          style: { fontSizePt: 40 },
        }),
      ),
    ).toThrow("ELEMENT_LOCKED");
  });

  it("changes the page background without touching reviewed content", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slide = source.slides[0]!;
    const command = { type: "set-slide-background" as const, slideId: slide.id, background: "#102030" };
    expect(commandDomain(command)).toBe("design");
    const result = produce(source, (draft) => applyCommand(draft, command));
    expect(result.slides[0]!.background).toBe("#102030");
    expect(result.slides[0]!.content).toEqual(source.slides[0]!.content);
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, { type: "set-slide-background", slideId: slide.id, background: "navy" }),
      ),
    ).toThrow("INVALID_BACKGROUND_COLOR");
  });

  it("sets and removes a locked page background picture as one design command", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const withBackground = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-slide-background-image",
        slideId: slide.id,
        dataUrl,
        mimeType: "image/png",
      }),
    );
    const background = withBackground.slides[0]!.elements.find(
      (element) => element.type === "image" && element.placement === "slide-background",
    );
    expect(background).toMatchObject({
      type: "image",
      locked: true,
      origin: "user",
      frame: { x: 0, y: 0, width: source.pageSize.width, height: source.pageSize.height },
    });
    expect(
      commandDomain({ type: "set-slide-background-image", slideId: slide.id, dataUrl, mimeType: "image/png" }),
    ).toBe("design");

    const removed = produce(withBackground, (draft) =>
      applyCommand(draft, { type: "remove-slide-background-image", slideId: slide.id }),
    );
    expect(
      removed.slides[0]!.elements.some(
        (element) => element.type === "image" && element.placement === "slide-background",
      ),
    ).toBe(false);
  });

  it("applies an AI draft as one structured document replacement", () => {
    const source = createDocument();
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-draft",
        title: "AI 战略",
        slides: [
          { title: "现状", body: "市场增长\n竞争加剧", speakerNotes: "说明背景" },
          { title: "行动", body: "聚焦产品", speakerNotes: "说明计划" },
        ],
      }),
    );
    expect(result.title).toBe("AI 战略");
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0]!.content).toMatchObject({ title: "现状", body: "市场增长\n竞争加剧", status: "approved" });
    expect(result.slides[0]!.elements).toHaveLength(2);
    // 应用已审核草稿即为第一次确认，设计阶段之前就有可对比的基线。
    expect(result.contentVersions).toHaveLength(1);
    expect(result.contentVersions![0]!.slides.map((slide) => slide.title)).toEqual(["现状", "行动"]);
  });

  it("stores structured AI content blocks with stable IDs and keeps body edits consistent", () => {
    const source = createDocument();
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-draft",
        title: "结构化",
        slides: [
          { title: "要点", body: "甲\n乙", speakerNotes: "", blocks: [{ type: "bullet-list", items: ["甲", "乙"] }] },
        ],
      }),
    );
    const content = result.slides[0]!.content;
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks![0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    const bodyElement = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.contentRef === "body",
    )!;
    const edited = produce(result, (draft) =>
      applyCommand(draft, {
        type: "edit-text",
        slideId: result.slides[0]!.id,
        elementId: bodyElement.id,
        text: "新的正文",
      }),
    );
    expect(edited.slides[0]!.content.body).toBe("新的正文");
    expect(edited.slides[0]!.content.blocks).toEqual([
      { id: content.blocks![0]!.id, type: "paragraph", text: "新的正文" },
    ]);
  });
});
