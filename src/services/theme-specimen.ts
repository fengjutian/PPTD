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
import { defaultConceptForPreset, resolveDeckConcept, type ConceptPresetId } from "../core/design/deck-concept";
import { defaultThemePreset, findThemePreset, type ThemePreset } from "../core/design/theme-presets";
import type { AiSlideDesign, AiSlideDraft } from "../core/commands";
import type { CompositionFacts } from "../core/commands/design-intent";
import { parseHexColor } from "../core/rendering/contrast";
import { encodePng, type PixelImage } from "../core/rendering/png";

const slides: AiSlideDraft[] = [
  { title: "2026 年第二季度经营回顾", body: "区域连锁零售 · 管理层 · 2026 年 7 月", speakerNotes: "" },
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
    body: "整体经营质量较上季度改善。",
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
    body: "客流连续三个月回升，复购同步改善。",
    speakerNotes: "",
    blocks: [
      {
        type: "chart",
        kind: "line",
        categories: ["4 月", "5 月", "6 月"],
        series: [
          { name: "客流", values: [100, 112, 128] },
          { name: "复购", values: [92, 99, 113] },
        ],
      },
    ],
  },
  {
    title: "门店现场",
    body: "陈列调整后，高频品类移到入口。",
    speakerNotes: "",
    blocks: [
      {
        type: "bullet-list",
        items: ["复购率连续三个月上升", "入口端动销提升 18%"],
      },
    ],
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
    concept: defaultConceptForPreset(options.conceptPresetId ?? "editorial"),
    pageFacts: facts,
    pageCount: slides.length,
    id: "theme-specimen",
  }).concept;
  const preset = findThemePreset(options.themePresetId ?? "editorial-teal") ?? defaultThemePreset();
  const artwork = specimenImage(preset);
  const document = createDocument();
  applyCommand(document, {
    type: "apply-ai-designed-draft",
    title: "主题样张",
    slides,
    designs,
    designConcept: concept,
    themePresetId: preset.id,
    visualAssets: [
      {
        slideIndex: 6,
        dataUrl: artwork,
        mimeType: "image/png",
        naturalWidth: 240,
        naturalHeight: 135,
        altText: "门店现场示意图",
      },
    ],
  });
  return document;
}

export const SPECIMEN_PAGE_COUNT = slides.length;

type Rgb = [number, number, number];

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

function presetColor(preset: ThemePreset, slot: string, fallback: Rgb): Rgb {
  const value = preset.theme.colors.find((color) => color.name === slot)?.value;
  return value ? (parseHexColor(value) ?? fallback) : fallback;
}

/**
 * A deterministic abstract image stands in for a photograph in the sample deck.
 *
 * The image is built from the preset's own palette instead of a fixed teal: a
 * specimen for a burgundy theme must not show a green picture. Two soft glows
 * keep it from reading as a flat colour swatch.
 */
function specimenImage(preset: ThemePreset): string {
  const width = 240;
  const height = 135;
  const primary = presetColor(preset, "primary", [30, 53, 80]);
  const accent = presetColor(preset, "accent", [15, 120, 105]);
  const accent3 = presetColor(preset, "accent3", [214, 168, 75]);
  const surface = presetColor(preset, "surface", [255, 255, 255]);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / (width - 1);
      const ny = y / (height - 1);
      const diagonal = nx * 0.62 + (1 - ny) * 0.38;
      const base = mix(primary, accent, diagonal);
      const lightX = nx - 0.76;
      const lightY = ny - 0.22;
      const highlight = Math.max(0, 1 - (lightX * lightX + lightY * lightY) / 0.25);
      const warmX = nx - 0.18;
      const warmY = ny - 0.82;
      const warm = Math.max(0, 1 - (warmX * warmX + warmY * warmY) / 0.2);
      const [red, green, blue] = mix(mix(base, surface, highlight * highlight * 0.35), accent3, warm * warm * 0.18);
      const offset = (y * width + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
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
