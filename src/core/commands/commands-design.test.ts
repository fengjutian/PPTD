import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";

import { createDocument, inches, type TextElement } from "../document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import { contrastRatio } from "../rendering/contrast";
import { textLikelyOverflows } from "../rendering/text-fit";

describe("commands 3", () => {
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
});
