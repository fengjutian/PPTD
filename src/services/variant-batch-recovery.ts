import { designWithRecipe, type AiSlideDesign } from "../core/commands";
import type { RecipeId } from "../core/design/deck-concept";
import { RECIPE_CATALOG } from "../core/layout/recipes/catalog";
import type { GeneratedVisualAsset, VisualAssetDecision } from "./ai-visual-asset";

export interface MissingAssetRecovery {
  designs: AiSlideDesign[];
  recoveredSlideIndexes: number[];
}

function fallbackRecipe(design: AiSlideDesign, slideIndex: number, itemCount: number): RecipeId {
  if (design.layout === "cover" || slideIndex === 0) return "cover-statement";
  if (design.layout === "section") return "section-statement";
  return itemCount >= 3 ? "editorial-index" : "asymmetric-split";
}

/**
 * Image generation is an optional external dependency. When an approved image
 * request produces no pixels, move that page to a renderer-backed no-image
 * family before quality evaluation instead of rejecting the whole deck.
 */
export function recoverMissingVisualAssets(input: {
  designs: readonly AiSlideDesign[];
  decisions: readonly VisualAssetDecision[];
  assets: readonly GeneratedVisualAsset[];
  itemCounts: readonly number[];
}): MissingAssetRecovery {
  const available = new Set(input.assets.map((asset) => asset.slideIndex));
  const recoveredSlideIndexes: number[] = [];
  const designs = input.designs.map((design, slideIndex) => {
    const planned = input.decisions[slideIndex]?.enabled === true;
    const recipeNeedsImage = design.recipe ? RECIPE_CATALOG[design.recipe]?.requiresImage === true : false;
    if ((!planned && !recipeNeedsImage && !design.visualAsset?.enabled) || available.has(slideIndex)) return design;
    recoveredSlideIndexes.push(slideIndex);
    const withoutImage: AiSlideDesign = { ...design, visualAsset: { enabled: false } };
    return designWithRecipe(withoutImage, fallbackRecipe(design, slideIndex, input.itemCounts[slideIndex] ?? 0));
  });
  return { designs, recoveredSlideIndexes };
}

/**
 * 确定性检查与审美合同的稳定原因码。用户读到的是原因，不是错误码本身。
 *
 * 键必须与 `presentation-quality-gate` 的 issue 名和
 * `scorePresentationAesthetics` 生成的 `AESTHETIC_*` 一致；未知码原样展示，
 * 不为了好看把它藏起来。
 */
const REASON_LABELS: Record<string, string> = {
  "low-contrast": "文字对比度不足",
  "text-overflow": "文本容量超出文本框",
  "out-of-bounds": "对象超出页面边界",
  "text-overlap": "文本发生可见重叠",
  "obstacle-overlap": "文本压住页脚或 Logo",
  "table-overflow": "表格高度超出文本框",
  "text-orphan": "存在孤立文本",
  AESTHETIC_CONTENT_UNDERFILLED: "页面内容过空",
  AESTHETIC_SCORE_BELOW_THRESHOLD: "综合审美评分不足",
};

/** `AESTHETIC_<维度>_LOW` 的维度名。 */
const DIMENSION_LABELS: Record<string, string> = {
  HIERARCHY: "标题与正文层级不清",
  BALANCE: "版面重心失衡",
  RHYTHM: "页面节奏重复",
  HOMOGENEITY: "与其他版本过于雷同",
  IMAGE_RELEVANCE: "配图与内容无关",
  COVERAGE: "页面留白过多",
  VISUAL_ANCHOR: "缺少视觉锚点",
};

/** 逐页原因码：同一错误重复出现时，页码比笼统的类别更有用。 */
const PAGE_REASON = /^(SLIDE_UNDERFILLED|REAL_ASSET_REQUIRED|COVER_TEXT_OVERLAP):(\d+)$/;

function reasonLabel(reason: string): string {
  const page = PAGE_REASON.exec(reason);
  if (page) {
    const pageNumber = Number(page[2]) + 1;
    if (page[1] === "SLIDE_UNDERFILLED") return `第 ${pageNumber} 页内容过空`;
    if (page[1] === "REAL_ASSET_REQUIRED") return `第 ${pageNumber} 页缺少配图`;
    return `第 ${pageNumber} 页封面文字重叠`;
  }
  if (reason.startsWith("AESTHETIC_") && reason.endsWith("_LOW")) {
    const dimension = reason.slice("AESTHETIC_".length, -"_LOW".length);
    return DIMENSION_LABELS[dimension] ?? "综合审美评分不足";
  }
  return REASON_LABELS[reason] ?? reason;
}

export function variantFailureMessage(error: unknown): { code: string; message: string } {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("AI_REQUEST_TIMEOUT")) return { code: "AI_REQUEST_TIMEOUT", message: "AI 请求超时" };
  if (detail.startsWith("VARIANT_QUALITY_GATE_FAILED:")) {
    const reasons = detail.slice("VARIANT_QUALITY_GATE_FAILED:".length).split(",");
    const readable = [...new Set(reasons.filter(Boolean).map(reasonLabel))];
    return {
      code: "VARIANT_QUALITY_GATE_FAILED",
      message: readable.length > 0 ? `质量检查未通过：${readable.join("、")}` : "质量检查未通过",
    };
  }
  const code = /^([A-Z][A-Z0-9_]{2,63})(?::|$)/.exec(detail)?.[1] ?? "VARIANT_GENERATION_FAILED";
  return { code, message: detail };
}

/**
 * 零产出的批量要有可执行的结论，而不是只报告"没有产出"。
 *
 * ADR 0117 要求批量汇总不得把超时、Schema 错误和质量门拒绝折叠成没有上下
 * 文的零产出；这里按出现次数排序，把最主要的原因带进状态栏（面板里仍保留
 * 每个版本的完整记录）。
 */
export function summarizeVariantFailures(failures: readonly { message: string }[], total: number): string {
  const counts = new Map<string, number>();
  for (const failure of failures) counts.set(failure.message, (counts.get(failure.message) ?? 0) + 1);
  const reasons = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([message, count]) => (count > 1 ? `${message} ×${count}` : message));
  return reasons.length > 0 ? `${total} 个版本都没有产出（${reasons.join("、")}）` : `${total} 个版本都没有产出`;
}
