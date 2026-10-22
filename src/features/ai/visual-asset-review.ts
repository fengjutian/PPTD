/**
 * 配图意图的合规检查。
 *
 * 配图意图在内容阶段就产出，用户在审核页看得见、改得动。改得动意味着也可能
 * 改坏，所以这里有一组确定性的检查，在审核阶段就把问题摆出来。
 *
 * 规则表是共享资产（`assets/content-lexicon.json`），前端据此检测，后端据此
 * 写生成提示。两边读同一份文件，提示和检测不会各说各话。
 *
 * 这些问题都**不阻塞**审核：内容本身没有问题，图的事可以之后再定。
 */

import lexicon from "../../../assets/content-lexicon.json";
import type { AiDraft } from "../../services/ai-service";

/** 提示词里不该出现的词：生成图里的文字几乎总是错的。 */
const TEXT_REQUEST_WORDS: readonly string[] = lexicon.imagePrompt.textRequestWords;
/** 整册配图的上限。再多就是相册，不是演示。 */
const MAX_IMAGES_PER_DECK: number = lexicon.imagePrompt.maxImagesPerDeck;
/** 这些内容块自己就是版面，再叠一张图会一页讲两件事。 */
const STRUCTURED_BLOCK_TYPES: readonly string[] = lexicon.imagePrompt.structuredBlockTypes;

/** 配图意图的问题分类。 */
export type VisualAssetIssueKind =
  | "image-text-request"
  | "image-empty-prompt"
  | "image-on-structured-page"
  | "image-over-limit";

/** 一条配图意图问题。 */
export interface VisualAssetIssue {
  /** 第几页（从 0 开始）。 */
  slideIndex: number;
  kind: VisualAssetIssueKind;
  message: string;
}

/** 提示词里是不是在要求画面出现文字。 */
export function requestsTextInImage(prompt: string): boolean {
  const lowered = prompt.toLowerCase();
  return TEXT_REQUEST_WORDS.some((word) => lowered.includes(word.toLowerCase()));
}

/** 这一页的内容块是不是已经占满了版面。 */
export function hasStructuredBlock(slide: AiDraft["slides"][number]): boolean {
  return (slide.blocks ?? []).some((block) => STRUCTURED_BLOCK_TYPES.includes(block.type));
}

/**
 * 整册的配图意图有哪些问题。
 *
 * 逐页检查加上整册检查：单页都合规，整册也可能配得太多。
 */
export function visualAssetIssues(draft: AiDraft): VisualAssetIssue[] {
  const issues: VisualAssetIssue[] = [];
  const enabledIndexes: number[] = [];

  draft.slides.forEach((slide, index) => {
    const intent = slide.plan?.visualAsset;
    if (!intent?.enabled) return;
    enabledIndexes.push(index);
    const prompt = intent.prompt.trim();
    if (!prompt) {
      issues.push({ slideIndex: index, kind: "image-empty-prompt", message: "这一页要配图，但没有画面描述，生成出来会很泛" });
      return;
    }
    if (requestsTextInImage(prompt)) {
      issues.push({ slideIndex: index, kind: "image-text-request", message: "画面描述里要求出现文字或字母，生成图的文字几乎总是错的" });
    }
    if (hasStructuredBlock(slide)) {
      issues.push({ slideIndex: index, kind: "image-on-structured-page", message: "这一页已有结构化内容块，再配图会一页讲两件事" });
    }
  });

  if (enabledIndexes.length > MAX_IMAGES_PER_DECK) {
    // 超出上限的部分从第一张多余的图开始算起。
    issues.push({
      slideIndex: enabledIndexes[MAX_IMAGES_PER_DECK]!,
      kind: "image-over-limit",
      message: `整册配图 ${enabledIndexes.length} 张，超过 ${MAX_IMAGES_PER_DECK} 张的上限`,
    });
  }

  return issues;
}

/** 一页的配图意图在审核页上显示成什么。 */
export function visualAssetSummary(slide: AiDraft["slides"][number]): { role: string; prompt: string; enabled: boolean } | undefined {
  const intent = slide.plan?.visualAsset;
  if (!intent) return undefined;
  const roleLabels: Record<string, string> = { hero: "主视觉", side: "侧栏图", band: "通栏图" };
  return { role: roleLabels[intent.role] ?? intent.role, prompt: intent.prompt, enabled: intent.enabled };
}
