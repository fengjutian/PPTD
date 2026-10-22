import { TABLE_MAX_COLUMNS } from "../../core/document-model/table-data";
import { assessLayoutCapacity, type CapacityBlockFacts, type LayoutCapacityNote } from "../../core/commands/layout-capacity";
import { describeTitleSkeleton, findRepeatedTitlePatterns, analyzeTitle } from "../../core/content/title-quality";
import { sanitizeBlocks } from "../../services/ai-draft-content";
import { splitBodyItems, type AiDraft, type ContentBlock, type SlideBrief } from "../../services/ai-service";
import { visualAssetIssues } from "./visual-asset-review";

export type DraftSlide = AiDraft["slides"][number];
export type AiDraftSaveState = "saving" | "saved";

/**
 * The review screen edits a table through the draft schema, which stores at
 * most 20 rows, while the document model allows 30. Cells can also be dropped
 * on the way in, so the tighter of the two is what the writer may build.
 */
export const TABLE_REVIEW_MAX_ROWS = 20;
export const TABLE_REVIEW_MAX_COLUMNS = TABLE_MAX_COLUMNS;

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

/** 配图角色在审核页上的名字。顺序与视觉素材层一致。 */
export const visualAssetRoleLabels: Record<"hero" | "side" | "band", string> = {
  hero: "主视觉",
  side: "侧栏图",
  band: "通栏图",
};

export const blockTypeLabels: Record<ContentBlock["type"], string> = {
  paragraph: "段落",
  "bullet-list": "要点列表",
  quote: "引用",
  metric: "指标",
  timeline: "时间线",
  process: "流程",
  comparison: "对比",
  "table-data": "表格",
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
    case "table-data":
      // A table is as dense as the rows it carries.
      return block.rows.length;
    case "paragraph":
    case "quote":
    case "metric":
      return 1;
  }
}

/**
 * Blocks are the reviewed fact source; body copy is only the fallback for
 * legacy drafts that never produced structured blocks. Empty items are
 * ignored so the counter follows what the page will actually render.
 */
export function countSlidePoints(slide: DraftSlide): number {
  const blocks = sanitizeBlocks(slide.blocks);
  if (blocks.length === 0) return splitBodyItems(slide.body).length;
  return blocks.reduce((total, block) => total + blockPointCount(block), 0);
}

function firstPoint(slide: DraftSlide): string {
  const blocks = sanitizeBlocks(slide.blocks);
  const bulletList = blocks.find((block): block is Extract<ContentBlock, { type: "bullet-list" }> => block.type === "bullet-list");
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

/**
 * A capacity note with the block it belongs to.
 *
 * A note about the title belongs to the page, a note about the points belongs
 * to the point list and a note about the columns belongs to the comparison
 * block. The review screen hangs every note on the part it talks about, so
 * the writer reads the advice next to the text it is about.
 */
export type SlideCapacityNote = LayoutCapacityNote;

/**
 * What the reviewed copy does to the page it will be laid out on.
 *
 * The rules live in the core, next to the renderer that applies them, so the
 * advice cannot drift away from the page it describes. The review screen
 * shows the result as a warning next to the text instead of letting the
 * writer discover the overflow in the exported file.
 */
export function slideCapacityNotes(slide: DraftSlide, index: number): SlideCapacityNote[] {
  const bulletItems: string[] = [];
  let itemBlockIndex: number | undefined;
  // The blocks are described as they are stored, so the index of a note is
  // the index of the block the review screen renders.
  const blocks: CapacityBlockFacts[] = slide.blocks.map((block, blockIndex) => {
    switch (block.type) {
      case "bullet-list": {
        const items = block.items.filter((item) => item.trim());
        if (itemBlockIndex === undefined && items.length > 0) {
          itemBlockIndex = blockIndex;
          bulletItems.push(...items);
        }
        return { index: blockIndex, type: block.type, itemCount: items.length };
      }
      case "comparison": {
        const leftItems = block.leftItems.filter((item) => item.trim());
        const rightItems = block.rightItems.filter((item) => item.trim());
        return { index: blockIndex, type: block.type, itemCount: leftItems.length + rightItems.length, leftItems, rightItems };
      }
      case "timeline":
      case "process":
        return { index: blockIndex, type: block.type, itemCount: block.items.filter((item) => item.label.trim() || item.text.trim()).length };
      default:
        return { index: blockIndex, type: block.type, itemCount: 1 };
    }
  });
  // The points of a page come from its bullet list, and from the body copy on
  // the legacy drafts that never produced a structured block.
  const items = bulletItems.length > 0 ? bulletItems : splitBodyItems(slide.body);
  return assessLayoutCapacity({
    index,
    title: slide.title,
    items,
    itemBlockIndex,
    bodyLength: slide.body.length,
    blocks,
  });
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

export type ReviewIssueKind = "missing-title" | "empty-content" | "duplicate-title" | "table-too-large" | "table-ragged" | "templated-title" | "repeated-title-pattern" | "image-text-request" | "image-empty-prompt" | "image-on-structured-page" | "image-over-limit";
export type ReviewIssue = {
  kind: ReviewIssueKind;
  /** Pages the issue applies to, in page order. The first one is the jump target. */
  indexes: number[];
  message: string;
  /** Blocking issues keep the draft from being confirmed into a template. */
  blocking: boolean;
};

/**
 * Review problems are collected for the whole draft instead of only the first
 * one, so the warning bar can explain every reason the confirm button is
 * unavailable and jump to the page that needs work.
 */
export function reviewIssues(draft: AiDraft): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const missing = missingTitleIndexes(draft);
  if (missing.length > 0) {
    issues.push({ kind: "missing-title", indexes: missing, message: `还有 ${missing.length} 页缺少标题`, blocking: true });
  }
  const empty = draft.slides.flatMap((slide, index) => (slideHasContent(slide) ? [] : [index]));
  if (empty.length > 0) {
    issues.push({ kind: "empty-content", indexes: empty, message: `还有 ${empty.length} 页没有内容`, blocking: true });
  }
  const byTitle = new Map<string, number[]>();
  for (const [index, slide] of draft.slides.entries()) {
    const title = slide.title.trim();
    if (!title) continue;
    byTitle.set(title, [...(byTitle.get(title) ?? []), index]);
  }
  const duplicates = [...byTitle.entries()].filter(([, indexes]) => indexes.length > 1);
  if (duplicates.length > 0) {
    // Every group of repeated titles is reported: a draft of twenty pages
    // rarely repeats only once, and naming one group left the writer guessing
    // about the others.
    const groups = duplicates.map(([title, indexes]) => `${indexes.map((index) => `第 ${index + 1} 页`).join("、")}：${title}`);
    const indexes = duplicates.flatMap(([, group]) => group);
    issues.push({
      kind: "duplicate-title",
      indexes,
      message: `${duplicates.length} 组标题重复（${groups.join("；")}）`,
      blocking: false,
    });
  }
  // A table wider or taller than the document model cannot become a project
  // file, and clamping it for the writer would silently drop reviewed cells.
  const oversized = draft.slides.flatMap((slide, index) => (slide.blocks.some((block) => block.type === "table-data" && tableBlockOversized(block)) ? [index] : []));
  if (oversized.length > 0) {
    issues.push({
      kind: "table-too-large",
      indexes: oversized,
      message: `还有 ${oversized.length} 页表格超过上限（最多 ${TABLE_REVIEW_MAX_COLUMNS} 列、${TABLE_REVIEW_MAX_ROWS} 行）`,
      blocking: true,
    });
  }
  // A row wider than the header keeps its extra cells in the draft but loses
  // them when the table is exported, so the writer has to fill the header or
  // delete the column instead of the cell silently disappearing later.
  const ragged = draft.slides.flatMap((slide, index) => (slide.blocks.some((block) => block.type === "table-data" && tableBlockRagged(block)) ? [index] : []));
  if (ragged.length > 0) {
    issues.push({ kind: "table-ragged", indexes: ragged, message: `还有 ${ragged.length} 页表格行比表头宽，导出会丢失多出的列`, blocking: true });
  }
  // 标题写成栏目名或空泛壳子时，文稿读起来像一份还没写完的大纲。
  // 这不是错误，内容照旧成立，但值得在确认之前提醒一次。
  const templated = draft.slides.flatMap((slide, index) => {
    const analysis = analyzeTitle(slide.title);
    return analysis.issues.length > 0 ? [{ index, labels: analysis.labels }] : [];
  });
  if (templated.length > 0) {
    const detail = templated.map((item) => `第 ${item.index + 1} 页（${item.labels.join("、")}）`).join("；");
    issues.push({
      kind: "templated-title",
      indexes: templated.map((item) => item.index),
      message: `还有 ${templated.length} 页标题是模板或空泛说法，建议改成一句结论：${detail}`,
      blocking: false,
    });
  }
  // 多页共用同一个句法骨架时，整册读下来像同一句话换了词。
  const repeated = findRepeatedTitlePatterns(draft.slides.map((slide) => slide.title));
  if (repeated.length > 0) {
    const detail = repeated
      .map((group) => `第 ${group.indexes.map((index) => index + 1).join("、")} 页（${describeTitleSkeleton(group.skeleton)}）`)
      .join("；");
    issues.push({
      kind: "repeated-title-pattern",
      indexes: [...new Set(repeated.flatMap((group) => group.indexes))],
      message: `有 ${repeated.length} 组标题句式重复，建议打散：${detail}`,
      blocking: false,
    });
  }
  // 配图意图也在内容阶段就产出了，所以它的合规问题在这里一并报出来。
  // 配图的问题不阻塞审核：内容本身没有问题，图的事可以之后再定。
  visualAssetIssues(draft).forEach((issue) => {
    issues.push({ kind: issue.kind, indexes: [issue.slideIndex], message: issue.message, blocking: false });
  });
  return issues;
}

/** Whether a table has cells that the header has no column for. */
export function tableBlockRagged(block: Extract<ContentBlock, { type: "table-data" }>): boolean {
  return block.rows.some((row) => row.length > block.header.length);
}

/** Whether a table block still exceeds what the review screen and document allow. */
export function tableBlockOversized(block: Extract<ContentBlock, { type: "table-data" }>): boolean {
  return (
    block.header.length > TABLE_REVIEW_MAX_COLUMNS ||
    block.rows.length > TABLE_REVIEW_MAX_ROWS ||
    block.rows.some((row) => row.length > TABLE_REVIEW_MAX_COLUMNS)
  );
}

/**
 * A table is the one block whose cells can all be blank while the structure
 * stays in place, so it only counts as page content once a cell carries text.
 */
function blockHasContent(block: ContentBlock): boolean {
  if (block.type !== "table-data") return true;
  return block.header.some((cell) => cell.trim()) || block.rows.some((row) => row.some((cell) => cell.trim()));
}

/** A page needs something the renderer can draw, not just a heading. */
export function slideHasContent(slide: DraftSlide): boolean {
  const blocks = sanitizeBlocks(slide.blocks);
  // Blocks are the reviewed fact source; the body string is only their
  // projection, so a page with blocks is judged by the blocks alone.
  if (blocks.length > 0) return blocks.some(blockHasContent);
  return splitBodyItems(slide.body).length > 0;
}

export type TableKeyAction = { type: "focus"; row: number } | { type: "append-row"; row: number };

/**
 * Table cells move like a grid: Enter and the vertical arrows walk down a
 * column, and Enter below the last row appends one so the writer never has to
 * reach for the add button while typing a row of figures. The caller keeps the
 * cell's own column, since the helper only decides which row comes next.
 */
export function tableCellKeyAction(key: string, row: number, rowCount: number, canAppendRow: boolean): TableKeyAction | undefined {
  const lastRow = rowCount - 1;
  if (key === "ArrowDown") return { type: "focus", row: Math.min(lastRow, row + 1) };
  if (key === "ArrowUp") return { type: "focus", row: Math.max(0, row - 1) };
  if (key === "Enter") {
    if (row < lastRow) return { type: "focus", row: row + 1 };
    return canAppendRow ? { type: "append-row", row: row + 1 } : undefined;
  }
  return undefined;
}

/**
 * The outline is a single tab stop, so arrow keys move the selection instead of
 * each page adding a Tab press. Returns undefined for keys the outline ignores.
 */
export function outlineNavTarget(key: string, index: number, total: number): number | undefined {
  if (total <= 0) return undefined;
  const last = total - 1;
  if (key === "ArrowDown") return Math.min(last, index + 1);
  if (key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return undefined;
}

/**
 * List editors behave like a text list: Enter opens the next row and Backspace
 * on an empty row removes it, so a reviewer can build a slide without reaching
 * for the mouse. Both actions are no-ops when they would leave no row or exceed
 * the block's item limit.
 */
export type ItemKeyAction = { type: "insert" } | { type: "remove"; focus: number };

export function itemKeyAction(key: string, value: string, index: number, total: number, max: number): ItemKeyAction | undefined {
  if (key === "Enter") return total < max ? { type: "insert" } : undefined;
  if (key === "Backspace" && total > 1 && value.trim() === "") return { type: "remove", focus: Math.max(0, index - 1) };
  return undefined;
}

/**
 * Scroll sync picks the card nearest a fixed anchor below the list top rather
 * than the first visible card, so a tall card does not steal the highlight from
 * the page the reader just scrolled to.
 */
export function nearestSlideIndex(cards: readonly { index: number; top: number }[], listTop: number, anchorOffset = 8): number | undefined {
  let nearest: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    const distance = Math.abs(card.top - listTop - anchorOffset);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = card.index;
    }
  }
  return nearest;
}

/**
 * The scroll position of the card list that puts a page at the top of it.
 *
 * Only the list may move here. scrollIntoView scrolls the page as well, and a
 * scrolled page shifts the whole application window up: the header disappears
 * and an empty band shows under the status bar.
 */
export function slideCardScrollTop(input: { listTop: number; cardTop: number; scrollTop: number; margin?: number }): number {
  const margin = input.margin ?? 0;
  return Math.max(0, input.scrollTop + input.cardTop - input.listTop - margin);
}

export function isSlideEdited(slide: DraftSlide, original: DraftSlide | undefined): boolean {
  if (!original) return false;
  return (
    slide.title !== original.title ||
    slide.body !== original.body ||
    slide.speakerNotes !== original.speakerNotes ||
    JSON.stringify(slide.blocks) !== JSON.stringify(original.blocks) ||
    // 配图意图也是这一页的内容：改了画面描述，这一页就不再是原稿了。
    JSON.stringify(slide.plan?.visualAsset ?? null) !== JSON.stringify(original.plan?.visualAsset ?? null)
  );
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

/** Keeps selection attached to the same logical page across history changes. */
export function resolveActiveSlideIndex(draft: AiDraft, slideId: string | undefined, fallbackIndex: number): number {
  const matched = slideId ? draft.slides.findIndex((slide) => slide.id === slideId) : -1;
  if (matched >= 0) return matched;
  return Math.max(0, Math.min(fallbackIndex, draft.slides.length - 1));
}
