import { estimateTextLines } from "./text-fit";

/**
 * Measured flow layout.
 *
 * A column of items used to be divided into equal slots and every item was
 * centred inside its slot. An item that needs two lines and an item that
 * needs one line then leave different amounts of white space around them,
 * and the rhythm of the column breaks: the gap above a short row is larger
 * than the gap above a tall one even though the rule between the rows is
 * the same distance away.
 *
 * This module measures the items instead of assuming their height. Every item
 * gets the same font size, the gaps between the items are the same everywhere,
 * and the column is placed by the height the content really needs.
 */

/** The ratio between the font size and the height of one line. */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.25;

/** One step of the font size search, in points. */
const FONT_STEP_PT = 0.5;

export interface FlowOptions {
  /** The text of every item, in the order they appear. */
  readonly items: readonly string[];
  /** The width of the text column, in points. */
  readonly widthPt: number;
  /** The height the column may use, in points. */
  readonly availableHeightPt: number;
  /** The font size the column would like to use, in points. */
  readonly preferredFontSizePt: number;
  /** The smallest font size the column may fall back to, in points. */
  readonly minimumFontSizePt: number;
  /** The smallest gap between two items, in points. */
  readonly minimumGapPt?: number;
  /**
   * The largest gap between two items, in points. The leftover space of a
   * column that holds little text is not spread over the gaps without a
   * limit: the items would drift apart and stop reading as one list.
   */
  readonly maximumGapPt?: number;
  /**
   * Where the column sits when it is shorter than the space it was given.
   * A centred column keeps the rules of a list together instead of leaving
   * all of the white space at the bottom.
   */
  readonly verticalAlign?: "top" | "center";
  /** The ratio between the font size and the height of one line. */
  readonly lineHeightRatio?: number;
  /** The font the measurement uses. */
  readonly fontFamily?: string;
}

export interface FlowRow {
  /** The index of the item in the flow. */
  readonly index: number;
  /** The text of the item. */
  readonly text: string;
  /** The font size every item of the flow ended up with. */
  readonly fontSizePt: number;
  /** How many lines the item needs. */
  readonly lines: number;
  /** The height of the item, in points. */
  readonly heightPt: number;
  /** The distance from the top of the column to the top of the item, in points. */
  readonly topPt: number;
}

export interface FlowLayout {
  /** The items with their measured height and their place in the column. */
  readonly rows: readonly FlowRow[];
  /** The font size the whole column uses. */
  readonly fontSizePt: number;
  /** The gap between two items, in points. */
  readonly gapPt: number;
  /** The height the column occupies, in points. */
  readonly totalHeightPt: number;
  /** True when the items do not fit even at the smallest font size. */
  readonly overflow: boolean;
}

/** The height one item needs at a given font size, in points. */
export function measureItemHeightPt(
  text: string,
  widthPt: number,
  fontSizePt: number,
  options: { lineHeightRatio?: number; fontFamily?: string } = {},
): number {
  const ratio = options.lineHeightRatio ?? DEFAULT_LINE_HEIGHT_RATIO;
  const lines = estimateTextLines(text, widthPt, fontSizePt, options.fontFamily);
  return lines * fontSizePt * ratio;
}

/**
 * Lays a column of items out by their measured height.
 *
 * The font size is shared by the whole column: an item that is a little longer
 * than its neighbours must not be set in a smaller size, because the column
 * would read as a list of unrelated fragments.
 */
export function layoutFlow(options: FlowOptions): FlowLayout {
  const ratio = options.lineHeightRatio ?? DEFAULT_LINE_HEIGHT_RATIO;
  const minimumGapPt = options.minimumGapPt ?? 0;
  const maximumGapPt = options.maximumGapPt ?? Number.POSITIVE_INFINITY;
  const gapCount = Math.max(0, options.items.length - 1);
  const heights = (fontSizePt: number) =>
    options.items.map((text) =>
      measureItemHeightPt(text, options.widthPt, fontSizePt, {
        lineHeightRatio: ratio,
        fontFamily: options.fontFamily,
      }),
    );

  // The largest font size whose items still fit the column.
  let fontSizePt = options.preferredFontSizePt;
  let rowHeights = heights(fontSizePt);
  let contentPt = rowHeights.reduce((sum, height) => sum + height, 0);
  while (fontSizePt > options.minimumFontSizePt && contentPt + gapCount * minimumGapPt > options.availableHeightPt) {
    fontSizePt = Math.max(options.minimumFontSizePt, fontSizePt - FONT_STEP_PT);
    rowHeights = heights(fontSizePt);
    contentPt = rowHeights.reduce((sum, height) => sum + height, 0);
  }
  const overflow = contentPt + gapCount * minimumGapPt > options.availableHeightPt;

  // The leftover space is shared by the gaps, so every gap is the same size.
  const leftoverPt = Math.max(0, options.availableHeightPt - contentPt);
  const gapPt = gapCount === 0 ? 0 : Math.min(maximumGapPt, Math.max(minimumGapPt, leftoverPt / gapCount));
  const totalHeightPt = contentPt + gapPt * gapCount;

  // A column that is shorter than the space it was given is centred, so the
  // white space does not all collect below the last item.
  const leadingPt =
    options.verticalAlign === "center" ? Math.max(0, (options.availableHeightPt - totalHeightPt) / 2) : 0;

  const rows: FlowRow[] = [];
  let topPt = leadingPt;
  options.items.forEach((text, index) => {
    const heightPt = rowHeights[index] ?? 0;
    rows.push({
      index,
      text,
      fontSizePt,
      lines: Math.max(1, Math.round(heightPt / (fontSizePt * ratio))),
      heightPt,
      topPt,
    });
    topPt += heightPt + gapPt;
  });
  return { rows, fontSizePt, gapPt, totalHeightPt, overflow };
}
