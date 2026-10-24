/**
 * Eight-page specimens for a theme preset.
 *
 * A preset card shows colours; this shows what the preset does to a cover, a
 * section, running copy, metrics, a table, a chart, a picture and a closing
 * page. It is built by the product's own command path, so a specimen cannot
 * promise a layout the renderer does not draw.
 *
 * Pure: no DOM and no model. The picker renders it on demand.
 */

import { applyCommand } from "../core/commands";
import { createDocument, type PresentationDocument } from "../core/document-model";
import {
  defaultDocumentaryConcept,
  defaultEditorialConcept,
  resolveDeckConcept,
  type ConceptPresetId,
} from "../core/design/deck-concept";
import type { AiSlideDesign, AiSlideDraft } from "../core/commands";
import type { CompositionFacts } from "../core/commands/design-intent";
import { encodePng, type PixelImage } from "../core/rendering/png";

const slides: AiSlideDraft[] = [
  { title: "2026 年第二季度经营回顾", body: "区域连锁零售 · 管理层", speakerNotes: "" },
  { title: "第二部分 门店效率", body: "从客流到复购的完整链路。", speakerNotes: "" },
  {
    title: "门店调整的三个判断",
    body: "关闭低效门店释放租金\n把陈列面积让给高频品类\n用预约制降低高峰拥堵",
    speakerNotes: "",
    blocks: [
      {
        type: "bullet-list",
        items: ["关闭低效门店释放租金", "把陈列面积让给高频品类", "用预约制降低高峰拥堵"],
      },
    ],
  },
  {
    title: "本季度三项核心指标",
    body: "",
    speakerNotes: "",
    blocks: [
      { type: "metric", label: "销售收入", value: "38 万" },
      { type: "metric", label: "客户数", value: "260 家" },
      { type: "metric", label: "平均交付", value: "5 天" },
    ],
  },
  {
    title: "区域门店结构",
    body: "",
    speakerNotes: "",
    blocks: [
      {
        type: "table-data",
        header: ["区域", "门店数", "复购率"],
        rows: [
          ["华东", "42", "38%"],
          ["华南", "31", "35%"],
          ["华北", "28", "31%"],
        ],
      },
    ],
  },
  {
    title: "客流与复购的变化",
    body: "",
    speakerNotes: "",
    blocks: [
      {
        type: "chart",
        kind: "line",
        categories: ["4 月", "5 月", "6 月"],
        values: [100, 112, 128],
      },
    ],
  },
  {
    title: "门店现场",
    body: "陈列调整后，高频品类被放到入口，复购率连续三个月上升。",
    speakerNotes: "",
  },
  {
    title: "下一步",
    body: "复制华东的陈列标准\n把预约制推广到 30 家门店",
    speakerNotes: "",
    blocks: [
      {
        type: "bullet-list",
        items: ["复制华东的陈列标准", "把预约制推广到 30 家门店"],
      },
    ],
  },
];

const designed = (layout: AiSlideDesign["layout"], extra: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout,
  background: "#FFFFFF",
  accent: "#0F7869",
  titleColor: "#1E3550",
  bodyColor: "#5F6B76",
  ...extra,
});

const designs: AiSlideDesign[] = [
  designed("cover", { recipe: "cover-statement" }),
  designed("section", { recipe: "section-statement" }),
  designed("title-body", { recipe: "editorial-index" }),
  designed("title-body", { recipe: "data-story" }),
  designed("title-body"),
  designed("title-body", { recipe: "chart-story" }),
  designed("title-body", { recipe: "image-led", visualAsset: { enabled: true, role: "side" } }),
  designed("summary"),
];

const facts: CompositionFacts[] = slides.map((slide, index) => ({
  itemCount: slide.blocks?.length ?? 3,
  shortItems: true,
  longestItemLength: 18,
  bodyLength: slide.body.length,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: slide.blocks?.some((block) => block.type === "metric") ?? false,
  layout: designs[index]!.layout,
}));

export interface SpecimenOptions {
  themePresetId?: string;
  conceptPresetId?: ConceptPresetId;
}

export function buildSpecimenDocument(options: SpecimenOptions = {}): PresentationDocument {
  const concept = resolveDeckConcept({
    concept: options.conceptPresetId === "documentary" ? defaultDocumentaryConcept() : defaultEditorialConcept(),
    pageFacts: facts,
    pageCount: slides.length,
    id: "theme-specimen",
  }).concept;
  const document = createDocument();
  applyCommand(document, {
    type: "apply-ai-designed-draft",
    title: "主题样张",
    slides,
    designs,
    designConcept: concept,
    themePresetId: options.themePresetId ?? "editorial-teal",
    visualAssets: [
      {
        slideIndex: 6,
        dataUrl: specimenImage(),
        mimeType: "image/png",
        naturalWidth: 320,
        naturalHeight: 180,
        altText: "门店现场示意图",
      },
    ],
  });
  return document;
}

export const SPECIMEN_PAGE_COUNT = slides.length;

/** A deterministic gradient stands in for a photograph in the sample deck. */
function specimenImage(): string {
  const width = 320;
  const height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 18 + Math.round((x / width) * 24);
      data[offset + 1] = 92 + Math.round((y / height) * 58);
      data[offset + 2] = 84 + Math.round((x / width) * 40);
      data[offset + 3] = 255;
    }
  }
  const image: PixelImage = { width, height, data };
  return `data:image/png;base64,${toBase64(encodePng(image))}`;
}

/** The bundle runs in a WebView; Buffer is not available there. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
