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
  return fittedFontSizeInRange(text, frame, preferredPt, minimumPt, preferredPt, fontFamily, lineHeight);
}

/**
 * The largest size in `[minimumPt, maximumPt]` that fits the frame.
 *
 * The old fitter only ever shrank. That kept text inside its box, but it also
 * kept a page with three short points at body size while the rows around it
 * were a foot tall: the page was empty and the type was small at the same time.
 * A layout that knows a slot is sparse can now ask for a size range and use the
 * room the content actually has.
 *
 * `preferredPt` is the first candidate, not a cap: when it fits, the fitter
 * keeps growing until `maximumPt` or the first size that no longer fits. When
 * it does not fit, the fitter shrinks as before. If even `minimumPt` does not
 * fit, the caller still owns the conflict decision.
 */
export function fittedFontSizeInRange(
  text: string,
  frame: RectEmu,
  preferredPt: number,
  minimumPt: number,
  maximumPt: number,
  fontFamily: string | undefined,
  lineHeight: number,
): number {
  const minimum = Math.max(1, Math.round(minimumPt));
  const maximum = Math.max(minimum, Math.round(maximumPt));
  const preferred = Math.min(maximum, Math.max(minimum, Math.round(preferredPt)));
  if (textFits(text, frame, preferred, fontFamily, lineHeight)) {
    for (let size = preferred + 1; size <= maximum; size += 1) {
      if (!textFits(text, frame, size, fontFamily, lineHeight)) return size - 1;
    }
    return maximum;
  }
  for (let size = preferred - 1; size >= minimum; size -= 1) {
    if (textFits(text, frame, size, fontFamily, lineHeight)) return size;
  }
  return minimum;
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
