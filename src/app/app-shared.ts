import { type TemplateAnalysis } from "../services/project-files";

import { type ThemePreset } from "../core/design/theme-presets";

import { type ThemeAudience, type ThemeContentDensity, type ThemePageType } from "../core/design/theme-preset-metadata";

import { type VisualReview } from "../services/visual-alignment";
import { type ReviewEvidence } from "../services/design-quality-stage";

import { type TemplateFitCode } from "../services/template-review-target";

export const CANVAS_WIDTH = 960;
/** 主题详情里的色板槽位与元数据用中文角色名呈现，原始 id 仍留给开发与复制。 */
export const themeColorRoleLabels: Record<string, string> = {
  primary: "正文与标题",
  accent: "主强调",
  accent2: "辅助强调",
  accent3: "点缀",
  muted: "次要文字",
  surface: "页面底色",
  surfaceAlt: "浅色底",
  surfaceRaised: "浮起面",
  border: "分隔线",
  textMuted: "图注与来源",
  accentSubtle: "强调色带",
};
export const themeAudienceLabels: Record<ThemeAudience, string> = {
  general: "通用",
  education: "教育",
  executive: "管理层",
  professional: "专业",
  public: "公共事务",
  consumer: "消费",
};
export const themePageTypeLabels: Record<ThemePageType, string> = {
  cover: "封面",
  section: "章节",
  narrative: "正文",
  comparison: "对比",
  metrics: "指标",
  table: "表格",
  chart: "图表",
  image: "图片",
  summary: "结论",
};
export const themeDensityLabels: Record<ThemeContentDensity, string> = {
  airy: "疏朗",
  balanced: "均衡",
  compact: "紧凑",
};
/** 视觉评审的问题类型 → 用户能读懂的中文。 */
export const visualIssueLabels: Record<VisualReview["issues"][number]["issue"], string> = {
  "weak-hierarchy": "层级不强",
  "poor-contrast": "对比度不足",
  "visual-imbalance": "构图失衡",
  "background-conflict": "背景干扰",
  misalignment: "元素未对齐",
  "excessive-empty-space": "留白过多",
  "repetitive-layout": "版式重复",
  "theme-mismatch": "主题不匹配",
  "weak-visual-focus": "视觉焦点不清",
  "generic-layout": "版式过于通用",
  "template-mismatch": "模板不匹配",
};
export const templateFitLabels: Record<TemplateFitCode, string> = {
  "template-title-axis": "标题轴线偏离模板",
  "template-content-bounds": "正文超出模板内容区",
  "template-title-size": "标题字号偏离模板",
  "template-body-size": "正文字号偏离模板",
  "template-palette": "颜色偏离模板色板",
  "template-font": "字体偏离模板",
  "template-align": "段落对齐偏离模板",
  "template-line-spacing": "行距偏离模板",
};
/** The narrowest and the widest the property panel may be dragged to. */
export const INSPECTOR_MIN_WIDTH = 220;
export const INSPECTOR_MAX_WIDTH = 520;
export const INSPECTOR_WIDTH_KEY = "pptd.inspector-width";

/**
 * The width of the property panel is a display preference. It is kept in the
 * local storage of the application, because it belongs to the window and not
 * to the document.
 */
export function readInspectorWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= INSPECTOR_MIN_WIDTH && stored <= INSPECTOR_MAX_WIDTH) return stored;
  } catch {
    // A window without a local storage keeps the default width.
  }
  return 252;
}
export type AppView = "editor" | "ai" | "theme" | "settings";
export type PageMessage = { id: number; text: string; kind: "info" | "success" | "error" };
export type DesignProgress = { percent: number; label: string };

/**
 * One generated design variant, as the gallery needs it.
 *
 * The full design stays in the runtime; this view carries only what a card
 * draws, so the gallery cannot accidentally edit a design.
 */
export interface VariantOptionView {
  id: string;
  presetId: string;
  name: string;
  description: string;
  /** Why the AI picked this template for this deck. */
  reason: string;
  /** Two representative rendered pages, cover first. */
  images: string[];
  /** Pages in the designed deck, so the full preview can say how much it will render. */
  pageCount: number;
  issueCount: number;
}

/** How far the variant batch has got; `failed` counts attempts that produced no card. */
export interface VariantBatchProgress {
  total: number;
  completed: number;
  failed: number;
}

/** The user's answer to the direction gate. */
export type DirectionChoice =
  { kind: "select"; id: string; words?: string } | { kind: "skip"; words?: string } | { kind: "retry" };

export function parityIssueLabel(
  kind: "missing-slide" | "missing-text" | "picture-count" | "table-count" | "chart-count",
) {
  switch (kind) {
    case "missing-slide":
      return "页面缺失";
    case "missing-text":
      return "文字缺失";
    case "picture-count":
      return "图片数量不符";
    case "table-count":
      return "表格数量不符";
    case "chart-count":
      return "图表数量不符";
  }
}

export function reviewEvidenceLabel(evidence: ReviewEvidence): string {
  if (evidence.renderer === "powerpoint" && evidence.evidence === "final") {
    return "PowerPoint 真实渲染导出文稿（最终画面）";
  }
  if (evidence.renderer === "canvas" && evidence.evidence === "layout") {
    return `画布近似渲染（版式预览，非最终断行与字体度量）${evidence.reason ? "；真实渲染不可用" : ""}`;
  }
  return "仅确定性校验（视觉评审未运行）";
}

/** 已用时。分钟也按两位显示，进度提示里的数字不会一会儿宽一会儿窄。 */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export type TemplateLayoutRender = { layoutIndex: number; layoutName: string; dataUrl: string };

export function matchTemplateLayoutRender(
  renders: TemplateLayoutRender[],
  layoutIndex: number,
  layoutName: string,
): TemplateLayoutRender | undefined {
  const normalizedName = layoutName.trim().toLocaleLowerCase();
  const nameMatches = renders.filter((render) => render.layoutName.trim().toLocaleLowerCase() === normalizedName);
  if (nameMatches.length > 0)
    return nameMatches.sort(
      (left, right) => Math.abs(left.layoutIndex - layoutIndex) - Math.abs(right.layoutIndex - layoutIndex),
    )[0];
  return renders.find((render) => render.layoutIndex === layoutIndex);
}

/**
 * The template context of a deck that is not built from a PPTX.
 *
 * A preset owns the palette, the fonts and the type scale, but it is not a
 * layout: the analysis is deliberately empty of slides and layouts so the
 * design stage cannot reference a placeholder that does not exist. Page size
 * matches the default 16:9 document.
 */
export function presetTemplateAnalysis(preset: ThemePreset): TemplateAnalysis {
  const color = (slot: string) => preset.theme.colors.find((entry) => entry.name === slot)?.value ?? "#FFFFFF";
  return {
    contentHash: `preset:${preset.id}`,
    slideCount: 0,
    slideWidthEmu: 12192000,
    slideHeightEmu: 6858000,
    masterCount: 0,
    layoutCount: 0,
    themeCount: 1,
    themeColors: [
      { name: "accent1", value: color("accent") },
      { name: "accent2", value: color("accent2") },
      { name: "accent3", value: color("accent3") },
      { name: "lt1", value: color("surface") },
      { name: "lt2", value: color("surfaceAlt") },
      { name: "dk1", value: color("primary") },
    ],
    majorFont: preset.theme.majorFont,
    minorFont: preset.theme.minorFont,
    defaultBackgroundColor: color("surface"),
    defaultDecorations: [],
    slides: [],
    layouts: [],
    warnings: [],
  };
}
