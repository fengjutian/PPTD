import type { DeckConcept, RecipeId } from "../../design/deck-concept";

/** Stable semantic parts a recipe may put on a page. */
export type DesignComponentRole =
  | "page-title"
  | "body-copy"
  | "numbered-list"
  | "metric-card"
  | "native-chart"
  | "content-image"
  | "image-plate"
  | "process-node"
  | "timeline-node"
  | "comparison-column"
  | "quote-mark"
  | "attribution"
  | "section-marker"
  | "accent-rule"
  | "surface-panel"
  | "index-rail";

export type RecipeIntent = "statement" | "evidence" | "list" | "image" | "process" | "comparison" | "quote";

export interface RecipeCatalogEntry {
  id: RecipeId;
  label: string;
  intent: RecipeIntent;
  summary: string;
  components: readonly DesignComponentRole[];
  /** A hard rendering prerequisite, not an invitation to invent an image. */
  requiresImage: boolean;
  /** Minimum body-column capability expected from a template layout. */
  minimumColumns: 1 | 2;
  /** Content-capacity guidance; the recipe's `supports` function remains authoritative. */
  capacity: { minItems?: number; maxItems?: number; note: string };
}

const recipe = (entry: RecipeCatalogEntry): RecipeCatalogEntry => entry;

/**
 * Human- and model-readable facts for every renderer-backed recipe.
 *
 * This catalog contains no coordinates, colours or font sizes. Geometry stays
 * in the recipe implementation and visual values stay in design tokens.
 */
export const RECIPE_CATALOG: Readonly<Record<RecipeId, RecipeCatalogEntry>> = {
  "cover-statement": recipe({
    id: "cover-statement",
    label: "封面陈述",
    intent: "statement",
    summary: "用一个主标题和少量辅助信息建立整册开场。",
    components: ["page-title", "body-copy", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { maxItems: 2, note: "仅适合封面和极少量辅助信息。" },
  }),
  "data-story": recipe({
    id: "data-story",
    label: "指标故事",
    intent: "evidence",
    summary: "用原生指标卡突出同一叙事下的关键数字。",
    components: ["page-title", "metric-card", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { minItems: 1, note: "需要 metric 内容块；不替代多系列图表。" },
  }),
  "chart-story": recipe({
    id: "chart-story",
    label: "图表故事",
    intent: "evidence",
    summary: "用原生可编辑图表承载同单位数据关系。",
    components: ["page-title", "native-chart", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { minItems: 1, note: "需要 chart 内容块；系列色来自主题令牌。" },
  }),
  "editorial-index": recipe({
    id: "editorial-index",
    label: "编辑索引",
    intent: "list",
    summary: "以编号和清晰节奏组织短要点。",
    components: ["page-title", "numbered-list", "index-rail", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { minItems: 3, maxItems: 6, note: "要点应简短并可快速扫描。" },
  }),
  "asymmetric-split": recipe({
    id: "asymmetric-split",
    label: "非对称分栏",
    intent: "list",
    summary: "用主次不等的两块区域组织结论和要点。",
    components: ["page-title", "body-copy", "surface-panel", "accent-rule"],
    requiresImage: false,
    minimumColumns: 2,
    capacity: { minItems: 2, maxItems: 5, note: "适合中短要点，不用于结构化数据块。" },
  }),
  "image-led": recipe({
    id: "image-led",
    label: "主图引导",
    intent: "image",
    summary: "让图片占据页面主区域，文字保持独立可编辑。",
    components: ["page-title", "body-copy", "content-image", "accent-rule"],
    requiresImage: true,
    minimumColumns: 1,
    capacity: { note: "需要可用图片；适合一般图文页。" },
  }),
  "full-bleed-image": recipe({
    id: "full-bleed-image",
    label: "全幅图片",
    intent: "image",
    summary: "图片铺满页面，文字落在可读的原生色板上。",
    components: ["page-title", "body-copy", "content-image", "image-plate"],
    requiresImage: true,
    minimumColumns: 1,
    capacity: { maxItems: 2, note: "适合封面、章节或短陈述。" },
  }),
  "side-image-text": recipe({
    id: "side-image-text",
    label: "侧图正文",
    intent: "image",
    summary: "以框选图片和测量过的正文列形成图文对开。",
    components: ["page-title", "body-copy", "content-image", "image-plate", "accent-rule"],
    requiresImage: true,
    minimumColumns: 2,
    capacity: { minItems: 3, maxItems: 5, note: "适合正文较多的图文页。" },
  }),
  "process-rail": recipe({
    id: "process-rail",
    label: "流程轨道",
    intent: "process",
    summary: "沿共享轨道表达有先后关系的步骤。",
    components: ["page-title", "process-node", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { minItems: 2, note: "需要 process 内容块。" },
  }),
  comparison: recipe({
    id: "comparison",
    label: "双栏对比",
    intent: "comparison",
    summary: "用同等权重的两栏比较两组已审核内容。",
    components: ["page-title", "comparison-column", "accent-rule"],
    requiresImage: false,
    minimumColumns: 2,
    capacity: { minItems: 2, note: "需要 comparison 内容块。" },
  }),
  "weighted-split": recipe({
    id: "weighted-split",
    label: "加权对比",
    intent: "comparison",
    summary: "以不同视觉权重比较主次两组内容。",
    components: ["page-title", "comparison-column", "surface-panel"],
    requiresImage: false,
    minimumColumns: 2,
    capacity: { minItems: 2, note: "需要可分成主次的比较内容。" },
  }),
  "timeline-rail": recipe({
    id: "timeline-rail",
    label: "时间轴",
    intent: "process",
    summary: "沿统一轨道表达时间节点及其说明。",
    components: ["page-title", "timeline-node", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { minItems: 2, note: "需要 timeline 内容块。" },
  }),
  "quote-field": recipe({
    id: "quote-field",
    label: "引用场",
    intent: "quote",
    summary: "以大字号引用、引号和署名建立安静页面。",
    components: ["page-title", "quote-mark", "attribution", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { maxItems: 1, note: "需要 quote 内容块。" },
  }),
  "section-statement": recipe({
    id: "section-statement",
    label: "章节陈述",
    intent: "statement",
    summary: "用章节标记和主标题完成段落过渡。",
    components: ["section-marker", "page-title", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { maxItems: 1, note: "仅适合章节页。" },
  }),
  "paper-column": recipe({
    id: "paper-column",
    label: "纸本专栏",
    intent: "list",
    summary: "以窄版心和连续正文形成纸本阅读节奏。",
    components: ["page-title", "body-copy", "accent-rule"],
    requiresImage: false,
    minimumColumns: 1,
    capacity: { note: "仅由 paper 设计方向选择。" },
  }),
  "instrument-columns": recipe({
    id: "instrument-columns",
    label: "仪表索引",
    intent: "evidence",
    summary: "用索引轨道和分栏数字形成仪表式信息层级。",
    components: ["page-title", "numbered-list", "metric-card", "index-rail"],
    requiresImage: false,
    minimumColumns: 2,
    capacity: { note: "仅由 instrument 设计方向选择。" },
  }),
};

export function recipeCatalogForConcept(concept: Pick<DeckConcept, "recipes">): RecipeCatalogEntry[] {
  return concept.recipes.map((id) => RECIPE_CATALOG[id]);
}

export function imageRecipeIds(): RecipeId[] {
  return Object.values(RECIPE_CATALOG)
    .filter((entry) => entry.requiresImage)
    .map((entry) => entry.id);
}
