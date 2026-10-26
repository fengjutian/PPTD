import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";

import { LAYOUT_CAPACITY, stripListPrefix } from "../core/commands/layout-capacity";
import type { AiPaletteRole, CompositionFacts } from "../core/commands/design-intent";

import { contrastRatio as colorContrastRatio, fillForInk, MINIMUM_CONTRAST } from "../core/rendering/contrast";
import { loadSettings } from "./settings";

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
    type: z.literal("chart"),
    kind: z.enum(["column", "bar", "line", "pie"]),
    categories: z.array(z.string().min(1).max(100)).min(2).max(8),
    values: z.array(z.number().finite()).min(2).max(8).optional(),
    series: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          values: z.array(z.number().finite()).min(2).max(8),
        }),
      )
      .min(1)
      .max(6)
      .optional(),
    unit: z.string().max(20).optional(),
  }),
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

const visualBriefSchema = z.object({
  /**
   * The visual form the page should take. This is a content decision: the page
   * says whether its evidence is a photograph, a chart, a diagram, a quote, a
   * metric, a table or nothing at all. The design stage may refuse it when the
   * reviewed content cannot carry it.
   */
  form: z.enum(["image", "chart", "diagram", "quote", "metric", "table", "none"]),
  /** What the picture/diagram shows, never new wording or numbers. */
  brief: z.string().max(300).optional(),
  aspect: z.enum(["16:9", "4:3", "1:1"]).optional(),
});
export type VisualBrief = z.infer<typeof visualBriefSchema>;

export const slidePlanSchema = z.object({
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
  visualBrief: visualBriefSchema.optional(),
  visualAsset: visualAssetIntentSchema.optional(),
});
export const legacySlidePlan = {
  purpose: "传达本页已审核内容",
  conclusion: "以本页标题和正文为准",
  visualIntent: "structured-text" as const,
  density: "medium" as const,
};

/**
 * 一处需要核实的说法。
 *
 * 核实是人的动作：AI 不能确认事实真假，所以这里只记录"谁标记了什么、核没核"，
 * 不记录模型的判断。`blockIndex` 指内容块；缺省表示整页级（例如标题里的判断）。
 */
export const contentCheckKindSchema = z.enum(["fact", "number", "citation"]);
export const contentCheckSchema = z.object({
  blockIndex: z.number().int().min(0).optional(),
  kind: contentCheckKindSchema,
  status: z.enum(["unverified", "verified"]).default("unverified"),
});
export type ContentCheck = z.infer<typeof contentCheckSchema>;
export type ContentCheckKind = z.infer<typeof contentCheckKindSchema>;

/**
 * 一条素材事实。
 *
 * 事实只能从用户提供的素材里抽取：模型没有外部事实来源，让它凭主题"回忆"
 * 数字，得到的是一份读起来很专业、却无法核对的稿子。编号由系统按顺序分配，
 * 提示词、正文引用和审核页才对得上同一条事实。
 */
export const sourceFactSchema = z.object({
  /** 本稿内稳定，形如 F1。 */
  id: z.string().regex(/^F\d+$/),
  /** 一句话事实，含主体、指标和口径。 */
  statement: z.string().min(1).max(300),
  /** 原文数字，如 "320 亿元"。 */
  figure: z.string().max(80).optional(),
  /** 时间，如 "2024 年"。 */
  period: z.string().max(80).optional(),
  /** 出处，如 "2024 年报"。 */
  source: z.string().max(120).optional(),
});
export type SourceFact = z.infer<typeof sourceFactSchema>;

export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  presentationBrief: presentationBriefSchema,
  /**
   * 从用户素材里抽取的事实。
   *
   * 没有素材时缺省；旧草稿没有这个字段也不需要迁移。事实只活在审核草稿里，
   * 不进入演示文稿，也不随导出走。
   */
  sourceFacts: z.array(sourceFactSchema).max(24).optional(),
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
        // 这一页引用了哪些素材事实。没有素材的草稿为空数组。
        factRefs: z.array(z.string().max(20)).max(8).optional(),
        // 旧草稿没有这个字段：缺省即"这一页没有核实标记"。
        checks: z.array(contentCheckSchema).max(20).optional(),
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
        factRefs: z.array(z.string().max(20)).max(8).optional(),
      }),
    )
    .min(1),
});
export type AiSlideBatch = z.infer<typeof aiSlideBatchSchema>;

/** 事实抽取的输出合同。编号由系统分配，模型只负责"从原文里挑"。 */
export const sourceFactsResponseSchema = z.object({
  facts: z
    .array(
      z.object({
        statement: z.string().min(1).max(300),
        figure: z.string().max(80).optional(),
        period: z.string().max(80).optional(),
        source: z.string().max(120).optional(),
      }),
    )
    .max(60),
});
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
  visualBrief: visualBriefSchema.optional(),
});
export const slideBriefsSchema = z.object({ briefs: z.array(slideBriefSchema).min(1) });
export type SlideBrief = z.infer<typeof slideBriefSchema>;

/**
 * The design direction the model proposes. Only presets with a renderer are in
 * the enum: a value the command layer cannot draw must fail validation, not be
 * silently downgraded after the fact.
 */
export const aiDeckConceptSchema = z.object({
  preset: z.enum(["editorial", "documentary", "paper", "instrument"]),
  name: z.string().trim().min(1).max(20),
  idea: z.string().trim().min(1).max(80),
  typeContrast: z.enum(["calm", "strong", "dramatic"]),
  imagery: z.enum(["none", "hero", "band", "side", "texture"]),
  rationale: z.string().trim().min(1).max(120),
});
export const aiDeckConceptsSchema = z.object({ concepts: z.array(aiDeckConceptSchema).min(1).max(3) });
/**
 * The four directions the gate shows. Every renderable preset appears once: the
 * set is a choice among skeletons, not four colourways of the same page. A
 * missing or duplicated preset is a contract violation, so the whole gate falls
 * back to the single-direction path instead of showing a short list.
 */
export const aiDeckDirectionsSchema = z
  .object({ directions: z.array(aiDeckConceptSchema).length(4) })
  .superRefine((value, context) => {
    const presets = value.directions.map((direction) => direction.preset);
    if (new Set(presets).size !== presets.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["directions"],
        message: "AI_DIRECTIONS_DUPLICATE_PRESET",
      });
    }
  });

/**
 * Bumped whenever the direction prompt or its output contract changes.
 *
 * The prompt regression fixtures pin this string; a prompt edit without a
 * version bump fails the regression suite instead of silently invalidating
 * recorded model outputs.
 */
export const DESIGN_DIRECTIONS_PROMPT_VERSION = "design-directions-v2";

/**
 * Bumped whenever the page design prompt or its output contract changes.
 *
 * The page prompt is assembled in `src-tauri/src/commands/ai.rs`; this constant
 * is the frontend's record of which revision produced a deck. Bump it in the
 * same change as the prompt, and surface it in the design quality report so a
 * run can be traced without storing the prompt text.
 */
export const DESIGN_PROMPT_VERSION = "design-pages-v1";
export type AiDeckConceptOutput = z.infer<typeof aiDeckConceptSchema>;

export function briefsFromDraft(draft: AiDraft): SlideBrief[] {
  return draft.slides.map((slide, slideIndex) => ({ slideIndex, ...slide.plan }));
}

/**
 * The content facts the concept planner needs before page layouts exist.
 *
 * `layout` is deliberately neutral: the concept only uses the facts to choose a
 * deck rhythm, and the per-page design stage owns the actual layout choice.
 */
export function compositionFactsFromDraft(draft: AiDraft): CompositionFacts[] {
  return draft.slides.map((slide) => {
    const blocks = slide.blocks ?? [];
    const bulletItems = blocks
      .filter((block): block is Extract<ContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
      .flatMap((block) => block.items);
    const items = (bulletItems.length > 0 ? bulletItems : splitBodyItems(slide.body)).map(stripListPrefix);
    const hasRowBlock = blocks.some(
      (block) =>
        block.type === "timeline" || block.type === "process" || block.type === "metric" || block.type === "chart",
    );
    return {
      itemCount: items.length,
      shortItems: items.every((item) => item.length <= LAYOUT_CAPACITY.shortItemLength),
      longestItemLength: items.reduce((longest, item) => Math.max(longest, item.length), 0),
      bodyLength: slide.body.length,
      hasQuote: blocks.some((block) => block.type === "quote"),
      hasComparison: blocks.some((block) => block.type === "comparison"),
      hasRowBlock,
      hasMetric: blocks.some((block) => block.type === "metric"),
      hasChart: blocks.some((block) => block.type === "chart"),
      hasTimeline: blocks.some((block) => block.type === "timeline"),
      hasProcess: blocks.some((block) => block.type === "process"),
      hasTable: blocks.some((block) => block.type === "table-data"),
      layout: "title-body",
    };
  });
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
const aiDesignRecipeIds = [
  "cover-statement",
  "data-story",
  "chart-story",
  "image-led",
  "full-bleed-image",
  "side-image-text",
  "editorial-index",
  "asymmetric-split",
  "process-rail",
  "comparison",
  "weighted-split",
  "timeline-rail",
  "quote-field",
  "section-statement",
  // Two recipes a direction draws itself. The design prompt does not offer
  // them: the command layer selects them from the concept (ADR 0094), and a
  // request for one outside its direction is refused by the concept's recipe
  // set. They appear here so the design type and the renderer agree on what an
  // implemented recipe is.
  "paper-column",
  "instrument-columns",
] as const;

const DESIGN_PLAN_FOCAL_KINDS = ["title", "number", "image", "chart", "none"] as const;

export const pageDesignPlanSchema = z.object({
  role: z.enum(["cover", "section", "claim", "comparison", "process", "timeline", "quote", "summary"]),
  composition: z.object({
    primitive: z.enum(["split", "stack", "grid", "rail", "overlay", "band"]),
    ratio: z.number().min(0.25).max(0.75).optional(),
    align: z.enum(["left", "center"]).optional(),
  }),
  density: z.enum(["sparse", "normal", "dense"]),
  /** The AI picks an intent, never a point size. */
  typeScale: z.enum(["compact", "normal", "expressive"]).optional(),
  templatePolicy: z.enum(["use", "takeover", "ignore"]),
  recipe: z.enum(aiDesignRecipeIds).optional(),
  /**
   * The first visual entry of the page.
   *
   * The design prompt exposes two fields with the same word: the page-level
   * `focal` enum (`title` / `index` / `body`) and this object. Models
   * occasionally write the enum shorthand here. A string matching a focal kind
   * is normalised; layer names are dropped instead of failing the whole page
   * (and, with it, the four-direction gate).
   */
  focal: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const kind = DESIGN_PLAN_FOCAL_KINDS.find((candidate) => candidate === value);
      return kind ? { kind } : undefined;
    },
    z
      .object({
        kind: z.enum(DESIGN_PLAN_FOCAL_KINDS),
        blockId: z.string().max(120).optional(),
        brief: z.string().max(600).optional(),
      })
      .optional(),
  ),
  chart: z
    .object({
      kind: z.enum(["column", "bar", "line", "pie"]),
      /** The data relation the page is arguing, before the chart type. */
      relation: z.enum(["proportion", "change", "composition", "comparison", "magnitude"]).optional(),
    })
    .optional(),
});

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
        /**
         * The page recipe that draws this page. It is optional so old models and
         * old design files keep the legacy composition path.
         */
        recipe: z.enum(aiDesignRecipeIds).optional(),
        /** The semantic design plan; absent keeps the legacy design path. */
        designPlan: pageDesignPlanSchema.optional(),
        variant: z.enum(["left", "right"]).optional(),
        focal: z.enum(["title", "index", "body"]).optional(),
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
type DesignVisualAsset = NonNullable<AiPresentationDesign["slides"][number]["visualAsset"]>;

/**
 * Applies the content stage's visual form to the design stage's asset choice.
 *
 * "none" disables an image even when the design model asked for one; "image"
 * turns a missing prompt into a concrete picture brief. Non-image forms keep
 * the page free of stock photography so a chart/diagram/table block owns the
 * page instead.
 */
export function visualAssetForBrief(input: {
  asset?: DesignVisualAsset;
  form?: VisualBrief["form"];
  brief?: string;
  title: string;
  visualIntent: SlideBrief["visualIntent"];
}): DesignVisualAsset | undefined {
  if (!input.form) return input.asset;
  if (input.form !== "image") return { enabled: false };
  return {
    enabled: true,
    role: input.asset?.role ?? (input.visualIntent === "hero" ? "hero" : "side"),
    prompt:
      input.asset?.prompt?.trim() ||
      input.brief?.trim() ||
      `${input.title}相关的真实场景或材质特写，无文字、无字母、无数字`,
  };
}

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
    capabilities?: {
      hasTitle: boolean;
      hasBody: boolean;
      hasImage: boolean;
      columns: number;
      free: boolean;
    };
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
 * Deepens a filled page until the ink it carries reads on it.
 *
 * The palette's accent tones are chosen to be marks on paper, not whole pages.
 * A light accent painted full-bleed under the inverse ink is a 2.5:1 page, so
 * the field is deepened rather than the beat being turned into dark text on a
 * bright field: the deck keeps its own rhythm. Light fields are left alone;
 * their ink is chosen against them.
 */
function readableField(fill: string, ink: string): string {
  if ((colorContrastRatio(ink, fill) ?? 21) >= MINIMUM_CONTRAST) return fill;
  if (colorLuminance(fill) > 0.45) return fill;
  return fillForInk(ink, fill);
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
      const requestedBackground =
        roleColor(slide.palette?.background, palette, deriveInk(palette, palette.background)) ?? palette.background;
      // The field has to carry the copy that is set on it, so a light accent
      // used as a page surface is deepened until its inverse ink reads.
      const background = readableField(requestedBackground, deriveInk(palette, requestedBackground).ink);
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
export async function aiSelection(): Promise<{ provider: string; model: string }> {
  const settings = await loadSettings();
  return { provider: settings.aiProviderId, model: settings.aiModel };
}

export function describeAiError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.startsWith("AI_RESPONSE_SCHEMA_INVALID:")) {
    const [, stage = "生成结果", path = "未知字段", reason = "字段值无效"] = detail.split(":");
    return `AI 返回的${stage}未通过校验：${path} ${reason}`;
  }
  if (detail.includes("AI_OUTLINE_PAGE_COUNT_MISMATCH")) return "AI 返回的大纲页数与请求页数不一致，请重新生成";
  if (detail.includes("AI_OUTLINE_PAGE_INDEX_INVALID")) return "AI 返回的大纲页码不连续，请重新生成";
  if (detail.includes("AI_BATCH_SLIDE_COUNT_MISMATCH")) return "AI 返回的正文页数与大纲不一致，请重新生成";
  if (detail.includes("AI_SLIDE_COUNT_MISMATCH")) return "AI 返回的草稿页数与请求页数不一致，请重新生成";
  if (detail.includes("AI_OUTLINE_JSON_INVALID")) return "AI 返回的演示大纲不是完整 JSON，请重新生成";
  if (detail.includes("AI_BATCH_JSON_INVALID")) return "AI 返回的正文批次不是完整 JSON，请重新生成";
  if (detail.includes("AI_JSON_INVALID")) return "AI 返回的完整草稿不是有效 JSON，请重新生成";
  if (detail.includes("AI_REWRITE_JSON_INVALID")) return "AI 返回的本页重写结果不是完整 JSON，请重新生成";
  if (detail.includes("AI_REWRITE_EMPTY")) return "AI 没有返回可用的正文，请重新生成";
  if (detail.includes("AI_REWRITE_REQUEST_INVALID")) return "这一页暂时无法重写：请先补全页面标题";
  if (detail.includes("AI_TITLES_JSON_INVALID")) return "AI 返回的标题候选不是完整 JSON，请重试";
  if (detail.includes("AI_TITLES_EMPTY")) return "AI 没有给出可用的标题候选，请重试";
  if (detail.includes("AI_NOTES_JSON_INVALID")) return "AI 返回的演讲备注不是完整 JSON，请重试";
  if (detail.includes("AI_NOTES_EMPTY")) return "AI 没有写出可用的演讲备注，请重试";
  if (detail.includes("AI_IMAGE_PROMPTS_JSON_INVALID")) return "AI 返回的画面描述不是完整 JSON，请重试";
  if (detail.includes("AI_IMAGE_PROMPTS_EMPTY")) return "AI 没有给出可用的画面描述，请重试";
  if (detail.includes("AI_SPLIT_JSON_INVALID")) return "AI 返回的拆页结果不是完整 JSON，请重试";
  if (detail.includes("AI_SPLIT_EMPTY")) return "AI 拆出的页面没有内容，请重试";
  if (detail.includes("AI_SPLIT_TITLE_DUPLICATE")) return "AI 拆出的两页标题相同，请重试";
  if (detail.includes("AI_DECK_REVIEW_JSON_INVALID")) return "AI 返回的审稿结果不是完整 JSON，请重试";
  if (detail.includes("AI_DECK_REVIEW_REQUEST_INVALID")) return "这份草稿暂时无法审稿：页数或内容超出了单次请求的上限";
  if (
    detail.includes("AI_TITLES_REQUEST_INVALID") ||
    detail.includes("AI_NOTES_REQUEST_INVALID") ||
    detail.includes("AI_SPLIT_REQUEST_INVALID")
  )
    return "这一页暂时无法处理：请先补全页面标题";
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
  /** 已抽取的素材事实。为空时生成行为与没有素材时完全一致。 */
  facts?: readonly SourceFact[];
}

/** 一次请求能写完的页数上限。再少就没必要拆批。 */
