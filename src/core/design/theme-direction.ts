import type { DeckConcept } from "./deck-concept";
import { themePresetGuidance } from "./theme-preset-guidance";
import { themePresetMetadata, type ThemeContentDensity, type ThemePageType } from "./theme-preset-metadata";
import type { ThemePreset } from "./theme-presets";

/**
 * The part of a theme that is safe to send to a design model.
 *
 * This is deliberately structured rather than the human-facing art-direction
 * paragraph: the model gets the same facts the picker shows, without a block of
 * prose that can silently disagree with the renderer's actual capabilities.
 */
export interface ThemeDirection {
  presetId: string;
  name: string;
  character: string;
  scenarios: readonly string[];
  audiences: readonly string[];
  pageRhythm: string;
  imageStyle: string;
  density: ThemeContentDensity;
  recommendedPageTypes: readonly ThemePageType[];
  fontFallbacks: { latin: readonly string[]; eastAsian: readonly string[] };
  chartPalette: readonly string[];
  forbiddenCombinations: readonly string[];
  colors: readonly { name: string; value: string }[];
  fonts: { major: string; minor: string };
  typeScale: { displayPt: number; titlePt: number; bodyPt: number };
}

export interface ThemeDirectionAudit {
  status: "sent" | "partial" | "unmapped";
  notes: string[];
  /** Direction requirements the current renderer cannot express. */
  unsupported: string[];
}

/** Image-direction phrases that imply a layout we do not render yet. */
const UNSUPPORTED_LAYOUT_TERMS = ["拼贴", "collage", "蒙太奇", "杂志跨页", "全出血文字", "动态图形"];

export function themeDirectionForPreset(preset: ThemePreset): ThemeDirection {
  const guidance = themePresetGuidance(preset.id);
  const metadata = themePresetMetadata(preset.id);
  const styles = preset.theme.textStyles;
  return {
    presetId: preset.id,
    name: preset.name,
    character: guidance.character,
    scenarios: guidance.scenarios,
    audiences: metadata.audiences,
    pageRhythm: guidance.pageRhythm,
    imageStyle: guidance.imageStyle,
    density: metadata.density,
    recommendedPageTypes: metadata.recommendedPageTypes,
    fontFallbacks: metadata.fontFallbacks,
    chartPalette: metadata.chartPalette,
    forbiddenCombinations: metadata.forbiddenCombinations,
    colors: preset.theme.colors.map((color) => ({ name: color.name, value: color.value })),
    fonts: { major: preset.theme.majorFont, minor: preset.theme.minorFont },
    typeScale: {
      displayPt: styles?.display?.fontSizePt ?? 44,
      titlePt: styles?.title?.fontSizePt ?? 30,
      bodyPt: styles?.body?.fontSizePt ?? 16,
    },
  };
}

/**
 * Tells the report what the theme direction can and cannot actually change.
 *
 * The prompt can say "collage"; the renderer only has single-image, editorial
 * and data recipes. Reporting the gap is better than letting the model promise
 * a layout that will never appear.
 */
export function auditThemeDirection(
  direction: ThemeDirection | undefined,
  concept: DeckConcept | undefined,
): ThemeDirectionAudit {
  if (!direction) {
    return {
      status: "unmapped",
      notes: ["本次使用上传模板，主题方向没有注入 AI；模板自身的颜色、字体和占位区是唯一视觉上下文。"],
      unsupported: [],
    };
  }

  const unsupported = UNSUPPORTED_LAYOUT_TERMS.filter((term) => direction.imageStyle.includes(term));
  const notes = [
    `主题方向已发送到概念与逐页设计请求：${direction.name}。`,
    `当前可用配方：${concept?.recipes.join("、") ?? "未确定"}。`,
    `图片方向：${direction.imageStyle}`,
  ];
  if (unsupported.length > 0) {
    notes.push(`图片方向包含「${unsupported.join("、")}」，当前配方没有这种构图，该项不会生效。`);
  }
  const legacyPages = direction.recommendedPageTypes.filter(
    (page) => page === "table" || page === "chart" || page === "section",
  );
  if (legacyPages.length > 0) {
    notes.push(`推荐页型中的 ${legacyPages.join("、")} 仍由结构化或旧分支承接，不在 recipe 覆盖范围内。`);
  }
  if (direction.forbiddenCombinations.length > 0) {
    notes.push("禁止组合已写入提示词；渲染器尚未逐条校验，仍需视觉评审兜底。");
  }

  return {
    status: unsupported.length > 0 || !concept ? "partial" : "sent",
    notes,
    unsupported,
  };
}
