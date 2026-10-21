import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, inches } from "../document-model";
import { contrastRatio, contrastRatioAgainstLuminance } from "../rendering/contrast";
import { estimateTextLines } from "../rendering/text-fit";

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

  it("keeps legacy unannotated title edits and deletes in the content domain", () => {
    const source = createDocument();
    const legacy = structuredClone(source);
    const slide = legacy.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type === "text") delete title.contentRef;
    expect(commandDomain({ type: "edit-text", slideId: slide.id, elementId: title.id, text: "兼容标题" }, legacy)).toBe("content");
    expect(commandDomain({ type: "delete-element", slideId: slide.id, elementId: title.id }, legacy)).toBe("content");
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
    const edited = produce(added, (draft) => applyCommand(draft, { type: "edit-text", slideId, elementId: addedText.id, text: "补充说明" }));
    expect(edited.slides[0]!.content.title).toBe(titleBefore);
    expect(edited.slides[0]!.content.status).toBe("approved");
    expect(edited.slides[0]!.elements[1]).toMatchObject({ type: "text", text: "补充说明" });
  });

  it("reorders elements to change z-order without changing content", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const added = produce(source, (draft) => applyCommand(draft, { type: "add-shape", slideId, shape: "rectangle" }));
    const shapeId = added.slides[0]!.elements[1]!.id;
    const reordered = produce(added, (draft) => applyCommand(draft, { type: "reorder-element", slideId, elementId: shapeId, toIndex: 0 }));
    expect(reordered.slides[0]!.elements[0]).toMatchObject({ id: shapeId, type: "shape" });
    expect(reordered.slides[0]!.content).toEqual(added.slides[0]!.content);
    expect(() => produce(added, (draft) => applyCommand(draft, { type: "reorder-element", slideId, elementId: shapeId, toIndex: 9 }))).toThrow("ELEMENT_INDEX_OUT_OF_RANGE");
  });

  it("duplicates content-bound text as decorative instead of creating a second content writer", () => {
    const source = createDocument();
    const slideId = source.slides[0]!.id;
    const titleId = source.slides[0]!.elements[0]!.id;
    const duplicated = produce(source, (draft) => applyCommand(draft, { type: "duplicate-element", slideId, elementId: titleId }));
    const copy = duplicated.slides[0]!.elements[1]!;
    expect(copy.type === "text" && copy.contentRef).toBe("decorative");
    expect(duplicated.slides[0]!.content.title).toBe(source.slides[0]!.content.title);
  });

  it("aligns an element to page edges and center without touching content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const aligned = produce(source, (draft) => applyCommand(draft, { type: "align-element", slideId: slide.id, elementId: element.id, align: "center" }));
    expect(aligned.slides[0]!.elements[0]!.frame.x).toBe(Math.round((source.pageSize.width - element.frame.width) / 2));
    expect(aligned.slides[0]!.content).toEqual(source.slides[0]!.content);
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

  it("restyles text without touching reviewed content", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const command = { type: "set-text-style" as const, slideId: slide.id, elementId: title.id, style: { fontSizePt: 36, color: "#112233", bold: true, align: "center" as const } };
    expect(commandDomain(command)).toBe("design");
    const result = produce(source, (draft) => applyCommand(draft, command));
    expect(result.slides[0]!.elements[0]).toMatchObject({ style: { fontSizePt: 36, color: "#112233", bold: true, align: "center" } });
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(result.slides[0]!.content.status).toBe("approved");
  });

  it("restyles shapes and image alt text without touching reviewed content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const withShape = produce(source, (draft) => applyCommand(draft, { type: "add-shape", slideId: slide.id, shape: "rectangle" }));
    const shape = withShape.slides[0]!.elements[1]!;
    const restyled = produce(withShape, (draft) => applyCommand(draft, { type: "set-shape-style", slideId: slide.id, elementId: shape.id, style: { fill: "#00ff00", strokeWidthPt: 3, radiusPt: 20 } }));
    expect(restyled.slides[0]!.elements[1]).toMatchObject({ style: { fill: "#00ff00", strokeWidthPt: 3, radiusPt: 20 } });
    expect(restyled.slides[0]!.content).toEqual(withShape.slides[0]!.content);

    const withImage = produce(source, (draft) => applyCommand(draft, { type: "add-image", slideId: slide.id, dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png", altText: "原描述" }));
    const image = withImage.slides[0]!.elements[1]!;
    const described = produce(withImage, (draft) => applyCommand(draft, { type: "set-image-alt-text", slideId: slide.id, elementId: image.id, altText: "新的替代文本" }));
    expect(described.slides[0]!.elements[1]).toMatchObject({ altText: "新的替代文本" });
    expect(described.slides[0]!.content).toEqual(withImage.slides[0]!.content);
  });

  it("rejects style values the exporter could not round-trip", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "set-text-style", slideId: slide.id, elementId: title.id, style: { color: "red" } }))).toThrow("INVALID_TEXT_STYLE");
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "set-text-style", slideId: slide.id, elementId: title.id, style: { fontSizePt: 0 } }))).toThrow("INVALID_TEXT_STYLE");
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "set-shape-style", slideId: slide.id, elementId: title.id, style: { fill: "#ffffff" } }))).toThrow("ELEMENT_NOT_SHAPE");
    expect(() => produce(source, (draft) => applyCommand(draft, { type: "set-image-alt-text", slideId: slide.id, elementId: title.id, altText: "描述" }))).toThrow("ELEMENT_NOT_IMAGE");
  });

  it("refuses to restyle a locked element", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const locked = produce(source, (draft) => applyCommand(draft, { type: "set-element-lock", slideId: slide.id, elementId: title.id, locked: true }));
    expect(() => produce(locked, (draft) => applyCommand(draft, { type: "set-text-style", slideId: slide.id, elementId: title.id, style: { fontSizePt: 40 } }))).toThrow("ELEMENT_LOCKED");
  });

  it("applies an AI draft as one structured document replacement", () => {
    const source = createDocument();
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-draft", title: "AI 战略", slides: [
      { title: "现状", body: "市场增长\n竞争加剧", speakerNotes: "说明背景" },
      { title: "行动", body: "聚焦产品", speakerNotes: "说明计划" },
    ] }));
    expect(result.title).toBe("AI 战略");
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0]!.content).toMatchObject({ title: "现状", body: "市场增长\n竞争加剧", status: "approved" });
    expect(result.slides[0]!.elements).toHaveLength(2);
  });

  it("stores structured AI content blocks with stable IDs and keeps body edits consistent", () => {
    const source = createDocument();
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-draft", title: "结构化", slides: [
      { title: "要点", body: "甲\n乙", speakerNotes: "", blocks: [{ type: "bullet-list", items: ["甲", "乙"] }] },
    ] }));
    const content = result.slides[0]!.content;
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks![0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    const bodyElement = result.slides[0]!.elements.find((element) => element.type === "text" && element.contentRef === "body")!;
    const edited = produce(result, (draft) => applyCommand(draft, { type: "edit-text", slideId: result.slides[0]!.id, elementId: bodyElement.id, text: "新的正文" }));
    expect(edited.slides[0]!.content.body).toBe("新的正文");
    expect(edited.slides[0]!.content.blocks).toEqual([{ id: content.blocks![0]!.id, type: "paragraph", text: "新的正文" }]);
  });

  it("applies AI template design without allowing it to rewrite approved content", () => {
    const source = createDocument();
    const content = { title: "已审核标题", body: "已审核正文", speakerNotes: "已审核备注" };
    const design = { layout: "cover" as const, background: "#112233", accent: "#FF6600", titleColor: "#FFFFFF", bodyColor: "#EEEEEE" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "设计文稿", slides: [content], designs: [design], fontFamily: "Arial" }));
    expect(result.slides[0]!.content).toEqual({ ...content, status: "approved" });
    expect(result.slides[0]!.background).toBe("#112233");
    expect(result.slides[0]!.elements.map((element) => element.type)).toEqual(["shape", "shape", "text", "text"]);
    expect(result.slides[0]!.elements[2]).toMatchObject({ type: "text", text: "已审核标题", style: { fontFamily: "Arial", fontSizePt: 42 } });
  });

  it("keeps display type on the headline and text type on running copy", () => {
    const source = createDocument();
    const content = { title: "标题", body: "正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "字体", slides: [content], designs: [design], fontFamily: "Arial", bodyFontFamily: "Georgia" }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title);
    const body = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.body);
    expect(title?.type === "text" && title.style.fontFamily).toBe("Arial");
    expect(body?.type === "text" && body.style.fontFamily).toBe("Georgia");
  });

  it("renders a multi-point title-body page as a structured list instead of one stranded block", () => {
    const source = createDocument();
    const content = { title: "作品背景", body: "1. 作品在什么背景下创作？\n2. 作者想回应什么？\n3. 当时的社会环境如何？\n4. 作品为何采用这种形式？\n5. 它后来产生了什么影响？", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "作品背景", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(["作品背景", "01", "作品在什么背景下创作？", "02", "作者想回应什么？", "03", "当时的社会环境如何？", "04", "作品为何采用这种形式？", "05", "它后来产生了什么影响？"]);
    // The list fills the content area instead of shrinking into the top-left.
    const firstItem = texts[2]!;
    const lastItem = texts[texts.length - 1]!;
    expect(lastItem.frame.y).toBeGreaterThan(firstItem.frame.y);
    expect(lastItem.frame.y + lastItem.frame.height).toBeLessThanOrEqual(source.pageSize.height);
    expect(firstItem.frame.width).toBeGreaterThan(source.pageSize.width * 0.5);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("uses a bullet-list block as the page structure even when body is a short summary", () => {
    const source = createDocument();
    const content = { title: "三条结论", body: "本页用三条结论回答标题。", speakerNotes: "", blocks: [{ type: "bullet-list" as const, items: ["结论一", "结论二", "结论三"] }] };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "三条结论", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(texts).toEqual(["三条结论", "01", "结论一", "02", "结论二", "03", "结论三"]);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("turns a five-point page into an editorial list with a pull quote", () => {
    const source = createDocument();
    const content = { title: "原文赏析——第二段", body: "1. 总写洞庭湖全景\n2. '衔远山,吞长江,浩浩汤汤'\n3. 描写气象万千的景色\n4. 过渡到登楼览物之情\n5. '前人之述备矣'引出下文", speakerNotes: "", blocks: [{ type: "bullet-list" as const, items: ["总写洞庭湖全景", "'衔远山,吞长江,浩浩汤汤'", "描写气象万千的景色", "过渡到登楼览物之情", "'前人之述备矣'引出下文"] }] };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "岳阳楼记", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    content.blocks[0]!.items.forEach((item) => expect(texts).toContain(item));
    expect(texts).toContain("关键摘录");
    expect(result.slides[0]!.elements.every((element) => element.frame.width > 0 && element.frame.height > 0)).toBe(true);
    const panel = result.slides[0]!.elements.find((element) => element.type === "shape" && element.frame.x > result.pageSize.width * 0.5 && element.frame.width > result.pageSize.width * 0.25 && element.frame.height > result.pageSize.height * 0.4);
    expect(panel).toBeDefined();
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("keeps a bullet list when the page also carries a quote block", () => {
    const source = createDocument();
    const items = ["第一项", "第二项", "第三项", "第四项", "第五项"];
    const content = { title: "重点摘录", body: items.join("\n"), speakerNotes: "", blocks: [{ type: "quote" as const, text: "先天下之忧而忧" }, { type: "bullet-list" as const, items }] };
    const design = { layout: "quote" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "重点摘录", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    items.forEach((item) => expect(texts).toContain(item));
    expect(texts).toContain("先天下之忧而忧");
    expect(texts).toContain("关键摘录");
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("renders a quote block with its attribution instead of a plain paragraph", () => {
    const source = createDocument();
    const content = { title: "核心观点", body: "真正的理解来自实践。", speakerNotes: "", blocks: [{ type: "quote" as const, text: "真正的理解来自实践。", attribution: "作者" }] };
    const design = { layout: "quote" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "核心观点", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(texts).toContain("真正的理解来自实践。");
    expect(texts).toContain("— 作者");
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("renders numbered content as editable cards with deterministic geometry", () => {
    const source = createDocument();
    const content = { title: "三个重点", body: "1. 第一项 2. 第二项 3. 第三项", speakerNotes: "" };
    const design = { layout: "cards" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "卡片文稿", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(["三个重点", "01", "1", "第一项", "2", "第二项", "3", "第三项"]);
    const badge = result.slides[0]!.elements.find((element) => element.type === "shape" && element.shape === "ellipse")!;
    const firstItem = texts.find((element) => element.text === "第一项")!;
    // The badge sits above the copy; text must start below the badge instead
    // of painting over the numeral.
    expect(firstItem.frame.y).toBeGreaterThanOrEqual(badge.frame.y + badge.frame.height);
    expect(result.slides[0]!.elements.every((element) => element.frame.width > 0 && element.frame.height > 0)).toBe(true);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("uses valid text regions extracted from the selected PPTX template", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [{ index: 1, regions: [
      { role: "title" as const, frame: { x: 0.12, y: 0.08, width: 0.70, height: 0.12 } },
      { role: "body" as const, frame: { x: 0.18, y: 0.32, width: 0.60, height: 0.42 } },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "模板文稿", slides: [content], designs: [design], templateLayouts }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title)!;
    const body = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.body)!;
    expect(title.frame).toEqual({ x: Math.round(source.pageSize.width * 0.12), y: Math.round(source.pageSize.height * 0.08), width: Math.round(source.pageSize.width * 0.70), height: Math.round(source.pageSize.height * 0.12) });
    expect(body.frame).toEqual({ x: Math.round(source.pageSize.width * 0.18), y: Math.round(source.pageSize.height * 0.32), width: Math.round(source.pageSize.width * 0.60), height: Math.round(source.pageSize.height * 0.42) });
  });

  it("rejects overlapping template regions for split layouts", () => {
    const source = createDocument();
    const content = { title: "双栏", body: "1. 左侧内容 2. 右侧内容", speakerNotes: "" };
    const design = { layout: "split" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [{ index: 1, regions: [
      { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.80, height: 0.12 } },
      { role: "body" as const, frame: { x: 0.05, y: 0.25, width: 0.70, height: 0.50 } },
      { role: "body" as const, frame: { x: 0.30, y: 0.25, width: 0.65, height: 0.50 } },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "安全双栏", slides: [content], designs: [design], templateLayouts }));
    const bodies = result.slides[0]!.elements.filter((element): element is Extract<typeof element, { type: "text" }> => element.type === "text" && element.text !== content.title && !/^\d+$/.test(element.text));
    expect(bodies[0]!.frame.x + bodies[0]!.frame.width).toBeLessThanOrEqual(bodies[1]!.frame.x);
    expect(bodies.every((element) => element.frame.y + element.frame.height <= source.pageSize.height)).toBe(true);
  });

  it("rejects a template layout whose title overlaps its body", () => {
    const source = createDocument();
    const content = { title: "不能重叠的标题", body: "正文内容", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [{ index: 1, name: "损坏版式", regions: [
      { role: "title" as const, frame: { x: 0.10, y: 0.35, width: 0.70, height: 0.20 } },
      { role: "body" as const, frame: { x: 0.08, y: 0.30, width: 0.82, height: 0.50 } },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "安全回退", slides: [content], designs: [design], templateLayouts }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title)!;
    const body = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.body)!;
    expect(title.frame.y + title.frame.height).toBeLessThanOrEqual(body.frame.y);
  });

  it("selects a semantic template layout and adopts its background", () => {
    const source = createDocument();
    const content = { title: "方案对比", body: "左侧\n右侧", speakerNotes: "" };
    const design = { layout: "split" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [
      { index: 1, name: "标题和内容", backgroundColor: "#FFFFFF", regions: [{ role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } }, { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } }] },
      { index: 2, name: "双栏比较", backgroundColor: "#F5F1E8", regions: [{ role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } }, { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.36, height: 0.55 } }, { role: "body" as const, frame: { x: 0.56, y: 0.28, width: 0.36, height: 0.55 } }] },
    ];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "模板匹配", slides: [content], designs: [design], templateLayouts }));
    expect(result.slides[0]!.background).toBe("#F5F1E8");
    const bodies = result.slides[0]!.elements.filter((element) => element.type === "text" && element.text !== content.title);
    expect(bodies[0]!.frame.x).toBe(Math.round(source.pageSize.width * 0.08));
    expect(bodies[1]!.frame.x).toBe(Math.round(source.pageSize.width * 0.56));
  });

  it("places a rendered complex template layout behind editable content", () => {
    const source = createDocument();
    const content = { title: "可编辑标题", body: "可编辑正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const backgroundImageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const templateLayouts = [{ index: 1, name: "标题和内容", backgroundImageDataUrl, regions: [
      { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
      { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "复杂模板", slides: [content], designs: [design], templateLayouts }));
    expect(result.slides[0]!.elements[0]).toMatchObject({ type: "image", locked: true, source: { dataUrl: backgroundImageDataUrl } });
    expect(result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text)).toEqual([content.title, content.body]);
  });

  it("creates controlled visual rhythm across equally suitable semantic backgrounds", () => {
    const source = createDocument();
    const slides = [
      { title: "第一页", body: "正文一", speakerNotes: "" },
      { title: "第二页", body: "正文二", speakerNotes: "" },
    ];
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const regionSet = [
      { role: "title" as const, frame: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 } },
      { role: "body" as const, frame: { x: 0.08, y: 0.28, width: 0.84, height: 0.55 } },
    ];
    const templateLayouts = [
      { index: 1, name: "正文甲", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: regionSet },
      { index: 2, name: "正文乙", backgroundImageDataUrl: "data:image/png;base64,BBBB", regions: regionSet },
    ];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "多版式", slides, designs: [design, design], templateLayouts }));
    const backgrounds = result.slides.map((slide) => slide.elements.find((element) => element.type === "image"));
    expect(backgrounds[0]).toMatchObject({ type: "image", source: { dataUrl: templateLayouts[0]!.backgroundImageDataUrl } });
    expect(backgrounds[1]).toMatchObject({ type: "image", source: { dataUrl: templateLayouts[1]!.backgroundImageDataUrl } });
    const titleFrames = result.slides.map((slide, slideIndex) => slide.elements.find((element) => element.type === "text" && element.text === slides[slideIndex]!.title)!.frame);
    expect(titleFrames[1]).toEqual(titleFrames[0]);
  });

  it("renders timeline blocks without parsing the body string", () => {
    const source = createDocument();
    const content = { title: "里程碑", body: "这段正文不应驱动时间线", speakerNotes: "", blocks: [{ type: "timeline" as const, items: [{ label: "第一阶段", text: "调研" }, { label: "第二阶段", text: "交付" }] }] };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "时间线", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(texts).toEqual(["里程碑", "第一阶段", "调研", "第二阶段", "交付"]);
    expect(result.slides[0]!.content.body).toBe(content.body);
  });

  it("renders comparison blocks as two labeled editable columns", () => {
    const source = createDocument();
    const content = { title: "方案对比", body: "保留的审核正文", speakerNotes: "", blocks: [{ type: "comparison" as const, leftLabel: "方案 A", rightLabel: "方案 B", leftItems: ["稳定"], rightItems: ["快速"] }] };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(texts).toEqual(["方案对比", "方案 A", "• 稳定", "方案 B", "• 快速"]);
  });

  it("renders metric blocks as value-first cards", () => {
    const source = createDocument();
    const content = { title: "核心指标", body: "指标说明", speakerNotes: "", blocks: [{ type: "metric" as const, label: "增长率", value: "42%" }, { type: "metric" as const, label: "客户数", value: "120" }] };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "指标", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(texts).toEqual(["核心指标", "42%", "增长率", "120", "客户数"]);
  });

  it("renders process blocks as numbered native-object steps", () => {
    const source = createDocument();
    const content = { title: "实施流程", body: "审核正文", speakerNotes: "", blocks: [{ type: "process" as const, items: [{ label: "分析", text: "确认目标" }, { label: "执行", text: "完成交付" }] }] };
    const design = { layout: "cards" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "流程", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text").map((element) => element.text);
    expect(texts).toEqual(["实施流程", "1", "分析", "确认目标", "→", "2", "执行", "完成交付"]);
    expect(result.slides[0]!.elements.every((element) => element.type === "text" || element.type === "shape")).toBe(true);
  });

  it("does not silently drop points when a cards layout receives more than six", () => {
    const source = createDocument();
    const body = Array.from({ length: 7 }, (_, index) => `${index + 1}. 第${index + 1}个要点`).join("\n");
    const content = { title: "七个要点", body, speakerNotes: "" };
    const design = { layout: "cards" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "七个要点", slides: [content], designs: [design] }));
    const copy = result.slides[0]!.elements.filter((element): element is Extract<typeof element, { type: "text" }> => element.type === "text").map((element) => element.text).join("\n");
    for (let index = 1; index <= 7; index += 1) expect(copy).toContain(`第${index}个要点`);
    expect(result.slides[0]!.content.body).toBe(body);
  });

  it("keeps an explicitly requested split layout instead of forcing numbered text into cards", () => {
    const source = createDocument();
    const longItem = "这是一个用于验证中文文本框宽度估算和自动字号适配的较长段落，不能越过双栏边界覆盖另一列内容";
    const content = { title: "排版检查", body: `1. ${longItem}\n2. ${longItem}\n3. ${longItem}\n4. ${longItem}`, speakerNotes: "" };
    const design = { layout: "split" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "自动适配", slides: [content], designs: [design] }));
    const bodies = result.slides[0]!.elements.filter((element): element is Extract<typeof element, { type: "text" }> => element.type === "text" && element.text !== content.title && !/^\d+$/.test(element.text));
    expect(bodies).toHaveLength(2);
    expect(bodies.every((element) => element.style.fontSizePt < 20 && element.style.fontSizePt >= 12)).toBe(true);
    for (const [bodyIndex, body] of bodies.entries()) {
      expect(bodies.slice(bodyIndex + 1).every((candidate) => body.frame.x + body.frame.width <= candidate.frame.x || candidate.frame.x + candidate.frame.width <= body.frame.x || body.frame.y + body.frame.height <= candidate.frame.y || candidate.frame.y + candidate.frame.height <= body.frame.y)).toBe(true);
    }
  });

  it("centers an incomplete final card row on the shared alignment grid", () => {
    const source = createDocument();
    const content = { title: "五项重点", body: "1. 第一项\n2. 第二项\n3. 第三项\n4. 第四项\n5. 第五项", speakerNotes: "" };
    const design = { layout: "cards" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "视觉对齐", slides: [content], designs: [design] }));
    const labels = result.slides[0]!.elements.filter((element): element is Extract<typeof element, { type: "text" }> => element.type === "text" && /^第[一二三四五]项$/.test(element.text));
    expect(labels).toHaveLength(5);
    expect(labels[3]!.frame.x).toBeGreaterThan(labels[0]!.frame.x);
    expect(labels[4]!.frame.x + labels[4]!.frame.width).toBeLessThan(labels[2]!.frame.x + labels[2]!.frame.width);
    expect(labels[3]!.frame.y).toBe(labels[4]!.frame.y);
  });

  it("places editable content inside a vision-recommended safe region", () => {
    const source = createDocument();
    const content = { title: "避开模板标志", body: "正文位于视觉模型识别的留白区域", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#234567", accent: "#22AA99", titleColor: "#FFFFFF", bodyColor: "#FFFFFF", safeRegion: { x: 0.28, y: 0.18, width: 0.64, height: 0.68 } };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "安全区", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts[0]!.frame.x).toBe(Math.round(source.pageSize.width * design.safeRegion.x));
    expect(texts.every((element) => element.frame.x >= Math.round(source.pageSize.width * design.safeRegion.x))).toBe(true);
    expect(texts.every((element) => element.frame.x + element.frame.width <= Math.round(source.pageSize.width * (design.safeRegion.x + design.safeRegion.width)) + 1)).toBe(true);
  });

  it("places editable text on the placeholder geometry of the rendered template layout", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [{ index: 11, name: "内页（浅色）1", backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=", regions: [
      { role: "title" as const, frame: { x: 0.052, y: 0.030, width: 0.799, height: 0.059 } },
      { role: "body" as const, frame: { x: 0.052, y: 0.119, width: 0.423, height: 0.046 } },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "模板文稿", slides: [content], designs: [design], templateLayouts }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title)!;
    const body = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.body)!;
    expect(title.frame).toEqual({ x: Math.round(source.pageSize.width * 0.052), y: Math.round(source.pageSize.height * 0.030), width: Math.round(source.pageSize.width * 0.799), height: Math.round(source.pageSize.height * 0.059) });
    // The largest body region carries the copy, not the short subtitle placeholder.
    expect(body.frame).toEqual({ x: Math.round(source.pageSize.width * 0.052), y: Math.round(source.pageSize.height * 0.222), width: Math.round(source.pageSize.width * 0.897), height: Math.round(source.pageSize.height * 0.621) });
  });

  it("keeps the template artwork visible instead of covering the page with a panel", () => {
    const source = createDocument();
    const content = { title: "对比度修复", body: "正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333", backgroundTreatment: "local-scrim" as const };
    const templateLayouts = [{ index: 11, name: "内页（浅色）1", backgroundImageDataUrl: "data:image/png;base64,iVBORw0KGgo=", regions: [
      { role: "title" as const, frame: { x: 0.052, y: 0.030, width: 0.799, height: 0.059 } },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "模板文稿", slides: [content], designs: [design], templateLayouts }));
    const shapes = result.slides[0]!.elements.filter((element) => element.type === "shape");
    expect(shapes.length).toBeGreaterThan(0);
    // The scrim hugs the text block; it must never become a full page sheet.
    expect(shapes.every((shape) => shape.frame.width < source.pageSize.width * 0.98 && shape.frame.height < source.pageSize.height * 0.98)).toBe(true);
    expect(result.slides[0]!.elements[0]).toMatchObject({ type: "image" });
  });

  it("uses the ink and the size the template assigned to its placeholders", () => {
    const source = createDocument();
    const content = { title: "模板标题", body: "模板正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [{ index: 11, name: "内页（浅色）1", regions: [
      { role: "title" as const, frame: { x: 0.052, y: 0.030, width: 0.799, height: 0.059 }, textColor: "#273D79", fontSizePt: 26 },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 }, textColor: "#999A9A", fontSizePt: 18 },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "模板文稿", slides: [content], designs: [design], templateLayouts }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title)!;
    const body = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.body)!;
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
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#FFFFFF", bodyColor: "#FFFFFF" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "对比度", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts.every((element) => element.type === "text" && contrastRatio(element.style.color, "#FFFFFF")! >= 4.5)).toBe(true);
    // The title keeps more weight than the body so the page keeps a hierarchy.
    expect(texts[0]!.type === "text" && texts[0]!.style.color).not.toBe(texts[1]!.type === "text" && texts[1]!.style.color);
  });

  it("rotates the template artwork across pages instead of repeating one layout", () => {    const source = createDocument();
    const slides = [
      { title: "第一页", body: "正文一", speakerNotes: "" },
      { title: "第二页", body: "正文二", speakerNotes: "" },
      { title: "第三页", body: "正文三", speakerNotes: "" },
    ];
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const regionSet = [
      { role: "title" as const, frame: { x: 0.052, y: 0.030, width: 0.799, height: 0.059 } },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 } },
    ];
    const templateLayouts = [
      { index: 11, name: "内页（浅色）1", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: regionSet },
      { index: 13, name: "内页（浅色）3", backgroundImageDataUrl: "data:image/png;base64,BBBB", regions: regionSet },
      { index: 14, name: "内页（深色）1", backgroundImageDataUrl: "data:image/png;base64,CCCC", regions: regionSet },
    ];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "多版式", slides, designs: [design, design, design], templateLayouts }));
    const backgrounds = result.slides.map((slide) => slide.elements.find((element) => element.type === "image"));
    expect(backgrounds.map((element) => element?.type === "image" ? element.source.dataUrl : undefined)).toEqual([
      templateLayouts[0]!.backgroundImageDataUrl,
      templateLayouts[1]!.backgroundImageDataUrl,
      templateLayouts[2]!.backgroundImageDataUrl,
    ]);
  });

  it("keeps a CJK headline on one line inside the template title box", () => {
    const source = createDocument();
    const content = { title: "昆佰泰基因测序整体解决方案", body: "副标题", speakerNotes: "" };
    const design = { layout: "cover" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#FFFFFF", bodyColor: "#FFFFFF" };
    const templateLayouts = [{ index: 1, name: "封面1", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: [
      { role: "title" as const, frame: { x: 0.084, y: 0.340, width: 0.832, height: 0.167 }, textColor: "#FFFFFF", fontSizePt: 66 },
      { role: "body" as const, frame: { x: 0.125, y: 0.589, width: 0.750, height: 0.167 }, textColor: "#FFFFFF", fontSizePt: 28 },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design], templateLayouts }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title)!;
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
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const templateLayouts = [{ index: 14, name: "内页（深色）1", backgroundImageDataUrl: "data:image/png;base64,AAAA", backgroundLuminance: { title: { darkest: 0.3947, lightest: 0.5795 }, body: { darkest: 0.3993, lightest: 0.612 } }, regions: [
      { role: "title" as const, frame: { x: 0.052, y: 0.030, width: 0.806, height: 0.059 }, textColor: "#FFFFFF", fontSizePt: 26 },
      { role: "body" as const, frame: { x: 0.052, y: 0.225, width: 0.897, height: 0.621 }, textColor: "#FFFFFF", fontSizePt: 18 },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design], templateLayouts }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    const range = templateLayouts[0]!.backgroundLuminance!.title!;
    // The template asks for white, which cannot carry the text on that teal
    // artwork. The ink has to hold on the darkest and on the lightest patch.
    expect(texts.every((element) => element.type === "text" && element.style.color !== "#FFFFFF")).toBe(true);
    expect(texts.every((element) => element.type === "text" && contrastRatioAgainstLuminance(element.style.color, range.darkest)! >= 3)).toBe(true);
  });

  it("lets a design override the ink the template assigned to its placeholders", () => {
    const source = createDocument();
    const content = { title: "覆盖墨色", body: "正文", speakerNotes: "" };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#101010", bodyColor: "#202020", inkOverride: true };
    const templateLayouts = [{ index: 11, name: "内页（浅色）1", backgroundImageDataUrl: "data:image/png;base64,AAAA", regions: [
      { role: "title" as const, frame: { x: 0.052, y: 0.030, width: 0.799, height: 0.059 }, textColor: "#273D79", fontSizePt: 26 },
      { role: "body" as const, frame: { x: 0.052, y: 0.222, width: 0.897, height: 0.621 }, textColor: "#999A9A", fontSizePt: 18 },
    ] }];
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design], templateLayouts }));
    const title = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === content.title)!;
    // Without the override the template ink wins, so a repair could never
    // change the colour of a template page.
    expect(title.type === "text" && title.style.color).toBe("#101010");
  });

  it("deepens a badge fill so the numerals stay readable on it", () => {
    const source = createDocument();
    const content = { title: "要点", body: "1. 第一项优势\n2. 第二项优势", speakerNotes: "" };
    const design = { layout: "cards" as const, background: "#FFFFFF", accent: "#15A590", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }));
    const badge = result.slides[0]!.elements.find((element) => element.type === "shape" && element.shape === "ellipse");
    const numeral = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === "1");
    expect(badge?.type === "shape" && contrastRatio("#FFFFFF", badge.style.fill)!).toBeGreaterThanOrEqual(4.5);
    expect(numeral?.type === "text" && numeral.style.color).toBe("#FFFFFF");
  });

  it("sizes a stat card to the number and the label it carries", () => {
    const source = createDocument();
    const content = { title: "关键指标", body: "", speakerNotes: "", blocks: [{ type: "metric" as const, label: "年检测样本量", value: "38万" }] };
    const design = { layout: "title-body" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "标题", slides: [content], designs: [design] }));
    const value = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === "38万");
    const label = result.slides[0]!.elements.find((element) => element.type === "text" && element.text === "年检测样本量");
    const card = result.slides[0]!.elements.find((element) => element.type === "shape" && element.frame.width > source.pageSize.width * 0.5);
    expect(card?.type === "shape").toBe(true);
    // The card used to stretch over the whole content region and left the
    // label stranded at the bottom of an empty panel.
    expect(card!.type === "shape" && card!.frame.height).toBeLessThan(source.pageSize.height * 0.3);
    expect(value!.type === "text" && label!.type === "text" && value!.frame.y).toBeGreaterThan(card!.frame.y);
    expect(label!.type === "text" && label!.frame.y + label!.frame.height).toBeLessThanOrEqual(card!.frame.y + card!.frame.height);
  });

});
