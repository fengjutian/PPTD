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
    expect(result.slides[0]!.content).toMatchObject({ title: "现状", body: "市场增长\n竞争加剧", status: "approved" });
    expect(result.slides[0]!.elements).toHaveLength(2);
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

  it("renders numbered content as editable cards with deterministic geometry", () => {
    const source = createDocument();
    const content = { title: "三个重点", body: "1. 第一项 2. 第二项 3. 第三项", speakerNotes: "" };
    const design = { layout: "cards" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "卡片文稿", slides: [content], designs: [design] }));
    const texts = result.slides[0]!.elements.filter((element) => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(["三个重点", "1. 第一项", "2. 第二项", "3. 第三项"]);
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
    const bodies = result.slides[0]!.elements.filter((element): element is Extract<typeof element, { type: "text" }> => element.type === "text" && element.text !== content.title);
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

  it("shrinks long Chinese text to fit narrow template columns", () => {
    const source = createDocument();
    const longItem = "这是一个用于验证中文文本框宽度估算和自动字号适配的较长段落，不能越过双栏边界覆盖另一列内容";
    const content = { title: "排版检查", body: `1. ${longItem}\n2. ${longItem}\n3. ${longItem}\n4. ${longItem}`, speakerNotes: "" };
    const design = { layout: "split" as const, background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" };
    const result = produce(source, (draft) => applyCommand(draft, { type: "apply-ai-designed-draft", title: "自动适配", slides: [content], designs: [design] }));
    const bodies = result.slides[0]!.elements.filter((element): element is Extract<typeof element, { type: "text" }> => element.type === "text" && element.text !== content.title);
    expect(bodies).toHaveLength(2);
    expect(bodies.every((element) => element.style.fontSizePt < 20 && element.style.fontSizePt >= 12)).toBe(true);
  });

});
