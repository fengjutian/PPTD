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

export function variantFailureMessage(error: unknown): { code: string; message: string } {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("AI_REQUEST_TIMEOUT")) return { code: "AI_REQUEST_TIMEOUT", message: "AI 请求超时" };
  if (detail.startsWith("VARIANT_QUALITY_GATE_FAILED:")) {
    const reasons = detail.slice("VARIANT_QUALITY_GATE_FAILED:".length).split(",");
    const labels: Record<string, string> = {
      "low-contrast": "文字对比度不足",
      "text-orphan": "存在孤立文本",
      AESTHETIC_IMAGE_RELEVANCE_LOW: "图片相关性不足",
      AESTHETIC_SCORE_BELOW_THRESHOLD: "综合审美评分不足",
    };
    const readable = [...new Set(reasons.map((reason) => labels[reason.replace(/:\d+$/, "")] ?? reason))];
    return { code: "VARIANT_QUALITY_GATE_FAILED", message: `质量检查未通过：${readable.join("、")}` };
  }
  const code = /^([A-Z][A-Z0-9_]{2,63})(?::|$)/.exec(detail)?.[1] ?? "VARIANT_GENERATION_FAILED";
  return { code, message: detail };
}
