import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";
import { LAYOUT_CAPACITY } from "../core/commands/layout-capacity";
import { loadSettings } from "./settings";
import { defaultPresentationVisualGoal, type PresentationVisualGoal } from "./visual-alignment";

export const narrativeStrategySchema = z.enum(["management-report", "proposal", "retrospective", "training", "product-launch", "fundraising", "general"]);
export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("bullet-list"), items: z.array(z.string().min(1).max(500)).min(1).max(12) }),
  z.object({ type: z.literal("quote"), text: z.string().min(1).max(2000), attribution: z.string().max(300).optional() }),
  z.object({ type: z.literal("metric"), label: z.string().min(1).max(300), value: z.string().min(1).max(100) }),
  z.object({ type: z.literal("timeline"), items: z.array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(500) })).min(1).max(10) }),
  z.object({ type: z.literal("comparison"), leftLabel: z.string().min(1).max(100), rightLabel: z.string().min(1).max(100), leftItems: z.array(z.string().min(1).max(500)).max(8), rightItems: z.array(z.string().min(1).max(500)).max(8) }),
  z.object({ type: z.literal("process"), items: z.array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(500) })).min(1).max(10) }),
  z.object({ type: z.literal("table-data"), header: z.array(z.string().min(1).max(100)).min(1).max(10), rows: z.array(z.array(z.string().max(500)).max(10)).min(1).max(20) }),
]);
const slidePlanSchema = z.object({
  purpose: z.string().min(1).max(300),
  conclusion: z.string().min(1).max(300),
  visualIntent: z.enum(["hero", "quote", "timeline", "comparison", "process", "data-chart", "image-story", "summary", "structured-text"]),
  density: z.enum(["low", "medium", "high"]),
});
const legacySlidePlan = { purpose: "传达本页已审核内容", conclusion: "以本页标题和正文为准", visualIntent: "structured-text" as const, density: "medium" as const };
export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  presentationBrief: z.object({ objective: z.string().min(1).max(500), audience: z.string().min(1).max(300), scenario: z.string().min(1).max(300), expectedAction: z.string().min(1).max(500), coreConclusion: z.string().min(1).max(500), narrativeStrategy: narrativeStrategySchema, assumptions: z.array(z.string().max(500)).max(10) }).default({ objective: "清晰传达演示主题", audience: "未指定受众", scenario: "通用演示", expectedAction: "理解演示内容", coreConclusion: "以演示文稿标题和逐页内容为准", narrativeStrategy: "general", assumptions: ["该草稿来自旧版本，尚未补充完整演示简报"] }),
  slides: z.array(z.object({ id: z.string().min(1).optional(), title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000), plan: slidePlanSchema.default(legacySlidePlan), blocks: z.array(contentBlockSchema).max(20).default([]) })).min(1).max(20),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;

/** 大纲阶段只产出标题与简报，正文由分批阶段补齐。 */
export const aiOutlineSchema = z.object({
  title: z.string().min(1).max(200),
  presentationBrief: z.object({ objective: z.string().min(1).max(500), audience: z.string().min(1).max(300), scenario: z.string().min(1).max(300), expectedAction: z.string().min(1).max(500), coreConclusion: z.string().min(1).max(500), narrativeStrategy: narrativeStrategySchema, assumptions: z.array(z.string().max(500)).max(10) }).default({ objective: "清晰传达演示主题", audience: "未指定受众", scenario: "通用演示", expectedAction: "理解演示内容", coreConclusion: "以演示文稿标题和逐页内容为准", narrativeStrategy: "general", assumptions: ["该草稿来自旧版本，尚未补充完整演示简报"] }),
  pages: z.array(z.object({ index: z.number().int().min(0).max(19), title: z.string().min(1).max(200), purpose: z.string().min(1).max(300) })).min(1).max(20),
});
export type AiOutline = z.infer<typeof aiOutlineSchema>;

export const aiSlideBatchSchema = z.object({
  slides: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000), plan: slidePlanSchema.default(legacySlidePlan), blocks: z.array(contentBlockSchema).max(20).default([]) })).min(1).max(20),
});
export type AiSlideBatch = z.infer<typeof aiSlideBatchSchema>;
export const slideBriefSchema = z.object({
  slideIndex: z.number().int().min(0).max(19),
  purpose: z.string().min(1).max(300),
  conclusion: z.string().min(1).max(300),
  visualIntent: z.enum(["hero", "quote", "timeline", "comparison", "process", "data-chart", "image-story", "summary", "structured-text"]),
  density: z.enum(["low", "medium", "high"]),
});
export const slideBriefsSchema = z.object({ briefs: z.array(slideBriefSchema).min(1).max(20) });
export type SlideBrief = z.infer<typeof slideBriefSchema>;

export function briefsFromDraft(draft: AiDraft): SlideBrief[] {
  return draft.slides.map((slide, slideIndex) => ({ slideIndex, ...slide.plan }));
}
export const aiPresentationDesignSchema = z.object({
  slides: z.array(z.object({
    layout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    bodyColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })).min(1).max(20),
});
export type AiPresentationDesign = z.infer<typeof aiPresentationDesignSchema>;
type AiLayoutKind = z.infer<typeof aiPresentationDesignSchema>["slides"][number]["layout"];
const intentLayouts: Record<SlideBrief["visualIntent"], AiLayoutKind> = {
  hero: "cover",
  quote: "quote",
  timeline: "cards",
  comparison: "split",
  process: "cards",
  "data-chart": "title-body",
  "image-story": "split",
  summary: "summary",
  "structured-text": "title-body",
};

/** Splits reviewed body copy into the visual units the page actually carries. */
export function splitBodyItems(body: string): string[] {
  return body.split(/\n+|(?=(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*)/).map((value) => value.trim()).filter(Boolean);
}

/**
 * Picks the layout that matches the amount and shape of the reviewed content.
 *
 * The model's layout is a recommendation, not a command: a numbered list that
 * it calls "title-body" used to be rendered as one plain text block, which is
 * what produced pages with a small paragraph in a large empty canvas. Short
 * lists become cards, long lists become two columns, and only continuous prose
 * stays on a title-body page. The content itself is never changed.
 */
export function chooseSlideLayout(input: {
  index: number;
  requested: AiLayoutKind;
  visualIntent: SlideBrief["visualIntent"];
  density: SlideBrief["density"];
  body: string;
  blocks?: ContentBlock[];
}): AiLayoutKind {
  const blockItems = (input.blocks ?? [])
    .filter((block): block is Extract<ContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
    .flatMap((block) => block.items);
  // Blocks are the structured fact source. Body copy is the fallback for
  // legacy drafts that never produced blocks.
  const items = blockItems.length > 0 ? blockItems : splitBodyItems(input.body);
  const hasBlock = (type: ContentBlock["type"]) => (input.blocks ?? []).some((block) => block.type === type);
  // A first page is only a cover when it actually carries a cover: a title
  // plus a short subtitle. A multi-point overview is a content page even when
  // the model labels it "cover" or the brief calls it "hero". Returning early
  // here also prevents the hero intent from being converted to a section page,
  // which used to dump the whole list into one small text box.
  if (input.index === 0) {
    if (items.length <= LAYOUT_CAPACITY.coverMaxItems && input.body.trim().length <= LAYOUT_CAPACITY.coverBodyLength && !hasBlock("quote")) return "cover";
    if (hasBlock("quote") && items.length < LAYOUT_CAPACITY.cardsGridMinItems) return "quote";
    if (items.length >= LAYOUT_CAPACITY.cardsGridMinItems) return "cards";
    if (items.length === LAYOUT_CAPACITY.splitMinItems) return "split";
    return "title-body";
  }
  const longestItem = items.reduce((longest, item) => Math.max(longest, [...item].length), 0);
  const intent = intentLayouts[input.visualIntent];
  // A model often returns title-body as a safe default. When the slide brief
  // states a more specific intent, that intent wins.
  let layout: AiLayoutKind = input.requested === "cover" ? "section" : input.requested;
  if (layout === "title-body" && intent !== "title-body") layout = intent;
  if (layout === "cover") layout = "section";
  // Semantic blocks carry stronger signals than the model's layout guess.
  const hasCardBlock = hasBlock("timeline") || hasBlock("process") || hasBlock("metric");
  // A quote attached to a real list is a pull quote, not a replacement for the
  // list. Keep the list layout so the renderer can carry both.
  if (hasBlock("quote")) layout = items.length >= 3 ? "cards" : "quote";
  else if (hasBlock("comparison")) layout = "split";
  else if (hasCardBlock) layout = "cards";
  if (layout === "quote" && input.density === "high" && !hasBlock("quote")) layout = "title-body";
  if (layout === "split" && items.length < LAYOUT_CAPACITY.splitMinItems && !hasBlock("comparison")) layout = "title-body";
  if (layout === "cards" && !hasCardBlock && (items.length < LAYOUT_CAPACITY.cardsMinItems || items.length > LAYOUT_CAPACITY.cardsMaxItems || longestItem > LAYOUT_CAPACITY.cardItemLengthLimit || input.body.length > LAYOUT_CAPACITY.cardBodyLengthLimit)) {
    layout = items.length >= LAYOUT_CAPACITY.splitMinItems && items.length <= LAYOUT_CAPACITY.splitMaxItems && input.body.length <= LAYOUT_CAPACITY.splitBodyLength ? "split" : "title-body";
  }
  if (layout === "title-body" && items.length >= LAYOUT_CAPACITY.splitMinItems) {
    const cardEligible = items.length >= LAYOUT_CAPACITY.cardsGridMinItems && items.length <= LAYOUT_CAPACITY.cardsMaxItems && longestItem <= LAYOUT_CAPACITY.cardItemLength && input.body.length <= LAYOUT_CAPACITY.cardBodyLength;
    layout = cardEligible ? "cards" : "split";
  }
  return layout;
}

export interface DesignTemplateContext { slideWidthEmu: number | null; slideHeightEmu: number | null; themeColors: Array<{ name: string; value: string }>; majorFont: string | null; minorFont: string | null; defaultBackgroundColor: string | null; slides: Array<{ index: number; title: string; textCount: number; imageCount: number; shapeCount: number; layout: string | null; backgroundColor: string | null; regions: Array<{ role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }> }>; layouts: Array<{ index: number; name: string; backgroundColor: string | null; regions: Array<{ role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }> }> }

function colorLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((value) => Number.parseInt(value, 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

/** Blends `foreground` towards `background` so body copy can step back one level. */
function mixColor(foreground: string, background: string, amount: number): string {
  const first = [foreground.slice(1, 3), foreground.slice(3, 5), foreground.slice(5, 7)].map((value) => Number.parseInt(value, 16));
  const second = [background.slice(1, 3), background.slice(3, 5), background.slice(5, 7)].map((value) => Number.parseInt(value, 16));
  if ([...first, ...second].some((value) => !Number.isFinite(value))) return foreground;
  const blended = first.map((channel, index) => Math.round(channel + (second[index]! - channel) * amount));
  return `#${blended.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * Template colors are authoritative. AI selects structure, but cannot invent a
 * competing palette. The title keeps the full strength of the template ink and
 * the body steps one level back, so a page keeps a readable hierarchy instead of
 * two blocks of identically coloured text.
 */
export function constrainDesignToTemplate(design: AiPresentationDesign, template: DesignTemplateContext): AiPresentationDesign {
  const colors = new Map(template.themeColors.map((color) => [color.name.toLowerCase(), color.value.toUpperCase()]));
  const accent = colors.get("accent1") ?? colors.get("accent2");
  const light = colors.get("lt1") ?? colors.get("lt2");
  const dark = colors.get("dk1") ?? colors.get("dk2");
  if (!accent && !light && !dark) return design;
  const rawBackground = template.defaultBackgroundColor;
  const background = rawBackground?.startsWith("#") ? rawBackground.toUpperCase() : rawBackground ? colors.get(rawBackground.toLowerCase()) ?? light ?? "#FFFFFF" : light ?? "#FFFFFF";
  const foreground = dark ?? (colorLuminance(background) > 0.45 ? "#1F2937" : "#FFFFFF");
  const bodyForeground = mixColor(foreground, background, colorLuminance(background) > 0.45 ? 0.22 : 0.16);
  return { slides: design.slides.map((slide) => ({ ...slide, background, accent: accent ?? slide.accent, titleColor: foreground, bodyColor: bodyForeground })) };
}
/** 当前选中的厂商与模型。调用方不再关心具体厂商，由设置决定。 */
async function aiSelection(): Promise<{ provider: string; model: string }> {
  const settings = await loadSettings();
  return { provider: settings.aiProviderId, model: settings.aiModel };
}

export function describeAiError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("AI_VISUAL_QUALITY_GATE_FAILED")) return `生成结果未通过视觉质量检查。${detail.split(": ").slice(1).join(": ")}`;
  if (detail.includes("AI_VISION_REVIEW_FAILED")) return `视觉评审不可用：${detail.split(":").slice(1).join(":").trim() || "模型未返回可用结果"}。已跳过视觉评审，改用确定性校验。`;
  if (detail.includes("AI_REQUEST_CANCELLED") || detail.includes("AI_GENERATION_CANCELLED")) return "已取消本次生成";
  if (detail.includes("AI_REQUEST_TIMEOUT")) return "AI 生成超时，请减少页数后重试";
  if (detail.includes("AI_PROVIDER_BUSY")) return "AI 服务当前繁忙，系统已自动重试，请稍后再次生成";
  if (detail.includes("AI_PROVIDER_HTTP_ERROR:401") || detail.includes("AI_PROVIDER_HTTP_ERROR:403") || detail.includes("AI_API_KEY_MISSING")) return "AI 服务凭据无效或未配置，请在设置中检查 API Key";
  if (detail.includes("AI_PROVIDER_HTTP_ERROR:429")) return "AI 请求过于频繁，请稍后再试";
  if (detail.includes("timed out") || detail.includes("REQUEST_FAILED")) return "AI 服务连接超时，请检查网络后重试";
  if (detail.includes("JSON_INVALID") || detail.includes("RESPONSE_INVALID") || detail.includes("EMPTY_RESPONSE") || detail.includes("ZodError")) return "AI 返回的数据格式不符合要求，请重新生成";
  return detail;
}

/** 生成过程的阶段与完成度，供界面显示真实进度。 */
export interface AiGenerationProgress {
  stage: "outline" | "content";
  completed: number;
  total: number;
  label: string;
}

/** 后端在流式生成过程中汇报的进度。 */
export interface AiGenerationStreamProgress {
  taskId: number;
  /** 同一次任务里的请求标识：正文分批并行，各批进度由前端汇总。 */
  key: string;
  phase: string;
  received: number;
  pages: number;
}

/**
 * 订阅生成进度。
 *
 * 返回的取消函数必须在生成结束时调用，否则监听会一直挂着。
 */
export function listenAiGenerationProgress(handler: (progress: AiGenerationStreamProgress) => void): Promise<UnlistenFn> {
  return listen<AiGenerationStreamProgress>("ai-generation-progress", (event) => handler(event.payload));
}

/**
 * 汇总同一次任务里各批次的流式进度。
 *
 * 正文分批并行，每个批次只知道自己写到第几页。批次之间互不重叠，所以把各批
 * 的页数相加就是整份草稿已经写出的页数；同一个批次重复上报时取最新的那次。
 */
export function mergeStreamProgress(
  totals: Map<string, { received: number; pages: number }>,
  progress: AiGenerationStreamProgress,
): { pages: number; received: number } {
  totals.set(progress.key, { received: progress.received, pages: progress.pages });
  let pages = 0;
  let received = 0;
  for (const value of totals.values()) {
    pages += value.pages;
    received += value.received;
  }
  return { pages, received };
}

export interface AiGenerationOptions {
  onProgress?: (progress: AiGenerationProgress) => void;
  /** 返回 true 时放弃本次生成，用于响应用户取消。 */
  isCancelled?: () => boolean;
  /** 生成任务号。同一任务的所有请求共享它，取消时一并中断。 */
  taskId?: number;
}

/** 一次请求能写完的页数上限。再少就没必要拆批。 */
const SINGLE_CALL_PAGE_LIMIT = 6;
/** 单批页数。批越小单次输出越短，越不容易触发服务端超时。 */
const BATCH_PAGE_COUNT = 5;

function assertNotCancelled(options: AiGenerationOptions): void {
  if (options.isCancelled?.()) throw new Error("AI_GENERATION_CANCELLED");
}

/**
 * 生成整份演示草稿。
 *
 * 一次性让模型写完 20 页，输出量足以让单次请求超时，而超时后的重试会把整份
 * 草稿重写一遍，用户等待时间成倍放大。因此页数较多时改为"先出大纲、再分批写
 * 正文"：大纲输出很小，几秒内返回；正文分批并行，墙钟时间接近单批耗时。
 */
export async function generatePresentationDraft(topic: string, slideCount: number, options: AiGenerationOptions = {}): Promise<AiDraft> {
  const { provider, model } = await aiSelection();
  if (slideCount <= SINGLE_CALL_PAGE_LIMIT) {
    options.onProgress?.({ stage: "content", completed: 0, total: 1, label: "正在生成演示草稿…" });
    const raw = await invoke<unknown>("generate_presentation", { request: { topic, slideCount, model, provider, taskId: options.taskId, streamProgress: true } });
    const draft = aiDraftSchema.parse(raw);
    if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
    options.onProgress?.({ stage: "content", completed: 1, total: 1, label: "草稿已生成" });
    return draft;
  }

  options.onProgress?.({ stage: "outline", completed: 0, total: 1, label: "正在规划演示大纲…" });
  const outlineRaw = await invoke<unknown>("generate_presentation_outline", { request: { topic, slideCount, model, provider, taskId: options.taskId, streamProgress: true } });
  const outline = aiOutlineSchema.parse(outlineRaw);
  if (outline.pages.length !== slideCount) throw new Error("AI_OUTLINE_PAGE_COUNT_MISMATCH");
  assertNotCancelled(options);

  const batches = Array.from({ length: Math.ceil(slideCount / BATCH_PAGE_COUNT) }, (_, index) => ({
    startIndex: index * BATCH_PAGE_COUNT,
    count: Math.min(BATCH_PAGE_COUNT, slideCount - index * BATCH_PAGE_COUNT),
  }));
  options.onProgress?.({ stage: "content", completed: 0, total: batches.length, label: "正在分批生成正文…" });

  let completed = 0;
  const batchResults = await Promise.all(batches.map(async (batch) => {
    const raw = await invoke<unknown>("generate_presentation_slides_batch", { request: { topic, outline, startIndex: batch.startIndex, count: batch.count, model, provider, taskId: options.taskId, streamProgress: true } });
    const parsed = aiSlideBatchSchema.parse(raw);
    if (parsed.slides.length !== batch.count) throw new Error("AI_BATCH_SLIDE_COUNT_MISMATCH");
    completed += 1;
    options.onProgress?.({ stage: "content", completed, total: batches.length, label: `正在生成正文（${completed}/${batches.length} 批）` });
    return parsed.slides;
  }));

  // 大纲是全局事实来源：页面标题以大纲为准，各批只补正文、备注、页面计划和内容块。
  const generated = batchResults.flat();
  const slides = outline.pages.map((page, index) => {
    const source = generated[index];
    return {
      title: page.title,
      body: source?.body ?? "",
      speakerNotes: source?.speakerNotes ?? "",
      plan: source?.plan ?? legacySlidePlan,
      blocks: source?.blocks ?? [],
    };
  });
  const draft = aiDraftSchema.parse({ title: outline.title, presentationBrief: outline.presentationBrief, slides });
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  options.onProgress?.({ stage: "content", completed: batches.length, total: batches.length, label: "草稿已生成" });
  return draft;
}

export async function generateSlideBriefs(draft: AiDraft, taskId?: number): Promise<SlideBrief[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("generate_slide_briefs", { request: { draft, model, provider, taskId } });
  const result = slideBriefsSchema.parse(raw);
  if (result.briefs.length !== draft.slides.length || result.briefs.some((brief, index) => brief.slideIndex !== index)) throw new Error("AI_BRIEF_SLIDE_MISMATCH");
  return result.briefs;
}

export interface AiPresentationDesignOptions {
  visualGoal?: PresentationVisualGoal;
  /** 生成任务号：取消时后端会中断该任务下所有在途请求。 */
  taskId?: number;
}

export async function generatePresentationDesign(draft: AiDraft, briefs: SlideBrief[], template: DesignTemplateContext, options: AiPresentationDesignOptions = {}): Promise<AiPresentationDesign> {
  const { provider, model } = await aiSelection();
  const visualGoal = options.visualGoal ?? defaultPresentationVisualGoal();
  const raw = await invoke<unknown>("generate_presentation_design", { request: { draft, briefs, template, visualGoal, model, provider, taskId: options.taskId } });
  const design = aiPresentationDesignSchema.parse(raw);
  if (design.slides.length !== draft.slides.length) throw new Error("AI_DESIGN_SLIDE_COUNT_MISMATCH");
  return constrainDesignToTemplate({
    slides: design.slides.map((slide, index) => {
      const content = draft.slides[index]!;
      const brief = briefs[index]!;
      return {
        ...slide,
        layout: chooseSlideLayout({
          index,
          requested: slide.layout,
          visualIntent: brief.visualIntent,
          density: brief.density,
          body: content.body,
          blocks: content.blocks,
        }),
      };
    }),
  }, template);
}

export const aiKeyConfigured = (providerId: string) => invoke<boolean>("ai_api_key_configured", { providerId });
export const saveAiKey = (providerId: string, apiKey: string) => invoke<void>("save_ai_api_key", { providerId, apiKey });
export const deleteAiKey = (providerId: string) => invoke<void>("delete_ai_api_key", { providerId });
export const testAiConnection = (providerId: string, model: string) => invoke<string>("test_ai_connection", { providerId, model });

/**
 * 取消一个生成任务。
 *
 * 后端会中断该任务下所有在途请求，而不是只让界面停止等待：否则模型会继续
 * 生成一份没人要的草稿。
 */
export const cancelAiGeneration = (taskId: number) => invoke<boolean>("cancel_ai_generation", { taskId });

/** 生成任务结束，释放后端登记。 */
export const endAiGeneration = (taskId: number) => invoke<void>("end_ai_generation", { taskId });
