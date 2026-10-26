import type { Emu, RectEmu } from "../../document-model";
import { estimateTextLines, textLines, type TextRunMetrics } from "../../rendering/text-fit";
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

/**
 * The run properties a headline is measured with.
 *
 * A recipe fits its title before it owns the element, so it reads the tracking
 * from the tokens here and the bold weight from the role: every title the
 * recipes draw is bold. Without the tracking the plan measures a narrower line
 * than the export writes, and the title wraps a word later in the file.
 */
export function headingMetrics(letterSpacingPt: number): TextRunMetrics {
  return { bold: true, ...(letterSpacingPt === 0 ? {} : { letterSpacingPt }) };
}

/** The height of a block in points, using the renderer's own line breaking. */
export function textHeightPt(
  text: string,
  widthPt: number,
  fontSizePt: number,
  fontFamily: string | undefined,
  lineHeight: number,
  metrics?: TextRunMetrics,
): number {
  return estimateTextLines(text, widthPt, fontSizePt, fontFamily, metrics) * fontSizePt * lineHeight;
}

/** Whether the text fits its frame at this size. */
export function textFits(
  text: string,
  frame: RectEmu,
  fontSizePt: number,
  fontFamily: string | undefined,
  lineHeight: number,
  metrics?: TextRunMetrics,
): boolean {
  const widthPt = frame.width / EMU_PER_PT;
  const heightPt = frame.height / EMU_PER_PT;
  return textHeightPt(text, widthPt, fontSizePt, fontFamily, lineHeight, metrics) <= heightPt * 0.98;
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
  metrics?: TextRunMetrics,
): number {
  return fittedFontSizeInRange(text, frame, preferredPt, minimumPt, preferredPt, fontFamily, lineHeight, metrics);
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
  metrics?: TextRunMetrics,
): number {
  const minimum = Math.max(1, Math.round(minimumPt));
  const maximum = Math.max(minimum, Math.round(maximumPt));
  const preferred = Math.min(maximum, Math.max(minimum, Math.round(preferredPt)));
  if (textFits(text, frame, preferred, fontFamily, lineHeight, metrics)) {
    for (let size = preferred + 1; size <= maximum; size += 1) {
      if (!textFits(text, frame, size, fontFamily, lineHeight, metrics)) return size - 1;
    }
    return maximum;
  }
  for (let size = preferred - 1; size >= minimum; size -= 1) {
    if (textFits(text, frame, size, fontFamily, lineHeight, metrics)) return size;
  }
  return minimum;
}

/**
 * Whether the block would leave a stranded last line at this size.
 *
 * A last line of one or two characters ("…贡献有 / 限") is the most common
 * typographic defect in a generated column: nothing is clipped, every glyph is
 * inside its box, and the page still reads as unfinished. Columns that share one
 * type size ask this before committing to it, so the whole list shrinks by a
 * point instead of one item being set smaller than its neighbours.
 */
export function endsInOrphan(
  text: string,
  widthPt: number,
  fontSizePt: number,
  fontFamily: string | undefined,
  minimumLastLineChars = 3,
  metrics?: TextRunMetrics,
): boolean {
  const lines = textLines(text, widthPt, fontSizePt, fontFamily, metrics);
  if (lines.length <= 1) return false;
  const lastLine = (lines[lines.length - 1] ?? "").replace(/\s/g, "");
  return lastLine.length < minimumLastLineChars;
}

/** Whether any of the items would end on a stranded line at this size. */
export function anyEndsInOrphan(
  items: readonly string[],
  widthPt: number,
  fontSizePt: number,
  fontFamily: string | undefined,
  minimumLastLineChars = 3,
  metrics?: TextRunMetrics,
): boolean {
  return items.some((item) => endsInOrphan(item, widthPt, fontSizePt, fontFamily, minimumLastLineChars, metrics));
}

/**
 * The largest size that does not leave an orphan on the last line.
 *
 * A two-line headline whose second line holds a single character reads as a
 * mistake, and that is exactly what a fitted size can produce: the size is the
 * largest that fits, not the one that breaks well. A point or two smaller
 * usually balances the break; a headline that is slightly smaller beats one with
 * a stranded character.
 */
export function fittedFontSizeWithoutOrphan(
  text: string,
  frame: RectEmu,
  preferredPt: number,
  minimumPt: number,
  fontFamily: string | undefined,
  lineHeight: number,
  minimumLastLineChars = 3,
  maximumDropPt = Number.POSITIVE_INFINITY,
  metrics?: TextRunMetrics,
): number {
  const fitted = fittedFontSize(text, frame, preferredPt, minimumPt, fontFamily, lineHeight, metrics);
  const widthPt = frame.width / EMU_PER_PT;
  // A display headline may be worth a point or two to balance; a body title is
  // not worth a third of its size, so a caller can bound the search and leave
  // the narrow frame to the layout audit instead.
  const floor = Math.max(minimumPt, Math.round(fitted - maximumDropPt));
  let size = fitted;
  while (size > floor) {
    if (!endsInOrphan(text, widthPt, size, fontFamily, minimumLastLineChars, metrics)) return size;
    size -= 1;
  }
  return size;
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
