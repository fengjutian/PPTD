import type { AiDraft, DesignTemplateContext, SlideBrief } from "./ai-contracts";

export type SemanticRelation =
  | "statement"
  | "comparison"
  | "chronology"
  | "process"
  | "evidence"
  | "hierarchy"
  | "quotation"
  | "scene";

export interface SlideDesignIntelligence {
  slideIndex: number;
  relation: SemanticRelation;
  rhythmRole: "opening" | "build" | "evidence" | "turn" | "pause" | "close";
  preferredFamilies: string[];
  avoidFamilies: string[];
  focalPriority: "title" | "number" | "chart" | "image" | "body";
  measurement: {
    titleChars: number;
    bodyChars: number;
    itemCount: number;
    estimatedTitleLines: number;
    estimatedBodyLines: number;
    pressure: "low" | "medium" | "high";
  };
  dataStory?: {
    relationship: "proportion" | "change" | "comparison" | "magnitude";
    recommendedChart: "column" | "bar" | "line" | "pie";
  };
}

export interface DesignIntelligence {
  slides: SlideDesignIntelligence[];
  deckRhythm: string[];
  brandGrammar: {
    titleAxes: number[];
    bodyColumns: number[];
    imageLayouts: number;
    palette: string[];
    fonts: string[];
  };
}

function relationOf(draft: AiDraft["slides"][number], brief: SlideBrief): SemanticRelation {
  const blocks = draft.blocks ?? [];
  if (blocks.some((block) => block.type === "comparison")) return "comparison";
  if (blocks.some((block) => block.type === "timeline")) return "chronology";
  if (blocks.some((block) => block.type === "process")) return "process";
  if (blocks.some((block) => block.type === "chart" || block.type === "table-data" || block.type === "metric"))
    return "evidence";
  if (blocks.some((block) => block.type === "quote")) return "quotation";
  if (brief.visualIntent === "image-story" || brief.visualIntent === "hero") return "scene";
  if ((draft.body.match(/\n/g)?.length ?? 0) >= 4) return "hierarchy";
  return "statement";
}

function familiesFor(relation: SemanticRelation): string[] {
  if (relation === "comparison") return ["comparison", "weighted-split", "instrument-columns"];
  if (relation === "chronology") return ["timeline-rail", "process-rail", "editorial-index"];
  if (relation === "process") return ["process-rail", "timeline-rail", "weighted-split"];
  if (relation === "evidence") return ["instrument-columns", "weighted-split", "editorial-index"];
  if (relation === "quotation") return ["quote-field", "section-statement", "paper-column"];
  if (relation === "scene") return ["image-led", "side-image-text", "full-bleed-image"];
  if (relation === "hierarchy") return ["editorial-index", "paper-column", "asymmetric-split"];
  return ["section-statement", "asymmetric-split", "paper-column"];
}

function focalOf(relation: SemanticRelation): SlideDesignIntelligence["focalPriority"] {
  if (relation === "evidence") return "chart";
  if (relation === "scene") return "image";
  if (relation === "statement" || relation === "quotation") return "title";
  return "body";
}

function rhythmRole(index: number, total: number, relation: SemanticRelation): SlideDesignIntelligence["rhythmRole"] {
  if (index === 0) return "opening";
  if (index === total - 1) return "close";
  if (relation === "quotation" || relation === "scene") return "pause";
  if (relation === "evidence") return "evidence";
  if (index === Math.floor(total / 2)) return "turn";
  return "build";
}

function itemCount(slide: AiDraft["slides"][number]): number {
  const structured = (slide.blocks ?? []).reduce((count, block) => {
    if (block.type === "bullet-list") return count + block.items.length;
    if (block.type === "timeline" || block.type === "process") return count + block.items.length;
    if (block.type === "comparison") return count + Math.max(block.leftItems.length, block.rightItems.length);
    if (block.type === "table-data") return count + block.rows.length;
    if (block.type === "metric") return count + 1;
    return count;
  }, 0);
  return structured || slide.body.split("\n").filter((line) => line.trim()).length;
}

function measurementOf(slide: AiDraft["slides"][number], brief: SlideBrief): SlideDesignIntelligence["measurement"] {
  const items = itemCount(slide);
  const titleChars = [...slide.title].length;
  const bodyChars = [...slide.body].length;
  const load = bodyChars / 260 + items / 7 + titleChars / 45;
  return {
    titleChars,
    bodyChars,
    itemCount: items,
    estimatedTitleLines: Math.max(1, Math.ceil(titleChars / 22)),
    estimatedBodyLines: Math.max(1, Math.ceil(bodyChars / 52) + Math.max(0, items - 1)),
    pressure: brief.density === "high" || load > 2.2 ? "high" : brief.density === "low" && load < 1 ? "low" : "medium",
  };
}

function dataStoryOf(slide: AiDraft["slides"][number]): SlideDesignIntelligence["dataStory"] {
  const chart = (slide.blocks ?? []).find((block) => block.type === "chart");
  if (!chart) return undefined;
  const multipleSeries = (chart.series?.length ?? 0) > 1;
  const relationship = chart.kind === "pie" ? "proportion" : chart.kind === "line" ? "change" : multipleSeries ? "comparison" : "magnitude";
  const longLabels = chart.categories.some((category) => [...category].length > 8);
  const recommendedChart =
    relationship === "change" ? "line" : relationship === "proportion" && chart.categories.length <= 5 ? "pie" : longLabels ? "bar" : "column";
  return { relationship, recommendedChart };
}

/** Deterministic semantic and brand context supplied before the model chooses geometry. */
export function buildDesignIntelligence(
  draft: AiDraft,
  briefs: readonly SlideBrief[],
  template: DesignTemplateContext,
): DesignIntelligence {
  let previousFamilies: string[] = [];
  const slides = draft.slides.map((slide, index) => {
    const relation = relationOf(slide, briefs[index]!);
    const preferredFamilies = familiesFor(relation);
    const plan: SlideDesignIntelligence = {
      slideIndex: index,
      relation,
      rhythmRole: rhythmRole(index, draft.slides.length, relation),
      preferredFamilies,
      avoidFamilies: previousFamilies.slice(0, 1),
      focalPriority: focalOf(relation),
      measurement: measurementOf(slide, briefs[index]!),
      ...(dataStoryOf(slide) ? { dataStory: dataStoryOf(slide) } : {}),
    };
    previousFamilies = preferredFamilies;
    return plan;
  });
  const titleAxes = template.layouts
    .flatMap((layout) => layout.regions)
    .filter((region) => region.role === "title")
    .map((region) =>
      Math.round((region.x / Math.max(1, template.slideWidthEmu ?? Math.max(region.x + region.width, 1))) * 1000),
    );
  return {
    slides,
    deckRhythm: slides.map((slide) => slide.rhythmRole),
    brandGrammar: {
      titleAxes: [...new Set(titleAxes)].slice(0, 6),
      bodyColumns: [...new Set(template.layouts.map((layout) => layout.capabilities?.columns ?? 1))].slice(0, 4),
      imageLayouts: template.layouts.filter((layout) => layout.capabilities?.hasImage).length,
      palette: template.themeColors.map((color) => color.value).filter(Boolean).slice(0, 12),
      fonts: [...new Set([template.majorFont, template.minorFont].filter((font): font is string => Boolean(font)))],
    },
  };
}
