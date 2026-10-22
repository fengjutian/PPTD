import { invoke } from "@tauri-apps/api/core";
import { buildVisualAssetPrompt, resolveVisualAsset } from "../core/commands/visual-asset";
import type { AiSlideDesign } from "../core/commands/template-layouts";

/**
 * 生成页面配图。
 *
 * 配图是外部依赖：可能没有凭据、可能超时、可能被限流。因此这里的失败一律
 * 不抛——一页没有图只是少一张图，整份文稿必须照样成立。调用方拿到的是
 * "哪些页有图"，而不是"成功还是失败"。
 */

/** 一页生成好的配图。 */
export interface GeneratedVisualAsset {
  /** 页面索引。 */
  slideIndex: number;
  /** 图片数据。 */
  dataUrl: string;
  /** 图片类型。 */
  mimeType: string;
  /** 图片的原始像素宽。 */
  naturalWidth: number;
  /** 图片的原始像素高。 */
  naturalHeight: number;
  /** 替代文字。 */
  altText: string;
}

/** 一页要配图的决定，以及失败的原因。 */
export interface VisualAssetPlanEntry {
  slideIndex: number;
  /** 这一页最终有没有图。 */
  generated: boolean;
  /** 为什么没有图。 */
  reason?: string;
}

/** 生成一页配图的结果。 */
interface ImageResult {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * 为一页生成配图。
 *
 * 尺寸跟着页面上的框走：主视觉是竖着的半页，侧栏是竖着的小块，
 * 通栏是横着的一条。图的比例和框不一致，裁剪会切掉不少内容。
 */
export async function generateVisualAsset(input: {
  prompt: string;
  role: "hero" | "side" | "band";
}): Promise<GeneratedVisualAsset | undefined> {
  const size = input.role === "band" ? { width: 1280, height: 720 } : { width: 1024, height: 1024 };
  try {
    const result = await invoke<ImageResult>("generate_presentation_image", {
      request: { prompt: input.prompt, width: size.width, height: size.height },
    });
    if (!result?.dataUrl) return undefined;
    return {
      slideIndex: -1,
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      naturalWidth: result.width,
      naturalHeight: result.height,
      altText: input.prompt.slice(0, 200),
    };
  } catch {
    // 图片生成失败不是文稿失败。少一张图的文稿仍然是可以导出的文稿。
    return undefined;
  }
}

/** 一次生成里配图的上限。整册都配图会变成相册，也会烧掉大量额度。 */
const MAX_ASSETS_PER_DECK = 4;

/** 一页配不配图的决定。 */
export interface VisualAssetDecision {
  /** 是否配图。 */
  enabled: boolean;
  /** 配图的角色。 */
  role?: "hero" | "side" | "band";
  /** 为什么不配。 */
  reason?: string;
}

/**
 * 决定哪些页配图、怎么配。
 *
 * 决定权来自两处：AI 说这一页想配图，排版引擎说这一页配得下。两者都同意
 * 才有图。整册的配图数量也有上限，否则一份二十页的文稿会变成相册。
 */
export function planVisualAssets(input: {
  designs: readonly AiSlideDesign[];
  /** 每一页的要点条数。 */
  itemCounts: readonly number[];
  /** 每一页是否有结构化内容块。 */
  deterministicBlocks: readonly boolean[];
  /** 整套演示的主题，写进提示词。 */
  topic: string;
}): { decisions: VisualAssetDecision[]; prompts: Map<number, string> } {
  const decisions: VisualAssetDecision[] = [];
  const prompts = new Map<number, string>();
  let granted = 0;
  input.designs.forEach((design, index) => {
    const decision = resolveVisualAsset({
      layout: design.layout,
      itemCount: input.itemCounts[index] ?? 0,
      hasDeterministicBlock: input.deterministicBlocks[index] ?? false,
      requested: Boolean(design.visualAsset?.enabled),
      requestedRole: design.visualAsset?.role,
    });
    if (!decision.enabled) {
      decisions.push({ enabled: false, reason: decision.reason });
      return;
    }
    if (granted >= MAX_ASSETS_PER_DECK) {
      decisions.push({ enabled: false, reason: `整册配图不超过 ${MAX_ASSETS_PER_DECK} 张` });
      return;
    }
    granted += 1;
    decisions.push({ enabled: true, role: decision.role });
    prompts.set(index, buildVisualAssetPrompt(design.visualAsset?.prompt, input.topic));
  });
  return { decisions, prompts };
}

/**
 * 按计划生成整册的配图。
 *
 * 并发被限制住：一次发二十个图像请求既会耗尽连接，也会同时撞上厂商的限流。
 */
export async function generateDeckVisualAssets(input: {
  decisions: readonly VisualAssetDecision[];
  prompts: ReadonlyMap<number, string>;
  concurrency?: number;
}): Promise<GeneratedVisualAsset[]> {
  const targets = input.decisions
    .map((decision, index) => ({ decision, index }))
    .filter((entry) => entry.decision.enabled && entry.decision.role);
  const assets: GeneratedVisualAsset[] = [];
  const concurrency = Math.max(1, input.concurrency ?? 2);
  for (let offset = 0; offset < targets.length; offset += concurrency) {
    const group = targets.slice(offset, offset + concurrency);
    const results = await Promise.all(group.map(async (entry) => {
      const prompt = input.prompts.get(entry.index);
      if (!prompt) return undefined;
      const asset = await generateVisualAsset({ prompt, role: entry.decision.role! });
      return asset ? { ...asset, slideIndex: entry.index } : undefined;
    }));
    for (const asset of results) {
      if (asset) assets.push(asset);
    }
  }
  return assets;
}
