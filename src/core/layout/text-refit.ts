import { isElementVisible, type Emu, type PresentationDocument, type Slide, type TextElement } from "../document-model";
import { estimateTextLines, fitTextToFrame } from "../rendering/text-fit";

/**
 * Makes the text of a finished page fit the frame it was given.
 *
 * The recipes and the legacy composition both fit their copy when they plan a
 * page, but a page is assembled from many independent decisions: a repair may
 * enlarge a title, a template may narrow a column, a style constraint may add
 * leading. The result can be a frame that is two percent too short — enough for
 * the canvas to clip the last line and for PowerPoint to shrink the whole box.
 *
 * The repair is deterministic and design-only. It never touches the copy: it
 * gives a too-short frame the empty room below it when the composition has it
 * (which keeps the designed size), and otherwise reduces the size, within a
 * readable floor. A text that still does not fit is reported, not rewritten.
 */
export interface TextRefitAdjustment {
  elementId: string;
  /** How the element was repaired, for diagnostics and tests. */
  kind: "grew-frame" | "shrank-type";
  /** The size the element carries after the repair, in points. */
  fontSizePt: number;
  /** Added frame height in points; zero when the type was shrunk. */
  grownPt: number;
}

export interface TextRefitConflict {
  elementId: string;
  /** The height the copy needs at the smallest size the refit allows, in points. */
  neededPt: number;
  /** The height the frame offers, in points. */
  availablePt: number;
}

export interface TextRefitReport {
  adjustments: readonly TextRefitAdjustment[];
  conflicts: readonly TextRefitConflict[];
}

/** Points in one EMU, matching the renderer's own conversion. */
const EMU_PER_PT = 12_700;
/** The share of an overflow that is rounding rather than a lost line. */
const OVERFLOW_TOLERANCE = 1.02;
/** How much smaller than designed a refit may set a text. */
const MINIMUM_SCALE = 0.7;
/** The smallest size a refit will ever write, in points. */
const MINIMUM_PT = 8;
/** The page edge a refit must leave free, as a share of the page height. */
const PAGE_BOTTOM_MARGIN = 0.02;
/**
 * How much a frame may grow before shrinking the type is the better repair.
 *
 * A refit absorbs the line or two a design left out; it must not turn a
 * one-line label into a column that runs down the page because nothing else
 * happened to be in the way.
 */
const MAXIMUM_GROWTH_LINES = 2;

/**
 * How much empty height sits below a text frame before something else is hit.
 *
 * Two kinds of object stop the growth: whatever starts below the frame, and
 * whatever visually backs the frame (a card, a header bar) — text that grew out
 * of its card would be painted over the page instead.
 */
function growthLimitPt(slide: Slide, element: TextElement, pageHeight: Emu): number {
  const frame = element.frame;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  // One point of slack keeps a neighbour that merely touches the frame from
  // being read as a blocker.
  const slack = EMU_PER_PT;
  let limit = Math.round(pageHeight * (1 - PAGE_BOTTOM_MARGIN));
  for (const other of slide.elements) {
    if (other.id === element.id || !isElementVisible(other)) continue;
    const otherFrame = other.frame;
    if (otherFrame.width <= 0 || otherFrame.height <= 0) continue;
    const overlapX = Math.min(frame.x + frame.width, otherFrame.x + otherFrame.width) - Math.max(frame.x, otherFrame.x);
    if (overlapX <= slack) continue;
    const otherTop = otherFrame.y;
    const otherBottom = otherFrame.y + otherFrame.height;
    if (otherTop >= bottom - slack) {
      limit = Math.min(limit, otherTop);
    } else if (otherTop < top && otherBottom > top + slack) {
      limit = Math.min(limit, otherBottom);
    }
  }
  return Math.max(0, (limit - bottom) / EMU_PER_PT);
}

/** The height a text needs at a given size, measured the way the renderer breaks it. */
function neededHeightPt(element: TextElement, fontSizePt: number): number {
  const widthPt = element.frame.width / EMU_PER_PT;
  const lines = estimateTextLines(element.text, widthPt, fontSizePt, element.style.fontFamily);
  return lines * fontSizePt * (element.style.lineHeight ?? 1.25);
}

/**
 * Repairs every text of one page in place and reports what it could not fix.
 *
 * Called while a page is composed, so the document — not only the preview — is
 * the thing that fits. `pageHeight` is the page it will be drawn on.
 */
export function refitSlideText(slide: Slide, pageHeight: Emu): TextRefitReport {
  const adjustments: TextRefitAdjustment[] = [];
  const conflicts: TextRefitConflict[] = [];
  // A page laid out on a template placeholder carries the template's geometry
  // as a contract: growing or shrinking its frames would silently break the
  // layout the user uploaded. The overflow is left to the audit and to the
  // file's own autofit, which shrinks the copy without touching the frame.
  if (slide.layoutId !== undefined) return { adjustments, conflicts };
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    if (!isElementVisible(element)) continue;
    if (!element.text.trim()) continue;
    if (element.frame.width <= 0 || element.frame.height <= 0) continue;

    const designedPt = element.style.fontSizePt;
    const availablePt = element.frame.height / EMU_PER_PT;
    if (neededHeightPt(element, designedPt) <= availablePt * OVERFLOW_TOLERANCE) continue;

    const fit = fitTextToFrame(element.text, {
      width: element.frame.width / EMU_PER_PT,
      height: availablePt,
      fontSize: designedPt,
      lineHeight: element.style.lineHeight ?? 1.25,
      fontFamily: element.style.fontFamily,
      minimumScale: MINIMUM_SCALE,
    });
    // A vertically centred or bottom-aligned block would move when its frame
    // grows; growing it is a layout change, shrinking the type is not.
    const growsInPlace = (element.style.verticalAlign ?? "top") === "top";
    const neededPt = neededHeightPt(element, designedPt);
    const linePt = designedPt * (element.style.lineHeight ?? 1.25);
    const roomPt = growsInPlace ? growthLimitPt(slide, element, pageHeight) : 0;
    const growthCapPt = Math.min(roomPt, MAXIMUM_GROWTH_LINES * linePt);
    if (growsInPlace && neededPt - availablePt <= growthCapPt) {
      const grownPt = neededPt * 1.01 - availablePt;
      element.frame = {
        ...element.frame,
        height: Math.ceil((availablePt + grownPt) * EMU_PER_PT) as Emu,
      };
      adjustments.push({ elementId: element.id, kind: "grew-frame", fontSizePt: designedPt, grownPt });
      continue;
    }

    const floor = Math.max(MINIMUM_PT, Math.round(designedPt * MINIMUM_SCALE));
    let repairedPt = Math.max(floor, fit.fontSize);
    // The fit allows a rounding sliver; the document itself may not. Step down
    // whole points until the copy really fits the box the canvas will clip at.
    while (repairedPt > floor && neededHeightPt(element, repairedPt) > availablePt) repairedPt -= 1;
    if (repairedPt < designedPt) {
      element.style = { ...element.style, fontSizePt: repairedPt };
      adjustments.push({ elementId: element.id, kind: "shrank-type", fontSizePt: repairedPt, grownPt: 0 });
    }
    // Still over the frame at the floor: report the size that would be needed
    // instead of shrinking the copy into unreadable type (ADR 0114 §6).
    if (neededHeightPt(element, repairedPt) > availablePt) {
      conflicts.push({
        elementId: element.id,
        neededPt: Math.round(neededHeightPt(element, repairedPt)),
        availablePt: Math.round(availablePt),
      });
    }
  }
  return { adjustments, conflicts };
}

/** Repairs every page of a document; used after a design has been composed. */
export function refitDocumentText(document: PresentationDocument): TextRefitReport {
  const adjustments: TextRefitAdjustment[] = [];
  const conflicts: TextRefitConflict[] = [];
  for (const slide of document.slides) {
    const report = refitSlideText(slide, document.pageSize.height);
    adjustments.push(...report.adjustments);
    conflicts.push(...report.conflicts);
  }
  return { adjustments, conflicts };
}
