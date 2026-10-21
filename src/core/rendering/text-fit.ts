import type { TextElement } from "../document-model";

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

/** Approximate line count for a text frame. Uses the same heuristic as the visual gate. */
export function estimateTextLines(text: string, widthPt: number, fontSizePt: number): number {
  const unitsPerLine = Math.max(1, widthPt / fontSizePt);
  return text.split("\n").reduce((total, paragraph) => {
    const units = measureTextUnits(paragraph);
    return total + Math.max(1, Math.ceil(units / unitsPerLine));
  }, 0);
}

export function textLikelyOverflows(element: TextElement): boolean {
  const widthPt = element.frame.width / 12_700;
  const heightPt = element.frame.height / 12_700;
  return (
    estimateTextLines(element.text, widthPt, element.style.fontSizePt) * element.style.fontSizePt * 1.2 >
    heightPt * 1.08
  );
}
