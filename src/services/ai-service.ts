import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";
import { applyDeckArtDirection } from "../core/commands/deck-art-direction";
import { LAYOUT_CAPACITY } from "../core/commands/layout-capacity";
import type { AiPaletteRole } from "../core/commands/design-intent";
import { contrastRatio as colorContrastRatio } from "../core/rendering/contrast";
import { loadSettings } from "./settings";
import { defaultPresentationVisualGoal, type PresentationVisualGoal } from "./visual-alignment";
import { normalizeDraftPunctuation } from "./ai-draft-normalize";

export const narrativeStrategySchema = z.enum([
  "management-report",
  "proposal",
  "retrospective",
  "training",
  "product-launch",
  "fundraising",
  "general",
]);
const defaultPresentationBrief = {
  objective: "清晰传达演示主题",
  audience: "未指定受众",
  scenario: "通用演示",
  expectedAction: "理解演示内容",
  coreConclusion: "以演示文稿标题和逐页内容为准",
  narrativeStrategy: "general" as const,
  assumptions: ["AI 未补充完整演示简报，请在内容审核阶段确认"],
};

const presentationBriefSchema = z
  .object({
    objective: z.string().min(1).max(500).default(defaultPresentationBrief.objective),
    audience: z.string().min(1).max(300).default(defaultPresentationBrief.audience),
    scenario: z.string().min(1).max(300).default(defaultPresentationBrief.scenario),
    expectedAction: z.string().min(1).max(500).default(defaultPresentationBrief.expectedAction),
    coreConclusion: z.string().min(1).max(500).default(defaultPresentationBrief.coreConclusion),
    narrativeStrategy: narrativeStrategySchema.default(defaultPresentationBrief.narrativeStrategy),
    assumptions: z.array(z.string().max(500)).max(10).default(defaultPresentationBrief.assumptions),
  })
  .default(defaultPresentationBrief);
export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("bullet-list"), items: z.array(z.string().min(1).max(500)).min(1).max(12) }),
  z.object({
    type: z.literal("quote"),
    text: z.string().min(1).max(2000),
    attribution: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal("metric"), label: z.string().min(1).max(300), value: z.string().min(1).max(100) }),
  z.object({
    type: z.literal("timeline"),
    items: z
      .array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(500) }))
      .min(1)
      .max(10),
  }),
  z.object({
    type: z.literal("comparison"),
    leftLabel: z.string().min(1).max(100),
    rightLabel: z.string().min(1).max(100),
    leftItems: z.array(z.string().min(1).max(500)).max(8),
    rightItems: z.array(z.string().min(1).max(500)).max(8),
  }),
  z.object({
    type: z.literal("process"),
    items: z
      .array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(500) }))
      .min(1)
      .max(10),
  }),
  z.object({
    type: z.literal("table-data"),
    header: z.array(z.string().min(1).max(100)).min(1).max(10),
    rows: z
      .array(z.array(z.string().max(500)).max(10))
      .min(1)
      .max(20),
  }),
]);
/**
 * 一页想配什么图。
 *
 * 这是**意图**，不是图片：模型只说"这一页要一张什么样的图"，图什么时候生成、
 * 落在哪里，由排版引擎决定。用户可以在内容审核阶段改这段描述——那时是唯一
 * 一个还没花钱生成图片、也最容易改的时机。
 */
const visualAssetIntentSchema = z.object({
  enabled: z.boolean().default(true),
  /** 画面描述。只描述画面本身，不要要求画面出现文字。 */
  prompt: z.string().max(300).default(""),
  /** 图在页面上的角色。 */
  role: z.enum(["hero", "side", "band"]).default("side"),
  /**
   * 这段意图是谁说的。
   *
   * "model" 是模型在生成时给的，"user" 是人在审核页改的。区别很要紧：
   * 模型说"这一页不用配图"只是它保守，人说"这一页不用配图"才是决定。
   * 只有人的决定才压得住设计阶段的建议。
   */
  source: z.enum(["model", "user"]).default("model"),
});
export type AiVisualAssetIntent = z.infer<typeof visualAssetIntentSchema>;

const slidePlanSchema = z.object({
  purpose: z.string().min(1).max(300),
  conclusion: z.string().min(1).max(300),
  visualIntent: z.enum([
    "hero",
    "quote",
    "timeline",
    "comparison",
    "process",
    "data-chart",
    "image-story",
    "summary",
    "structured-text",
  ]),
  density: z.enum(["low", "medium", "high"]),
  visualAsset: visualAssetIntentSchema.optional(),
});
const legacySlidePlan = {
  purpose: "传达本页已审核内容",
  conclusion: "以本页标题和正文为准",
  visualIntent: "structured-text" as const,
  density: "medium" as const,
};
export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  presentationBrief: presentationBriefSchema,
  slides: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        title: z.string().min(1).max(200),
        body: z.string().max(4000),
        speakerNotes: z.string().max(4000),
        reviewed: z.boolean().optional(),
        plan: slidePlanSchema.default(legacySlidePlan),
        blocks: z.array(contentBlockSchema).max(20).default([]),
      }),
    )
    .min(1),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;

/** 大纲阶段只产出标题与简报，正文由分批阶段补齐。 */
export const aiOutlineSchema = z.object({
  title: z.string().min(1).max(200),
  presentationBrief: presentationBriefSchema,
  pages: z
    .array(
      z.object({
        index: z.number().int().min(0),
        title: z.string().min(1).max(200),
        purpose: z.string().min(1).max(300),
      }),
    )
    .min(1),
});
export type AiOutline = z.infer<typeof aiOutlineSchema>;

export const aiSlideBatchSchema = z.object({
  slides: z
    .array(
      z.object({
        // 批次标题最终以已校验的大纲为准。模型省略这个重复字段时不应让整次生成失败。
        title: z.string().max(200).default(""),
        body: z.string().max(4000),
        // 提示词允许备注为空；省略与空字符串在领域语义上等价。
        speakerNotes: z.string().max(4000).default(""),
        plan: slidePlanSchema.default(legacySlidePlan),
        blocks: z.array(contentBlockSchema).max(20).default([]),
      }),
    )
    .min(1),
});
export type AiSlideBatch = z.infer<typeof aiSlideBatchSchema>;
export const slideBriefSchema = z.object({
  slideIndex: z.number().int().min(0),
  purpose: z.string().min(1).max(300),
  conclusion: z.string().min(1).max(300),
  visualIntent: z.enum([
    "hero",
    "quote",
    "timeline",
    "comparison",
    "process",
    "data-chart",
    "image-story",
    "summary",
    "structured-text",
  ]),
  density: z.enum(["low", "medium", "high"]),
});
export const slideBriefsSchema = z.object({ briefs: z.array(slideBriefSchema).min(1) });
export type SlideBrief = z.infer<typeof slideBriefSchema>;

export function briefsFromDraft(draft: AiDraft): SlideBrief[] {
  return draft.slides.map((slide, slideIndex) => ({ slideIndex, ...slide.plan }));
}
const aiPaletteRoleSchema = z.enum([
  "surface",
  "surface-alt",
  "accent-1",
  "accent-2",
  "accent-3",
  "primary",
  "secondary",
  "inverse",
  "template-default",
]);
export const aiPresentationDesignSchema = z.object({
  slides: z
    .array(
      z.object({
        layout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]),
        background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        bodyColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        /**
         * The composition family of the page. The renderer checks the request
         * against the reviewed content, so an impossible request is refused
         * instead of producing a page that cannot carry its own content.
         */
        composition: z.enum(["auto", "stacked", "columns", "grid", "editorial"]).optional(),
        /** How this page communicates, before choosing a geometric skeleton. */
        visualNarrative: z
          .enum(["statement", "evidence", "comparison", "chronology", "framework", "quotation", "scene"])
          .optional(),
        /** Which level of the hierarchy carries the weight of the page. */
        emphasis: z.enum(["balanced", "title-dominant", "body-dominant"]).optional(),
        /** How much white space the page is willing to spend. */
        densityTarget: z.enum(["airy", "balanced", "compact"]).optional(),
        /**
         * The slots of the template palette the page paints itself with. The model
         * picks a slot instead of a colour value, so the deck stays inside the
         * palette of its template and the choice still has an effect.
         */
        palette: z
          .object({
            background: aiPaletteRoleSchema.optional(),
            accent: aiPaletteRoleSchema.optional(),
            title: aiPaletteRoleSchema.optional(),
            body: aiPaletteRoleSchema.optional(),
          })
          .optional(),
        /**
         * Whether this page carries a picture. The model says yes or no and
         * describes the picture; the renderer decides where it goes.
         */
        visualAsset: z
          .object({
            enabled: z.boolean(),
            /** What the picture shows. It describes the scene, never the wording. */
            prompt: z.string().max(600).optional(),
            role: z.enum(["hero", "side", "band"]).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
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
  return body
    .split(/\n+|(?=(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*)/)
    .map((value) => value.trim())
    .filter(Boolean);
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
    if (
      items.length <= LAYOUT_CAPACITY.coverMaxItems &&
      input.body.trim().length <= LAYOUT_CAPACITY.coverBodyLength &&
      !hasBlock("quote")
    )
      return "cover";
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
  if (layout === "split" && items.length < LAYOUT_CAPACITY.splitMinItems && !hasBlock("comparison"))
    layout = "title-body";
  if (
    layout === "cards" &&
    !hasCardBlock &&
    (items.length < LAYOUT_CAPACITY.cardsMinItems ||
      items.length > LAYOUT_CAPACITY.cardsMaxItems ||
      longestItem > LAYOUT_CAPACITY.cardItemLengthLimit ||
      input.body.length > LAYOUT_CAPACITY.cardBodyLengthLimit)
  ) {
    layout =
      items.length >= LAYOUT_CAPACITY.splitMinItems &&
      items.length <= LAYOUT_CAPACITY.splitMaxItems &&
      input.body.length <= LAYOUT_CAPACITY.splitBodyLength
        ? "split"
        : "title-body";
  }
  if (layout === "title-body" && items.length >= LAYOUT_CAPACITY.splitMinItems) {
    const cardEligible =
      items.length >= LAYOUT_CAPACITY.cardsGridMinItems &&
      items.length <= LAYOUT_CAPACITY.cardsMaxItems &&
      longestItem <= LAYOUT_CAPACITY.cardItemLength &&
      input.body.length <= LAYOUT_CAPACITY.cardBodyLength;
    layout = cardEligible ? "cards" : "split";
  }
  return layout;
}

export interface DesignTemplateContext {
  slideWidthEmu: number | null;
  slideHeightEmu: number | null;
  themeColors: Array<{ name: string; value: string }>;
  majorFont: string | null;
  minorFont: string | null;
  defaultBackgroundColor: string | null;
  slides: Array<{
    index: number;
    title: string;
    textCount: number;
    imageCount: number;
    shapeCount: number;
    layout: string | null;
    backgroundColor: string | null;
    regions: Array<{ role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }>;
  }>;
  layouts: Array<{
    index: number;
    name: string;
    backgroundColor: string | null;
    regions: Array<{ role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }>;
  }>;
}

function colorLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

/** Blends `foreground` towards `background` so body copy can step back one level. */
function mixColor(foreground: string, background: string, amount: number): string {
  const first = [foreground.slice(1, 3), foreground.slice(3, 5), foreground.slice(5, 7)].map((value) =>
    Number.parseInt(value, 16),
  );
  const second = [background.slice(1, 3), background.slice(3, 5), background.slice(5, 7)].map((value) =>
    Number.parseInt(value, 16),
  );
  if ([...first, ...second].some((value) => !Number.isFinite(value))) return foreground;
  const blended = first.map((channel, index) => Math.round(channel + (second[index]! - channel) * amount));
  return `#${blended.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** The palette of a template, resolved into the slots a page can pick. */
interface TemplatePalette {
  /** The background the template paints its pages with. */
  background: string;
  /** The main ink of the template. */
  primary: string;
  /** The accents of the template, in the order the theme declares them. */
  accents: string[];
  /** The light surfaces of the template. */
  surfaces: string[];
  /** Whether the template declares a palette at all. */
  hasColors: boolean;
}

/** The inks a page uses on the background it ended up with. */
interface DerivedInk {
  /** The ink that reads on the background. */
  ink: string;
  /** The ink that reads on the background and steps one level back. */
  secondary: string;
}

function templatePalette(template: DesignTemplateContext): TemplatePalette {
  const colors = new Map(template.themeColors.map((color) => [color.name.toLowerCase(), color.value.toUpperCase()]));
  const accent1 = colors.get("accent1");
  const accent2 = colors.get("accent2");
  const accent3 = colors.get("accent3");
  const light = colors.get("lt1") ?? colors.get("lt2");
  const dark = colors.get("dk1") ?? colors.get("dk2");
  const rawBackground = template.defaultBackgroundColor;
  const background = rawBackground?.startsWith("#")
    ? rawBackground.toUpperCase()
    : rawBackground
      ? (colors.get(rawBackground.toLowerCase()) ?? light ?? "#FFFFFF")
      : (light ?? "#FFFFFF");
  const foreground = dark ?? (colorLuminance(background) > 0.45 ? "#1F2937" : "#FFFFFF");
  return {
    background,
    primary: foreground,
    accents: [accent1, accent2, accent3].filter((value): value is string => Boolean(value)),
    surfaces: [light, colors.get("lt2")].filter((value): value is string => Boolean(value)),
    hasColors: Boolean(accent1 || accent2 || light || dark),
  };
}

/**
 * The inks of a page, derived from the background the page actually uses.
 *
 * A page that paints itself with a dark surface of the template cannot keep
 * the dark ink of that template, so the inks are mixed against the background
 * the page ended up with and not against the one the template defaults to.
 */
function deriveInk(palette: TemplatePalette, background: string): DerivedInk {
  const onLight = (colorLuminance(background) ?? 1) > 0.45;
  const ink = onLight ? palette.primary : (palette.surfaces[0] ?? "#FFFFFF");
  return { ink, secondary: mixColor(ink, background, onLight ? 0.22 : 0.16) };
}

/**
 * The colour of a palette slot.
 *
 * The model picks a slot of the template palette instead of a colour value, so
 * the deck stays inside the palette of its template while the choice the
 * model made still decides what the page looks like. A slot the template does
 * not have falls back to the closest one it does have.
 */
function roleColor(role: AiPaletteRole | undefined, palette: TemplatePalette, derived: DerivedInk): string | undefined {
  switch (role) {
    case "surface":
      return palette.surfaces[0] ?? palette.background;
    case "surface-alt":
      return palette.surfaces[1] ?? palette.surfaces[0] ?? palette.background;
    case "accent-1":
      return palette.accents[0] ?? derived.ink;
    case "accent-2":
      return palette.accents[1] ?? palette.accents[0] ?? derived.ink;
    case "accent-3":
      return palette.accents[2] ?? palette.accents[1] ?? palette.accents[0] ?? derived.ink;
    case "primary":
      return palette.primary;
    case "secondary":
      return derived.secondary;
    case "inverse":
      return derived.ink;
    case "template-default":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Resolves the colours of every page inside the palette of the template.
 *
 * The template owns the colours: a generated deck has to stay inside the
 * palette of the template it was built with. The model still chooses, but it
 * chooses a slot of that palette rather than an arbitrary value. A model that
 * picks no slot keeps the colours of the template, which is what the previous
 * behaviour did.
 */
export function constrainDesignToTemplate(
  design: AiPresentationDesign,
  template: DesignTemplateContext,
): AiPresentationDesign {
  const palette = templatePalette(template);
  if (!palette.hasColors) return design;
  return {
    slides: design.slides.map((slide) => {
      const background =
        roleColor(slide.palette?.background, palette, deriveInk(palette, palette.background)) ?? palette.background;
      // The inks are derived from the background the page actually uses, not
      // from the background the template defaults to.
      const derived = deriveInk(palette, background);
      const accent = roleColor(slide.palette?.accent, palette, derived) ?? palette.accents[0] ?? slide.accent;
      // A slot of the palette only decides the tone. An ink that cannot be read
      // on the background the page ended up with is not a choice, it is a
      // mistake, so it falls back to the ink that reads.
      const chosenTitle = roleColor(slide.palette?.title, palette, derived);
      const chosenBody = roleColor(slide.palette?.body, palette, derived);
      const titleColor =
        chosenTitle && (colorContrastRatio(chosenTitle, background) ?? 0) >= 4.5 ? chosenTitle : derived.ink;
      const bodyColor =
        chosenBody && (colorContrastRatio(chosenBody, background) ?? 0) >= 4.5 ? chosenBody : derived.secondary;
      return { ...slide, background, accent, titleColor, bodyColor };
    }),
  };
}
/** 当前选中的厂商与模型。调用方不再关心具体厂商，由设置决定。 */
async function aiSelection(): Promise<{ provider: string; model: string }> {
  const settings = await loadSettings();
  return { provider: settings.aiProviderId, model: settings.aiModel };
}

export function describeAiError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("AI_VISUAL_QUALITY_GATE_FAILED"))
    return `生成结果未通过视觉质量检查。${detail.split(": ").slice(1).join(": ")}`;
  if (detail.includes("AI_VISION_REVIEW_FAILED"))
    return `视觉评审不可用：${detail.split(":").slice(1).join(":").trim() || "模型未返回可用结果"}。已跳过视觉评审，改用确定性校验。`;
  if (detail.includes("AI_REQUEST_CANCELLED") || detail.includes("AI_GENERATION_CANCELLED")) return "已取消本次生成";
  if (detail.includes("AI_REQUEST_TIMEOUT")) return "AI 生成超时，请减少页数后重试";
  if (detail.includes("AI_PROVIDER_BUSY")) return "AI 服务当前繁忙，系统已自动重试，请稍后再次生成";
  if (
    detail.includes("AI_PROVIDER_HTTP_ERROR:401") ||
    detail.includes("AI_PROVIDER_HTTP_ERROR:403") ||
    detail.includes("AI_API_KEY_MISSING")
  )
    return "AI 服务凭据无效或未配置，请在设置中检查 API Key";
  if (detail.includes("AI_PROVIDER_HTTP_ERROR:429")) return "AI 请求过于频繁，请稍后再试";
  if (detail.includes("timed out") || detail.includes("REQUEST_FAILED")) return "AI 服务连接超时，请检查网络后重试";
  if (
    detail.includes("JSON_INVALID") ||
    detail.includes("RESPONSE_INVALID") ||
    detail.includes("EMPTY_RESPONSE") ||
    detail.includes("ZodError")
  )
    return "AI 返回的数据格式不符合要求，请重新生成";
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
export function listenAiGenerationProgress(
  handler: (progress: AiGenerationStreamProgress) => void,
): Promise<UnlistenFn> {
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
export async function generatePresentationDraft(
  topic: string,
  slideCount: number,
  options: AiGenerationOptions = {},
): Promise<AiDraft> {
  const { provider, model } = await aiSelection();
  if (slideCount <= SINGLE_CALL_PAGE_LIMIT) {
    options.onProgress?.({ stage: "content", completed: 0, total: 1, label: "正在生成演示草稿…" });
    const raw = await invoke<unknown>("generate_presentation", {
      request: { topic, slideCount, model, provider, taskId: options.taskId, streamProgress: true },
    });
    const draft = aiDraftSchema.parse(raw);
    if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
    options.onProgress?.({ stage: "content", completed: 1, total: 1, label: "草稿已生成" });
    // 标点在这里收拾：模型刚写完、用户还没看到的时候。
    return normalizeDraftPunctuation(draft);
  }

  options.onProgress?.({ stage: "outline", completed: 0, total: 1, label: "正在规划演示大纲…" });
  const outlineRaw = await invoke<unknown>("generate_presentation_outline", {
    request: { topic, slideCount, model, provider, taskId: options.taskId, streamProgress: true },
  });
  const parsedOutline = aiOutlineSchema.parse(outlineRaw);
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
            model,
            provider,
            taskId: options.taskId,
            streamProgress: true,
          },
        });
        const parsed = aiSlideBatchSchema.parse(raw);
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
    };
  });
  const draft = aiDraftSchema.parse({ title: outline.title, presentationBrief: outline.presentationBrief, slides });
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  options.onProgress?.({ stage: "content", completed: batches.length, total: batches.length, label: "草稿已生成" });
  // 标点在这里收拾：模型刚写完、用户还没看到的时候。
  return normalizeDraftPunctuation(draft);
}

export async function polishPresentationTopic(topic: string): Promise<string> {
  const { provider, model } = await aiSelection();
  const raw = await invoke<unknown>("polish_presentation_topic", { request: { topic, model, provider } });
  return z.string().trim().min(1).max(4000).parse(raw);
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
  /** 生成任务号：取消时后端会中断该任务下所有在途请求。 */
  taskId?: number;
}

export async function generatePresentationDesign(
  draft: AiDraft,
  briefs: SlideBrief[],
  template: DesignTemplateContext,
  options: AiPresentationDesignOptions = {},
): Promise<AiPresentationDesign> {
  const { provider, model } = await aiSelection();
  const visualGoal = options.visualGoal ?? defaultPresentationVisualGoal();
  const raw = await invoke<unknown>("generate_presentation_design", {
    request: { draft, briefs, template, visualGoal, model, provider, taskId: options.taskId },
  });
  const design = aiPresentationDesignSchema.parse(raw);
  if (design.slides.length !== draft.slides.length) throw new Error("AI_DESIGN_SLIDE_COUNT_MISMATCH");
  return constrainDesignToTemplate(
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
          return {
            ...slide,
            visualNarrative,
            // Scene pages need a visual anchor even when an older model omitted
            // the new asset instruction. The renderer still owns placement.
            ...(visualNarrative === "scene" && !slide.visualAsset
              ? {
                  visualAsset: {
                    enabled: true,
                    role: "side" as const,
                    prompt: `${content.title}相关的写实环境或象征性场景，无文字、无字母、无数字`,
                  },
                }
              : {}),
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
