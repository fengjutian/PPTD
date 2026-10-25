import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";

import { createDocument, type TextElement } from "../document-model";

import { estimateTextLines } from "../rendering/text-fit";
import { VISUAL_ASSET_REQUEST_SIZE } from "./visual-asset";

describe("commands 2", () => {
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

  it("角色修复可以同时移动标题并恢复模板字体", () => {
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
          target: "title" as const,
          frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        },
        {
          action: "restyle" as const,
          target: "title" as const,
          fontFamily: "Source Han Sans",
          textAlign: "center" as const,
          lineHeight: 1.3,
        },
      ],
    };
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "apply-ai-designed-draft", title: "字体", slides: [content], designs: [design] }),
    );
    const title = result.slides[0]!.elements.find(
      (element) => element.type === "text" && element.text === content.title,
    );
    expect(title?.type === "text" && title.style.fontFamily).toBe("Source Han Sans");
    expect(title?.type === "text" && title.style.align).toBe("center");
    expect(title?.type === "text" && title.style.lineHeight).toBe(1.3);
    expect(title?.type === "text" && title.frame.x).toBe(Math.round(0.1 * result.pageSize.width));
  });

  it("stores and clears the persisted template target as design state", () => {
    const document = createDocument();
    const grid = {
      left: 0.05,
      right: 0.95,
      top: 0.08,
      bottom: 0.9,
      titleX: 0.05,
      titleY: 0.08,
      titleWidth: 0.9,
      titleHeight: 0.1,
      bodyTop: 0.24,
      bodyBottom: 0.9,
    };
    applyCommand(document, {
      type: "set-template-style",
      templateStyle: {
        name: "示例模板",
        templateHash: "abc123",
        page: { widthEmu: document.pageSize.width, heightEmu: document.pageSize.height },
        grid,
        layouts: [{ name: "内页", grid, freeComposition: false }],
        palette: [],
        alignment: "left-grid",
        confidence: "high",
        minimumFit: 90,
        tolerances: { axis: 0.01, axisY: 0.005, margin: 0.01, fontSizePt: 1.5, colorChannel: 12 },
      },
    });
    expect(document.templateStyle?.templateHash).toBe("abc123");
    applyCommand(document, { type: "set-template-style" });
    expect(document.templateStyle).toBeUndefined();
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
});
