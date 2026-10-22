import { estimateTextLines } from "../rendering/text-fit";

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
} as const;

/**
 * The safe area a page lays out into when no template claims one. A template
 * may claim a different one, and then the page has more or less room, but the
 * review screen has to describe the page it can describe: the standard one.
 */
export const DEFAULT_CONTENT_REGION = { left: 0.07, right: 0.93, top: 0.20, bottom: 0.87 } as const;

/**
 * The geometry a content page lays out into. The renderer and the review
 * screen share it so that a page the writer was warned about is the page that
 * gets built.
 */
export const CONTENT_REGION = {
  /** The content of a page starts this far below the top of the safe area. */
  contentTopOffset: 0.17,
  /** A comparison column takes this share of the content area. */
  comparisonColumnWidth: 0.44,
  /** The label of a comparison column. */
  comparisonLabelFontSizePt: 18,
  /** The copy of a comparison column. */
  comparisonItemFontSizePt: 16,
  /** The smallest copy a comparison column may shrink to. */
  comparisonMinimumItemFontSizePt: 12,
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
  const contentTop = region.top + Math.min(CONTENT_REGION.contentTopOffset, (region.bottom - region.top) * 0.30);
  return region.bottom - contentTop;
}

export type LayoutCapacitySeverity = "info" | "warning";
export type LayoutCapacityScope = "title" | "items" | "comparison";

export interface LayoutCapacityNote {
  severity: LayoutCapacitySeverity;
  scope: LayoutCapacityScope;
  message: string;
}

export interface LayoutCapacityInput {
  /** The position of the page in the deck. The first page has its own rules. */
  index: number;
  title: string;
  /** The points the page will lay out, in the order they will be laid out. */
  items: readonly string[];
  /** The body copy the page carries. */
  bodyLength: number;
  /** The two sides of a comparison block, when the page carries one. */
  comparison?: { leftItems: readonly string[]; rightItems: readonly string[] };
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
  const widthPt = (DEFAULT_CONTENT_REGION.right - DEFAULT_CONTENT_REGION.left) * CONTENT_REGION.comparisonColumnWidth * pageWidthIn * 72 - 0.07 * pageWidthIn * 72;
  const headerFraction = (CONTENT_REGION.comparisonLabelFontSizePt * 1.2) / 72 / pageHeightIn + 0.018;
  const availablePt = (contentHeightFraction() - headerFraction - 0.06) * pageHeightIn * 72;
  const value = points.map((point) => `• ${point}`).join("\n\n");
  const preferred = CONTENT_REGION.comparisonItemFontSizePt;
  const minimum = CONTENT_REGION.comparisonMinimumItemFontSizePt;
  const fitsAt = (size: number) => estimateTextLines(value, widthPt, size, options.fontFamily) * size * BODY_LINE_HEIGHT_RATIO <= availablePt;
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
 * been built, so every note names the limit it comes from.
 */
export function assessLayoutCapacity(input: LayoutCapacityInput, options: CapacityOptions = {}): LayoutCapacityNote[] {
  const notes: LayoutCapacityNote[] = [];
  const points = input.items.map(stripListPrefix);
  const count = points.length;

  const titleWidthPt = ((DEFAULT_CONTENT_REGION.right - DEFAULT_CONTENT_REGION.left) * STANDARD_PAGE_WIDTH_EMU) / EMU_PER_POINT;
  const titleLines = estimateTextLines(input.title, titleWidthPt, TITLE_FONT_SIZE_PT, options.fontFamily);
  if (titleLines > 1) {
    notes.push({ severity: "warning", scope: "title", message: `标题 ${[...input.title].length} 字，在 ${TITLE_FONT_SIZE_PT}pt 标题框里会折成 ${titleLines} 行` });
  }

  if (count === 1) {
    notes.push({ severity: "info", scope: "items", message: "本页只有 1 条要点，会排成一整页正文，建议补到 2 条以上" });
  } else if (count === LAYOUT_CAPACITY.splitMinItems) {
    notes.push({ severity: "info", scope: "items", message: "本页 2 条要点会排成双栏，每栏只有 1 条" });
  } else if (count > LAYOUT_CAPACITY.cardsMaxItems) {
    notes.push({ severity: "warning", scope: "items", message: `本页 ${count} 条要点，超过卡片版式的 ${LAYOUT_CAPACITY.cardsMaxItems} 条上限，会排成双栏或整页正文` });
  } else if (count >= LAYOUT_CAPACITY.cardsGridMinItems) {
    const columns = count === 3 || count >= 5 ? 3 : 2;
    notes.push({ severity: "info", scope: "items", message: `本页 ${count} 条要点，可排成 ${columns} 列卡片网格` });
  }

  let longest = { index: -1, length: 0 };
  points.forEach((point, pointIndex) => {
    const length = [...point].length;
    if (length > longest.length) longest = { index: pointIndex, length };
  });
  const cardLimit = longest.length > LAYOUT_CAPACITY.cardItemLengthLimit ? LAYOUT_CAPACITY.cardItemLengthLimit : LAYOUT_CAPACITY.cardItemLength;
  if (longest.length > cardLimit) {
    notes.push({ severity: "warning", scope: "items", message: `第 ${longest.index + 1} 条 ${longest.length} 字，超过卡片版式 ${cardLimit} 字上限，本页会排成双栏或整页正文` });
  } else if (longest.length > LAYOUT_CAPACITY.shortItemLength) {
    notes.push({ severity: "warning", scope: "items", message: `第 ${longest.index + 1} 条 ${longest.length} 字，超过单行 ${LAYOUT_CAPACITY.shortItemLength} 字，本页会排成双栏而不是卡片` });
  }

  if (input.bodyLength > LAYOUT_CAPACITY.cardBodyLengthLimit) {
    notes.push({ severity: "warning", scope: "items", message: `正文 ${input.bodyLength} 字，超过卡片版式 ${LAYOUT_CAPACITY.cardBodyLengthLimit} 字上限，本页会排成双栏或整页正文` });
  } else if (input.bodyLength > LAYOUT_CAPACITY.cardBodyLength) {
    notes.push({ severity: "info", scope: "items", message: `正文 ${input.bodyLength} 字，卡片网格最多排 ${LAYOUT_CAPACITY.cardBodyLength} 字` });
  }

  if (input.index === 0) {
    if (count >= LAYOUT_CAPACITY.cardsGridMinItems) {
      notes.push({ severity: "warning", scope: "items", message: `首页有 ${count} 条要点，会排成卡片页而不是封面` });
    } else if (count <= LAYOUT_CAPACITY.coverMaxItems && input.bodyLength > LAYOUT_CAPACITY.coverBodyLength) {
      notes.push({ severity: "warning", scope: "items", message: `首页正文 ${input.bodyLength} 字，超过封面 ${LAYOUT_CAPACITY.coverBodyLength} 字上限` });
    }
  }

  if (input.comparison) {
    const left = input.comparison.leftItems.map(stripListPrefix);
    const right = input.comparison.rightItems.map(stripListPrefix);
    const difference = Math.abs(left.length - right.length);
    if (difference >= 2) {
      notes.push({ severity: "warning", scope: "comparison", message: `左栏 ${left.length} 条、右栏 ${right.length} 条，两栏相差 ${difference} 条，版面会失衡` });
    }
    const side = left.length >= right.length ? "左栏" : "右栏";
    const longer = left.length >= right.length ? left : right;
    const fit = fitComparisonColumn(longer, options);
    if (!fit.fits) {
      notes.push({ severity: "warning", scope: "comparison", message: `${side} ${longer.length} 条排不下 ${CONTENT_REGION.comparisonMinimumItemFontSizePt}pt 的可读下限，导出时会溢出` });
    } else if (fit.fittedFontSizePt < fit.preferredFontSizePt) {
      notes.push({ severity: "info", scope: "comparison", message: `${side} ${longer.length} 条要排到 ${fit.fittedFontSizePt}pt 才排得下` });
    }
  }

  return notes;
}
