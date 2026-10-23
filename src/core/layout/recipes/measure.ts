import type { Emu, RectEmu } from "../../document-model";
import { estimateTextLines } from "../../rendering/text-fit";
import type { NormalizedFrame } from "./types";

/** One point in EMU. */
export const EMU_PER_PT = 12_700;

/** Converts a page-relative frame to the integer EMU the document stores. */
export function frameFromNormalized(rect: NormalizedFrame, page: { width: Emu; height: Emu }): RectEmu {
  return {
    x: Math.round(rect.x * page.width) as Emu,
    y: Math.round(rect.y * page.height) as Emu,
    width: Math.round(rect.width * page.width) as Emu,
    height: Math.round(rect.height * page.height) as Emu,
  };
}

/** The height of a block in points, using the renderer's own line breaking. */
export function textHeightPt(
  text: string,
  widthPt: number,
  fontSizePt: number,
  fontFamily: string | undefined,
  lineHeight: number,
): number {
  return estimateTextLines(text, widthPt, fontSizePt, fontFamily) * fontSizePt * lineHeight;
}

/** Whether the text fits its frame at this size. */
export function textFits(
  text: string,
  frame: RectEmu,
  fontSizePt: number,
  fontFamily: string | undefined,
  lineHeight: number,
): boolean {
  const widthPt = frame.width / EMU_PER_PT;
  const heightPt = frame.height / EMU_PER_PT;
  return textHeightPt(text, widthPt, fontSizePt, fontFamily, lineHeight) <= heightPt * 0.98;
}

/**
 * The largest size at or below `preferredPt` that fits the frame.
 *
 * The result is not proof that the text fits: callers check the minimum size
 * with `textFits` and return a conflict instead of writing a clipped page.
 */
export function fittedFontSize(
  text: string,
  frame: RectEmu,
  preferredPt: number,
  minimumPt: number,
  fontFamily: string | undefined,
  lineHeight: number,
): number {
  for (let size = Math.max(1, Math.round(preferredPt)); size >= minimumPt; size -= 1) {
    if (textFits(text, frame, size, fontFamily, lineHeight)) return size;
  }
  return minimumPt;
}

export function rectsOverlap(left: RectEmu, right: RectEmu): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/** A horizontal rule's height in page-relative units. */
export function ruleHeight(rulePt: number, pageHeight: Emu): number {
  const pageHeightInches = pageHeight / 914_400;
  return rulePt / 72 / pageHeightInches;
}
