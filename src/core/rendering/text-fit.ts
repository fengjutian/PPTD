import type { TextElement } from "../document-model";

/** Approximate line count for a text frame. Uses the same heuristic as the visual gate. */
export function estimateTextLines(text: string, widthPt: number, fontSizePt: number): number {
  const unitsPerLine = Math.max(1, widthPt / (fontSizePt * 0.92));
  return text.split("\n").reduce((total, paragraph) => {
    const units = [...paragraph].reduce((sum, character) => sum + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1), 0);
    return total + Math.max(1, Math.ceil(units / unitsPerLine));
  }, 0);
}

export function textLikelyOverflows(element: TextElement): boolean {
  const widthPt = element.frame.width / 12_700;
  const heightPt = element.frame.height / 12_700;
  return estimateTextLines(element.text, widthPt, element.style.fontSizePt) * element.style.fontSizePt * 1.2 > heightPt * 1.08;
}
