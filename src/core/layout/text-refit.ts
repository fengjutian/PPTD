import { isElementVisible, type Emu, type PresentationDocument, type Slide, type TextElement } from "../document-model";
import { endsInOrphan } from "./recipes/measure";
import { DEFAULT_LINE_HEIGHT, estimateTextLines, fitTextToFrame, runMetricsOf } from "../rendering/text-fit";

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
/** How many points a size group may give up to avoid a stranded last line. */
const STRAND_ALLOWANCE_PT = 2;
/** The share a group of short runs (values, labels) may give up instead. */
const STRAND_SHORT_RUN_PORTION = 0.25;
/** The share a group of paragraphs may give up when only a big step balances it. */
const STRAND_PARAGRAPH_PORTION = 0.25;
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
  const lines = estimateTextLines(element.text, widthPt, fontSizePt, element.style.fontFamily, runMetricsOf(element));
  return lines * fontSizePt * (element.style.lineHeight ?? DEFAULT_LINE_HEIGHT);
}

/**
 * Repairs every text of one page in place and reports what it could not fix.
 *
 * Called while a page is composed, so the document — not only the preview — is
 * the thing that fits. `pageHeight` is the page it will be drawn on.
 */
export function refitSlideText(slide: Slide, pageHeight: Emu): TextRefitReport {
  // One adjustment per element: the overflow pass may shrink a text that the
  // strand pass then steps down again, and the report should describe the page
  // as it ends up, not every intermediate decision.
  const byElement = new Map<string, TextRefitAdjustment>();
  const record = (adjustment: TextRefitAdjustment) => byElement.set(adjustment.elementId, adjustment);
  const conflicts: TextRefitConflict[] = [];
  // A page laid out on a template placeholder carries the template's geometry
  // as a contract: growing or shrinking its frames would silently break the
  // layout the user uploaded. The overflow is left to the audit and to the
  // file's own autofit, which shrinks the copy without touching the frame.
  if (slide.layoutId !== undefined) return { adjustments: [], conflicts };
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
      lineHeight: element.style.lineHeight ?? DEFAULT_LINE_HEIGHT,
      fontFamily: element.style.fontFamily,
      bold: element.style.bold,
      letterSpacingPt: element.style.letterSpacingPt,
      minimumScale: MINIMUM_SCALE,
    });
    // A vertically centred or bottom-aligned block would move when its frame
    // grows; growing it is a layout change, shrinking the type is not.
    const growsInPlace = (element.style.verticalAlign ?? "top") === "top";
    const neededPt = neededHeightPt(element, designedPt);
    const linePt = designedPt * (element.style.lineHeight ?? DEFAULT_LINE_HEIGHT);
    const roomPt = growsInPlace ? growthLimitPt(slide, element, pageHeight) : 0;
    const growthCapPt = Math.min(roomPt, MAXIMUM_GROWTH_LINES * linePt);
    if (growsInPlace && neededPt - availablePt <= growthCapPt) {
      const grownPt = neededPt * 1.01 - availablePt;
      element.frame = {
        ...element.frame,
        height: Math.ceil((availablePt + grownPt) * EMU_PER_PT) as Emu,
      };
      record({ elementId: element.id, kind: "grew-frame", fontSizePt: designedPt, grownPt });
      continue;
    }

    const floor = Math.max(MINIMUM_PT, Math.round(designedPt * MINIMUM_SCALE));
    let repairedPt = Math.max(floor, fit.fontSize);
    // The fit allows a rounding sliver; the document itself may not. Step down
    // whole points until the copy really fits the box the canvas will clip at.
    while (repairedPt > floor && neededHeightPt(element, repairedPt) > availablePt) repairedPt -= 1;
    if (repairedPt < designedPt) {
      element.style = { ...element.style, fontSizePt: repairedPt };
      record({ elementId: element.id, kind: "shrank-type", fontSizePt: repairedPt, grownPt: 0 });
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
  repairStrandedLines(slide, record);
  return { adjustments: [...byElement.values()], conflicts };
}

/**
 * Grows the frame of one edited text so its new copy fits, and stops there.
 *
 * The design-time refit may shrink type as well, because the page was composed
 * without the writer. After an edit the copy is the writer's own text: the box has
 * to follow it, but the size is their choice and silently shrinking it after they
 * type is a different thing from shrinking a page nobody has read yet. So this
 * helper only makes the frame taller — never the type smaller, never another
 * element — and only while there is room below it.
 *
 * A vertically centred or bottom-aligned block would jump when its frame grows, so
 * those are left alone; the audit and the canvas edge report them instead.
 */
export function growFrameForText(slide: Slide, element: TextElement, pageHeight: Emu): TextRefitAdjustment | undefined {
  if (slide.layoutId !== undefined) return undefined;
  if (!isElementVisible(element)) return undefined;
  if (!element.text.trim()) return undefined;
  if (element.frame.width <= 0 || element.frame.height <= 0) return undefined;
  if ((element.style.verticalAlign ?? "top") !== "top") return undefined;
  const availablePt = element.frame.height / EMU_PER_PT;
  const neededPt = neededHeightPt(element, element.style.fontSizePt);
  if (neededPt <= availablePt * OVERFLOW_TOLERANCE) return undefined;
  const roomPt = growthLimitPt(slide, element, pageHeight);
  if (neededPt - availablePt > roomPt) return undefined;
  // One point of slack: the measurement and the renderer may differ by a rounding
  // sliver, and a frame that is one point short would still show a warning edge.
  const grownPt = neededPt * 1.01 - availablePt;
  element.frame = {
    ...element.frame,
    height: Math.ceil((availablePt + grownPt) * EMU_PER_PT) as Emu,
  };
  return { elementId: element.id, kind: "grew-frame", fontSizePt: element.style.fontSizePt, grownPt };
}

/**
 * A short run of copy with no sentence punctuation: a metric value ("260 家"), a
 * step label, a card heading. Such a text is meant to sit on one line, so its
 * group may give up more size than a paragraph would before the narrow frame is
 * blamed instead.
 */
function isShortRun(element: TextElement): boolean {
  const compact = element.text.replace(/\s/g, "");
  return compact.length > 0 && compact.length <= 12 && !/[。，；：、！？!?,;:]/.test(element.text);
}

/**
 * Steps a whole size group down until no paragraph ends on a stranded line.
 *
 * A page's texts that share a size form one group: the body points of a list, the
 * two columns of a comparison, a row of cards. Shrinking one member alone to fix
 * its tail would leave two sizes inside one list, which is a worse defect than
 * the tail it fixes, so the group gives up the point together. A step is only
 * taken when it actually removes the strand — a size that is smaller and still
 * stranded helps nobody. Paragraphs stop after two points; a group of short runs
 * may step further, because a value or a label is meant to fit on one line and
 * its frame is what has to give.
 */
function repairStrandedLines(slide: Slide, record: (adjustment: TextRefitAdjustment) => void): void {
  const groups = new Map<number, TextElement[]>();
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    if (!isElementVisible(element)) continue;
    if (!element.text.trim()) continue;
    if (element.frame.width <= 0) continue;
    // A title is set by its own fitting rule (and a cover's two-line break is a
    // deliberate display choice); the audit still reports a title that strands,
    // but the refit does not quietly resize the page's headline.
    if (element.contentRef === "title") continue;
    const size = element.style.fontSizePt;
    const members = groups.get(size);
    if (members) members.push(element);
    else groups.set(size, [element]);
  }
  const strands = (members: readonly TextElement[], size: number): number =>
    members.filter((element) =>
      endsInOrphan(
        element.text,
        element.frame.width / EMU_PER_PT,
        size,
        element.style.fontFamily,
        3,
        runMetricsOf(element),
      ),
    ).length;
  for (const [designedPt, members] of groups) {
    const current = strands(members, designedPt);
    if (current === 0) continue;
    const allowancePt = members.every(isShortRun)
      ? Math.max(STRAND_ALLOWANCE_PT, Math.round(designedPt * STRAND_SHORT_RUN_PORTION))
      : Math.max(STRAND_ALLOWANCE_PT, Math.round(designedPt * STRAND_PARAGRAPH_PORTION));
    const floor = Math.max(MINIMUM_PT, Math.round(designedPt - allowancePt));
    // The largest size that clears every strand, or — when one member simply
    // cannot be balanced in its frame — the size that leaves the fewest.
    let chosen: number | undefined;
    let chosenCount = current;
    for (let candidate = Math.round(designedPt) - 1; candidate >= floor; candidate -= 1) {
      const count = strands(members, candidate);
      if (count === 0) {
        chosen = candidate;
        break;
      }
      if (count < chosenCount) {
        chosen = candidate;
        chosenCount = count;
      }
    }
    if (chosen === undefined) continue;
    for (const element of members) {
      element.style = { ...element.style, fontSizePt: chosen };
      record({ elementId: element.id, kind: "shrank-type", fontSizePt: chosen, grownPt: 0 });
    }
  }
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
