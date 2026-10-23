import { estimateTextLines } from "../rendering/text-fit";
import { assessArgument } from "../content/argument-quality";

/**
 * The capacity rules that decide how much reviewed copy a page can carry.
 *
 * The renderer applies these numbers when it builds a page, so the review
 * screen has to apply the same ones. A rule that only lives in the renderer is
 * invisible to the writer, and a rule that only lives in the review screen
 * drifts away from the page it describes.
 */
export const LAYOUT_CAPACITY = {
  /** A card page needs two points before it becomes a grid of cards. */
  cardsMinItems: 2,
  /** The grid a card page becomes carries three to six points. */
  cardsGridMinItems: 3,
  /** The most points a card page carries. */
  cardsMaxItems: 6,
  /** A point at or below this length still reads as a single line. */
  shortItemLength: 48,
  /** The longest point a card page accepts when it is promoted to a grid. */
  cardItemLength: 56,
  /** The body a card page accepts when it is promoted to a grid. */
  cardBodyLength: 360,
  /** The longest point that still leaves the page a card page. */
  cardItemLengthLimit: 72,
  /** The body that still leaves the page a card page. */
  cardBodyLengthLimit: 420,
  /** A two column page needs two points to fill two columns. */
  splitMinItems: 2,
  /** The most points a two column page carries. */
  splitMaxItems: 8,
  /** The body a two column page carries. */
  splitBodyLength: 560,
  /** A cover page carries a title and a short subtitle. */
  coverMaxItems: 1,
  coverBodyLength: 80,
  /** A page that carries a pull quote beside its points holds three to five. */
  panelMinItems: 3,
  panelMaxItems: 5,
  /**
   * The most steps a timeline, a process or a metric row carries at a size a
   * reader can still take in. More of them are still drawn, but every step
   * gets a narrower box and a smaller type.
   */
  rowBlockMaxItems: 6,
} as const;

/**
 * The safe area a page lays out into when no template claims one. A template
 * may claim a different one, and then the page has more or less room, but the
 * review screen has to describe the page it can describe: the standard one.
 */
export const DEFAULT_CONTENT_REGION = { left: 0.07, right: 0.93, top: 0.2, bottom: 0.87 } as const;

/**
 * The geometry a content page lays out into. The renderer and the review
 * screen share it so that a page the writer was warned about is the page that
 * gets built.
 */
export const CONTENT_REGION = {
  /** The content of a page starts this far below the top of the safe area. */
  contentTopOffset: 0.17,
  /** A comparison column takes this share of the content area. */
  comparisonColumnWidth: 0.475,
  /** The gutter between the two comparison columns, in page width. */
  comparisonColumnGap: 0.05,
  /** The label of a comparison column. */
  comparisonLabelFontSizePt: 22,
  /** The copy of a comparison column. */
  comparisonItemFontSizePt: 18,
  /** The smallest copy a comparison column may shrink to. */
  comparisonMinimumItemFontSizePt: 14,
  /**
   * The share of the content area a comparison panel fills even when it carries
   * only a couple of points.
   *
   * A panel sized to its copy alone left the lower half of the page white: two
   * lines of 18pt copy produced a 1.7in card on a 3.75in content area. Growing
   * the panel to this share keeps the two cards the visual weight of the page
   * instead of letting them float in the upper third.
   */
  comparisonMinPanelHeightRatio: 0.55,
  /**
   * Where a short content block sits inside the content area, as a share of the
   * leftover space. Centering the block is the rule; anchoring it at 30% of the
   * gap was what pushed every short page into its upper half.
   */
  blockVerticalAnchor: 0.5,
} as const;

/**
 * The type scale of the two structural blocks an editorial page can carry: the
 * numbered rail of points and the pull-quote panel beside it.
 *
 * A rail numeral is an index, not body copy. It reads as a step above the
 * points it numbers; a numeral the same size as the copy turns the column into
 * a list with stray digits in it. The quote is a display object: it never drops
 * below running copy, and it never grows past the title of the page.
 */
export const PANEL_TYPE_SCALE = {
  /** A rail numeral is this much larger than the copy of its row. */
  railNumberRatio: 1.2,
  railNumberMinPt: 16,
  railNumberMaxPt: 24,
  /** The smallest size a pull quote may take. */
  quoteMinPt: 18,
  /** The largest size a pull quote may take; the title stays the biggest object. */
  quoteMaxPt: 30,
  /** The caption that names a panel. */
  labelPt: 13,
} as const;

/** The standard 16:9 page, in EMU. */
const STANDARD_PAGE_WIDTH_EMU = 12_192_000;
const STANDARD_PAGE_HEIGHT_EMU = 6_858_000;
const EMU_PER_POINT = 12_700;
const EMU_PER_INCH = 914_400;
/** The title of a content page is set at this size. A cover title is larger. */
const TITLE_FONT_SIZE_PT = 30;
/** The line height the renderer reserves for a line of body copy. */
const BODY_LINE_HEIGHT_RATIO = 1.25;

/**
 * Removes the list marker a writer may have typed into a point.
 *
 * The renderer draws its own marker, so a point that keeps the typed one shows
 * two of them. The review screen measures the text the renderer draws, which
 * is why the rule lives here and not inside the renderer.
 */
export function stripListPrefix(value: string): string {
  return value.replace(/^(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*/, "");
}

/** The height of the content area, as a fraction of the page height. */
export function contentHeightFraction(): number {
  const region = DEFAULT_CONTENT_REGION;
  const contentTop = region.top + Math.min(CONTENT_REGION.contentTopOffset, (region.bottom - region.top) * 0.3);
  return region.bottom - contentTop;
}

export type LayoutCapacitySeverity = "info" | "warning";
export type LayoutCapacityScope = "title" | "items" | "comparison" | "block";

export interface LayoutCapacityNote {
  severity: LayoutCapacitySeverity;
  scope: LayoutCapacityScope;
  /** The block the note belongs to. A page level note has none. */
  blockIndex?: number;
  message: string;
}

/** The kinds of blocks a page can carry. */
export type CapacityBlockType =
  "paragraph" | "bullet-list" | "quote" | "metric" | "timeline" | "process" | "comparison" | "table-data";

/**
 * A block of a page, described the way the layout rules see it.
 *
 * The review screen passes the blocks it renders, with the position they
 * occupy, so that a note can be shown next to the block it talks about.
 */
export interface CapacityBlockFacts {
  /** The position of the block on the page, as the review screen renders it. */
  index: number;
  type: CapacityBlockType;
  /** The visible units the block carries. */
  itemCount: number;
  /** The two sides of a comparison block. */
  leftItems?: readonly string[];
  rightItems?: readonly string[];
}

export interface LayoutCapacityInput {
  /** The position of the page in the deck. The first page has its own rules. */
  index: number;
  title: string;
  /** The points the page will lay out, in the order they will be laid out. */
  items: readonly string[];
  /** The block the points belong to. */
  itemBlockIndex?: number;
  /** The body copy the page carries. */
  bodyLength: number;
  /** The blocks the page carries. */
  blocks?: readonly CapacityBlockFacts[];
}

export interface CapacityOptions {
  fontFamily?: string;
  pageWidthEmu?: number;
  pageHeightEmu?: number;
}

/** How a comparison column has to set its copy to carry every point. */
export interface ComparisonColumnFit {
  /** The size the copy keeps when the column has room. */
  preferredFontSizePt: number;
  /** The size the copy has to use to fit every point. */
  fittedFontSizePt: number;
  /** Whether every point fits at the readable floor. */
  fits: boolean;
}

/**
 * How a comparison column sets its copy.
 *
 * The column is as tall as the points it carries, and the copy shrinks until
 * it fits. A column that could not shrink far enough would overflow, which is
 * what the writer has to know before the page is built.
 */
export function fitComparisonColumn(points: readonly string[], options: CapacityOptions = {}): ComparisonColumnFit {
  const pageWidth = options.pageWidthEmu ?? STANDARD_PAGE_WIDTH_EMU;
  const pageHeight = options.pageHeightEmu ?? STANDARD_PAGE_HEIGHT_EMU;
  const pageWidthIn = pageWidth / EMU_PER_INCH;
  const pageHeightIn = pageHeight / EMU_PER_INCH;
  const widthPt =
    (DEFAULT_CONTENT_REGION.right - DEFAULT_CONTENT_REGION.left) *
      CONTENT_REGION.comparisonColumnWidth *
      pageWidthIn *
      72 -
    0.07 * pageWidthIn * 72;
  const headerFraction = (CONTENT_REGION.comparisonLabelFontSizePt * 1.2) / 72 / pageHeightIn + 0.018;
  // The panel grows with its copy up to the content area, so a column is
  // measured against the whole area. The minimum panel height only decides how
  // much room a short column starts with.
  const availablePt = (contentHeightFraction() - headerFraction - 0.06) * pageHeightIn * 72;
  const value = points.map((point) => `• ${point}`).join("\n\n");
  const preferred = CONTENT_REGION.comparisonItemFontSizePt;
  const minimum = CONTENT_REGION.comparisonMinimumItemFontSizePt;
  const fitsAt = (size: number) =>
    estimateTextLines(value, widthPt, size, options.fontFamily) * size * BODY_LINE_HEIGHT_RATIO <= availablePt;
  let fitted: number = minimum;
  for (let size = preferred; size >= minimum; size -= 1) {
    if (fitsAt(size)) {
      fitted = size;
      break;
    }
  }
  return { preferredFontSizePt: preferred, fittedFontSizePt: fitted, fits: fitsAt(minimum) };
}

/**
 * What the reviewed copy of a page will look like once it is laid out.
 *
 * The notes are advisory: the writer decides how much a page is allowed to
 * say. What they must not do is learn about a limit only after the page has
 * been built, so every note names the limit it comes from. A note also never
 * claims a layout the copy does not force: the template is chosen later, and
 * the advice here is about the copy itself.
 */
export function assessLayoutCapacity(input: LayoutCapacityInput, options: CapacityOptions = {}): LayoutCapacityNote[] {
  const notes: LayoutCapacityNote[] = [];
  const points = input.items.map(stripListPrefix);
  const count = points.length;
  const blocks = input.blocks ?? [];
  const comparison = blocks.find((block) => block.type === "comparison");
  const rowBlocks = blocks.filter((block) => block.type === "timeline" || block.type === "process");
  const metricBlocks = blocks.filter((block) => block.type === "metric");

  // A title that does not fit its box does not wrap, it pushes into the copy
  // below it, so the writer has to know before the page is built.
  const titleWidthPt =
    ((DEFAULT_CONTENT_REGION.right - DEFAULT_CONTENT_REGION.left) * STANDARD_PAGE_WIDTH_EMU) / EMU_PER_POINT;
  const titleLines = estimateTextLines(input.title, titleWidthPt, TITLE_FONT_SIZE_PT, options.fontFamily);
  if (input.title.trim() && titleLines > 1) {
    notes.push({
      severity: "warning",
      scope: "title",
      message: `标题 ${[...input.title.trim()].length} 字，标准版式下会折成 ${titleLines} 行，而标题框只放得下 1 行`,
    });
  }

  // A page that carries a comparison or a row of steps is drawn by its own
  // branch of the renderer, and the point count does not describe that page.
  if (!comparison && rowBlocks.length === 0) {
    if (input.index === 0) {
      if (count >= LAYOUT_CAPACITY.cardsGridMinItems) {
        notes.push({
          severity: "warning",
          scope: "items",
          blockIndex: input.itemBlockIndex,
          message: `首页有 ${count} 条要点，会排成内容页而不是封面`,
        });
      } else if (input.bodyLength > LAYOUT_CAPACITY.coverBodyLength) {
        notes.push({
          severity: "warning",
          scope: "items",
          blockIndex: input.itemBlockIndex,
          message: `首页正文 ${input.bodyLength} 字，超过封面 ${LAYOUT_CAPACITY.coverBodyLength} 字上限`,
        });
      }
    } else if (count === 1) {
      notes.push({
        severity: "info",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: "本页只有 1 条要点，会排成一整栏正文，建议补到 2 条以上",
      });
    } else if (count === LAYOUT_CAPACITY.splitMinItems) {
      notes.push({
        severity: "info",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: "本页 2 条要点，排成双栏时每栏只有 1 条",
      });
    } else if (count > LAYOUT_CAPACITY.cardsMaxItems) {
      notes.push({
        severity: "warning",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: `本页 ${count} 条要点，超过卡片网格的 ${LAYOUT_CAPACITY.cardsMaxItems} 条上限，会挤成双栏或整栏正文，建议拆页`,
      });
    } else if (count >= LAYOUT_CAPACITY.cardsGridMinItems) {
      const columns = count === 3 || count >= 5 ? 3 : 2;
      notes.push({
        severity: "info",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: `本页 ${count} 条要点，可排成 ${columns} 列卡片网格`,
      });
    }

    let longest = { index: -1, length: 0 };
    points.forEach((point, pointIndex) => {
      const length = [...point].length;
      if (length > longest.length) longest = { index: pointIndex, length };
    });
    if (longest.length > LAYOUT_CAPACITY.cardItemLengthLimit) {
      notes.push({
        severity: "warning",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: `第 ${longest.index + 1} 条 ${longest.length} 字，超过卡片版式 ${LAYOUT_CAPACITY.cardItemLengthLimit} 字上限，这页排不成卡片`,
      });
    } else if (longest.length > LAYOUT_CAPACITY.shortItemLength) {
      notes.push({
        severity: "info",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: `第 ${longest.index + 1} 条 ${longest.length} 字，超过单行 ${LAYOUT_CAPACITY.shortItemLength} 字，卡片里会折行`,
      });
    }

    if (input.bodyLength > LAYOUT_CAPACITY.cardBodyLengthLimit) {
      notes.push({
        severity: "warning",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: `正文 ${input.bodyLength} 字，超过卡片版式 ${LAYOUT_CAPACITY.cardBodyLengthLimit} 字上限，这页排不成卡片网格`,
      });
    } else if (input.bodyLength > LAYOUT_CAPACITY.cardBodyLength) {
      notes.push({
        severity: "info",
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: `正文 ${input.bodyLength} 字，卡片网格最多排 ${LAYOUT_CAPACITY.cardBodyLength} 字`,
      });
    }
  }

  // A row of steps is drawn at a fixed width per step, so every step beyond
  // the comfortable count takes its width from its neighbours.
  for (const block of rowBlocks) {
    if (block.itemCount <= LAYOUT_CAPACITY.rowBlockMaxItems) continue;
    const label = block.type === "timeline" ? "时间线" : "流程";
    notes.push({
      severity: "warning",
      scope: "block",
      blockIndex: block.index,
      message: `${label}有 ${block.itemCount} 项，会全部排上，但每项都被压窄、文字明显变小，建议拆页`,
    });
  }
  if (metricBlocks.length > LAYOUT_CAPACITY.rowBlockMaxItems) {
    notes.push({
      severity: "warning",
      scope: "block",
      blockIndex: metricBlocks[0]!.index,
      message: `本页有 ${metricBlocks.length} 个指标，会排成 ${Math.ceil(metricBlocks.length / 3)} 行卡片，卡片高度被压小，建议拆页`,
    });
  }

  if (comparison) {
    const left = (comparison.leftItems ?? []).map(stripListPrefix);
    const right = (comparison.rightItems ?? []).map(stripListPrefix);
    const difference = Math.abs(left.length - right.length);
    if (difference >= 2) {
      notes.push({
        severity: "warning",
        scope: "comparison",
        blockIndex: comparison.index,
        message: `左栏 ${left.length} 条、右栏 ${right.length} 条，两栏相差 ${difference} 条，版面会失衡`,
      });
    }
    const side = left.length >= right.length ? "左栏" : "右栏";
    const longer = left.length >= right.length ? left : right;
    const fit = fitComparisonColumn(longer, options);
    if (!fit.fits) {
      notes.push({
        severity: "warning",
        scope: "comparison",
        blockIndex: comparison.index,
        message: `${side} ${longer.length} 条排不下 ${CONTENT_REGION.comparisonMinimumItemFontSizePt}pt 的可读下限，导出时会溢出`,
      });
    } else if (fit.fittedFontSizePt < fit.preferredFontSizePt) {
      notes.push({
        severity: "info",
        scope: "comparison",
        blockIndex: comparison.index,
        message: `${side} ${longer.length} 条要排到 ${fit.fittedFontSizePt}pt 才排得下`,
      });
    }
  }

  // 论证形式是内容的问题，不是容量的问题，但它和容量一样在页面建出来之前
  // 就该被看见：一条"排得下"的要点仍然可能什么都没证明。携带结构化内容块的
  // 页面由块自己决定形式，要点不是它的版面单位，不在这里评价。
  if (!comparison && rowBlocks.length === 0) {
    for (const issue of assessArgument({
      title: input.title,
      items: points,
      hasComparison: Boolean(comparison),
      hasTimeline: blocks.some((block) => block.type === "timeline"),
      hasProcess: blocks.some((block) => block.type === "process"),
    })) {
      notes.push({
        severity: issue.severity,
        scope: "items",
        blockIndex: input.itemBlockIndex,
        message: issue.message,
      });
    }
  }

  return notes;
}
