import { applyCommand } from "../../src/core/commands";
import { createDocument } from "../../src/core/document-model";
import { defaultConceptForPreset, resolveDeckConcept, type ConceptPresetId } from "../../src/core/design/deck-concept";
import type { AiSlideDesign, AiSlideDraft } from "../../src/core/commands";
import type { CompositionFacts } from "../../src/core/commands/design-intent";
import { encodePng, type PixelImage } from "../../src/core/rendering/png";

/**
 * A deterministic ten-page deck for design review.
 *
 * It deliberately covers every recipe: cover, section, index, split, metric,
 * process, comparison, timeline, quote and image-led. The fixture is not a
 * substitute for a real model run; it is the repeatable half of the review so a
 * layout regression is caught even when no API key is available.
 */
const PAGE_WIDTH = 10;
const PAGE_HEIGHT = 5.625;

export function gradientImage(): string {
  const width = 320;
  const height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const stripe = Math.sin((x + y) / 24) > 0.55 ? 10 : 0;
      data[offset] = 12 + stripe;
      data[offset + 1] = 110 + Math.round((x / width) * 40) + stripe;
      data[offset + 2] = 102 + Math.round((y / height) * 35) + stripe;
      data[offset + 3] = 255;
    }
  }
  const image: PixelImage = { width, height, data };
  return `data:image/png;base64,${Buffer.from(encodePng(image)).toString("base64")}`;
}

const designed = (layout: AiSlideDesign["layout"], extra: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout,
  background: "#FFFFFF",
  accent: "#0F7869",
  titleColor: "#1E3550",
  bodyColor: "#5F6B76",
  ...extra,
});

export const previewSlides: AiSlideDraft[] = [
  {
    title: "2026 年第二季度经营回顾",
    body: "区域连锁零售 · 管理层",
    speakerNotes: "",
  },
  {
    title: "第二部分 门店效率",
    body: "从客流到复购的完整链路。",
    speakerNotes: "",
  },
  {
    title: "三条结论",
    body: "客流回升\n客单稳定\n复购改善",
    speakerNotes: "",
  },
  {
    title: "门店调整的三个判断",
    body: "关闭低效门店释放租金\n把陈列面积让给高频品类\n用预约制降低高峰拥堵\n把店长考核从销售额改为复购率",
    speakerNotes: "",
  },
  {
    title: "本季度三项核心指标",
    body: "销售收入 38 万，客户数 260 家，平均交付 5 天。",
    speakerNotes: "",
    blocks: [
      { type: "metric", label: "销售收入", value: "38 万" },
      { type: "metric", label: "客户数", value: "260 家" },
      { type: "metric", label: "平均交付", value: "5 天" },
    ],
  },
  {
    title: "从线索到交付的四步",
    body: "",
    speakerNotes: "",
    blocks: [
      {
        type: "process",
        items: [
          { label: "线索", text: "市场与门店共同收集" },
          { label: "评估", text: "按客户画像分级" },
          { label: "方案", text: "一店一策给出改造清单" },
          { label: "交付", text: "两周内完成首店验证" },
        ],
      },
    ],
  },
  {
    title: "自建与委托的取舍",
    body: "",
    speakerNotes: "",
    blocks: [
      {
        type: "comparison",
        leftLabel: "自建团队",
        rightLabel: "委托合作",
        leftItems: ["长期成本更低", "数据完全自主", "启动慢"],
        rightItems: ["启动快", "依赖外部排期", "边际成本高"],
      },
    ],
  },
  {
    title: "五年能力建设",
    body: "",
    speakerNotes: "",
    blocks: [
      {
        type: "timeline",
        items: [
          { label: "2018", text: "公司成立，完成首轮融资" },
          { label: "2020", text: "自建测序平台投入运行" },
          { label: "2021", text: "合作医院突破 100 家" },
          { label: "2023", text: "年检测样本量超过 30 万" },
          { label: "2025", text: "三代测序产品线全面上线" },
        ],
      },
    ],
  },
  {
    title: "岳阳楼记",
    body: "",
    speakerNotes: "",
    blocks: [
      {
        type: "quote",
        text: "先天下之忧而忧，后天下之乐而乐。",
        attribution: "范仲淹",
      },
    ],
  },
  {
    title: "精准医疗的视觉证据",
    body: "肿瘤早筛覆盖率提升\n三代测序渗透率上升\n临床指南更新加快",
    speakerNotes: "",
  },
];

export const previewDesigns: AiSlideDesign[] = [
  designed("cover"),
  designed("section"),
  designed("title-body"),
  designed("split"),
  designed("cards"),
  designed("cards"),
  designed("split"),
  designed("cards"),
  designed("quote"),
  designed("split", { visualAsset: { enabled: true, role: "side" } }),
];

export const previewFacts: CompositionFacts[] = [
  {
    itemCount: 0,
    shortItems: false,
    longestItemLength: 0,
    bodyLength: 12,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "cover",
  },
  {
    itemCount: 1,
    shortItems: true,
    longestItemLength: 10,
    bodyLength: 14,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "section",
  },
  {
    itemCount: 3,
    shortItems: true,
    longestItemLength: 4,
    bodyLength: 12,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "title-body",
  },
  {
    itemCount: 4,
    shortItems: false,
    longestItemLength: 21,
    bodyLength: 0,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "split",
  },
  {
    itemCount: 0,
    shortItems: false,
    longestItemLength: 0,
    bodyLength: 24,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: true,
    hasMetric: true,
    layout: "cards",
  },
  {
    itemCount: 4,
    shortItems: false,
    longestItemLength: 12,
    bodyLength: 0,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: true,
    hasProcess: true,
    layout: "cards",
  },
  {
    itemCount: 6,
    shortItems: true,
    longestItemLength: 7,
    bodyLength: 0,
    hasQuote: false,
    hasComparison: true,
    hasRowBlock: true,
    layout: "split",
  },
  {
    itemCount: 5,
    shortItems: false,
    longestItemLength: 14,
    bodyLength: 0,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: true,
    hasTimeline: true,
    layout: "cards",
  },
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
  {
    itemCount: 3,
    shortItems: true,
    longestItemLength: 12,
    bodyLength: 40,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "split",
  },
];

export interface DesignPreviewOptions {
  /** Built-in theme preset; defaults to the editorial teal used before. */
  themePresetId?: string;
  /** Concept preset; defaults to editorial. */
  conceptPresetId?: ConceptPresetId;
}

export function buildDesignPreviewDocument(options: DesignPreviewOptions = {}) {
  const document = createDocument();
  const concept = resolveDeckConcept({
    concept: defaultConceptForPreset(options.conceptPresetId ?? "editorial"),
    pageFacts: previewFacts,
    pageCount: previewSlides.length,
    id: "design-preview",
  }).concept;
  applyCommand(document, {
    type: "apply-ai-designed-draft",
    title: "2026 年第二季度经营回顾",
    slides: previewSlides,
    designs: previewDesigns,
    designConcept: concept,
    themePresetId: options.themePresetId ?? "editorial-teal",
    visualAssets: [
      {
        slideIndex: 9,
        dataUrl: gradientImage(),
        mimeType: "image/png",
        naturalWidth: 320,
        naturalHeight: 180,
        altText: "经营数据趋势的抽象配图",
      },
    ],
  });
  return document;
}

export const previewPage = { width: PAGE_WIDTH, height: PAGE_HEIGHT };

/**
 * A three-page deck on a dark field, for the vocabulary baseline.
 *
 * The ten-page fixture above is entirely white, so nothing in the review ever
 * exercised the semantic roles on a dark page — which is exactly where a light
 * preset's stored `surfaceRaised` used to leak onto the page and leave light
 * copy on a near-white card. These pages make the dark case reproducible
 * without changing the ten-page deck every other assertion is pinned to.
 */
export function buildVocabularyPreviewDocument() {
  const document = createDocument();
  const slides: AiSlideDraft[] = [
    {
      title: "两种交付模式的取舍",
      body: "",
      speakerNotes: "",
      blocks: [
        {
          type: "comparison",
          leftLabel: "自建团队",
          rightLabel: "外部合作",
          leftItems: ["长期成本更低", "数据完全自主", "需要六个月建设期"],
          rightItems: ["两周内启动", "无需设备投入", "依赖外部排期"],
        },
      ],
    },
    {
      title: "三个阶段把成本降下来",
      body: "集中采购\n自动化巡检\n供应商分级",
      speakerNotes: "",
    },
    {
      title: "一条河改变了一座城",
      body: "二十年治理的现场记录",
      speakerNotes: "",
    },
    {
      title: "收入连续三个季度回升",
      body: "",
      speakerNotes: "",
      blocks: [
        { type: "metric", label: "第一季度", value: "38" },
        { type: "metric", label: "第二季度", value: "52" },
        { type: "metric", label: "第三季度", value: "71" },
      ],
    },
  ];
  const dark: Partial<AiSlideDesign> = {
    background: "#12233D",
    titleColor: "#F2F6FA",
    bodyColor: "#D7DEE8",
    // A palette-aware design keeps its own inks; without the roles the builder
    // falls back to the preset's light palette, which is not what a dark page
    // declares.
    palette: { background: "surface", accent: "accent-1", title: "inverse", body: "inverse" },
  };
  const designs: AiSlideDesign[] = [
    designed("split", dark),
    designed("split", { ...dark, visualAsset: { enabled: true, role: "side" } }),
    designed("cover", { ...dark, visualAsset: { enabled: true, role: "hero" } }),
    designed("cards", dark),
  ];
  const facts: CompositionFacts[] = [
    {
      itemCount: 6,
      shortItems: true,
      longestItemLength: 9,
      bodyLength: 0,
      hasQuote: false,
      hasComparison: true,
      hasRowBlock: false,
      layout: "split",
    },
    {
      itemCount: 3,
      shortItems: true,
      longestItemLength: 8,
      bodyLength: 30,
      hasQuote: false,
      hasComparison: false,
      hasRowBlock: false,
      layout: "split",
    },
    {
      itemCount: 0,
      shortItems: false,
      longestItemLength: 0,
      bodyLength: 12,
      hasQuote: false,
      hasComparison: false,
      hasRowBlock: false,
      layout: "cover",
    },
    {
      itemCount: 0,
      shortItems: false,
      longestItemLength: 0,
      bodyLength: 0,
      hasQuote: false,
      hasComparison: false,
      hasRowBlock: true,
      hasMetric: true,
      layout: "cards",
    },
  ];
  const concept = resolveDeckConcept({
    concept: defaultConceptForPreset("documentary"),
    pageFacts: facts,
    pageCount: slides.length,
    id: "vocabulary-preview",
  }).concept;
  applyCommand(document, {
    type: "apply-ai-designed-draft",
    title: "视觉词汇基线",
    slides,
    designs,
    designConcept: concept,
    themePresetId: "editorial-teal",
    visualAssets: [1, 2].map((slideIndex) => ({
      slideIndex,
      dataUrl: gradientImage(),
      mimeType: "image/png" as const,
      naturalWidth: 320,
      naturalHeight: 180,
      altText: "深色页配图",
    })),
  });
  return document;
}
