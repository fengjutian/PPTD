import { hexToHsl } from "../rendering/color-analysis";
import type { ConceptPresetId } from "./deck-concept";
import { THEME_PRESET_RULES } from "./theme-preset-inference";
import { themePresetMetadata } from "./theme-preset-metadata";
import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS, findThemePreset } from "./theme-presets";

/**
 * Which reviewed content should drive which preset.
 *
 * The picker used to pre-select `inferThemePresetId`, i.e. the first keyword
 * family that matched the title. That is one fact about a deck, and it cannot
 * choose eight different looks or justify itself. This module scores every
 * preset on the facts we actually have before generation — the subject words,
 * how much structured data the reviewed copy carries, how many picture slots
 * the content stage asked for, and how dense the copy is — and returns an
 * ordered, explainable list.
 *
 * Deterministic on purpose: the same deck must get the same recommendation on
 * every run, and a test can pin the reasons. The model is used for the design,
 * not for this ranking.
 */

export interface ThemeContentSignals {
  /** Title or topic of the reviewed draft. */
  title: string;
  /** Reviewed body copy. Only words and length are read; nothing is stored. */
  bodyText?: string;
  slideCount?: number;
  chartCount?: number;
  tableCount?: number;
  metricCount?: number;
  /** Pages whose content plan asked for a generated picture. */
  imageSlotCount?: number;
}

export interface ThemePresetChoice {
  presetId: string;
  name: string;
  description: string;
  score: number;
  /** One sentence the picker can show next to the preset. */
  reason: string;
}

/** Copy longer than this per page reads as a structured, evidence-heavy deck. */
const DENSE_COPY_PER_SLIDE = 140;
/** Copy shorter than this per page reads as a sparse, statement-led deck. */
const SPARSE_COPY_PER_SLIDE = 60;
/** Two presets whose accents sit within this many degrees read as the same colour. */
const SIMILAR_HUE_GAP = 18;
/** How many presets of one accent family a batch may contain. */
const MAX_PER_HUE = 2;
/** Colourless presets form their own family; one per batch is enough. */
const MAX_NEUTRAL_PRESETS = 1;

/**
 * Ranks every built-in preset for one reviewed draft.
 *
 * The first entry is the same preset `inferThemePresetId` would pick when a
 * subject family matches; the rest are scored on content fit, so a data-heavy
 * report prefers the presets that own chart/table pages even when no keyword
 * matched at all.
 */
export function rankThemePresets(signals: ThemeContentSignals): ThemePresetChoice[] {
  const title = signals.title.toLowerCase();
  const body = (signals.bodyText ?? "").toLowerCase().slice(0, 2000);
  const titleMatches = THEME_PRESET_RULES.filter((rule) => rule.pattern.test(title));
  const bodyMatches = THEME_PRESET_RULES.filter(
    (rule) => !titleMatches.includes(rule) && rule.pattern.test(body),
  );
  const structured = (signals.chartCount ?? 0) + (signals.tableCount ?? 0);
  const charts = signals.chartCount ?? 0;
  const tables = signals.tableCount ?? 0;
  const metrics = signals.metricCount ?? 0;
  const images = signals.imageSlotCount ?? 0;
  const slideCount = Math.max(1, signals.slideCount ?? 1);
  const averageBody = (signals.bodyText?.length ?? 0) / slideCount;
  const hasAnySignal = titleMatches.length > 0 || bodyMatches.length > 0 || structured > 0 || images > 0;

  const scored = THEME_PRESETS.map((preset, catalogIndex) => {
    const metadata = themePresetMetadata(preset.id);
    const pageTypes = metadata.recommendedPageTypes;
    const titleRule = titleMatches.find((rule) => rule.presetId === preset.id);
    const bodyRule = bodyMatches.find((rule) => rule.presetId === preset.id);
    let score = 0;
    if (titleRule) score += titleRule === titleMatches[0] ? 100 : 30;
    if (bodyRule) score += 8;
    // A structured page only holds together when the preset was drawn for it.
    // A table is the stronger evidence: `dataPages` presets own a real table
    // page, while the general presets only list a chart.
    if (tables > 0 && pageTypes.some((type) => type === "table")) score += Math.min(10, tables * 5);
    if (charts > 0 && pageTypes.some((type) => type === "chart")) score += Math.min(6, charts * 3);
    if (metrics > 0 && pageTypes.some((type) => type === "metrics")) score += Math.min(6, metrics * 2);
    if (images > 0 && pageTypes.some((type) => type === "image")) score += Math.min(6, images * 2);
    // Many structured pages is a compact, evidence-first deck; an airy preset
    // would spend the same page on white space and break the comparison.
    if (structured >= 3 && metadata.density === "compact") score += 3;
    if (averageBody > DENSE_COPY_PER_SLIDE) {
      score += metadata.density === "compact" ? 6 : metadata.density === "airy" ? -3 : 2;
    } else if (averageBody > 0 && averageBody < SPARSE_COPY_PER_SLIDE) {
      score += metadata.density === "airy" ? 6 : metadata.density === "compact" ? -2 : 2;
    }
    // With no subject and no structural evidence, the general-purpose preset
    // is the honest answer rather than whichever palette happens to be first.
    if (!hasAnySignal && structured === 0 && preset.id === DEFAULT_THEME_PRESET_ID) score += 20;
    return { preset, metadata, score, catalogIndex, titleRule, bodyRule };
  });

  return scored
    .sort((left, right) => right.score - left.score || left.catalogIndex - right.catalogIndex)
    .map(({ preset, metadata, score, titleRule, bodyRule }): ThemePresetChoice => ({
      presetId: preset.id,
      name: preset.name,
      description: preset.description,
      score,
      reason: reasonFor({ metadata, structured, metrics, images, titleRule, bodyRule, hasAnySignal }),
    }));
}

interface ReasonInput {
  metadata: ReturnType<typeof themePresetMetadata>;
  structured: number;
  metrics: number;
  images: number;
  titleRule?: (typeof THEME_PRESET_RULES)[number];
  bodyRule?: (typeof THEME_PRESET_RULES)[number];
  hasAnySignal: boolean;
}

function reasonFor(input: ReasonInput): string {
  const parts: string[] = [];
  const label = input.titleRule?.label ?? input.bodyRule?.label;
  if (label) parts.push(`题材匹配「${label}」`);
  else if (!input.hasAnySignal) parts.push("题材没有明显指向，用通用节奏最稳");
  else parts.push("题材没有直接命中，按页面类型和正文量匹配");
  if (input.structured > 0 && input.metadata.recommendedPageTypes.some((type) => type === "chart" || type === "table")) {
    parts.push(`本稿有 ${input.structured} 个图表或表格页，正好用它推荐的证据页`);
  } else if (input.metrics > 0 && input.metadata.recommendedPageTypes.some((type) => type === "metrics")) {
    parts.push(`本稿有 ${input.metrics} 处关键数字，适合它的指标页`);
  } else if (input.images > 0 && input.metadata.recommendedPageTypes.some((type) => type === "image")) {
    parts.push(`本稿有 ${input.images} 个配图位，适合它的图文页`);
  }
  return parts.join("；");
}

/**
 * Picks the presets for one batch of design variants.
 *
 * Relevance first, repetition second.
 *
 * The batch keeps the score order: it walks the ranked list and takes the next
 * preset whose accent is not a near-duplicate of two already chosen. The cap
 * matters because the accent wheel is clustered (five presets are blue, three
 * are teal): a purely "most distant hue" walk filled an annual report with
 * green, rose and red templates just because tech-blue was the second-best fit.
 * When every remaining preset violates the cap, the best-scoring one is taken
 * anyway — returning seven versions for an eight-version request would be a
 * worse answer than two of them sharing a blue.
 */
export function planThemePresetVariants(signals: ThemeContentSignals, count: number): ThemePresetChoice[] {
  const ranked = rankThemePresets(signals);
  const wanted = Math.max(1, Math.min(Math.floor(count) || 1, ranked.length));
  const remaining = [...ranked];
  const picked: ThemePresetChoice[] = [];
  while (picked.length < wanted && remaining.length > 0) {
    const pickedHues = picked
      .map((choice) => themePresetAccentHue(choice.presetId))
      .filter((hue): hue is number => hue !== undefined);
    const neutralCount = picked.filter((choice) => themePresetAccentHue(choice.presetId) === undefined).length;
    const index = remaining.findIndex((choice) => {
      const hue = themePresetAccentHue(choice.presetId);
      if (hue === undefined) return neutralCount < MAX_NEUTRAL_PRESETS;
      return pickedHues.filter((pickedHue) => hueDistance(pickedHue, hue) < SIMILAR_HUE_GAP).length < MAX_PER_HUE;
    });
    const [next] = remaining.splice(index >= 0 ? index : 0, 1);
    if (!next) break;
    picked.push(next);
  }
  return picked;
}

/**
 * The skeleton a preset can carry when the concept call is unavailable.
 *
 * Theme presets own palette and type; the concept owns composition. Pairing
 * them this way keeps a failed concept request from blocking the batch, and it
 * keeps the eight variants on one skeleton instead of eight unrelated ones.
 */
export function defaultConceptIdForTheme(presetId: string): ConceptPresetId {
  const metadata = themePresetMetadata(presetId);
  const pages = metadata.recommendedPageTypes;
  const dataHeavy = pages.some((type) => type === "chart") && pages.some((type) => type === "table");
  if (dataHeavy) return "instrument";
  if (metadata.scenarios.some((scenario) => /文学|诗词|古典|人文|阅读/.test(scenario))) return "paper";
  if (pages.some((type) => type === "image") && metadata.density === "airy") return "documentary";
  return "editorial";
}

/**
 * The accent hue that decides whether two presets read as the same colour.
 *
 * A preset whose accent is a neutral has no hue to compare, so the chain keeps
 * looking: `minimal-gray` says "almost no colour" with a near-black accent, but
 * its brass mark is the only chromatic note on the page.
 */
export function themePresetAccentHue(presetId: string): number | undefined {
  const preset = findThemePreset(presetId);
  if (!preset) return undefined;
  const byName = new Map(preset.theme.colors.map((color) => [color.name, color.value]));
  for (const slot of ["accent", "accent2", "accent3", "primary"]) {
    const value = byName.get(slot);
    const hsl = value ? hexToHsl(value) : undefined;
    // A grey has no meaningful hue; letting it satisfy the gap would make the
    // next pick look diverse on paper and identical on screen.
    if (hsl && hsl.s >= 0.15) return hsl.h;
  }
  return undefined;
}

function hueDistance(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}
