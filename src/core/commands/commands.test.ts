import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { classifyRelayoutElements, inferRelayoutContext } from "./slide-relayout";
import { createDocument, inches, type ElementId, type TextElement } from "../document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import { contrastRatio, contrastRatioAgainstLuminance } from "../rendering/contrast";
import { estimateTextLines, textLikelyOverflows } from "../rendering/text-fit";
import { VISUAL_ASSET_REQUEST_SIZE } from "./visual-asset";

describe("document commands", () => {
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

  it("applies AI template design without allowing it to rewrite approved content", () => {
    const source = createDocument();
    const content = { title: "已审核标题", body: "已审核正文", speakerNotes: "已审核备注" };
    const design = {
      layout: "cover" as const,
      background: "#112233",
      accent: "#FF6600",
      titleColor: "#FFFFFF",
      bodyColor: "#EEEEEE",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "设计文稿",
        slides: [content],
        designs: [design],
        fontFamily: "Arial",
      }),
    );
    expect(result.slides[0]!.content).toEqual({ ...content, status: "approved" });
    expect(result.slides[0]!.background).toBe("#112233");
    expect(result.slides[0]!.elements.map((element) => element.type)).toEqual(["shape", "shape", "text", "text"]);
    expect(result.slides[0]!.elements[2]).toMatchObject({
      type: "text",
      text: "已审核标题",
      style: { fontFamily: "Arial", fontSizePt: 63 },
    });
  });

  it("keeps display type on the headline and text type on running copy", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "字体",
        slides: [content],
        designs: [design],
        fontFamily: "Arial",
        bodyFontFamily: "Georgia",
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.title,
    );
    const body = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.body);
    expect(title?.type === "text" && title.style.fontFamily).toBe("Arial");
    expect(body?.type === "text" && body.style.fontFamily).toBe("Georgia");
  });

  it("places a generated picture on the page and moves the text out of its way", () => {
    const source = createDocument();
    const content = { title: "封面", body: "一句话副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      visualAsset: { enabled: true, prompt: "一座明亮的现代化数据中心", role: "hero" as const },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "配图",
        slides: [content],
        designs: [design],
        visualAssets: [
          {
            slideIndex: 0,
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png" as const,
            naturalWidth: 1600,
            naturalHeight: 900,
            altText: "现代化数据中心",
          },
        ],
      }),
    );
    const picture = result.slides[0]!.elements.find(
      (element): element is Extract<typeof element, { type: "image" }> => element.type === "image",
    );
    expect(picture).toBeDefined();
    expect(picture!.altText).toBe("现代化数据中心");
    // 图被裁成填满它的框，而不是被拉变形。
    expect(picture!.crop).toBeDefined();
    // 文字落在图的左边，两者不重叠。
    const titleElement = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.title,
    )!;
    expect(picture!.frame.x).toBeGreaterThan(titleElement.frame.x + titleElement.frame.width);
  });

  it("does not cut a picture whose proportions match the box it lands in", () => {
    // 生成的图按契约请求，图框也按同一个比例留：两者一致时不该裁掉画面。
    // 裁剪是"图比框宽/高"时才需要的补丁，不是常态。
    const source = createDocument();
    const content = { title: "封面", body: "一句话副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      visualAsset: { enabled: true, prompt: "一座明亮的现代化数据中心", role: "hero" as const },
    };
    const requested = VISUAL_ASSET_REQUEST_SIZE.hero;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "配图",
        slides: [content],
        designs: [design],
        visualAssets: [
          {
            slideIndex: 0,
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png" as const,
            naturalWidth: requested.width,
            naturalHeight: requested.height,
            altText: "现代化数据中心",
          },
        ],
      }),
    );
    const picture = result.slides[0]!.elements.find(
      (element): element is Extract<typeof element, { type: "image" }> => element.type === "image",
    );
    expect(picture).toBeDefined();
    expect(picture!.crop).toBeUndefined();
  });

  it("leaves the page alone when no picture was generated for it", () => {
    const source = createDocument();
    const content = { title: "封面", body: "一句话副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      visualAsset: { enabled: true, role: "hero" as const },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "配图", slides: [content], designs: [design] }),
    );
    expect(result.slides[0]!.elements.some((element) => element.type === "image")).toBe(false);
  });

  it("does not put a picture on a page whose content is a structured block", () => {
    const source = createDocument();
    const content = {
      title: "流程",
      body: "甲\n乙",
      speakerNotes: "",
      blocks: [
        {
          type: "process" as const,
          items: [
            { label: "甲", text: "第一步" },
            { label: "乙", text: "第二步" },
          ],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      visualAsset: { enabled: true, role: "side" as const },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "配图",
        slides: [content],
        designs: [design],
        visualAssets: [
          {
            slideIndex: 0,
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            mimeType: "image/png" as const,
            naturalWidth: 1024,
            naturalHeight: 1024,
            altText: "配图",
          },
        ],
      }),
    );
    // 内容块自己就是版面，再叠一张图会让这一页同时讲两件事。
    expect(result.slides[0]!.elements.some((element) => element.type === "image")).toBe(false);
  });

  it("draws the composition the design asked for instead of the one the layout implies", () => {
    const source = createDocument();
    const content = { title: "四个要点", body: "甲\n乙\n丙\n丁", speakerNotes: "" };
    const base = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const grid = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "构图", slides: [content], designs: [base] }),
    );
    const editorial = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "构图",
        slides: [content],
        designs: [{ ...base, composition: "editorial" as const }],
      }),
    );
    const texts = (result: typeof grid) =>
      result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    // A card grid draws a badge per card, an editorial page draws a numbered
    // column beside an anchor panel that carries the real count of the points.
    expect(texts(grid)).toContain("01");
    expect(texts(grid)).not.toContain("项要点");
    expect(texts(editorial)).toContain("项要点");
  });

  it("lets the design decide which level of the hierarchy carries the weight", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文", speakerNotes: "" };
    const base = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const balanced = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "层级", slides: [content], designs: [base] }),
    );
    const dominant = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "层级",
        slides: [content],
        designs: [{ ...base, emphasis: "title-dominant" as const }],
      }),
    );
    const sizeOf = (result: typeof balanced, text: string) => {
      const element = result.slides[0]!.elements.find(
        (candidate) => candidate.type === "text" && candidate.text === text,
      );
      return element?.type === "text" ? element.style.fontSizePt : 0;
    };
    expect(sizeOf(dominant, content.title)).toBeGreaterThan(sizeOf(balanced, content.title));
    expect(sizeOf(dominant, content.body)).toBeLessThan(sizeOf(balanced, content.body));
  });

  it("spends more or less white space on a page as the density target asks", () => {
    const source = createDocument();
    const content = { title: "密度", body: "甲\n乙\n丙\n丁", speakerNotes: "" };
    const base = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const airy = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "密度",
        slides: [content],
        designs: [{ ...base, densityTarget: "airy" as const }],
      }),
    );
    const compact = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "密度",
        slides: [content],
        designs: [{ ...base, densityTarget: "compact" as const }],
      }),
    );
    const secondRowTop = (result: typeof airy) => {
      const badge = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === "03");
      return badge?.type === "text" ? badge.frame.y : 0;
    };
    expect(secondRowTop(airy)).toBeGreaterThan(secondRowTop(compact));
  });

  it("整册里相邻页不再长成一个样", () => {
    const source = createDocument();
    const content = { title: "四个要点", body: "甲\n乙\n丙\n丁", speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "整册",
        slides: [content, content, content, content],
        designs: [design, design, design, design],
      }),
    );
    const texts = result.slides.map((slide) =>
      slide.elements.filter((element) => element.type === "text").map((element) => element.text),
    );
    // 三页同样的内容形状本来会得到三页一样的骨架。
    expect(texts[0]).toContain("01");
    expect(texts[0]).not.toContain("项要点");
    expect(texts[2]).toContain("项要点");
  });

  it("区域修复把指定位置的文字对齐到指定的轴线", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      elementRepairs: [
        {
          action: "align" as const,
          target: "region" as const,
          frame: { x: 0.3, y: 0.1, width: 0.5, height: 0.2 },
          axis: "left" as const,
        },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "区域", slides: [content], designs: [design] }),
    );
    const title = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.title,
    );
    expect(title?.type === "text" && title.frame.x).toBe(Math.round(0.3 * result.pageSize.width));
  });

  it("区域移动把整块内容按比例搬到目标位置", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      elementRepairs: [
        {
          action: "move" as const,
          target: "region" as const,
          frame: { x: 0.07, y: 0.12, width: 0.86, height: 0.1 },
          to: { x: 0.2, y: 0.3, width: 0.5, height: 0.08 },
        },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "区域", slides: [content], designs: [design] }),
    );
    const title = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.title,
    );
    expect(title?.type === "text" && title.frame.x).toBe(Math.round(0.2 * result.pageSize.width));
    expect(title?.type === "text" && title.frame.y).toBe(Math.round(0.3 * result.pageSize.height));
  });

  it("renders long multi-point title-body copy as a structured list instead of one stranded block", () => {
    const source = createDocument();
    const items = [
      "第一个要点需要完整保留背景、人物和事件之间的因果关系，不能为了卡片整齐而截断其中任何一句。这一段还需要保留完整的论述逻辑和上下文关系，方便读者连续理解。",
      "第二个要点说明作者回应了当时社会对政治改革和士人责任的核心争论，需要连续阅读。这一段还需要保留完整的论述逻辑和上下文关系，方便读者连续理解。",
      "第三个要点补充当时的社会环境、传播条件和读者接受方式，句子较长，不适合拆成短卡片。这一段还需要保留完整的论述逻辑和上下文关系，方便读者连续理解。",
      "第四个要点解释作品为什么采用这种形式和结构，并说明形式选择与表达目标之间的关系。这一段还需要保留完整的论述逻辑和上下文关系，方便读者连续理解。",
      "第五个要点概述作品后来产生的影响，以及它在不同历史阶段被重新解释和引用的方式。这一段还需要保留完整的论述逻辑和上下文关系，方便读者连续理解。",
    ];
    const content = {
      title: "作品背景",
      body: `1. ${items[0]}
2. ${items[1]}
3. ${items[2]}
4. ${items[3]}
5. ${items[4]}`,
      speakerNotes: "",
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "作品背景", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual([
      "作品背景",
      ...items.flatMap((item, index) => [String(index + 1).padStart(2, "0"), item]),
    ]);
    // The list fills the content area instead of shrinking into the top-left.
    const firstItem = texts[2]!;
    const lastItem = texts[texts.length - 1]!;
    expect(lastItem.frame.y).toBeGreaterThan(firstItem.frame.y);
    expect(lastItem.frame.y + lastItem.frame.height).toBeLessThanOrEqual(source.pageSize.height);
    expect(firstItem.frame.width).toBeGreaterThan(source.pageSize.width * 0.5);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("uses a bullet-list block as cards even when body is a short summary", () => {
    const source = createDocument();
    const content = {
      title: "三条结论",
      body: "本页用三条结论回答标题。",
      speakerNotes: "",
      blocks: [{ type: "bullet-list" as const, items: ["结论一", "结论二", "结论三"] }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "三条结论", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["三条结论", "01", "01", "结论一", "02", "结论二", "03", "结论三"]);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("turns a five-point page into an editorial list with a pull quote", () => {
    const source = createDocument();
    const content = {
      title: "原文赏析——第二段",
      body: "1. 总写洞庭湖全景\n2. '衔远山,吞长江,浩浩汤汤'\n3. 描写气象万千的景色\n4. 过渡到登楼览物之情\n5. '前人之述备矣'引出下文",
      speakerNotes: "",
      blocks: [
        {
          type: "bullet-list" as const,
          items: [
            "总写洞庭湖全景",
            "'衔远山,吞长江,浩浩汤汤'",
            "描写气象万千的景色",
            "过渡到登楼览物之情",
            "'前人之述备矣'引出下文",
          ],
        },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    content.blocks[0]!.items.forEach((item) => expect(texts).toContain(item));
    expect(texts).toContain("关键摘录");
    expect(result.slides[0]!.elements.every((element) => element.frame.width > 0 && element.frame.height > 0)).toBe(
      true,
    );
    const panel = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.x > result.pageSize.width * 0.5 &&
        element.frame.width > result.pageSize.width * 0.25 &&
        element.frame.height > result.pageSize.height * 0.4,
    );
    expect(panel).toBeDefined();
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("keeps a bullet list when the page also carries a quote block", () => {
    const source = createDocument();
    const items = ["第一项", "第二项", "第三项", "第四项", "第五项"];
    const content = {
      title: "重点摘录",
      body: items.join("\n"),
      speakerNotes: "",
      blocks: [
        { type: "quote" as const, text: "先天下之忧而忧" },
        { type: "bullet-list" as const, items },
      ],
    };
    const design = {
      layout: "quote" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "重点摘录", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    items.forEach((item) => expect(texts).toContain(item));
    expect(texts).toContain("先天下之忧而忧");
    expect(texts).toContain("关键摘录");
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("renders a quote block with its attribution instead of a plain paragraph", () => {
    const source = createDocument();
    const content = {
      title: "核心观点",
      body: "真正的理解来自实践。",
      speakerNotes: "",
      blocks: [{ type: "quote" as const, text: "真正的理解来自实践。", attribution: "作者" }],
    };
    const design = {
      layout: "quote" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "核心观点", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toContain("真正的理解来自实践。");
    expect(texts).toContain("— 作者");
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("renders numbered content as editable cards with deterministic geometry", () => {
    const source = createDocument();
    const content = { title: "三个重点", body: "1. 第一项 2. 第二项 3. 第三项", speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "卡片文稿", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual([
      "三个重点",
      "01",
      "01",
      "第一项",
      "02",
      "第二项",
      "03",
      "第三项",
    ]);
    const badge = result.slides[0]!.elements.find(
      (element) => element.type === "shape" && element.shape === "ellipse",
    )!;
    const firstItem = texts.find((element) => element.text === "第一项")!;
    // The badge sits above the copy; text must start below the badge instead
    // of painting over the numeral.
    expect(firstItem.frame.y).toBeGreaterThanOrEqual(badge.frame.y + badge.frame.height);
    // Card copy is running text, not a second headline; only the badge is bold.
    expect(firstItem.style.bold).toBe(false);
    expect(result.slides[0]!.elements.every((element) => element.frame.width > 0 && element.frame.height > 0)).toBe(
      true,
    );
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("keeps a one-line card as tall as its badge and copy", () => {
    const source = createDocument();
    const content = {
      title: "四个层次",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "bullet-list" as const,
          items: ["叙事：重修岳阳楼", "写景：洞庭全景", "抒情：悲喜二境", "议论：古仁人之心"],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "卡片文稿", slides: [content], designs: [design] }),
    );
    const badge = result.slides[0]!.elements.find(
      (element) => element.type === "shape" && element.shape === "ellipse",
    )!;
    const firstItem = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === "叙事：重修岳阳楼",
    )!;
    // The copy sits under the badge, not in the middle of a stretched card.
    const gap = firstItem.frame.y - (badge.frame.y + badge.frame.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(result.pageSize.height * 0.04);
    const card = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.shape === "rectangle" &&
        element.frame.width > result.pageSize.width * 0.3 &&
        element.frame.height > result.pageSize.height * 0.1 &&
        element.frame.height < result.pageSize.height * 0.3,
    )!;
    expect(card.frame.height).toBeLessThan(result.pageSize.height * 0.2);
  });

  it("prints the page number once when the footer already carries it", () => {
    const source = createDocument();
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      {
        title: "第一页",
        body: "",
        speakerNotes: "",
        blocks: [{ type: "bullet-list" as const, items: ["一", "二", "三", "四"] }],
      },
      { title: "第二页", body: "正文", speakerNotes: "" },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "课件",
        slides: pages,
        designs: [design, { ...design, layout: "title-body" as const }],
      }),
    );
    const topRight = result.slides[0]!.elements.filter(
      (element) =>
        element.type === "text" &&
        element.frame.x > result.pageSize.width * 0.85 &&
        element.frame.y < result.pageSize.height * 0.2,
    );
    expect(topRight).toHaveLength(0);
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 02")).toBe(
      true,
    );
  });

  it("renders a short summary list as an editorial page with a real point count", () => {
    const source = createDocument();
    const items = [
      "叙事、写景、抒情、议论相结合",
      "骈散结合,语言凝练优美",
      "对比手法突出主题思想",
      "引用典故丰富文化内涵",
      "千百年来激励无数仁人志士",
    ];
    const content = { title: "艺术特色与深远影响", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "summary" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const itemTexts = texts.filter((element) => items.includes(element.text));
    expect(itemTexts).toHaveLength(items.length);
    expect(itemTexts.every((element) => element.frame.width < source.pageSize.width * 0.4)).toBe(true);
    expect(texts.map((element) => element.text)).toContain("项要点");
    expect(texts.map((element) => element.text)).toContain("05");
    const panel = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.x > source.pageSize.width * 0.5 &&
        element.frame.width > source.pageSize.width * 0.25 &&
        element.frame.height > source.pageSize.height * 0.4,
    );
    expect(panel).toBeDefined();
    expect(result.slides[0]!.elements.every((element) => element.frame.width > 0 && element.frame.height > 0)).toBe(
      true,
    );
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("turns a short split page without a quote into an editorial point count", () => {
    const source = createDocument();
    const items = [
      "范仲淹因主张改革被贬邓州",
      "受好友滕子京之托撰写",
      "滕子京重修岳阳楼",
      "作者借题发挥寄托政治理想",
      "体现逆境中的豁达心态",
    ];
    const content = { title: "写作背景", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    items.forEach((item) => expect(texts).toContain(item));
    expect(texts).toContain("项要点");
    expect(texts.some((text) => text.startsWith("•"))).toBe(false);
    const panel = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.x > source.pageSize.width * 0.5 &&
        element.frame.width > source.pageSize.width * 0.25 &&
        element.frame.height > source.pageSize.height * 0.4,
    );
    expect(panel).toBeDefined();
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("turns a short split page with a quote into an editorial pull quote", () => {
    const source = createDocument();
    const items = [
      "总写洞庭湖全景",
      "'衔远山,吞长江,浩浩汤汤'",
      "描写气象万千的景色",
      "过渡到登楼览物之情",
      "'前人之述备矣'引出下文",
    ];
    const content = { title: "原文赏析——第二段", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    items.forEach((item) => expect(texts).toContain(item));
    expect(texts).toContain("关键摘录");
    expect(texts.some((text) => text.startsWith("•"))).toBe(false);
    const panel = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.x > source.pageSize.width * 0.5 &&
        element.frame.width > source.pageSize.width * 0.25 &&
        element.frame.height > source.pageSize.height * 0.4,
    );
    expect(panel).toBeDefined();
    // The canvas renderer uses 1.25 line height; the quote frame must be tall
    // enough for both wrapped lines instead of clipping the second one.
    const panelQuote = result.slides[0]!.elements.find(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" &&
        element.text.replace(/\s/g, "") === items[1] &&
        element.frame.x > source.pageSize.width * 0.5,
    )!;
    expect(
      estimateTextLines(panelQuote.text, panelQuote.frame.width / 12_700, panelQuote.style.fontSizePt) *
        panelQuote.style.fontSizePt *
        1.25,
    ).toBeLessThanOrEqual(panelQuote.frame.height / 12_700 + 0.5);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("turns a six-point short split page into cards instead of two sparse columns", () => {
    const source = createDocument();
    const items = ["第一项", "第二项", "第三项", "第四项", "第五项", "第六项"];
    const content = { title: "六个要点", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "六个要点", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    items.forEach((item) => expect(texts).toContain(item));
    expect(texts.some((text) => text.startsWith("•"))).toBe(false);
    expect(
      result.slides[0]!.elements.filter((element) => element.type === "shape" && element.shape === "ellipse"),
    ).toHaveLength(items.length);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("selects body template geometry for a short split page that becomes a point count", () => {
    const source = createDocument();
    const items = [
      "范仲淹因主张改革被贬邓州",
      "受好友滕子京之托撰写",
      "滕子京重修岳阳楼",
      "作者借题发挥寄托政治理想",
      "体现逆境中的豁达心态",
    ];
    const content = { title: "写作背景", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "正文",
        backgroundColor: "#FFFFFF",
        regions: [
          { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } },
        ],
      },
      {
        index: 2,
        name: "双栏",
        backgroundColor: "#F5F1E8",
        regions: [
          { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.36, height: 0.55 } },
          { role: "body" as const, frame: { x: 0.56, y: 0.28, width: 0.36, height: 0.55 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板匹配",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    expect(result.slides[0]!.background).toBe("#FFFFFF");
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "项要点")).toBe(
      true,
    );
  });

  it("uses valid text regions extracted from the selected PPTX template", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 1,
        regions: [
          { role: "title" as const, frame: { x: 0.12, y: 0.08, width: 0.7, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.18, y: 0.32, width: 0.6, height: 0.42 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板文稿",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.body,
    )!;
    expect(title.frame).toEqual({
      x: Math.round(source.pageSize.width * 0.12),
      y: Math.round(source.pageSize.height * 0.08),
      width: Math.round(source.pageSize.width * 0.7),
      height: Math.round(source.pageSize.height * 0.12),
    });
    expect(body.frame).toEqual({
      x: Math.round(source.pageSize.width * 0.18),
      y: Math.round(source.pageSize.height * 0.32),
      width: Math.round(source.pageSize.width * 0.6),
      height: Math.round(source.pageSize.height * 0.42),
    });
  });

  it("uses a content recipe on a template page while keeping its artwork", () => {
    const source = createDocument();
    const items = ["肿瘤早筛覆盖率提升", "三代测序渗透率上升", "临床指南更新加快"];
    const content = { title: "精准医疗重塑临床决策", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#273D79",
      bodyColor: "#4C4C4C",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "内页（浅色）",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
        ],
      },
    ];
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 3,
          shortItems: true,
          longestItemLength: 12,
          bodyLength: 40,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "title-body",
        },
      ],
      pageCount: 1,
      id: "template-recipe",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板配方",
        slides: [content],
        designs: [design],
        designConcept: concept,
        templateLayouts,
      }),
    );
    const slide = result.slides[0]!;
    const texts = slide.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(expect.arrayContaining(["01", "02", "03", ...items]));
    // The template artwork is still the page background.
    expect(
      slide.elements.some(
        (element) =>
          element.type === "image" &&
          element.source.kind === "embedded" &&
          element.source.dataUrl === templateLayouts[0]!.backgroundImageDataUrl,
      ),
    ).toBe(true);
    // The template owns the header line, so the recipe must not draw a second
    // accent rule under the title.
    expect(
      slide.elements.some(
        (element) =>
          element.type === "shape" &&
          element.style.fill === "#3366CC" &&
          element.frame.width >= source.pageSize.width * 0.1 &&
          element.frame.width <= source.pageSize.width * 0.13 &&
          element.frame.height <= inches(0.02),
      ),
    ).toBe(false);
  });

  it("uses the data story on a template metric page", () => {
    const source = createDocument();
    const content = {
      title: "三年关键指标",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "年检测样本量", value: "38万" },
        { type: "metric" as const, label: "合作医院", value: "260+" },
        { type: "metric" as const, label: "平均交付周期", value: "5天" },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#273D79",
      bodyColor: "#4C4C4C",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "内页（浅色）",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
        ],
      },
    ];
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 0,
          shortItems: true,
          longestItemLength: 0,
          bodyLength: 0,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: true,
          hasMetric: true,
          layout: "cards",
        },
      ],
      pageCount: 1,
      id: "template-metric",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板指标",
        slides: [content],
        designs: [design],
        designConcept: concept,
        templateLayouts,
      }),
    );
    const slide = result.slides[0]!;
    const values = slide.elements.filter(
      (element): element is TextElement => element.type === "text" && element.contentBlockRef?.field === "value",
    );
    const labels = slide.elements.filter(
      (element): element is TextElement => element.type === "text" && element.contentBlockRef?.field === "label",
    );
    expect(values).toHaveLength(3);
    expect(labels).toHaveLength(3);
    values.forEach((value, index) => {
      const label = labels[index]!;
      expect((label.frame.y - (value.frame.y + value.frame.height)) / source.pageSize.height).toBeLessThan(0.05);
    });
    expect(
      slide.elements.some(
        (element) =>
          element.type === "image" &&
          element.source.kind === "embedded" &&
          element.source.dataUrl === templateLayouts[0]!.backgroundImageDataUrl,
      ),
    ).toBe(true);
  });

  it("uses the process rail on a template page", () => {
    const source = createDocument();
    const content = {
      title: "标准交付流程",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "process" as const,
          items: [
            { label: "样本前处理", text: "48 小时内完成建库" },
            { label: "上机测序", text: "Illumina NovaSeq 平台" },
            { label: "生信分析", text: "自动化流程与人工复核" },
            { label: "报告交付", text: "临床级报告与解读" },
          ],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#273D79",
      bodyColor: "#4C4C4C",
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 0,
          shortItems: true,
          longestItemLength: 0,
          bodyLength: 0,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: true,
          hasProcess: true,
          layout: "cards",
        },
      ],
      pageCount: 1,
      id: "template-process",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "流程",
        slides: [content],
        designs: [design],
        designConcept: concept,
        templateLayouts: [
          {
            index: 1,
            name: "内页（浅色）",
            backgroundImageDataUrl: "data:image/png;base64,AAAA",
            regions: [
              { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
              { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
            ],
          },
        ],
      }),
    );
    const slide = result.slides[0]!;
    const texts = slide.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(
      expect.arrayContaining(["01", "02", "03", "04", "样本前处理", "报告交付"]),
    );
    const nodes = slide.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");
    expect(nodes).toHaveLength(4);
    expect(slide.elements.some((element) => element.type === "image" && element.source.kind === "embedded")).toBe(true);
  });

  it("uses the comparison recipe for a comparison block", () => {
    const source = createDocument();
    const content = {
      title: "两种合作模式对比",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "comparison" as const,
          leftLabel: "自建实验室",
          rightLabel: "委托检测",
          leftItems: ["长期成本更低", "数据完全自主", "需 6 个月建设期"],
          rightItems: ["启动快", "无需设备投入", "依赖外部排期"],
        },
      ],
    };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#1E3550",
      bodyColor: "#5F6B76",
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 6,
          shortItems: true,
          longestItemLength: 12,
          bodyLength: 0,
          hasQuote: false,
          hasComparison: true,
          hasRowBlock: false,
          layout: "split",
        },
      ],
      pageCount: 1,
      id: "comparison",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "对比",
        slides: [content],
        designs: [design],
        designConcept: concept,
      }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(
      expect.arrayContaining(["自建实验室", "委托检测", "长期成本更低", "启动快"]),
    );
    expect(texts.map((element) => element.text)).not.toContain("VS");
    expect(result.slides[0]!.elements.some((element) => element.type === "shape" && element.shape === "ellipse")).toBe(
      false,
    );
  });

  it("uses the timeline rail for a timeline block", () => {
    const source = createDocument();
    const content = {
      title: "公司发展历程",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "timeline" as const,
          items: [
            { label: "2018", text: "公司成立" },
            { label: "2020", text: "自建平台" },
            { label: "2021", text: "医院破百" },
            { label: "2023", text: "样本超 30 万" },
            { label: "2025", text: "三代产品线" },
          ],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#1E3550",
      bodyColor: "#5F6B76",
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 5,
          shortItems: true,
          longestItemLength: 8,
          bodyLength: 0,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: true,
          hasTimeline: true,
          layout: "cards",
        },
      ],
      pageCount: 1,
      id: "timeline",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "时间线",
        slides: [content],
        designs: [design],
        designConcept: concept,
      }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(
      expect.arrayContaining(["2018", "2025", "公司成立", "三代产品线"]),
    );
    expect(
      result.slides[0]!.elements.filter((element) => element.type === "shape" && element.shape === "ellipse"),
    ).toHaveLength(5);
  });

  it("uses the quote field for a quote page", () => {
    const source = createDocument();
    const content = {
      title: "岳阳楼记",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "quote" as const,
          text: "先天下之忧而忧，后天下之乐而乐。",
          attribution: "范仲淹",
        },
      ],
    };
    const design = {
      layout: "quote" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#1E3550",
      bodyColor: "#5F6B76",
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 1,
          shortItems: true,
          longestItemLength: 18,
          bodyLength: 0,
          hasQuote: true,
          hasComparison: false,
          hasRowBlock: false,
          layout: "quote",
        },
      ],
      pageCount: 1,
      id: "quote",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "引文",
        slides: [content],
        designs: [design],
        designConcept: concept,
      }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(
      expect.arrayContaining(["“", "先天下之忧而忧，后天下之乐而乐。", "— 范仲淹"]),
    );
  });

  it("uses the template picture placeholder for an image-led page", () => {
    const source = createDocument();
    const content = {
      title: "精准医疗的视觉证据",
      body: "肿瘤早筛覆盖率提升\n三代测序渗透率上升\n临床指南更新加快",
      speakerNotes: "",
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#1E3550",
      bodyColor: "#5F6B76",
      visualAsset: { enabled: true, role: "side" as const },
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 3,
          shortItems: true,
          longestItemLength: 12,
          bodyLength: 40,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "cards",
        },
      ],
      pageCount: 1,
      id: "template-image",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "图文",
        slides: [content],
        designs: [design],
        designConcept: concept,
        visualAssets: [
          {
            slideIndex: 0,
            dataUrl:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
            mimeType: "image/png" as const,
            naturalWidth: 1024,
            naturalHeight: 512,
            altText: "模板图位",
          },
        ],
        templateLayouts: [
          {
            index: 21,
            name: "图文页",
            backgroundImageDataUrl: "data:image/png;base64,AAAA",
            regions: [
              { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.45, height: 0.08 } },
              { role: "body" as const, frame: { x: 0.052, y: 0.2, width: 0.44, height: 0.6 } },
              { role: "image" as const, frame: { x: 0.54, y: 0.12, width: 0.4, height: 0.7 } },
            ],
          },
        ],
      }),
    );
    const image = result.slides[0]!.elements.find(
      (element) => element.type === "image" && element.placement === "content",
    );
    expect(image?.type).toBe("image");
    expect(image?.type === "image" ? image.frame : undefined).toEqual({
      x: Math.round(source.pageSize.width * 0.54),
      y: Math.round(source.pageSize.height * 0.12),
      width: Math.round(source.pageSize.width * 0.4),
      height: Math.round(source.pageSize.height * 0.7),
    });
    expect(
      result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "肿瘤早筛覆盖率提升"),
    ).toBe(true);
  });

  it("compiles a design plan and lays a takeover surface over template cards", () => {
    const source = createDocument();
    const content = {
      title: "反垄断裁决与 AI 资本开支，将主导 Alphabet 下一财年的估值走向",
      body: [
        "美国与欧盟反垄断诉讼可能改变搜索与 Android 分发模式",
        "AI 数据中心与芯片投入将推高资本开支，压制短期利润率",
        "搜索广告与云收入仍是估值的基本锚点",
        "生成式 AI 商业化进度决定长期估值溢价",
      ].join("\n"),
      speakerNotes: "",
    };
    const design = {
      layout: "split" as const,
      background: "#486A67",
      accent: "#B08A2E",
      titleColor: "#FFFFFF",
      bodyColor: "#293241",
      designPlan: {
        role: "claim" as const,
        composition: { primitive: "split" as const, ratio: 0.38 },
        density: "normal" as const,
        templatePolicy: "takeover" as const,
        recipe: "asymmetric-split" as const,
      },
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 4,
          shortItems: false,
          longestItemLength: 30,
          bodyLength: 0,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "split",
        },
      ],
      pageCount: 1,
      id: "plan",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "Alphabet 估值",
        slides: [content],
        designs: [design],
        designConcept: concept,
        templateLayouts: [
          {
            index: 11,
            name: "内页",
            backgroundImageDataUrl: "data:image/png;base64,AAAA",
            regions: [
              {
                role: "title" as const,
                frame: { x: 0.052, y: 0.03, width: 0.8, height: 0.08 },
                textColor: "#FFFFFF",
              },
              {
                role: "body" as const,
                frame: { x: 0.08, y: 0.22, width: 0.84, height: 0.62 },
                textColor: "#293241",
              },
            ],
          },
        ],
      }),
    );
    const surface = result.slides[0]!.elements.find(
      (element) => element.type === "shape" && element.style.fill === "#486A67",
    );
    expect(surface?.type).toBe("shape");
    expect(surface?.type === "shape" ? surface.frame.width / source.pageSize.width : 0).toBeGreaterThan(0.8);
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.body.split("\n")[2],
    )!;
    // The template body ink was chosen for white cards; the takeover surface is
    // dark, so the compiler must flip the body copy to a light ink.
    expect(body.style.color).not.toBe("#293241");
    expect(result.slides[0]!.content.title).toBe(content.title);
  });

  it("uses the section statement for a chapter page", () => {
    const source = createDocument();
    const content = {
      title: "第二部分 交付能力",
      body: "从样本前处理到报告解读的完整链路。",
      speakerNotes: "",
    };
    const design = {
      layout: "section" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#1E3550",
      bodyColor: "#5F6B76",
    };
    const concept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 1,
          shortItems: true,
          longestItemLength: 16,
          bodyLength: 20,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "section",
        },
      ],
      pageCount: 1,
      id: "section",
    }).concept;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "章节",
        slides: [content],
        designs: [design],
        designConcept: concept,
      }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(expect.arrayContaining(["01", content.title, content.body]));
    expect(result.slides[0]!.elements.some((element) => element.type === "shape")).toBe(true);
  });

  it("rejects overlapping template regions for split layouts", () => {
    const source = createDocument();
    const content = { title: "双栏", body: "1. 左侧内容 2. 右侧内容", speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 1,
        regions: [
          { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.8, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.05, y: 0.25, width: 0.7, height: 0.5 } },
          { role: "body" as const, frame: { x: 0.3, y: 0.25, width: 0.65, height: 0.5 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "安全双栏",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const bodies = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" && element.text !== content.title && !/^\d+$/.test(element.text),
    );
    expect(bodies[0]!.frame.x + bodies[0]!.frame.width).toBeLessThanOrEqual(bodies[1]!.frame.x);
    expect(bodies.every((element) => element.frame.y + element.frame.height <= source.pageSize.height)).toBe(true);
  });

  it("rejects a template layout whose title overlaps its body", () => {
    const source = createDocument();
    const content = { title: "不能重叠的标题", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "损坏版式",
        regions: [
          { role: "title" as const, frame: { x: 0.1, y: 0.35, width: 0.7, height: 0.2 } },
          { role: "body" as const, frame: { x: 0.08, y: 0.3, width: 0.82, height: 0.5 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "安全回退",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.body,
    )!;
    expect(title.frame.y + title.frame.height).toBeLessThanOrEqual(body.frame.y);
  });

  it("selects a semantic template layout and adopts its background", () => {
    const source = createDocument();
    const content = { title: "方案对比", body: "左侧\n右侧", speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "标题和内容",
        backgroundColor: "#FFFFFF",
        regions: [
          { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } },
        ],
      },
      {
        index: 2,
        name: "双栏比较",
        backgroundColor: "#F5F1E8",
        regions: [
          { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.36, height: 0.55 } },
          { role: "body" as const, frame: { x: 0.56, y: 0.28, width: 0.36, height: 0.55 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板匹配",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    expect(result.slides[0]!.background).toBe("#F5F1E8");
    const bodies = result.slides[0]!.elements.filter(
      (element): element is TextElement =>
        element.type === "text" && element.text !== content.title && element.text !== "•",
    );
    expect(bodies).toHaveLength(2);
    // The copy is inset inside the column card, past the marker gutter, so it
    // starts just right of the slot edge rather than exactly on it.
    expect(bodies[0]!.frame.x).toBeGreaterThanOrEqual(Math.round(source.pageSize.width * 0.11));
    expect(bodies[0]!.frame.x).toBeLessThan(Math.round(source.pageSize.width * 0.16));
    expect(bodies[1]!.frame.x).toBeGreaterThanOrEqual(Math.round(source.pageSize.width * 0.59));
    expect(bodies[1]!.frame.x).toBeLessThan(Math.round(source.pageSize.width * 0.64));
  });

  it("places a rendered complex template layout behind editable content", () => {
    const source = createDocument();
    const content = { title: "可编辑标题", body: "可编辑正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const backgroundImageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const templateLayouts = [
      {
        index: 1,
        name: "标题和内容",
        backgroundImageDataUrl,
        regions: [
          { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
          { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "复杂模板",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    expect(result.slides[0]!.elements[0]).toMatchObject({
      type: "image",
      locked: true,
      source: { dataUrl: backgroundImageDataUrl },
    });
    expect(
      result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text),
    ).toEqual([content.title, content.body]);
  });

  it("creates controlled visual rhythm across equally suitable semantic backgrounds", () => {
    const source = createDocument();
    const slides = [
      { title: "第一页", body: "正文一", speakerNotes: "" },
      { title: "第二页", body: "正文二", speakerNotes: "" },
    ];
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const regionSet = [
      { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
      { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } },
    ];
    const templateLayouts = [
      { index: 1, name: "正文甲", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: regionSet },
      { index: 2, name: "正文乙", backgroundImageDataUrl: "data:image/png;base64,BBBB", regions: regionSet },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "多版式",
        slides,
        designs: [design, design],
        templateLayouts,
      }),
    );
    const backgrounds = result.slides.map((slide) => slide.elements.find((element) => element.type === "image"));
    expect(backgrounds[0]).toMatchObject({
      type: "image",
      source: { dataUrl: templateLayouts[0]!.backgroundImageDataUrl },
    });
    expect(backgrounds[1]).toMatchObject({
      type: "image",
      source: { dataUrl: templateLayouts[1]!.backgroundImageDataUrl },
    });
    const titleFrames = result.slides.map(
      (slide, slideIndex) =>
        slide.elements.find((element) => element.type === "text" && element.text === slides[slideIndex]!.title)!.frame,
    );
    expect(titleFrames[1]).toEqual(titleFrames[0]);
  });

  it("renders timeline blocks without parsing the body string", () => {
    const source = createDocument();
    const content = {
      title: "里程碑",
      body: "这段正文不应驱动时间线",
      speakerNotes: "",
      blocks: [
        {
          type: "timeline" as const,
          items: [
            { label: "第一阶段", text: "调研" },
            { label: "第二阶段", text: "交付" },
          ],
        },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "时间线", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["里程碑", "第一阶段", "调研", "第二阶段", "交付"]);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("keeps timeline copy on its own side of the line", () => {
    const source = createDocument();
    const steps = [
      { label: "宋代以降", text: "成为士人立身行事的常见表述" },
      { label: "明清诗文", text: "常化用为抒怀言志的典故" },
      { label: "政治语境", text: "被引为治国理政与官员操守" },
      { label: "近代以来", text: "成为担当精神与公仆意识表达" },
    ];
    const content = {
      title: "先忧后乐",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "timeline" as const, items: steps }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "时间线", slides: [content], designs: [design] }),
    );
    const elements = result.slides[0]!.elements;
    const line = elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.width > result.pageSize.width * 0.5 &&
        element.frame.height < result.pageSize.height * 0.02,
    )!;
    const lineTop = line.frame.y;
    const lineBottom = line.frame.y + line.frame.height;
    for (const element of elements) {
      if (element.type !== "text" || element.text === content.title) continue;
      const top = element.frame.y;
      const bottom = element.frame.y + element.frame.height;
      expect(bottom <= lineTop || top >= lineBottom).toBe(true);
    }
  });

  it("renders comparison blocks as two labeled editable columns", () => {
    const source = createDocument();
    const content = {
      title: "方案对比",
      body: "保留的审核正文",
      speakerNotes: "",
      blocks: [
        {
          type: "comparison" as const,
          leftLabel: "方案 A",
          rightLabel: "方案 B",
          leftItems: ["稳定"],
          rightItems: ["快速"],
        },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["方案对比", "方案 A", "• 稳定", "方案 B", "• 快速"]);
  });

  it("keeps every reviewed point of a comparison column instead of cutting the last ones", () => {
    const source = createDocument();
    const leftItems = Array.from({ length: 8 }, (_, index) => `左${index + 1}`);
    const rightItems = Array.from({ length: 8 }, (_, index) => `右${index + 1}`);
    const content = {
      title: "方案对比",
      body: "保留的审核正文",
      speakerNotes: "",
      blocks: [{ type: "comparison" as const, leftLabel: "方案 A", rightLabel: "方案 B", leftItems, rightItems }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比", slides: [content], designs: [design] }),
    );
    const copy = result.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const item of [...leftItems, ...rightItems]) expect(copy).toContain(item);
  });

  it("fills a sparse comparison page instead of stranding the cards in its upper third", () => {
    const source = createDocument();
    const content = {
      title: "由景及人：一悲一喜，两境对照",
      body: "保留的审核正文",
      speakerNotes: "",
      blocks: [
        {
          type: "comparison" as const,
          leftLabel: "览阴而生悲",
          rightLabel: "览晴而生喜",
          leftItems: ["登斯楼，去国怀乡，忧谗畏讥", "满目萧然，感极而悲者矣"],
          rightItems: ["登斯楼，心旷神怡，宠辱偕忘", "把酒临风，其喜洋洋者矣"],
        },
      ],
    };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const pageHeight = result.pageSize.height;
    const panels = result.slides[0]!.elements.filter(
      (element) =>
        element.type === "shape" &&
        element.frame.width > result.pageSize.width * 0.4 &&
        element.frame.height > pageHeight * 0.2,
    );
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      const height = panel.frame.height / pageHeight;
      const top = panel.frame.y / pageHeight;
      const center = top + height / 2;
      // A panel carries at least its share of the content area, and the block
      // sits around the middle of the page instead of under the title.
      expect(height).toBeGreaterThan(0.3);
      expect(center).toBeGreaterThan(0.53);
    }
  });

  it("keeps the comparison label a step larger than the points it heads", () => {
    const source = createDocument();
    const content = {
      title: "方案对比",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "comparison" as const,
          leftLabel: "方案 A",
          rightLabel: "方案 B",
          leftItems: ["稳定"],
          rightItems: ["快速"],
        },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const label = texts.find((element) => element.text === "方案 A");
    const point = texts.find((element) => element.text === "• 稳定");
    expect(label?.style.fontSizePt).toBeGreaterThanOrEqual((point?.style.fontSizePt ?? 0) * 1.2);
  });

  it("keeps a card's copy inside its card when a repair moves the region", () => {
    const source = createDocument();
    const content = {
      title: "岳阳楼记",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "comparison" as const,
          leftLabel: "览阴而生悲",
          rightLabel: "览晴而生喜",
          leftItems: ["登斯楼，去国怀乡，忧谗畏讥"],
          rightItems: ["登斯楼，心旷神怡，宠辱偕忘"],
        },
      ],
    };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
      elementRepairs: [
        {
          action: "move" as const,
          target: "region" as const,
          frame: { x: 0.05, y: 0.36, width: 0.42, height: 0.14 },
          to: { x: 0.05, y: 0.8, width: 0.42, height: 0.14 },
        },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比", slides: [content], designs: [design] }),
    );
    const elements = result.slides[0]!.elements;
    const label = elements.find((element) => element.type === "text" && element.text === "览阴而生悲")!;
    const contained = (text: (typeof elements)[number]) =>
      elements.some(
        (element) =>
          element.type === "shape" &&
          text.frame.x >= element.frame.x - 9144 &&
          text.frame.y >= element.frame.y - 9144 &&
          text.frame.x + text.frame.width <= element.frame.x + element.frame.width + 9144 &&
          text.frame.y + text.frame.height <= element.frame.y + element.frame.height + 9144,
      );
    expect(contained(label)).toBe(true);
    for (const text of elements.filter((element) => element.type === "text" && element.contentRef !== "title")) {
      expect(contained(text)).toBe(true);
    }
  });

  it("keeps a cover title readable when the template probe describes artwork that is not painted", () => {
    const source = createDocument();
    const content = {
      title: "《岳阳楼记》是中国古代以记为论文章的典范之作",
      body: "以文体辨识为入口，以精神理解为目标。",
      speakerNotes: "",
    };
    const design = {
      layout: "cover" as const,
      background: "#D3D3D3",
      accent: "#0F7869",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
    };
    const layout = {
      index: 0,
      name: "封面",
      backgroundColor: "#D3D3D3",
      backgroundLuminance: { title: { darkest: 0.03, lightest: 0.18 }, body: { darkest: 0.03, lightest: 0.18 } },
      regions: [
        { role: "title" as const, frame: { x: 0.08, y: 0.34, width: 0.84, height: 0.17 } },
        { role: "body" as const, frame: { x: 0.08, y: 0.58, width: 0.75, height: 0.17 } },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "封面",
        slides: [content],
        designs: [design],
        templateLayouts: [layout],
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    expect(contrastRatio(title.style.color, "#D3D3D3")!).toBeGreaterThanOrEqual(3);
  });

  it("refits a title that a repair enlarged instead of letting it overflow", () => {
    const source = createDocument();
    const content = { title: "范仲淹兼具政治家与文学家双重身份是理解本文前提的完整论述", body: "", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      hierarchyAction: "strengthen-title" as const,
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    expect(textLikelyOverflows(title)).toBe(false);
  });

  it("uses the type scale a theme declares", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateTheme = {
      name: "青编",
      majorFont: "华文中宋",
      minorFont: "微软雅黑",
      colors: [{ name: "accent", value: "#0F7869" }],
      textStyles: {
        display: { fontSizePt: 44 },
        title: { fontSizePt: 26 },
        body: { fontSizePt: 16 },
        caption: { fontSizePt: 10 },
      },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "字号",
        slides: [content],
        designs: [design],
        templateTheme,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.body,
    )!;
    expect(title.style.fontSizePt).toBe(26);
    expect(body.style.fontSizePt).toBe(16);
    expect(result.theme?.textStyles?.title?.fontSizePt).toBe(26);
  });

  it("falls back to a built-in preset when no template is selected", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "预设",
        slides: [content],
        designs: [design],
        themePresetId: "paper-ink",
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.body,
    )!;
    expect(result.theme?.name).toBe("纸墨");
    expect(title.style.fontSizePt).toBe(30);
    expect(body.style.fontSizePt).toBe(16);
  });

  it("paints a chosen preset's palette and fonts", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#123456",
      accent: "#123456",
      titleColor: "#123456",
      bodyColor: "#123456",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "预设",
        slides: [content],
        designs: [design],
        themePresetId: "paper-ink",
      }),
    );
    const slide = result.slides[0]!;
    const title = slide.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = slide.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.body,
    )!;
    expect(slide.background).toBe("#FBFAF7");
    expect(title.style.fontFamily).toBe("华文中宋");
    expect(body.style.fontFamily).toBe("微软雅黑");
    expect(title.style.color).toBe("#1E2A32");
    expect(title.style.letterSpacingPt).toBe(0.8);
    expect(slide.elements.some((element) => element.type === "shape" && element.style.fill === "#2F6B5F")).toBe(true);
    expect(contrastRatio(body.style.color, slide.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body copy inside its frame with the preset leading", () => {
    const source = createDocument();
    const body = "登斯楼也，则有去国怀乡，忧谗畏讥，满目萧然，感极而悲者矣。".repeat(4);
    const content = { title: "览物之情", body, speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "字距",
        slides: [content],
        designs: [design],
        themePresetId: "paper-ink",
      }),
    );
    const slide = result.slides[0]!;
    for (const element of slide.elements) {
      if (element.type === "text") expect(textLikelyOverflows(element)).toBe(false);
    }
    const bodyElement = slide.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === body,
    )!;
    expect(bodyElement.style.lineHeight).toBe(1.3);
  });

  it("lets an explicitly chosen preset restyle a template deck", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateTheme = {
      name: "模板",
      majorFont: "微软雅黑",
      minorFont: "微软雅黑",
      colors: [],
      textStyles: { title: { fontSizePt: 22 }, body: { fontSizePt: 14 } },
    };
    const templateLayouts = [
      {
        index: 0,
        name: "内页",
        regions: [
          { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 }, fontSizePt: 22 },
          { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 }, fontSizePt: 14 },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "预设",
        slides: [content],
        designs: [design],
        templateTheme,
        templateLayouts,
        themePresetId: "warm-paper",
      }),
    );
    const slide = result.slides[0]!;
    const title = slide.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    expect(result.theme?.name).toBe("素纸");
    expect(title.style.fontFamily).toBe("华文中宋");
    expect(title.style.fontSizePt).toBe(32);
    expect(slide.elements.some((element) => element.type === "shape" && element.style.fill === "#A8642E")).toBe(true);
  });

  it("keeps the template's white cover ink when a preset is applied", () => {
    const source = createDocument();
    const content = { title: "封面标题", body: "副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateTheme = {
      name: "模板",
      majorFont: "微软雅黑",
      minorFont: "微软雅黑",
      colors: [],
    };
    const templateLayouts = [
      {
        index: 0,
        name: "封面",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.084, y: 0.34, width: 0.832, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 66,
          },
          {
            role: "body" as const,
            frame: { x: 0.125, y: 0.589, width: 0.75, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 28,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "封面",
        slides: [content],
        designs: [design],
        templateTheme,
        templateLayouts,
        themePresetId: "warm-paper",
      }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    const title = texts.find((element) => element.text === content.title)!;
    const body = texts.find((element) => element.text === content.body)!;
    // The template set white ink on a dark cover. Applying a preset must not
    // flip that ink to the preset's dark primary because the page colour is
    // white while the artwork is not sampled.
    expect(title.style.color).toBe("#FFFFFF");
    expect(body.style.color).toBe("#FFFFFF");
  });

  it("paints a local scrim with the page colour instead of the design background", () => {
    const source = createDocument();
    const content = { title: "页", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#1A1A1A",
      accent: "#0F7869",
      titleColor: "#FFFFFF",
      bodyColor: "#DCE3EA",
      backgroundTreatment: "local-scrim" as const,
    };
    const layout = {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      regions: [
        { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 } },
        { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 } },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "页",
        slides: [content],
        designs: [design],
        templateLayouts: [layout],
      }),
    );
    const large = result.slides[0]!.elements.filter(
      (element) =>
        element.type === "shape" &&
        element.frame.width > result.pageSize.width * 0.4 &&
        element.frame.height > result.pageSize.height * 0.3,
    );
    expect(large.some((element) => element.type === "shape" && element.style.fill === "#1A1A1A")).toBe(false);
  });

  it("keeps the footer readable over artwork whose probe is dark", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const layout = {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      backgroundLuminance: { title: { darkest: 0.02, lightest: 0.12 }, body: { darkest: 0.02, lightest: 0.12 } },
      regions: [
        { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 } },
        { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 } },
      ],
    };
    const pages = [
      { title: "第一页", body: "正文", speakerNotes: "" },
      { title: "第二页", body: "正文", speakerNotes: "" },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "课件",
        slides: pages,
        designs: [design, design],
        templateLayouts: [layout],
      }),
    );
    const footer = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === "01 / 02",
    )!;
    expect(contrastRatio(footer.style.color, "#FFFFFF")!).toBeGreaterThanOrEqual(4.5);
  });

  it("draws split columns as cards instead of bare text", () => {
    const source = createDocument();
    const items = [
      "滕子京因事被贬，出任岳州巴陵郡地方官",
      "到任后主持重修岳阳楼，使旧迹重光",
      "滕子京以书信形式嘱托范仲淹为新楼作记，并附上洞庭湖的图景与修建始末，请他以文字记下这件事并寄托自己的政治理想与人生感慨",
      "范仲淹应嘱作文，遂成《岳阳楼记》",
    ];
    const content = { title: "写作缘起", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#0F7869",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "分层", slides: [content], designs: [design] }),
    );
    const cards = result.slides[0]!.elements.filter(
      (element) => element.type === "shape" && element.style.fill === "#F3F5F7",
    );
    expect(cards).toHaveLength(2);
  });

  it("numbers the pages of a generated deck but not a one-page draft or a cover", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      { title: "第一页", body: "第一页正文", speakerNotes: "" },
      { title: "第二页", body: "第二页正文", speakerNotes: "" },
    ];
    const deck = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "岳阳楼记",
        slides: pages,
        designs: [design, design],
      }),
    );
    const textsOf = (index: number) =>
      deck.slides[index]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(textsOf(0)).toContain("01 / 02");
    expect(textsOf(1)).toContain("02 / 02");
    expect(textsOf(0)).toContain("岳阳楼记");

    const single = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "单页", slides: [pages[0]!], designs: [design] }),
    );
    expect(single.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 01")).toBe(
      false,
    );

    const cover = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "封面",
        slides: pages,
        designs: [{ ...design, layout: "cover" as const }, design],
      }),
    );
    expect(cover.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 02")).toBe(
      false,
    );
  });

  it("names the section the page belongs to in the footer", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      { title: "第一部分 洞庭湖", body: "", speakerNotes: "" },
      { title: "岳阳楼记", body: "正文", speakerNotes: "" },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "教学课件",
        slides: pages,
        designs: [{ ...design, layout: "section" as const }, design],
      }),
    );
    const footer = result.slides[1]!.elements.flatMap((element) =>
      element.type === "text" && element.frame.y > result.pageSize.height * 0.9 ? [element.text] : [],
    );
    expect(footer).toEqual(["第一部分 洞庭湖", "02 / 02"]);
  });

  it("leaves the page number to a template that already prints one", () => {
    const source = createDocument();
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const pages = [
      { title: "第一页", body: "第一页正文", speakerNotes: "" },
      { title: "第二页", body: "第二页正文", speakerNotes: "" },
    ];
    const layout = {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      regions: [
        { role: "title" as const, frame: { x: 0.07, y: 0.08, width: 0.86, height: 0.1 } },
        { role: "body" as const, frame: { x: 0.07, y: 0.22, width: 0.86, height: 0.6 } },
        { role: "body" as const, frame: { x: 0.86, y: 0.93, width: 0.08, height: 0.035 } },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板页脚",
        slides: pages,
        designs: [design, design],
        templateLayouts: [layout],
      }),
    );
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "01 / 02")).toBe(
      false,
    );
  });

  it("drops a small ornament that runs across the title and keeps a panel that carries the page", () => {
    const source = createDocument();
    const content = { title: "岳阳楼记", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const decorations = [
      { shape: "rectangle" as const, fill: "#FF00AA", frame: { x: 0.06, y: 0.12, width: 0.03, height: 0.05 } },
      { shape: "rectangle" as const, fill: "#EEF2F6", frame: { x: 0, y: 0, width: 0.12, height: 1 } },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "装饰",
        slides: [content],
        designs: [design],
        templateDecorations: decorations,
      }),
    );
    const fills = result.slides[0]!.elements.filter((element) => element.type === "shape").map(
      (element) => element.style.fill,
    );
    expect(fills).not.toContain("#FF00AA");
    expect(fills).toContain("#EEF2F6");
  });

  it("keeps the rail numeral and the pull quote above running copy", () => {
    const source = createDocument();
    const items = [
      "总写洞庭湖全景",
      "'衔远山，吞长江，浩浩汤汤'",
      "描写气象万千的景色",
      "过渡到登楼览物之情",
      "'前人之述备矣'",
    ];
    const content = {
      title: "原文赏析",
      body: items.join("\n"),
      speakerNotes: "",
      blocks: [
        { type: "quote" as const, text: "先天下之忧而忧，后天下之乐而乐" },
        { type: "bullet-list" as const, items },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const number = texts.find((element) => element.text === "01");
    const point = texts.find((element) => element.text === items[0]);
    expect(number?.style.fontSizePt).toBeGreaterThanOrEqual((point?.style.fontSizePt ?? 0) * 1.15);
    const quote = texts.find((element) => element.text.includes("先天下"));
    expect(quote?.style.fontSizePt).toBeGreaterThanOrEqual(18);
  });

  it("keeps every reviewed step of a timeline and of a process", () => {
    const source = createDocument();
    const steps = Array.from({ length: 8 }, (_, index) => ({ label: `阶段${index + 1}`, text: `说明${index + 1}` }));
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const timeline = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "时间线",
        slides: [
          { title: "里程碑", body: "", speakerNotes: "", blocks: [{ type: "timeline" as const, items: steps }] },
        ],
        designs: [design],
      }),
    );
    const timelineCopy = timeline.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const step of steps) {
      expect(timelineCopy).toContain(step.label);
      expect(timelineCopy).toContain(step.text);
    }

    const process = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "流程",
        slides: [
          { title: "实施流程", body: "", speakerNotes: "", blocks: [{ type: "process" as const, items: steps }] },
        ],
        designs: [design],
      }),
    );
    const processCopy = process.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const step of steps) {
      expect(processCopy).toContain(step.label);
      expect(processCopy).toContain(step.text);
    }
  });

  it("keeps every reviewed metric of a page", () => {
    const source = createDocument();
    const units = ["%", "万", "人", "单", "天", "次", "项"];
    const metrics = Array.from({ length: 7 }, (_, index) => ({
      type: "metric" as const,
      label: `指标${index + 1}`,
      value: `${index + 1}${units[index]}`,
    }));
    const content = { title: "核心指标", body: "指标说明", speakerNotes: "", blocks: metrics };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const copy = result.slides[0]!.elements.filter((element) => element.type === "text")
      .map((element) => element.text)
      .join("\n");
    for (const metric of metrics) {
      expect(copy).toContain(metric.label);
      expect(copy).toContain(metric.value);
    }
  });

  it("keeps every reviewed metric of a page that is drawn as a chart", () => {
    const source = createDocument();
    const metrics = Array.from({ length: 7 }, (_, index) => ({
      type: "metric" as const,
      label: `指标${index + 1}`,
      value: `${index + 1}%`,
    }));
    const content = { title: "核心指标", body: "", speakerNotes: "", blocks: metrics };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const chart = result.slides[0]!.elements.find((element) => element.type === "chart");
    const blocks = result.slides[0]!.content.blocks ?? [];
    expect(chart?.type === "chart" && chart.contentBlockIds).toEqual(
      blocks.filter((block) => block.type === "metric").map((block) => block.id),
    );
  });

  it("renders metric blocks as value-first cards", () => {
    const source = createDocument();
    const content = {
      title: "核心指标",
      body: "指标说明",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "增长率", value: "42%" },
        { type: "metric" as const, label: "客户数", value: "120" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["核心指标", "42%", "增长率", "120", "客户数"]);
  });

  it("links each stat card to the reviewed metric it draws", () => {
    const source = createDocument();
    const content = {
      title: "核心指标",
      body: "指标说明",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "增长率", value: "42%" },
        { type: "metric" as const, label: "客户数", value: "120" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }),
    );
    const slide = result.slides[0]!;
    const metricIds = slide.content.blocks?.filter((block) => block.type === "metric").map((block) => block.id) ?? [];
    const linked = slide.elements.filter(
      (element): element is TextElement => element.type === "text" && Boolean(element.contentBlockRef),
    );
    // Without the link the card is just two strings and editing it would leave
    // the reviewed number behind.
    expect(linked).toHaveLength(4);
    expect(linked.map((element) => element.contentBlockRef!.blockId)).toEqual([
      metricIds[0],
      metricIds[0],
      metricIds[1],
      metricIds[1],
    ]);
    expect(linked.map((element) => element.contentBlockRef!.field)).toEqual(["value", "label", "value", "label"]);
    expect(linked.map((element) => element.text)).toEqual(["42%", "增长率", "120", "客户数"]);
  });

  it("renders process blocks as numbered native-object steps", () => {
    const source = createDocument();
    const content = {
      title: "实施流程",
      body: "审核正文",
      speakerNotes: "",
      blocks: [
        {
          type: "process" as const,
          items: [
            { label: "分析", text: "确认目标" },
            { label: "执行", text: "完成交付" },
          ],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "流程", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map(
      (element) => element.text,
    );
    expect(texts).toEqual(["实施流程", "1", "分析", "确认目标", "2", "执行", "完成交付"]);
    expect(result.slides[0]!.elements.every((element) => element.type === "text" || element.type === "shape")).toBe(
      true,
    );
  });

  it("does not silently drop points when a cards layout receives more than six", () => {
    const source = createDocument();
    const body = Array.from({ length: 7 }, (_, index) => `${index + 1}. 第${index + 1}个要点`).join("\n");
    const content = { title: "七个要点", body, speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "七个要点", slides: [content], designs: [design] }),
    );
    const copy = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> => element.type === "text",
    )
      .map((element) => element.text)
      .join("\n");
    for (let index = 1; index <= 7; index += 1) expect(copy).toContain(`第${index}个要点`);
    expect(result.slides[0]!.content.body).toBe(body);
  });

  it("sets the two columns on one baseline with a hanging indent per point", () => {
    const source = createDocument();
    const items = [
      "近年多次进行组织架构调整，AI相关业务被独立或前置",
      "高管汇报关系与考核权重明显向智能云、大模型、自动驾驶倾斜",
      "销售与商业化资源在内部预算分配中逐步让位于AI基础设施建设",
      "人员招聘与人才激励的重点明显向AI研发岗位集中",
      "组织层面的优先级重排是判断战略转型真实性的关键信号",
    ];
    const content = { title: "组织架构调整", body: items.join("\n"), speakerNotes: "" };
    const design = {
      layout: "split" as const,
      composition: "columns" as const,
      background: "#FFFFFF",
      accent: "#B08A2E",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "组织", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
    const markers = texts.filter((element) => element.text === "•");
    const copies = texts.filter((element) => element.text !== content.title && element.text !== "•");
    expect(markers).toHaveLength(items.length);
    expect(copies).toHaveLength(items.length);
    // A card body is read, not shouted: the old 26pt ceiling read as a poster.
    expect(copies.every((element) => element.style.fontSizePt <= 20)).toBe(true);
    expect(markers.every((element) => element.style.fontSizePt <= 14)).toBe(true);
    // A 30+ character title at 40pt turns into three lines and eats the page.
    const heading = texts.find((element) => element.text === content.title)!;
    expect(heading.style.fontSizePt).toBeLessThanOrEqual(30);
    // The lead clause is bold, the predicate stays regular: hierarchy inside a
    // card without rewriting the reviewed sentence. Points without a natural
    // subject/predicate split keep one uniform run.
    const emphasized = copies.filter((element) => element.runs?.[0]?.start === 0);
    expect(emphasized.length).toBeGreaterThan(0);
    expect(emphasized.every((element) => (element.runs?.[0]?.end ?? 0) < element.text.length)).toBe(true);
    // The cut is chosen to balance the two columns by height, so both columns
    // carry points and their first rows sit on one baseline.
    const columns = [
      copies.filter((element) => element.frame.x + element.frame.width / 2 < source.pageSize.width / 2),
      copies.filter((element) => element.frame.x + element.frame.width / 2 >= source.pageSize.width / 2),
    ];
    expect(columns[0]!.length).toBeGreaterThan(0);
    expect(columns[1]!.length).toBeGreaterThan(0);
    expect(columns[0]![0]!.frame.y).toBe(columns[1]![0]!.frame.y);
    // 悬挂缩进：文字从标记右侧开始，换行后不会再退回标记下面。
    expect(columns[0]![0]!.frame.x).toBeGreaterThan(markers[0]!.frame.x);
    // 行距均匀：相邻两行的间距不因原来的空行而翻倍。
    const longest = columns[0]!.length >= columns[1]!.length ? columns[0]! : columns[1]!;
    expect(longest.length).toBeGreaterThanOrEqual(3);
    const firstGap = longest[1]!.frame.y - (longest[0]!.frame.y + longest[0]!.frame.height);
    const secondGap = longest[2]!.frame.y - (longest[1]!.frame.y + longest[1]!.frame.height);
    expect(firstGap).toBeGreaterThan(0);
    expect(Math.abs(firstGap - secondGap)).toBeLessThanOrEqual(2000);
    // 中缝不再立一根比卡片还高的装饰线。
    const divider = result.slides[0]!.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.width < source.pageSize.width * 0.02 &&
        element.frame.height > source.pageSize.height * 0.4 &&
        element.frame.x > source.pageSize.width * 0.45 &&
        element.frame.x < source.pageSize.width * 0.55,
    );
    expect(divider).toBeUndefined();
  });

  it("keeps an explicitly requested split layout instead of forcing numbered text into cards", () => {
    const source = createDocument();
    const longItem =
      "这是一个用于验证中文文本框宽度估算和自动字号适配的较长段落，不能越过双栏边界覆盖另一列内容，并需要保留完整上下文";
    const content = {
      title: "排版检查",
      body: `1. ${longItem}\n2. ${longItem}\n3. ${longItem}\n4. ${longItem}`,
      speakerNotes: "",
    };
    const design = {
      layout: "split" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "自动适配", slides: [content], designs: [design] }),
    );
    const bodies = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" &&
        element.text !== content.title &&
        element.text !== "•" &&
        !/^\d+$/.test(element.text),
    );
    // Two columns, four points: every point is its own text frame so a wrapped
    // point keeps its hanging indent instead of running back under the marker.
    expect(bodies).toHaveLength(4);
    // The copy may grow into the room the column has, but never to display size.
    expect(bodies.every((element) => element.style.fontSizePt <= 26 && element.style.fontSizePt >= 12)).toBe(true);
    for (const [bodyIndex, body] of bodies.entries()) {
      expect(
        bodies
          .slice(bodyIndex + 1)
          .every(
            (candidate) =>
              body.frame.x + body.frame.width <= candidate.frame.x ||
              candidate.frame.x + candidate.frame.width <= body.frame.x ||
              body.frame.y + body.frame.height <= candidate.frame.y ||
              candidate.frame.y + candidate.frame.height <= body.frame.y,
          ),
      ).toBe(true);
    }
  });

  it("centers an incomplete final card row on the shared alignment grid", () => {
    const source = createDocument();
    const content = {
      title: "五项重点",
      body: "1. 第一项\n2. 第二项\n3. 第三项\n4. 第四项\n5. 第五项",
      speakerNotes: "",
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "视觉对齐", slides: [content], designs: [design] }),
    );
    const labels = result.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" && /^第[一二三四五]项$/.test(element.text),
    );
    expect(labels).toHaveLength(5);
    expect(labels[3]!.frame.x).toBeGreaterThan(labels[0]!.frame.x);
    expect(labels[4]!.frame.x + labels[4]!.frame.width).toBeLessThan(labels[2]!.frame.x + labels[2]!.frame.width);
    expect(labels[3]!.frame.y).toBe(labels[4]!.frame.y);
  });

  it("places editable content inside a vision-recommended safe region", () => {
    const source = createDocument();
    const content = { title: "避开模板标志", body: "正文位于视觉模型识别的留白区域", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#234567",
      accent: "#22AA99",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
      safeRegion: { x: 0.28, y: 0.18, width: 0.64, height: 0.68 },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "安全区", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts[0]!.frame.x).toBe(Math.round(source.pageSize.width * design.safeRegion.x));
    expect(texts.every((element) => element.frame.x >= Math.round(source.pageSize.width * design.safeRegion.x))).toBe(
      true,
    );
    expect(
      texts.every(
        (element) =>
          element.frame.x + element.frame.width <=
          Math.round(source.pageSize.width * (design.safeRegion.x + design.safeRegion.width)) + 1,
      ),
    ).toBe(true);
  });

  it("places editable text on the placeholder geometry of the rendered template layout", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.119, width: 0.423, height: 0.046 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板文稿",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.body,
    )!;
    expect(title.frame).toEqual({
      x: Math.round(source.pageSize.width * 0.052),
      y: Math.round(source.pageSize.height * 0.03),
      width: Math.round(source.pageSize.width * 0.799),
      height: Math.round(source.pageSize.height * 0.059),
    });
    // The largest body region carries the copy, not the short subtitle placeholder.
    expect(body.frame).toEqual({
      x: Math.round(source.pageSize.width * 0.052),
      y: Math.round(source.pageSize.height * 0.222),
      width: Math.round(source.pageSize.width * 0.897),
      height: Math.round(source.pageSize.height * 0.621),
    });
  });

  it("keeps the template artwork visible instead of covering the page with a panel", () => {
    const source = createDocument();
    const content = { title: "对比度修复", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      backgroundTreatment: "local-scrim" as const,
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板文稿",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const shapes = result.slides[0]!.elements.filter((element) => element.type === "shape");
    expect(shapes.length).toBeGreaterThan(0);
    // The scrim hugs the text block; it must never become a full page sheet.
    expect(
      shapes.every(
        (shape) =>
          shape.frame.width < source.pageSize.width * 0.98 && shape.frame.height < source.pageSize.height * 0.98,
      ),
    ).toBe(true);
    expect(result.slides[0]!.elements[0]).toMatchObject({ type: "image" });
  });

  it("uses the ink and the size the template assigned to its placeholders", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 },
            textColor: "#273D79",
            fontSizePt: 26,
          },
          {
            role: "body" as const,
            frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 },
            textColor: "#999A9A",
            fontSizePt: 18,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板文稿",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const body = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.body,
    )!;
    expect(title.type === "text" && title.style.color).toBe("#273D79");
    expect(title.type === "text" && title.style.fontSizePt).toBe(26);
    expect(body.type === "text" && body.style.fontSizePt).toBe(18);
    // The template body grey is too light to read, so the ink is corrected while
    // the template's own size and geometry stay in place.
    expect(body.type === "text" && body.style.color).not.toBe("#999A9A");
    expect(body.type === "text" && contrastRatio(body.style.color, "#FFFFFF")!).toBeGreaterThanOrEqual(4.5);
  });

  it("repairs text that would be unreadable on the page it is placed on", () => {
    const source = createDocument();
    const content = { title: "浅底白字", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比度", slides: [content], designs: [design] }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(
      texts.every((element) => element.type === "text" && contrastRatio(element.style.color, "#FFFFFF")! >= 4.5),
    ).toBe(true);
    // The title keeps more weight than the body so the page keeps a hierarchy.
    expect(texts[0]!.type === "text" && texts[0]!.style.color).not.toBe(
      texts[1]!.type === "text" && texts[1]!.style.color,
    );
  });

  it("rotates the template artwork across pages instead of repeating one layout", () => {
    const source = createDocument();
    const slides = [
      { title: "第一页", body: "正文一", speakerNotes: "" },
      { title: "第二页", body: "正文二", speakerNotes: "" },
      { title: "第三页", body: "正文三", speakerNotes: "" },
    ];
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const regionSet = [
      { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
    ];
    const templateLayouts = [
      { index: 11, name: "内页（浅色）1", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: regionSet },
      { index: 13, name: "内页（浅色）3", backgroundImageDataUrl: "data:image/png;base64,BBBB", regions: regionSet },
      { index: 14, name: "内页（深色）1", backgroundImageDataUrl: "data:image/png;base64,CCCC", regions: regionSet },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "多版式",
        slides,
        designs: [design, design, design],
        templateLayouts,
      }),
    );
    const backgrounds = result.slides.map((slide) => slide.elements.find((element) => element.type === "image"));
    expect(backgrounds.map((element) => (element?.type === "image" ? element.source.dataUrl : undefined))).toEqual([
      templateLayouts[0]!.backgroundImageDataUrl,
      templateLayouts[1]!.backgroundImageDataUrl,
      templateLayouts[2]!.backgroundImageDataUrl,
    ]);
  });

  it("keeps a CJK headline on one line inside the template title box", () => {
    const source = createDocument();
    const content = { title: "昆佰泰基因测序整体解决方案", body: "副标题", speakerNotes: "" };
    const design = {
      layout: "cover" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
    };
    const templateLayouts = [
      {
        index: 1,
        name: "封面1",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.084, y: 0.34, width: 0.832, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 66,
          },
          {
            role: "body" as const,
            frame: { x: 0.125, y: 0.589, width: 0.75, height: 0.167 },
            textColor: "#FFFFFF",
            fontSizePt: 28,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "标题",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    const widthPt = title.frame.width / 12_700;
    // A CJK glyph fills a full em, so thirteen characters need thirteen times
    // the font size. Measuring them narrower let the line wrap and pushed the
    // second line into the artwork below the headline.
    expect(title.type === "text" && title.style.fontSizePt * content.title.length).toBeLessThanOrEqual(widthPt);
    expect(estimateTextLines(content.title, widthPt, title.type === "text" ? title.style.fontSizePt : 0)).toBe(1);
  });

  it("keeps the ink readable across every patch of artwork that carries it", () => {
    const source = createDocument();
    const content = { title: "深色版式", body: "正文内容", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 14,
        name: "内页（深色）1",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        backgroundLuminance: {
          title: { darkest: 0.3947, lightest: 0.5795 },
          body: { darkest: 0.3993, lightest: 0.612 },
        },
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.052, y: 0.03, width: 0.806, height: 0.059 },
            textColor: "#FFFFFF",
            fontSizePt: 26,
          },
          {
            role: "body" as const,
            frame: { x: 0.052, y: 0.225, width: 0.897, height: 0.621 },
            textColor: "#FFFFFF",
            fontSizePt: 18,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "标题",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const range = templateLayouts[0]!.backgroundLuminance!.title!;
    // The template asks for white, which cannot carry the text on that teal
    // artwork. The ink has to hold on the darkest and on the lightest patch.
    expect(texts.every((element) => element.type === "text" && element.style.color !== "#FFFFFF")).toBe(true);
    expect(
      texts.every(
        (element) => element.type === "text" && contrastRatioAgainstLuminance(element.style.color, range.darkest)! >= 3,
      ),
    ).toBe(true);
  });

  it("lets a design override the ink the template assigned to its placeholders", () => {
    const source = createDocument();
    const content = { title: "覆盖墨色", body: "正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#101010",
      bodyColor: "#202020",
      inkOverride: true,
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        backgroundImageDataUrl: "data:image/png;base64,AAAA",
        regions: [
          {
            role: "title" as const,
            frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 },
            textColor: "#273D79",
            fontSizePt: 26,
          },
          {
            role: "body" as const,
            frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 },
            textColor: "#999A9A",
            fontSizePt: 18,
          },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "标题",
        slides: [content],
        designs: [design],
        templateLayouts,
      }),
    );
    const title = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.text === content.title,
    )!;
    // Without the override the template ink wins, so a repair could never
    // change the colour of a template page.
    expect(title.type === "text" && title.style.color).toBe("#101010");
  });

  it("deepens a badge fill so the numerals stay readable on it", () => {
    const source = createDocument();
    const content = { title: "要点", body: "1. 第一项优势\n2. 第二项优势", speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#15A590",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const badge = result.slides[0]!.elements.find((element) => element.type === "shape" && element.shape === "ellipse");
    const numeral = result.slides[0]!.elements.find(
      (element) =>
        element.type === "text" && element.text === "01" && element.frame.width < source.pageSize.width * 0.04,
    );
    expect(badge?.type === "shape" && contrastRatio("#FFFFFF", badge.style.fill)!).toBeGreaterThanOrEqual(4.5);
    expect(numeral?.type === "text" && numeral.style.color).toBe("#FFFFFF");
  });

  it("sizes a stat card to the number and the label it carries", () => {
    const source = createDocument();
    const content = {
      title: "关键指标",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "metric" as const, label: "年检测样本量", value: "38万" }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const value = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === "38万");
    const label = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === "年检测样本量",
    );
    const card = result.slides[0]!.elements.find(
      (element) => element.type === "shape" && element.frame.width > source.pageSize.width * 0.5,
    );
    expect(card?.type === "shape").toBe(true);
    // The card used to stretch over the whole content region and left the
    // label stranded at the bottom of an empty panel.
    expect(card!.type === "shape" && card!.frame.height).toBeLessThan(source.pageSize.height * 0.3);
    expect(value!.type === "text" && label!.type === "text" && value!.frame.y).toBeGreaterThan(card!.frame.y);
    expect(label!.type === "text" && label!.frame.y + label!.frame.height).toBeLessThanOrEqual(
      card!.frame.y + card!.frame.height,
    );
  });

  it("binds the page to the template layout and keeps the artwork as the layout background", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const templateLayouts = [
      {
        index: 11,
        name: "内页（浅色）1",
        backgroundColor: "#FFFFFF",
        backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        regions: [
          { role: "title" as const, frame: { x: 0.052, y: 0.03, width: 0.799, height: 0.059 } },
          { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
        ],
      },
    ];
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "apply-ai-designed-draft",
        title: "模板文稿",
        slides: [content],
        designs: [design],
        templateLayouts,
        templateTheme: {
          name: "昆佰泰",
          majorFont: "思源黑体",
          minorFont: "思源宋体",
          colors: [{ name: "accent1", value: "#C04A32" }],
        },
      }),
    );
    // The layout is kept, so the exported file can carry it as a slide master.
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts![0]!.name).toBe("内页（浅色）1");
    expect(result.slides[0]!.layoutId).toBe(result.layouts![0]!.id);
    // The artwork belongs to the layout, not to the page.
    const artwork = result.slides[0]!.elements.find((element) => element.type === "image");
    expect(artwork?.type === "image" && artwork.placement).toBe("layout-background");
    expect(result.theme).toEqual({
      name: "昆佰泰",
      majorFont: "思源黑体",
      minorFont: "思源宋体",
      colors: [{ name: "accent1", value: "#C04A32" }],
    });
  });

  it("draws metrics of the same unit as a native chart instead of loose cards", () => {
    const source = createDocument();
    const content = {
      title: "关键指标",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "年检测样本量", value: "38万" },
        { type: "metric" as const, label: "覆盖机构", value: "12万" },
        { type: "metric" as const, label: "出具报告", value: "6万" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const chart = result.slides[0]!.elements.find((element) => element.type === "chart");
    expect(chart?.type === "chart").toBe(true);
    // The chart points at the reviewed metric blocks instead of copying them.
    const blocks = result.slides[0]!.content.blocks ?? [];
    expect(chart!.type === "chart" && chart!.contentBlockIds).toEqual(
      blocks.filter((block) => block.type === "metric").map((block) => block.id),
    );
    // The stat cards are gone: the page carries one chart instead of boxes
    // with the same numbers.
    expect(
      result.slides[0]!.elements.filter(
        (element) => element.type === "shape" && element.frame.width > source.pageSize.width * 0.2,
      ),
    ).toHaveLength(0);
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "38万")).toBe(
      false,
    );
  });

  it("lets the plan type scale change the title size", () => {
    const source = createDocument();
    const content = {
      title: "短标题",
      body: "第一句正文。\n第二句正文。\n第三句正文。",
      speakerNotes: "",
      blocks: [],
    };
    const design = (typeScale: "compact" | "normal" | "expressive") => ({
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      designPlan: {
        role: "claim" as const,
        composition: { primitive: "stack" as const },
        density: "normal" as const,
        typeScale,
        templatePolicy: "use" as const,
        recipe: "asymmetric-split" as const,
      },
    });
    const resolved = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [
        {
          itemCount: 3,
          shortItems: true,
          longestItemLength: 6,
          bodyLength: 20,
          hasQuote: false,
          hasComparison: false,
          hasRowBlock: false,
          layout: "title-body",
        },
      ],
      pageCount: 1,
      id: "type-scale-test",
    });
    const titleSize = (typeScale: "compact" | "normal" | "expressive") => {
      const result = produce(source, (draft) =>
        applyCommand(draft, {
          type: "apply-ai-designed-draft",
          title: "标题",
          slides: [content],
          designs: [design(typeScale)],
          designConcept: resolved.concept,
        }),
      );
      const title = [...result.slides[0]!.elements]
        .reverse()
        .find((element) => element.type === "text" && element.contentRef === "title");
      return title?.type === "text" ? title.style.fontSizePt : 0;
    };
    expect(titleSize("compact")).toBeLessThan(titleSize("normal"));
    expect(titleSize("expressive")).toBeGreaterThan(titleSize("normal"));
  });

  it("lets the data relation override an incompatible chart type", () => {
    const source = createDocument();
    const content = {
      title: "季度趋势",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "第一季度", value: "38" },
        { type: "metric" as const, label: "第二季度", value: "52" },
        { type: "metric" as const, label: "第三季度", value: "61" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
      designPlan: {
        role: "claim" as const,
        composition: { primitive: "stack" as const },
        density: "normal" as const,
        templatePolicy: "use" as const,
        // The model asked for a pie, but the page is about change over time.
        chart: { kind: "pie" as const, relation: "change" as const },
      },
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const chart = result.slides[0]!.elements.find((element) => element.type === "chart");
    expect(chart?.type === "chart" && chart.kind).toBe("line");
  });

  it("keeps the stat cards when the metrics do not share one unit", () => {
    const source = createDocument();
    const content = {
      title: "关键指标",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric" as const, label: "年检测样本量", value: "38万" },
        { type: "metric" as const, label: "年度增长率", value: "12%" },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    expect(result.slides[0]!.elements.some((element) => element.type === "chart")).toBe(false);
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "38万")).toBe(true);
  });

  it("draws a table block as a native table that points at the reviewed cells", () => {
    const source = createDocument();
    const content = {
      title: "检测能力",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "table-data" as const,
          header: ["项目", "数量"],
          rows: [
            ["样本量", "38万"],
            ["覆盖机构", "12万"],
          ],
        },
      ],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const table = result.slides[0]!.elements.find((element) => element.type === "table");
    expect(table?.type === "table").toBe(true);
    // The table holds no cells of its own: it points at the reviewed block, so
    // the exported grid can never show a cell the content does not carry.
    const blocks = result.slides[0]!.content.blocks ?? [];
    expect(table!.type === "table" && table!.contentBlockId).toBe(
      blocks.find((block) => block.type === "table-data")?.id,
    );
    // The cells are not copied into loose text boxes either.
    expect(result.slides[0]!.elements.some((element) => element.type === "text" && element.text === "38万")).toBe(
      false,
    );
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("duplicates a page with a native table and keeps the copy pointing at its own cells", () => {
    const source = createDocument();
    const content = {
      title: "检测能力",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "table-data" as const, header: ["项目", "数量"], rows: [["样本量", "38万"]] }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const designed = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const result = produce(designed, (draft) =>
      applyCommand(draft, { type: "duplicate-slide", slideId: designed.slides[0]!.id }),
    );
    const original = designed.slides[0]!.elements.find((element) => element.type === "table")!;
    const copy = result.slides[1]!.elements.find((element) => element.type === "table")!;
    expect(copy.id).not.toBe(original.id);
    // The copy points at the table block of its own page, not at the original.
    expect(copy.type === "table" && copy.contentBlockId).toBe(
      result.slides[1]!.content.blocks?.find((block) => block.type === "table-data")?.id,
    );
  });

  it("shrinks a text that overflows so it fits into its frame and keeps the copy frozen", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type !== "text") throw new Error("expected a text element");
    title.text = "一段很长的标题需要放进同一个文本框里所以它必须换行很多次";
    const originalHash = slide.content.contentHash;
    const before = title.style.fontSizePt;
    expect(textLikelyOverflows(title)).toBe(true);

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "fit-text", slideId: slide.id, elementId: title.id }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.style.fontSizePt).toBeLessThan(before);
    // The text now fits, so the quality gate stops reporting an overflow.
    expect(element.type === "text" && textLikelyOverflows(element)).toBe(false);
    // Fitting is design: the copy and the review state stay.
    expect(result.slides[0]!.content.contentHash).toBe(originalHash);
    expect(result.slides[0]!.content.status).toBe(source.slides[0]!.content.status);
  });

  it("keeps the size of a text that already fits", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const before = title.type === "text" ? title.style.fontSizePt : 0;
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "fit-text", slideId: slide.id, elementId: title.id }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.style.fontSizePt).toBe(before);
  });

  it("emphasises a range of a text without touching the approved copy", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 2,
        style: { bold: true },
      }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.runs).toEqual([{ start: 0, end: 2, bold: true }]);
    // The copy is content and the emphasis is design: the text itself does not
    // move and the content hash stays the same.
    expect(element.type === "text" && element.text).toBe(title.type === "text" ? title.text : "");
    expect(result.slides[0]!.content.contentHash).toBe(source.slides[0]!.content.contentHash);
  });

  it("clears the emphasis of a range and keeps the rest of the text", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const emphasised = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 4,
        style: { bold: true },
      }),
    );
    const result = produce(emphasised, (draft) =>
      applyCommand(draft, { type: "clear-text-emphasis", slideId: slide.id, elementId: title.id, start: 0, end: 2 }),
    );
    const element = result.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.runs).toEqual([{ start: 2, end: 4, bold: true }]);
  });

  it("drops the emphasis when the copy of the text changes", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const emphasised = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 2,
        style: { bold: true },
      }),
    );
    const result = produce(emphasised, (draft) =>
      applyCommand(draft, { type: "edit-text", slideId: slide.id, elementId: title.id, text: "新的标题" }),
    );
    const element = result.slides[0]!.elements[0]!;
    // The fragments addressed the old copy, so they would point at other words
    // now. Dropping them keeps the emphasis honest.
    expect(element.type === "text" && element.runs).toBeUndefined();
    expect(element.type === "text" && element.text).toBe("新的标题");
  });

  it("refuses an emphasis that leaves the text", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const command = {
      type: "set-text-emphasis" as const,
      slideId: slide.id,
      elementId: title.id,
      start: 0,
      end: 999,
      style: { bold: true },
    };
    expect(commandDomain(command)).toBe("design");
    expect(() => produce(source, (draft) => applyCommand(draft, command))).toThrow("INVALID_TEXT_EMPHASIS");
  });

  it("keeps the table cells in the content so a design command cannot rewrite them", () => {
    const source = createDocument();
    const content = {
      title: "检测能力",
      body: "",
      speakerNotes: "",
      blocks: [{ type: "table-data" as const, header: ["项目", "数量"], rows: [["样本量", "38万"]] }],
    };
    const design = {
      layout: "title-body" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }),
    );
    const cells = (result.slides[0]!.content.blocks ?? []).find((block) => block.type === "table-data");
    expect(cells?.type === "table-data" && cells.rows[0]?.[1]).toBe("38万");
    // The element keeps no copy of the cells, so the grid cannot drift away
    // from the reviewed table.
    const table = result.slides[0]!.elements.find((element) => element.type === "table");
    expect(JSON.stringify(table)).not.toContain("38万");
    expect(JSON.stringify(table)).not.toContain("样本量");
  });

  it("marks generated layout elements and user additions with provenance", () => {
    const source = createDocument();
    const content = { title: "三个重点", body: "第一项\n第二项\n第三项", speakerNotes: "" };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#3366CC",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const generated = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "卡片", slides: [content], designs: [design] }),
    );
    expect(generated.slides[0]!.elements.every((element) => element.origin === "generated")).toBe(true);

    const withUser = produce(generated, (draft) =>
      applyCommand(draft, { type: "add-text", slideId: generated.slides[0]!.id }),
    );
    expect(withUser.slides[0]!.elements.at(-1)!.origin).toBe("user");
  });

  it("re-lays out a legacy split page as a count page without touching content or user objects", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const items = [
      "范仲淹因主张改革被贬邓州",
      "受好友滕子京之托撰写",
      "滕子京重修岳阳楼",
      "作者借题发挥寄托政治理想",
      "体现逆境中的豁达心态",
    ];
    slide.content = { title: "写作背景", body: items.join("\n"), speakerNotes: "讲稿", status: "approved" };
    const title = slide.elements[0]!;
    if (title.type === "text") {
      title.text = "写作背景";
      title.contentRef = "title";
      title.frame = { x: inches(0.8), y: inches(0.5), width: inches(8.5), height: inches(0.8) };
    }
    const bodyStyle = {
      fontFamily: "Microsoft YaHei",
      fontSizePt: 20,
      color: "#30343A",
      bold: false,
      align: "left" as const,
    };
    slide.elements.push(
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "body",
        text: items.slice(0, 3).join("\n\n"),
        frame: { x: inches(0.8), y: inches(1.8), width: inches(5.2), height: inches(3.4) },
        rotationMilliDegree: 0,
        locked: false,
        style: bodyStyle,
      },
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "body",
        text: items.slice(3).join("\n\n"),
        frame: { x: inches(6.8), y: inches(1.8), width: inches(5.2), height: inches(3.4) },
        rotationMilliDegree: 0,
        locked: false,
        style: bodyStyle,
      },
      {
        id: crypto.randomUUID() as never,
        type: "image",
        frame: { x: inches(10.2), y: inches(5.8), width: inches(1.2), height: inches(0.8) },
        rotationMilliDegree: 0,
        locked: false,
        source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
        altText: "手工图片",
      },
      {
        id: crypto.randomUUID() as never,
        type: "text",
        contentRef: "decorative",
        text: "手工标注",
        frame: { x: inches(1.1), y: inches(6.4), width: inches(2.6), height: inches(0.35) },
        rotationMilliDegree: 0,
        locked: false,
        style: { ...bodyStyle, fontSizePt: 14, bold: true },
      },
    );
    const contentBefore = JSON.stringify(slide.content);
    const imageId = slide.elements.find((element) => element.type === "image")!.id;
    const noteId = slide.elements.find((element) => element.type === "text" && element.text === "手工标注")!.id;
    // The picture and the note were added by hand, so the relayout has to keep
    // them and rebuild only what the page generated.
    const classified = classifyRelayoutElements(slide);
    expect(classified.preserved.some((element) => element.id === imageId)).toBe(true);
    expect(classified.preserved.some((element) => element.id === noteId)).toBe(true);
    expect(inferRelayoutContext(slide, source).templateLayout).toBeDefined();
    const command = { type: "relayout-slide" as const, slideId: slide.id };
    expect(commandDomain(command)).toBe("design");
    const result = produce(source, (draft) => applyCommand(draft, command));
    const resultSlide = result.slides[0]!;
    expect(JSON.stringify(resultSlide.content)).toBe(contentBefore);
    expect(resultSlide.elements.some((element) => element.id === imageId)).toBe(true);
    expect(
      resultSlide.elements.some(
        (element) => element.id === noteId && element.type === "text" && element.text === "手工标注",
      ),
    ).toBe(true);
    expect(resultSlide.elements.some((element) => element.type === "text" && element.text === "项要点")).toBe(true);
    expect(resultSlide.elements.filter((element) => element.origin === "user").length).toBeGreaterThanOrEqual(2);
    expect(resultSlide.layoutId).toBeDefined();
    expect(result.layouts?.some((layout) => layout.id === resultSlide.layoutId)).toBe(true);
  });
});

describe("手工路径的 AI 配图", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const bodyStyle = {
    fontFamily: "Microsoft YaHei",
    fontSizePt: 20,
    color: "#30343A",
    bold: false,
    align: "left" as const,
  };

  /** 一页有标题和一整块正文的页面。 */
  function pageWithBody() {
    const source = createDocument();
    source.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "text",
      contentRef: "body",
      text: "正文内容",
      frame: { x: inches(0.8), y: inches(1.8), width: inches(11.7), height: inches(3.4) },
      rotationMilliDegree: 0,
      locked: false,
      style: bodyStyle,
    });
    return source;
  }

  it("按角色把图放在引擎算出的图位上", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
        role: "hero",
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    // 主视觉在右半页，不是页面中间那块空地。
    expect(image.frame.x).toBeGreaterThan(source.pageSize.width * 0.45);
  });

  it("给图腾地方时只动正文的几何，一个字都不改", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const contentBefore = JSON.stringify(source.slides[0]!.content);
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
        role: "hero",
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(body.frame.x + body.frame.width).toBeLessThanOrEqual(image.frame.x);
    expect(body.text).toBe("正文内容");
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
  });

  it("通栏图把正文推到图的下方", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 2048,
        naturalHeight: 512,
        role: "band",
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(body.frame.y).toBeGreaterThan(image.frame.y + image.frame.height);
  });

  it("锁定的正文不因为配图被挪动", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const body = source.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    body.locked = true;
    const before = body.frame.width;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
        role: "hero",
      }),
    );
    const after = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(after.frame.width).toBe(before);
  });

  it("拒绝不认识的角色", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "add-image",
          slideId,
          dataUrl,
          mimeType: "image/png",
          altText: "配图",
          role: "giant" as never,
        }),
      ),
    ).toThrow("INVALID_VISUAL_ASSET_ROLE");
  });

  it("不带角色时沿用原来的插图位置", () => {
    const source = pageWithBody();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "add-image",
        slideId,
        dataUrl,
        mimeType: "image/png",
        altText: "配图",
        naturalWidth: 1024,
        naturalHeight: 768,
      }),
    );
    const image = result.slides[0]!.elements.find((element) => element.type === "image")!;
    expect(image.frame.x).toBe(inches(2));
    const body = result.slides[0]!.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "body",
    )!;
    expect(body.frame.width).toBe(inches(11.7));
  });

  it("grows a short cover title and keeps a long one at the display size", () => {
    const coverSize = (title: string) => {
      const source = createDocument();
      const design = {
        layout: "cover" as const,
        background: "#FBFAF7",
        accent: "#2F6B5F",
        titleColor: "#1E2A32",
        bodyColor: "#333333",
      };
      const result = produce(source, (draft) =>
        applyCommand(draft, {
          type: "apply-ai-designed-draft",
          title: "封面",
          slides: [{ title, body: "", speakerNotes: "" }],
          designs: [design],
        }),
      );
      const element = result.slides[0]!.elements.find(
        (candidate): candidate is TextElement => candidate.type === "text" && candidate.text === title,
      )!;
      return element.style.fontSizePt;
    };
    expect(coverSize("岳阳楼记")).toBe(63);
    expect(coverSize("从洞庭湖到岳阳楼：一篇记文的地理与心事")).toBe(42);
  });

  it("uses an icon for a point that names something the icon set can draw", () => {
    const source = createDocument();
    const content = {
      title: "四条路径",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "bullet-list" as const,
          items: ["目标：提升覆盖率", "数据：增长 32%", "知人论世：生平与时代", "贯通整合：形成能力"],
        },
      ],
    };
    const design = {
      layout: "cards" as const,
      background: "#FFFFFF",
      accent: "#2F6B5F",
      titleColor: "#111111",
      bodyColor: "#333333",
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "图标", slides: [content], designs: [design] }),
    );
    const icons = result.slides[0]!.elements.filter((element) => element.type === "icon");
    expect(icons.map((element) => (element.type === "icon" ? element.name : ""))).toEqual(["target", "chart"]);
    const numbers = result.slides[0]!.elements.filter(
      (element) => element.type === "text" && /^\d{2}$/.test(element.text),
    );
    const numberTexts = numbers.map((element) => (element.type === "text" ? element.text : ""));
    expect(numberTexts).toContain("03");
    expect(numberTexts).toContain("04");
    expect(numberTexts).not.toContain("02");
  });

  it("inserts a built-in icon with the user as its origin", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const result = produce(source, (draft) => applyCommand(draft, { type: "add-icon", slideId, name: "target" }));
    const icon = result.slides[0]!.elements.at(-1)!;
    expect(icon.type).toBe("icon");
    if (icon.type !== "icon") throw new Error("expected an icon");
    expect(icon.name).toBe("target");
    expect(icon.origin).toBe("user");
    expect(icon.frame.width).toBe(inches(1));
  });

  it("updates the style and the name of an icon and refuses a text element", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const withIcon = produce(source, (draft) => applyCommand(draft, { type: "add-icon", slideId, name: "book" }));
    const iconId = withIcon.slides[0]!.elements.at(-1)!.id;

    const restyled = produce(withIcon, (draft) =>
      applyCommand(draft, {
        type: "set-icon-style",
        slideId,
        elementId: iconId,
        style: { color: "#112233", strokeWidth: 3 },
      }),
    );
    const icon = restyled.slides[0]!.elements.at(-1)!;
    if (icon.type !== "icon") throw new Error("expected an icon");
    expect(icon.style.color).toBe("#112233");
    expect(icon.style.strokeWidth).toBe(3);

    const renamed = produce(restyled, (draft) =>
      applyCommand(draft, { type: "set-icon-name", slideId, elementId: iconId, name: "water" }),
    );
    const renamedIcon = renamed.slides[0]!.elements.at(-1)!;
    expect(renamedIcon.type === "icon" ? renamedIcon.name : undefined).toBe("water");

    const textId = source.slides[0]!.elements[0]!.id;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, { type: "set-icon-style", slideId, elementId: textId, style: { color: "#112233" } }),
      ),
    ).toThrow("ELEMENT_NOT_ICON");
  });
});
