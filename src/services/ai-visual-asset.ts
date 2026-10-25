import { invoke } from "@tauri-apps/api/core";
import {
  buildVisualAssetPrompt,
  resolveVisualAsset,
  VISUAL_ASSET_REQUEST_SIZE,
  type AiVisualAssetRole,
} from "../core/commands/visual-asset";
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
 * 请求一张配图，并把失败原因说出来。
 *
 * 整册生成用不到失败原因——少一张图的文稿照样成立，所以那里用会吞掉错误的
 * `generateVisualAsset`。手工路径不一样：用户是主动点"生成配图"的，失败了
 * 必须告诉他为什么，否则他只会以为应用坏了。
 */
export async function requestVisualAsset(input: {
  prompt: string;
  role: AiVisualAssetRole;
}): Promise<{ ok: true; asset: GeneratedVisualAsset } | { ok: false; error: string }> {
  const size = VISUAL_ASSET_REQUEST_SIZE[input.role];
  try {
    const result = await invoke<ImageResult>("generate_presentation_image", {
      request: { prompt: input.prompt, width: size.width, height: size.height },
    });
    if (!result?.dataUrl) return { ok: false, error: "图像服务没有返回图片" };
    return {
      ok: true,
      asset: {
        slideIndex: -1,
        dataUrl: result.dataUrl,
        mimeType: result.mimeType,
        naturalWidth: result.width,
        naturalHeight: result.height,
        altText: input.prompt.slice(0, 200),
      },
    };
  } catch (error) {
    return { ok: false, error: describeImageFailure(error) };
  }
}

/**
 * 把失败翻译成一句人话。
 *
 * 常见的两类：没有配凭据，和请求本身被厂商拒绝。两者的处置不同——
 * 前者要先去设置里填 API Key，后者只能重试或改描述。
 */
function describeImageFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/credential|api.?key|unauthorized|401/i.test(raw)) return "没有可用的图像服务凭据，请先在设置里填写 API Key";
  if (/timeout|timed out/i.test(raw)) return "图像生成超时了，可以再试一次";
  if (/rate|429|too many/i.test(raw)) return "图像服务限流了，稍后再试";
  if (/network|connection|fetch/i.test(raw)) return "连不上图像服务，请检查网络";
  return `图像生成失败：${raw.slice(0, 120)}`;
}

/**
 * 为一页生成配图。
 *
 * 尺寸跟着角色走，和排版引擎留的图框用的是同一份契约
 * （`VISUAL_ASSET_REQUEST_SIZE`）。两边比例一致，填充裁剪就什么都不用切；
 * 图的比例和框对不上时，裁剪会把画面切掉一大半——那是"AI 配图一眼假"最常见的来源。
 */
export async function generateVisualAsset(input: {
  prompt: string;
  role: AiVisualAssetRole;
}): Promise<GeneratedVisualAsset | undefined> {
  const result = await requestVisualAsset(input);
  return result.ok ? result.asset : undefined;
}

/** 一次生成里配图的上限。整册都配图会变成相册，也会烧掉大量额度。 */
const MAX_ASSETS_PER_DECK = 4;

/** 一页配不配图的决定。 */
export interface VisualAssetDecision {
  /** 是否配图。 */
  enabled: boolean;
  /** 配图的角色。 */
  role?: AiVisualAssetRole;
  /** 为什么不配。 */
  reason?: string;
}

/**
 * The pages a deck still has to buy pictures for.
 *
 * A variant batch generates the deck's pictures once and hands them to the kept
 * version. Re-running the whole plan there would buy the same photograph twice
 * and replace it with a different one; running only the missing pages keeps the
 * batch's pictures and still fills the pages the batch did not cover.
 */
export function planAssetTopUp(input: {
  decisions: readonly VisualAssetDecision[];
  /** Page indexes that already have a picture. */
  covered: ReadonlySet<number>;
}): { decisions: VisualAssetDecision[]; targets: number } {
  let targets = 0;
  const decisions = input.decisions.map((decision, index) => {
    if (!decision.enabled || !decision.role || input.covered.has(index)) return { enabled: false };
    targets += 1;
    return decision;
  });
  return { decisions, targets };
}

/**
 * 内容阶段产出的配图意图。
 *
 * 它比设计阶段的建议更可信：用户在审核页看过、改过。设计阶段只是兜底。
 */
export interface VisualAssetIntent {
  enabled: boolean;
  prompt: string;
  role: AiVisualAssetRole;
  /** 谁说的这段意图。人的决定压得住模型的建议。 */
  source?: "model" | "user";
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
  /** 内容阶段的配图意图。审核过的意图优先于设计阶段的建议。 */
  intents?: readonly (VisualAssetIntent | undefined)[];
}): { decisions: VisualAssetDecision[]; prompts: Map<number, string> } {
  const decisions: VisualAssetDecision[] = [];
  const prompts = new Map<number, string>();
  let granted = 0;
  input.designs.forEach((design, index) => {
    const intent = input.intents?.[index];
    // 只有**人**在审核页说"这一页不配图"才算决定。模型说"不用配图"只是它
    // 保守：实测一册四页的真实产出，模型只给封面配了图，其余三页都写
    // enabled=false，而设计阶段本会给其中两页配图。按模型的话就把图全压没了。
    const declinedByUser = intent?.source === "user" && !intent.enabled;
    const requested = !declinedByUser && Boolean(intent?.enabled || design.visualAsset?.enabled);
    const requestedRole = intent?.enabled ? intent.role : design.visualAsset?.role;
    const description = intent?.enabled && intent.prompt.trim() ? intent.prompt : design.visualAsset?.prompt;
    const decision = resolveVisualAsset({
      layout: design.layout,
      itemCount: input.itemCounts[index] ?? 0,
      hasDeterministicBlock: input.deterministicBlocks[index] ?? false,
      requested,
      requestedRole,
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
    prompts.set(index, buildVisualAssetPrompt(description, input.topic));
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
  /** 每完成一组（最多 `concurrency` 张）汇报一次，用于显示"配图 2/4"。 */
  onProgress?: (completed: number, total: number) => void;
}): Promise<GeneratedVisualAsset[]> {
  const targets = input.decisions
    .map((decision, index) => ({ decision, index }))
    .filter((entry) => entry.decision.enabled && entry.decision.role);
  const assets: GeneratedVisualAsset[] = [];
  const concurrency = Math.max(1, input.concurrency ?? 2);
  for (let offset = 0; offset < targets.length; offset += concurrency) {
    const group = targets.slice(offset, offset + concurrency);
    const results = await Promise.all(
      group.map(async (entry) => {
        const prompt = input.prompts.get(entry.index);
        if (!prompt) return undefined;
        const asset = await generateVisualAsset({ prompt, role: entry.decision.role! });
        return asset ? { ...asset, slideIndex: entry.index } : undefined;
      }),
    );
    for (const asset of results) {
      if (asset) assets.push(asset);
    }
    // 进度按"已尝试的页数"算，不按成功张数：失败的那张也要往前走，
    // 否则用户会看到配图阶段停在一个永远不动的数字上。
    input.onProgress?.(Math.min(offset + group.length, targets.length), targets.length);
  }
  return assets;
}
