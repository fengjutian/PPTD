import type { TextElement } from "../document-model";
import { breakIntoLines } from "./cjk-linebreak";
import { getTextMeasurer } from "./text-metrics";

/**
 * Advance width of a character relative to the font size.
 * A CJK glyph fills a full em, so one character is one em wide. Measuring CJK
 * as narrower than that makes a headline look like it fits on one line while
 * the renderer wraps it and pushes the second line into the artwork below.
 */
const FULL_WIDTH_EM = 1;
const LATIN_WIDTH_EM = 0.55;

/** Width of a text run in em units, independent of the font size. */
export function measureTextUnits(text: string): number {
  return [...text].reduce(
    (sum, character) => sum + (/^[\u0000-\u00ff]$/.test(character) ? LATIN_WIDTH_EM : FULL_WIDTH_EM),
    0,
  );
}

/**
 * The width of the text in em units.
 *
 * When the application registered a measurer, the real font decides. Without
 * one the estimate above is used, which is the reason the core never depends
 * on a renderer.
 */
export function measureTextWidthEm(text: string, fontFamily?: string): number {
  const measurer = getTextMeasurer();
  if (measurer && fontFamily) {
    const width = measurer.widthEm(text, fontFamily);
    if (Number.isFinite(width) && width >= 0) return width;
  }
  return measureTextUnits(text);
}

/**
 * How many lines a text needs in a frame.
 *
 * The line breaking is the one the renderer uses, so the layout engine, the
 * quality gate and the picture the reviewer looks at all count the same
 * lines. Counting whole paragraphs by width instead would disagree with the
 * renderer wherever a Latin word or a piece of punctuation decides a break.
 */
export function estimateTextLines(text: string, widthPt: number, fontSizePt: number, fontFamily?: string): number {
  const widthEm = Math.max(1, widthPt / fontSizePt);
  return breakIntoLines(text, {
    widthEm,
    widthOf: (character) => measureTextWidthEm(character, fontFamily),
  }).length;
}

/**
 * How many characters one line of a text box holds.
 *
 * Two bands matter for readability and they are not the same number: a Latin
 * line wants 45–75 characters, a full-width line wants far fewer. The script is
 * decided from the text itself rather than from the font name, because a deck
 * mixes both in one paragraph and the reader only cares which one dominates.
 */
export interface LineMeasure {
  /** Characters per line at the element's own size and width. */
  characters: number;
  /** Which band applies: a line of 汉字 and a line of letters do not compare. */
  script: "cjk" | "latin";
}

export function measureLine(text: string, widthPt: number, fontSizePt: number): LineMeasure {
  const characters = [...text].filter((character) => !/\s/.test(character));
  if (characters.length === 0 || widthPt <= 0 || fontSizePt <= 0) {
    return { characters: 0, script: "latin" };
  }
  const wide = characters.filter((character) => !/^[\u0000-\u00ff]$/.test(character)).length;
  const script: LineMeasure["script"] = wide * 2 >= characters.length ? "cjk" : "latin";
  const emPerCharacter =
    characters.reduce((sum, character) => sum + measureTextWidthEm(character), 0) / characters.length;
  return { characters: Math.max(0, Math.round(widthPt / (emPerCharacter * fontSizePt))), script };
}

/**
 * The readable band of one line, in characters.
 *
 * The CJK numbers are the same 45–75 Latin characters expressed in full-width
 * glyphs (a full-width glyph is roughly 1.6–1.8 Latin characters wide), rounded
 * to whole characters. Both are soft bounds: the lint reports them, it never
 * refuses a page.
 */
export const MEASURE_BAND: Readonly<Record<LineMeasure["script"], { min: number; max: number }>> = {
  cjk: { min: 18, max: 36 },
  latin: { min: 40, max: 85 },
};

export interface TextFrameFitOptions {
  /** Frame width in the same unit as `fontSize`. */
  readonly width: number;
  /** Frame height in the same unit as `fontSize`. */
  readonly height: number;
  /** The size the layout asked for. */
  readonly fontSize: number;
  /** Line height as a multiple of the font size. */
  readonly lineHeight: number;
  /** The font the measurement uses. */
  readonly fontFamily?: string;
  /** The smallest share of the requested size a fit may fall back to. */
  readonly minimumScale?: number;
}

export interface TextFrameFit {
  /** The size that keeps every line of the block inside the frame. */
  readonly fontSize: number;
  /** The lines the text breaks into at that size. */
  readonly lines: readonly string[];
  /** True when the text had to be set smaller than requested. */
  readonly shrunk: boolean;
  /** True when even the smallest size leaves lines that do not fit the height. */
  readonly overflow: boolean;
}

/** How far a fit may shrink before it reports a conflict instead of shrinking. */
const MINIMUM_FIT_SCALE = 0.55;
/** The multiplicative step of the fit search; small enough to stay under a point. */
const FIT_STEP = 0.97;

/**
 * The largest size at or below the requested one that keeps a whole block of
 * text inside its frame.
 *
 * The layout engine, the preview renderer and the exporter have to agree on the
 * lines a paragraph breaks into, or a frame the layout measured as one line is
 * painted as two and the second line is lost. Both sides therefore break with
 * this module's measurer, and this function decides what happens when a frame
 * really is too small: the text is set smaller — which is what the exported
 * `normAutofit` does — instead of dropping the words that do not fit.
 *
 * Units are irrelevant as long as `width`, `height` and `fontSize` share them:
 * the line breaking only depends on the ratio between the frame and the type.
 */
export function fitTextToFrame(text: string, options: TextFrameFitOptions): TextFrameFit {
  const lineHeight = Math.max(0.1, options.lineHeight);
  const breakAt = (fontSize: number): string[] =>
    breakIntoLines(text, {
      widthEm: Math.max(1, options.width / Math.max(0.01, fontSize)),
      widthOf: (character) => measureTextWidthEm(character, options.fontFamily),
    });
  const linesAt = (fontSize: number) => {
    const lineBox = fontSize * lineHeight;
    // A frame rounded to whole EMU can be a hair shorter than the lines it was
    // measured for; that rounding must not read as an overflow. Two percent of
    // a line is the same slack the gate allows when it reports an overflow.
    return Math.max(1, Math.floor((options.height + lineBox * 0.02) / lineBox));
  };
  const requested = Math.max(0.01, options.fontSize);
  let fontSize = requested;
  let lines = breakAt(fontSize);
  if (lines.length <= linesAt(fontSize)) return { fontSize, lines, shrunk: false, overflow: false };

  const floor = Math.max(0.01, requested * (options.minimumScale ?? MINIMUM_FIT_SCALE));
  while (fontSize > floor) {
    fontSize = Math.max(floor, fontSize * FIT_STEP);
    lines = breakAt(fontSize);
    if (lines.length <= linesAt(fontSize)) return { fontSize, lines, shrunk: true, overflow: false };
  }
  return { fontSize, lines, shrunk: true, overflow: lines.length > linesAt(fontSize) };
}

/**
 * The region a text actually paints, in EMU.
 *
 * A frame is a container, not ink: a right-aligned page number and a
 * left-aligned section label can share the same footer band without a single
 * glyph ever meeting. Collision checks that compare frames report those two as
 * overlapping, which is how a correct page gets flagged (and, in the quality
 * gate, rejected). This box follows the alignment and the measured line widths,
 * so two texts collide only where the reader would see them collide.
 */
export interface TextInkBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** EMU per point, matching the rest of the document model. */
const EMU_PER_POINT = 12_700;

export function textInkBox(element: TextElement): TextInkBox {
  const fontSizePt = Math.max(0.01, element.style.fontSizePt);
  const lineHeight = element.style.lineHeight ?? 1.25;
  const frameWidthPt = element.frame.width / EMU_PER_POINT;
  const frameHeightPt = element.frame.height / EMU_PER_POINT;
  const lines =
    breakIntoLines(element.text, {
      widthEm: Math.max(1, frameWidthPt / fontSizePt),
      widthOf: (character) => measureTextWidthEm(character, element.style.fontFamily),
    }) ?? [];
  const widestEm = lines.reduce(
    (widest, line) =>
      Math.max(
        widest,
        [...line].reduce((sum, character) => sum + measureTextWidthEm(character, element.style.fontFamily), 0),
      ),
    0,
  );
  const inkWidthPt = Math.min(frameWidthPt, widestEm * fontSizePt);
  const inkHeightPt = Math.min(frameHeightPt, Math.max(1, lines.length) * fontSizePt * lineHeight);
  const align = element.style.align ?? "left";
  const verticalAlign = element.style.verticalAlign ?? "top";
  const xPt = align === "center" ? (frameWidthPt - inkWidthPt) / 2 : align === "right" ? frameWidthPt - inkWidthPt : 0;
  const yPt =
    verticalAlign === "middle"
      ? (frameHeightPt - inkHeightPt) / 2
      : verticalAlign === "bottom"
        ? frameHeightPt - inkHeightPt
        : 0;
  return {
    x: element.frame.x + Math.round(xPt * EMU_PER_POINT),
    y: element.frame.y + Math.round(yPt * EMU_PER_POINT),
    width: Math.max(0, Math.round(inkWidthPt * EMU_PER_POINT)),
    height: Math.max(0, Math.round(inkHeightPt * EMU_PER_POINT)),
  };
}

/**
 * Whether the text is taller than the frame it sits in.
 *
 * The thresholds match the ones the quality gate uses, so a page that reports
 * an overflow here can be repaired by the fitting command and the report
 * disappears.
 */
export function textLikelyOverflows(element: TextElement): boolean {
  const widthPt = element.frame.width / 12_700;
  const heightPt = element.frame.height / 12_700;
  // An explicit leading changes how tall the block is. Counting it here lets the
  // refit pass catch a text style that no longer fits its frame. A document
  // that never set one is measured with the single spacing the export writes
  // (1.2); the preview draws such a text with its own 1.25 default, and the
  // 8% allowance below is what keeps the two from disagreeing about a page.
  const lineHeight = element.style.lineHeight ?? 1.2;
  return (
    estimateTextLines(element.text, widthPt, element.style.fontSizePt, element.style.fontFamily) *
      element.style.fontSizePt *
      lineHeight >
    heightPt * 1.08
  );
}
