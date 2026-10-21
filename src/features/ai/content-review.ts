import { splitBodyItems, type AiDraft, type ContentBlock, type SlideBrief } from "../../services/ai-service";

export type DraftSlide = AiDraft["slides"][number];
export type AiDraftSaveState = "saving" | "saved";

export const narrativeStrategyLabels: Record<AiDraft["presentationBrief"]["narrativeStrategy"], string> = {
  "management-report": "管理层汇报",
  proposal: "方案提案",
  retrospective: "复盘总结",
  training: "培训讲解",
  "product-launch": "产品发布",
  fundraising: "融资路演",
  general: "通用叙事",
};

export const visualIntentLabels: Record<SlideBrief["visualIntent"], string> = {
  hero: "封面主视觉",
  quote: "引用金句",
  timeline: "时间线",
  comparison: "对比",
  process: "流程",
  "data-chart": "数据图表",
  "image-story": "图文叙事",
  summary: "总结",
  "structured-text": "结构化文本",
};

export const densityLabels: Record<SlideBrief["density"], string> = {
  low: "低信息密度",
  medium: "中等信息密度",
  high: "高信息密度",
};

export function countCharacters(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

function blockPointCount(block: ContentBlock): number {
  switch (block.type) {
    case "bullet-list":
    case "timeline":
    case "process":
      return block.items.length;
    case "comparison":
      return block.leftItems.length + block.rightItems.length;
    case "paragraph":
    case "quote":
    case "metric":
      return 1;
  }
}

/**
 * Blocks are the reviewed fact source; body copy is only the fallback for
 * legacy drafts that never produced structured blocks.
 */
export function countSlidePoints(slide: DraftSlide): number {
  if (slide.blocks.length === 0) return splitBodyItems(slide.body).length;
  return slide.blocks.reduce((total, block) => total + blockPointCount(block), 0);
}

function firstPoint(slide: DraftSlide): string {
  const bulletList = slide.blocks.find((block): block is Extract<ContentBlock, { type: "bullet-list" }> => block.type === "bullet-list");
  const raw = bulletList?.items[0] ?? splitBodyItems(slide.body)[0] ?? "";
  return raw.replace(/^\s*(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*/, "").trim();
}

export type SlideMetrics = { characters: number; points: number; preview: string };

export function slideMetrics(slide: DraftSlide): SlideMetrics {
  return {
    characters: countCharacters(slide.title) + countCharacters(slide.body),
    points: countSlidePoints(slide),
    preview: firstPoint(slide),
  };
}

export function draftMetrics(draft: AiDraft): { characters: number; points: number } {
  return draft.slides.reduce(
    (total, slide) => {
      const metrics = slideMetrics(slide);
      return { characters: total.characters + metrics.characters, points: total.points + metrics.points };
    },
    { characters: 0, points: 0 },
  );
}

export function missingTitleIndexes(draft: AiDraft): number[] {
  return draft.slides.flatMap((slide, index) => (slide.title.trim() ? [] : [index]));
}

export function isSlideEdited(slide: DraftSlide, original: DraftSlide | undefined): boolean {
  if (!original) return false;
  return slide.title !== original.title || slide.body !== original.body || slide.speakerNotes !== original.speakerNotes;
}

/**
 * Draft slides created before stable ids existed are upgraded on load so React
 * keys, scroll targets and focus stay attached to the same page while editing.
 */
export function withSlideIds(draft: AiDraft): AiDraft {
  return {
    ...draft,
    slides: draft.slides.map((slide) => (slide.id ? slide : { ...slide, id: crypto.randomUUID() })),
  };
}
