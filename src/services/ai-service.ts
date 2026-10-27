import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { applyDeckArtDirection } from "../core/commands/deck-art-direction";
import { CONCEPT_PRESET_IDS, type DeckConcept } from "../core/design/deck-concept";
import type { ThemeDirection } from "../core/design/theme-direction";
import type { StyleConstraint } from "../core/design/style-profiles";
import { recipeCatalogForConcept } from "../core/layout/recipes/registry";
import { layoutCapabilities } from "../core/commands/template-layouts";
import { layoutRect, type PageCoordinateSystem } from "../core/layout/geometry/coordinate-system";
import { createPptWorkbench, PPT_WORKBENCH_TOOLS, runPptWorkbenchLoop } from "../workbench";
import { defaultPresentationVisualGoal, type PresentationVisualGoal } from "./visual-alignment";
import { normalizeDraftPunctuation } from "./ai-draft-normalize";
import { buildDesignIntelligence } from "./design-intelligence";
import { loadDesignPreferences, loadRecentLooks } from "./design-memory";
import { loadSettings } from "./settings";
import { bodyFromBlocks, sanitizeBlocks } from "./ai-draft-content";
import {
  aiDeckConceptsSchema,
  aiDeckDirectionsSchema,
  aiDraftSchema,
  aiOutlineSchema,
  aiSelection,
  aiSlideBatchSchema,
  chooseSlideLayout,
  constrainDesignToTemplate,
  contentBlockSchema,
  isDesignEnvelope,
  legacySlidePlan,
  parseAiPresentationDesign,
  slideBriefsSchema,
  slidePlanSchema,
  sourceFactsResponseSchema,
  visualAssetForBrief,
  type AiDeckConceptOutput,
  type AiDraft,
  type AiGenerationOptions,
  type AiPresentationDesign,
  type AiPresentationDesignResult,
  type ContentBlock,
  type DesignTemplateContext,
  type SlideBrief,
  type SourceFact,
} from "./ai-contracts";

export * from "./ai-contracts";

const SINGLE_CALL_PAGE_LIMIT = 6;
/** 单批页数。批越小单次输出越短，越不容易触发服务端超时。 */
const BATCH_PAGE_COUNT = 5;

/** Adds stable layout capabilities before template data crosses the AI port. */
export function designTemplateForPrompt(template: DesignTemplateContext): DesignTemplateContext {
  return {
    ...template,
    layouts: template.layouts.map((layout) => ({
      ...layout,
      capabilities: layoutCapabilities(
        layout.regions.map((region) => ({
          role: region.role,
          frame: { x: region.x, y: region.y, width: region.width, height: region.height },
        })),
      ),
    })),
  };
}

function parseAiResponse<Schema extends z.ZodTypeAny>(schema: Schema, raw: unknown, stage: string): z.output<Schema> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? issue.path.join(".") : "根对象";
  const reason = issue?.code === "invalid_type" && issue.received === "undefined" ? "缺少必填字段" : "字段值无效";
  throw new Error(`AI_RESPONSE_SCHEMA_INVALID:${stage}:${path}:${reason}`);
}

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
export async function generatePresentationDraft(
  topic: string,
  slideCount: number,
  options: AiGenerationOptions = {},
): Promise<AiDraft> {
  const { provider, model } = await aiSelection();
  const facts = [...(options.facts ?? [])];
  // 没有素材时不往请求里塞空数组：提示词与改造前完全一致。
  const factsRequest = facts.length > 0 ? { facts } : {};
  if (slideCount <= SINGLE_CALL_PAGE_LIMIT) {
    options.onProgress?.({ stage: "content", completed: 0, total: 1, label: "正在生成演示草稿…" });
    const raw = await invoke<unknown>("generate_presentation", {
      request: {
        topic,
        slideCount,
        ...factsRequest,
        model,
        provider,
        taskId: options.taskId,
        streamProgress: true,
      },
    });
    const draft = parseAiResponse(aiDraftSchema, raw, "完整草稿");
    if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
    options.onProgress?.({ stage: "content", completed: 1, total: 1, label: "草稿已生成" });
    // 标点在这里收拾：模型刚写完、用户还没看到的时候。
    return withSourceFacts(normalizeDraftPunctuation(draft), facts);
  }

  options.onProgress?.({ stage: "outline", completed: 0, total: 1, label: "正在规划演示大纲…" });
  const outlineRaw = await invoke<unknown>("generate_presentation_outline", {
    request: { topic, slideCount, model, provider, taskId: options.taskId, streamProgress: true },
  });
  const parsedOutline = parseAiResponse(aiOutlineSchema, outlineRaw, "演示大纲");
  if (parsedOutline.pages.length !== slideCount) throw new Error("AI_OUTLINE_PAGE_COUNT_MISMATCH");
  // Pages may come back shuffled. Batches are sliced by position, so an
  // unordered outline would put one page's body under another page's title.
  const pages = [...parsedOutline.pages].sort((left, right) => left.index - right.index);
  if (pages.some((page, index) => page.index !== index)) throw new Error("AI_OUTLINE_PAGE_INDEX_INVALID");
  const outline = { ...parsedOutline, pages };
  assertNotCancelled(options);

  const batches = Array.from({ length: Math.ceil(slideCount / BATCH_PAGE_COUNT) }, (_, index) => ({
    startIndex: index * BATCH_PAGE_COUNT,
    count: Math.min(BATCH_PAGE_COUNT, slideCount - index * BATCH_PAGE_COUNT),
  }));
  options.onProgress?.({ stage: "content", completed: 0, total: batches.length, label: "正在分批生成正文…" });

  let completed = 0;
  const batchResults: AiDraft["slides"][] = [];
  // 页数不设产品上限，但同时发出无限请求会耗尽连接和供应商配额。
  // 固定并发窗口只限制并发量，不限制最终页数。
  const concurrency = 3;
  for (let offset = 0; offset < batches.length; offset += concurrency) {
    assertNotCancelled(options);
    const group = batches.slice(offset, offset + concurrency);
    const results = await Promise.all(
      group.map(async (batch) => {
        const raw = await invoke<unknown>("generate_presentation_slides_batch", {
          request: {
            topic,
            outline,
            startIndex: batch.startIndex,
            count: batch.count,
            ...factsRequest,
            model,
            provider,
            taskId: options.taskId,
            streamProgress: true,
          },
        });
        const parsed = parseAiResponse(aiSlideBatchSchema, raw, `第 ${batch.startIndex + 1} 页起的正文批次`);
        if (parsed.slides.length !== batch.count) throw new Error("AI_BATCH_SLIDE_COUNT_MISMATCH");
        completed += 1;
        options.onProgress?.({
          stage: "content",
          completed,
          total: batches.length,
          label: `正在生成正文（${completed}/${batches.length} 批）`,
        });
        return parsed.slides;
      }),
    );
    batchResults.push(...results);
  }

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
      ...(source?.factRefs ? { factRefs: source.factRefs } : {}),
    };
  });
  const draft = aiDraftSchema.parse({ title: outline.title, presentationBrief: outline.presentationBrief, slides });
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  options.onProgress?.({ stage: "content", completed: batches.length, total: batches.length, label: "草稿已生成" });
  // 标点在这里收拾：模型刚写完、用户还没看到的时候。
  return withSourceFacts(normalizeDraftPunctuation(draft), facts);
}

/**
 * 把本次抽取的素材事实挂到草稿上。
 *
 * 事实是这一稿的生成依据，跟着草稿走：审核页据此显示每页引用了什么，
 * 重新生成和单页重写也要拿到同一份清单。没有素材时保持草稿原样。
 */
function withSourceFacts(draft: AiDraft, facts: readonly SourceFact[]): AiDraft {
  return facts.length > 0 ? { ...draft, sourceFacts: facts.map((fact) => ({ ...fact })) } : draft;
}

/** 一次生成最多引用的素材事实数，和后端保持一致。 */
const MAX_SOURCE_FACTS = 24;

/**
 * 从用户粘贴的素材里抽取事实清单。
 *
 * 这一步是"先有证据，再写稿"的分界线：抽取结果能被人看见、能被人删掉，
 * 写稿阶段就只能引用这份清单里的内容。抽取本身不判断真假——判断真伪仍然是
 * 人的动作，系统只负责让"这一页的数据从哪来"有据可查。
 */
export async function extractSourceFacts(
  topic: string,
  material: string,
  options: { taskId?: number } = {},
): Promise<SourceFact[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("extract_source_facts", {
    request: { topic, material, model, provider, taskId: options.taskId },
  });
  const parsed = parseAiResponse(sourceFactsResponseSchema, raw, "素材事实");
  const seen = new Set<string>();
  const facts: SourceFact[] = [];
  for (const fact of parsed.facts) {
    const statement = fact.statement.trim();
    // 同一句话重复出现只留一条：事实清单是引用表，不是摘抄本。
    if (!statement || seen.has(statement)) continue;
    seen.add(statement);
    facts.push({
      id: `F${facts.length + 1}`,
      statement,
      ...(fact.figure?.trim() ? { figure: fact.figure.trim() } : {}),
      ...(fact.period?.trim() ? { period: fact.period.trim() } : {}),
      ...(fact.source?.trim() ? { source: fact.source.trim() } : {}),
    });
    if (facts.length >= MAX_SOURCE_FACTS) break;
  }
  return facts;
}

export async function polishPresentationTopic(topic: string): Promise<string> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("polish_presentation_topic", { request: { topic, model, provider } });
  return z.string().trim().min(1).max(4000).parse(raw);
}

/**
 * 单页重写的结果。
 *
 * 合同里没有 title 和 plan：标题由已定稿的大纲决定，页面计划是这一页的沟通
 * 任务，二者都不该被一次"换个写法"改掉。
 */
const slideRewriteSchema = z.object({
  body: z.string().max(4000).default(""),
  speakerNotes: z.string().max(4000).default(""),
  blocks: z.array(contentBlockSchema).max(20).default([]),
  factRefs: z.array(z.string().max(20)).max(8).optional(),
});
const slideRewriteResponseSchema = z.object({ slide: slideRewriteSchema });

/** 审核页所有"针对这一页"的 AI 请求共用的上下文。 */
export interface SlideAiContext {
  topic: string;
  deckTitle: string;
  /** 整册页面标题，按顺序。模型据此避免与相邻页重复。 */
  outline: string[];
  slideIndex: number;
  slide: {
    title: string;
    body: string;
    speakerNotes: string;
    plan: AiDraft["slides"][number]["plan"];
    blocks: ContentBlock[];
  };
  taskId?: number;
}

/** 整页重写输入：在页面上下文上再加一句可选的改写要求。 */
export interface SlideRewriteInput extends SlideAiContext {
  /** 用户的改写要求，可空。 */
  instruction?: string;
  /** 排版预检的结论；有告警时重写要把页面压回容量内。 */
  capacityNotes?: string[];
  /** 本稿的素材事实；重写只能用这些事实，并重新给出引用。 */
  facts?: readonly SourceFact[];
}

export interface SlideRewriteSuggestion {
  body: string;
  speakerNotes: string;
  blocks: ContentBlock[];
  factRefs?: string[];
}

/**
 * 模型只给正文和备注；块是渲染器真正画出来的东西，所以块优先。
 *
 * 模型没有输出块时，用它给的正文还原成一种块，别让这一页在审核页上变成
 * "有正文但没有内容块"的半成品。
 */
function normalizeSlideRewrite(slide: z.output<typeof slideRewriteSchema>): SlideRewriteSuggestion {
  const blocks = sanitizeBlocks(slide.blocks);
  if (blocks.length === 0) {
    const text = slide.body.trim();
    if (!text) throw new Error("AI_REWRITE_EMPTY");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12);
    blocks.push(
      lines.length > 1
        ? { type: "bullet-list", items: lines.map((line) => line.slice(0, 500)) }
        : { type: "paragraph", text: text.slice(0, 2000) },
    );
  }
  // body 是块的纯文本投影：两者必须一起重写，否则审核页的计数和渲染结果
  // 会各说各话。
  return {
    body: bodyFromBlocks(blocks),
    speakerNotes: slide.speakerNotes.trim(),
    blocks,
    ...(slide.factRefs ? { factRefs: slide.factRefs } : {}),
  };
}

/**
 * 让 AI 按这一页的标题和页面计划重写正文。
 *
 * 只返回候选版本，不写入草稿：用户在审核页对照新旧两版后自己决定是否替换。
 */
export async function rewritePresentationSlide(input: SlideRewriteInput): Promise<SlideRewriteSuggestion> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("rewrite_presentation_slide", { request: { ...input, model, provider } });
  const parsed = parseAiResponse(slideRewriteResponseSchema, raw, "本页重写结果");
  return normalizeSlideRewrite(parsed.slide);
}

const slideTitlesSchema = z.object({
  titles: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
});

/**
 * 给这一页拟几个候选标题。
 *
 * 当前标题和重复项会被剔掉：换标题的动作里，和原来一样的候选没有意义。
 */
export async function suggestSlideTitles(input: SlideAiContext & { count?: number }): Promise<string[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("suggest_slide_titles", { request: { ...input, model, provider } });
  const parsed = parseAiResponse(slideTitlesSchema, raw, "标题候选");
  const current = input.slide.title.trim();
  const titles = [...new Set(parsed.titles.map((title) => title.trim()).filter((title) => title && title !== current))];
  if (titles.length === 0) throw new Error("AI_TITLES_EMPTY");
  return titles.slice(0, 5);
}

const speakerNotesResponseSchema = z.object({ speakerNotes: z.string().max(4000) });

/**
 * 只写这一页的演讲备注，不动已审核的正文。
 *
 * 备注可以单独重来：正文审核完不想再动，是审核页上很常见的一种状态。
 */
export async function writeSpeakerNotes(input: SlideAiContext): Promise<string> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("write_speaker_notes", { request: { ...input, model, provider } });
  const parsed = parseAiResponse(speakerNotesResponseSchema, raw, "演讲备注");
  const notes = parsed.speakerNotes.trim();
  if (!notes) throw new Error("AI_NOTES_EMPTY");
  return notes;
}

const imagePromptsResponseSchema = z.object({
  // 空白候选在下面被剔掉；schema 只负责形状，空值走 AI_IMAGE_PROMPTS_EMPTY。
  prompts: z.array(z.string().max(300)).min(1).max(6),
});

/**
 * 给这一页拟几个画面描述。
 *
 * 只返回候选；写回时由界面把它设成 `source: "user"` 的配图意图，
 * 这样它才压得住设计阶段自己的建议（ADR 0036）。
 */
export async function suggestImagePrompts(input: SlideAiContext): Promise<string[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("suggest_image_prompts", { request: { ...input, model, provider } });
  const parsed = parseAiResponse(imagePromptsResponseSchema, raw, "配图描述候选");
  const prompts = [...new Set(parsed.prompts.map((prompt) => prompt.trim()).filter(Boolean))];
  if (prompts.length === 0) throw new Error("AI_IMAGE_PROMPTS_EMPTY");
  return prompts.slice(0, 4);
}

const splitPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4000).default(""),
  speakerNotes: z.string().max(4000).default(""),
  plan: slidePlanSchema.default(legacySlidePlan),
  blocks: z.array(contentBlockSchema).max(20).default([]),
});
const splitSlideResponseSchema = z.object({ pages: z.array(splitPageSchema).length(2) });

export type SplitSlidePage = z.infer<typeof splitPageSchema>;

/**
 * 把一页拆成两页。
 *
 * 两页都必须有内容块，否则拆出来的是"有标题没内容"的空页；两页标题也不能相同，
 * 否则大纲里会出现两个一样的页面。两种情况都按失败处理，让用户重试。
 */
export async function splitSlideContent(
  input: SlideAiContext & { capacityNotes?: string[] },
): Promise<SplitSlidePage[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("split_slide_content", { request: { ...input, model, provider } });
  const parsed = parseAiResponse(splitSlideResponseSchema, raw, "拆页结果");
  const pages = parsed.pages.map((page) => {
    const blocks = sanitizeBlocks(page.blocks);
    if (blocks.length === 0) throw new Error("AI_SPLIT_EMPTY");
    return {
      ...page,
      title: page.title.trim(),
      body: bodyFromBlocks(blocks),
      speakerNotes: page.speakerNotes.trim(),
      // 拆页不带配图意图：图要不要配由设计阶段判断，第一页沿用原页的意图。
      plan: { ...page.plan, visualAsset: undefined },
      blocks,
    };
  });
  if (pages[0]!.title === pages[1]!.title) throw new Error("AI_SPLIT_TITLE_DUPLICATE");
  return pages;
}

const deckReviewIssueSchema = z.object({
  slideIndex: z.number().int().min(0),
  severity: z.enum(["error", "warning"]),
  kind: z.enum(["duplicate", "title-body-mismatch", "broken-flow", "overloaded", "missing-conclusion", "unclear"]),
  message: z.string().trim().min(1).max(300),
});
const deckReviewResponseSchema = z.object({ issues: z.array(deckReviewIssueSchema).max(20) });

export type DeckReviewIssue = z.infer<typeof deckReviewIssueSchema>;

/**
 * 整册语义审稿：只出问题清单，不改任何文字。
 *
 * 越界页码和重复条目在这里剔掉：模型偶尔会把页码数错，或把同一条问题
 * 写成两遍，界面不该为此出现点不动的条目。
 */
export async function reviewDeckContent(input: {
  deckTitle: string;
  presentationBrief: AiDraft["presentationBrief"];
  slides: Array<Pick<AiDraft["slides"][number], "title" | "body" | "speakerNotes">>;
  taskId?: number;
}): Promise<DeckReviewIssue[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("review_deck_content", { request: { ...input, model, provider } });
  const parsed = parseAiResponse(deckReviewResponseSchema, raw, "内容审稿结果");
  const seen = new Set<string>();
  return parsed.issues
    .filter((issue) => issue.slideIndex < input.slides.length)
    .filter((issue) => {
      const key = `${issue.slideIndex}:${issue.kind}:${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export async function generateSlideBriefs(draft: AiDraft, taskId?: number): Promise<SlideBrief[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("generate_slide_briefs", { request: { draft, model, provider, taskId } });
  const result = slideBriefsSchema.parse(raw);
  if (result.briefs.length !== draft.slides.length || result.briefs.some((brief, index) => brief.slideIndex !== index))
    throw new Error("AI_BRIEF_SLIDE_MISMATCH");
  return result.briefs;
}

export interface AiPresentationDesignOptions {
  visualGoal?: PresentationVisualGoal;
  /** The chosen deck direction; sent to the design prompt so recipes stay legal. */
  concept?: DeckConcept;
  /** Structured theme art direction; sent to the design prompt. */
  themeDirection?: ThemeDirection;
  /** Structured style bounds shared by the model and the post-response guard. */
  styleConstraint?: StyleConstraint;
  /** 生成任务号：取消时后端会中断该任务下所有在途请求。 */
  taskId?: number;
}

const workbenchTurnSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool-call"), name: z.string().min(1).max(100), input: z.unknown() }),
  z.object({ kind: z.literal("final"), output: z.unknown() }),
]);

const designCoordinateSystem: PageCoordinateSystem = {
  coordinateSpace: "normalized-1000",
  page: layoutRect(0, 0, 1000, 1000),
  safe: layoutRect(80, 60, 840, 860),
  title: layoutRect(100, 80, 800, 120),
  content: layoutRect(100, 260, 800, 600),
  footer: layoutRect(100, 930, 800, 40),
};

const designWorkbenchTools = PPT_WORKBENCH_TOOLS.filter((tool) => tool.name.startsWith("layout."));

/**
 * Asks the model for the deck-level design direction.
 *
 * P1 returns exactly one direction. The call is deliberately separate from the
 * page design: the concept is a deck decision, and generating it together with
 * twenty pages made the model describe pages instead of a direction.
 */
export async function generateDeckConcepts(
  draft: AiDraft,
  briefs: SlideBrief[],
  template: DesignTemplateContext,
  options: { taskId?: number; themeDirection?: ThemeDirection; styleConstraint?: StyleConstraint } = {},
): Promise<AiDeckConceptOutput> {
  const { provider, model } = await aiSelection();
  const visualGoal = defaultPresentationVisualGoal();
  const raw = await invoke<unknown>("generate_deck_concepts", {
    request: {
      draft,
      briefs,
      template: designTemplateForPrompt(template),
      visualGoal,
      themeDirection: options.themeDirection,
      styleConstraint: options.styleConstraint,
      model,
      provider,
      taskId: options.taskId,
    },
  });
  const result = aiDeckConceptsSchema.parse(raw);
  if (result.concepts.length !== 1) throw new Error("AI_CONCEPT_COUNT_INVALID");
  return result.concepts[0]!;
}

export interface AiDeckDirectionOptions {
  taskId?: number;
  themeDirection?: ThemeDirection;
  styleConstraint?: StyleConstraint;
  /** Local look fingerprints; never reviewed copy. */
  recentLooks?: readonly unknown[];
  /** The user's own taste notes, stored only on this machine. */
  preferences?: readonly { text: string; scope: string }[];
}

/**
 * Proposes the renderable directions for the same reviewed content, in one call.
 *
 * The order is stable (catalog order, not model order) so the four previews do
 * not swap places between runs and the recorded decision refers to the same
 * proposal id. Four unique presets are required: a duplicate is a colour swap,
 * not a fifth choice.
 */
export async function generateDeckDirections(
  draft: AiDraft,
  briefs: SlideBrief[],
  template: DesignTemplateContext,
  options: AiDeckDirectionOptions = {},
): Promise<AiDeckConceptOutput[]> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("generate_deck_directions", {
    request: {
      draft,
      briefs,
      template: designTemplateForPrompt(template),
      visualGoal: defaultPresentationVisualGoal(),
      themeDirection: options.themeDirection,
      styleConstraint: options.styleConstraint,
      recentLooks: options.recentLooks,
      preferences: options.preferences,
      model,
      provider,
      taskId: options.taskId,
    },
  });
  const result = (() => {
    try {
      return aiDeckDirectionsSchema.parse(raw);
    } catch (error) {
      // The UI keys on a stable code; the zod detail stays in the message.
      throw new Error(`AI_DIRECTIONS_INVALID: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  return [...result.directions].sort(
    (left, right) => CONCEPT_PRESET_IDS.indexOf(left.preset) - CONCEPT_PRESET_IDS.indexOf(right.preset),
  );
}

export async function generatePresentationDesign(
  draft: AiDraft,
  briefs: SlideBrief[],
  template: DesignTemplateContext,
  options: AiPresentationDesignOptions = {},
): Promise<AiPresentationDesignResult> {
  const { provider, model } = await aiSelection();
  const visualGoal = options.visualGoal ?? defaultPresentationVisualGoal();
  const memoryEnabled = (await loadSettings().catch(() => undefined))?.designMemoryEnabled ?? false;
  const [recentLooks, preferences] = memoryEnabled
    ? await Promise.all([loadRecentLooks(5), loadDesignPreferences(10)])
    : [[], []];
  const request = {
    draft,
    briefs,
    template: designTemplateForPrompt(template),
    visualGoal,
    concept: options.concept,
    recipeCatalog: options.concept ? recipeCatalogForConcept(options.concept) : [],
    designIntelligence: buildDesignIntelligence(draft, briefs, template),
    recentLooks,
    preferences: preferences.map(({ text, scope }) => ({ text, scope })),
    themeDirection: options.themeDirection,
    styleConstraint: options.styleConstraint,
    model,
    provider,
    taskId: options.taskId,
    streamProgress: true,
  };
  const created = createPptWorkbench(designCoordinateSystem);
  if (!created.ok) throw new Error(`AI_WORKBENCH_INIT_FAILED:${created.issues[0]?.code ?? "UNKNOWN"}`);
  const loop = await runPptWorkbenchLoop({
    workbench: created.workbench,
    tools: designWorkbenchTools,
    transport: async ({ tools, transcript, layoutProgram }) => {
      const response = await invoke<unknown>("generate_presentation_design", {
        request: { ...request, layoutProgram, workbenchTools: tools, workbenchTranscript: transcript },
      });
      const turn = workbenchTurnSchema.safeParse(response);
      if (turn.success) {
        return turn.data.kind === "tool-call"
          ? { kind: "tool-call" as const, name: turn.data.name, input: turn.data.input ?? {} }
          : { kind: "final" as const, output: turn.data.output };
      }
      // Mixed-version desktop upgrades can briefly pair a new frontend with an
      // older backend. A valid legacy design is an immediate final turn.
      if (isDesignEnvelope(response)) return { kind: "final" as const, output: response };
      throw new Error("AI_WORKBENCH_TURN_INVALID");
    },
  });
  const raw = loop.output;
  const { design, repairs } = parseAiPresentationDesign(raw, draft);
  const constrained = constrainDesignToTemplate(
    {
      slides: applyDeckArtDirection(
        design.slides.map((slide, index) => {
          const content = draft.slides[index]!;
          const brief = briefs[index]!;
          const blockTypes = new Set((content.blocks ?? []).map((block) => block.type));
          const visualNarrative =
            slide.visualNarrative ??
            (blockTypes.has("quote")
              ? "quotation"
              : blockTypes.has("comparison")
                ? "comparison"
                : blockTypes.has("timeline") || blockTypes.has("process")
                  ? "chronology"
                  : blockTypes.has("metric") || blockTypes.has("table-data") || brief.visualIntent === "data-chart"
                    ? "evidence"
                    : brief.visualIntent === "image-story"
                      ? "scene"
                      : brief.visualIntent === "hero" || brief.visualIntent === "summary"
                        ? "statement"
                        : "framework");
          const visualAsset =
            visualAssetForBrief({
              asset: slide.visualAsset,
              form: brief.visualBrief?.form,
              brief: brief.visualBrief?.brief,
              title: content.title,
              visualIntent: brief.visualIntent,
            }) ??
            // Scene pages need a visual anchor even when an older model omitted
            // the new asset instruction. The renderer still owns placement.
            (visualNarrative === "scene"
              ? {
                  enabled: true,
                  role: "side" as const,
                  prompt: `${content.title}相关的写实环境或象征性场景，无文字、无字母、无数字`,
                }
              : undefined);
          return {
            ...slide,
            visualNarrative,
            ...(visualAsset ? { visualAsset } : {}),
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
      ),
    },
    template,
  );
  const layoutTrace = {
    coordinateSpace: "normalized-1000" as const,
    operations: loop.workbench.layout.program.operations.map(({ id, op, source }) => ({ id, op, source })),
    slots: [...loop.workbench.layout.slots.entries()].map(([id, rect]) => ({ id, rect: { ...rect } })),
    degradations: loop.transcript.flatMap((entry) =>
      entry.result.ok ? [] : entry.result.issues.map((issue) => ({ code: issue.code, message: issue.message })),
    ),
  };
  const withRepairs = (value: AiPresentationDesign): AiPresentationDesignResult => ({
    ...value,
    layoutTrace,
    ...(repairs.length > 0 ? { designRepairs: repairs } : {}),
  });
  if (!options.styleConstraint) return withRepairs(constrained);
  const allowedRecipes = options.concept ? new Set(options.concept.recipes) : undefined;
  return withRepairs({
    ...constrained,
    slides: constrained.slides.map((slide) => ({
      ...slide,
      densityTarget: options.styleConstraint!.density,
      ...(slide.recipe && allowedRecipes && !allowedRecipes.has(slide.recipe) ? { recipe: undefined } : {}),
    })),
  });
}

export const aiKeyConfigured = (providerId: string) => invoke<boolean>("ai_api_key_configured", { providerId });
export const saveAiKey = (providerId: string, apiKey: string) =>
  invoke<void>("save_ai_api_key", { providerId, apiKey });
export const deleteAiKey = (providerId: string) => invoke<void>("delete_ai_api_key", { providerId });
export const testAiConnection = (providerId: string, model: string) =>
  invoke<string>("test_ai_connection", { providerId, model });

/**
 * 取消一个生成任务。
 *
 * 后端会中断该任务下所有在途请求，而不是只让界面停止等待：否则模型会继续
 * 生成一份没人要的草稿。
 */
export const cancelAiGeneration = (taskId: number) => invoke<boolean>("cancel_ai_generation", { taskId });

/** 生成任务结束，释放后端登记。 */
export const endAiGeneration = (taskId: number) => invoke<void>("end_ai_generation", { taskId });
