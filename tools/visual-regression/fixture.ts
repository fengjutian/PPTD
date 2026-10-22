import { hashSlideContent } from "../../src/core/document-model/content-hash";
import { CURRENT_SCHEMA_VERSION } from "../../src/core/document-model/schema";
import { encodePng } from "../../src/core/rendering/png";
import type {
  ContentBlock,
  ElementId,
  PresentationDocument,
  Slide,
  SlideId,
  SlideElement,
} from "../../src/core/document-model/types";

/**
 * The deck the visual regression check renders.
 *
 * It is fixed on purpose: every id, every colour and every number is written
 * out, so the exported file is the same on every run and a difference in the
 * rendering always comes from the exporter and not from the input.
 */

const EMU_PER_INCH = 914_400;
const inches = (value: number) => Math.round(value * EMU_PER_INCH);

const FONT = "Microsoft YaHei";

function element<T extends SlideElement>(value: T): T {
  return value;
}

function base(id: string, x: number, y: number, width: number, height: number) {
  return {
    id: id as ElementId,
    frame: { x: inches(x), y: inches(y), width: inches(width), height: inches(height) },
    rotationMilliDegree: 0,
    locked: false,
    origin: "user" as const,
  };
}

/** A small picture with a fixed pattern, so the image path is covered as well. */
function pictureDataUrl(): string {
  const width = 96;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 30 + Math.round((x / width) * 120);
      data[offset + 1] = 90 + Math.round((y / height) * 100);
      data[offset + 2] = 200;
      data[offset + 3] = 255;
    }
  }
  const bytes = encodePng({ width, height, data });
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

const TABLE_BLOCK: ContentBlock = {
  id: "block-metrics",
  type: "table-data",
  header: ["指标", "数值"],
  rows: [
    ["覆盖机构", "12 家"],
    ["检测样本量", "38 万"],
  ],
};

/** The metrics a chart reads. Their values share one unit, or the chart refuses them. */
const TREND_BLOCKS: ContentBlock[] = [
  { id: "block-metric-q1", type: "metric", label: "一季度", value: "62%" },
  { id: "block-metric-q2", type: "metric", label: "二季度", value: "71%" },
  { id: "block-metric-q3", type: "metric", label: "三季度", value: "78%" },
];

const MIX_BLOCKS: ContentBlock[] = [
  { id: "block-metric-east", type: "metric", label: "华东", value: "42%" },
  { id: "block-metric-south", type: "metric", label: "华南", value: "31%" },
  { id: "block-metric-other", type: "metric", label: "其他", value: "27%" },
];

function coverSlide(): Slide {
  return {
    id: "slide-cover" as SlideId,
    background: "#0E2A47",
    content: {
      title: "季度业务回顾",
      body: "",
      speakerNotes: "",
      status: "approved",
      contentHash: hashSlideContent({ title: "季度业务回顾", body: "", speakerNotes: "", blocks: [] }),
    },
    elements: [
      element({
        ...base("el-cover-title", 0.9, 1.6, 8, 1),
        type: "text",
        contentRef: "title",
        text: "季度业务回顾",
        style: { fontFamily: FONT, fontSizePt: 40, color: "#FFFFFF", bold: true, align: "left" },
      }),
      element({
        ...base("el-cover-subtitle", 0.9, 2.8, 8, 0.6),
        type: "text",
        contentRef: "body",
        text: "2026 上半年 · 增长与效率",
        style: { fontFamily: FONT, fontSizePt: 18, color: "#9FC5E8", bold: false, align: "left" },
      }),
      element({
        ...base("el-cover-rule", 0.9, 3.7, 2.2, 0.12),
        type: "shape",
        shape: "rectangle",
        style: { fill: "#4EA3E0", stroke: "#4EA3E0", strokeWidthPt: 0, radiusPt: 0 },
      }),
    ],
  };
}

function contentSlide(): Slide {
  const title = "关键指标";
  const body = "覆盖机构：12 家\n年度检测样本量：38 万\n结论：质量保持稳定";
  return {
    id: "slide-content" as SlideId,
    background: "#FFFFFF",
    content: {
      title,
      body,
      speakerNotes: "",
      status: "approved",
      blocks: [TABLE_BLOCK],
      contentHash: hashSlideContent({ title, body, speakerNotes: "", blocks: [TABLE_BLOCK] }),
    },
    elements: [
      element({
        ...base("el-content-title", 0.9, 0.6, 7, 0.7),
        type: "text",
        contentRef: "title",
        text: title,
        style: { fontFamily: FONT, fontSizePt: 26, color: "#0E2A47", bold: true, align: "left" },
      }),
      element({
        ...base("el-content-body", 0.9, 1.5, 5.6, 1.8),
        type: "text",
        contentRef: "body",
        text: body,
        style: { fontFamily: FONT, fontSizePt: 16, color: "#333333", bold: false, align: "left" },
      }),
      element({
        ...base("el-content-table", 7, 1.5, 5.4, 1.9),
        type: "table",
        contentBlockId: "block-metrics",
        style: {
          fontFamily: FONT,
          fontSizePt: 12,
          headerFill: "#0E2A47",
          headerTextColor: "#FFFFFF",
          bodyTextColor: "#333333",
          borderColor: "#C8D3DE",
          firstColumnBold: true,
        },
      }),
      element({
        ...base("el-content-picture", 0.9, 3.7, 2.4, 1.6),
        type: "image",
        source: { kind: "embedded", dataUrl: pictureDataUrl(), mimeType: "image/png" },
        altText: "用于视觉回归的样例图片",
        placement: "content",
      }),
    ],
  };
}

/** A page with a native chart, an ellipse and a turned object. */
function chartSlide(): Slide {
  const title = "季度完成率";
  const body = "连续三个季度完成率稳步提升。";
  return {
    id: "slide-chart" as SlideId,
    background: "#FFFFFF",
    content: {
      title,
      body,
      speakerNotes: "",
      status: "approved",
      blocks: TREND_BLOCKS,
      contentHash: hashSlideContent({ title, body, speakerNotes: "", blocks: TREND_BLOCKS }),
    },
    elements: [
      element({
        ...base("el-chart-title", 0.9, 0.6, 7, 0.7),
        type: "text",
        contentRef: "title",
        text: title,
        style: { fontFamily: FONT, fontSizePt: 26, color: "#0E2A47", bold: true, align: "left" },
      }),
      element({
        ...base("el-chart-body", 0.9, 5.9, 8, 0.6),
        type: "text",
        contentRef: "body",
        text: body,
        style: { fontFamily: FONT, fontSizePt: 14, color: "#555555", bold: false, align: "left" },
      }),
      element({
        ...base("el-chart-plot", 0.9, 1.5, 7.4, 4.2),
        type: "chart",
        contentBlockIds: TREND_BLOCKS.map((block) => block.id),
        kind: "column",
        style: {
          fontFamily: FONT,
          fontSizePt: 11,
          textColor: "#333333",
          seriesColors: ["#2B579A"],
          showLegend: false,
          showValueLabels: true,
        },
      }),
      element({
        ...base("el-chart-ellipse", 9.1, 2.2, 2.6, 2.6),
        type: "shape",
        shape: "ellipse",
        style: { fill: "#4EA3E0", stroke: "#1F6E9C", strokeWidthPt: 1, radiusPt: 0 },
      }),
      element({
        ...base("el-chart-turned", 9.1, 5.1, 2.8, 1),
        type: "shape",
        shape: "rectangle",
        rotationMilliDegree: 15_000,
        style: { fill: "#D35230", stroke: "#8E2C16", strokeWidthPt: 1, radiusPt: 8 },
      }),
    ],
  };
}

/** A dark page with a pie chart, so the legend and the data labels are covered too. */
function pieSlide(): Slide {
  const title = "收入构成";
  const body = "";
  return {
    id: "slide-pie" as SlideId,
    background: "#0E2A47",
    content: {
      title,
      body,
      speakerNotes: "",
      status: "approved",
      blocks: MIX_BLOCKS,
      contentHash: hashSlideContent({ title, body, speakerNotes: "", blocks: MIX_BLOCKS }),
    },
    elements: [
      element({
        ...base("el-pie-title", 0.9, 0.7, 7, 0.7),
        type: "text",
        contentRef: "title",
        text: title,
        style: { fontFamily: FONT, fontSizePt: 26, color: "#FFFFFF", bold: true, align: "left" },
      }),
      element({
        ...base("el-pie-plot", 1.4, 1.7, 6.6, 4.6),
        type: "chart",
        contentBlockIds: MIX_BLOCKS.map((block) => block.id),
        kind: "pie",
        style: {
          fontFamily: FONT,
          fontSizePt: 11,
          textColor: "#FFFFFF",
          seriesColors: ["#D35230", "#2B579A", "#217346"],
          showLegend: true,
          showValueLabels: true,
        },
      }),
    ],
  };
}

/** The deck the visual regression check exports and compares. */
export function visualRegressionFixture(): PresentationDocument {
  return {
    id: "doc-visual-regression" as PresentationDocument["id"],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "视觉回归夹具",
    pageSize: { width: inches(13.333), height: inches(7.5) },
    revisions: { document: 0, content: 0, design: 0 },
    slides: [coverSlide(), contentSlide(), chartSlide(), pieSlide()],
  };
}
