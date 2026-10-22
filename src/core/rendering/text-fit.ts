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
 * Whether the text is taller than the frame it sits in.
 *
 * The thresholds match the ones the quality gate uses, so a page that reports
 * an overflow here can be repaired by the fitting command and the report
 * disappears.
 */
export function textLikelyOverflows(element: TextElement): boolean {
  const widthPt = element.frame.width / 12_700;
  const heightPt = element.frame.height / 12_700;
  return (
    estimateTextLines(element.text, widthPt, element.style.fontSizePt, element.style.fontFamily) *
      element.style.fontSizePt *
      1.2 >
    heightPt * 1.08
  );
}
