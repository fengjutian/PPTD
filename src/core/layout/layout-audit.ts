import { isElementVisible, type PresentationDocument, type TextElement } from "../document-model";
import { estimateTextLines, textInkBox } from "../rendering/text-fit";

/**
 * A deterministic read of the geometry a designed page ended up with.
 *
 * The visual review looks at a picture and can miss a text that lost its last
 * line, while the generation gate only knows the checks it was written with.
 * This audit answers the three questions a reader can answer by looking at the
 * page — does the copy fit its frame, does a text stay on the page, do two texts
 * claim the same space — so the preview can report a number it can stand behind
 * instead of announcing a pass it never verified.
 *
 * It reads the document only: no AI, no pixels, no repair. Rendering already
 * shrinks a text that does not fit, the same way the exported `normAutofit`
 * does, so an overflow here is a layout problem to surface, not copy to cut.
 */
export type LayoutAuditKind = "text-overflow" | "out-of-bounds" | "text-overlap";

export interface LayoutAuditIssue {
  slideIndex: number;
  elementIds: string[];
  kind: LayoutAuditKind;
  message: string;
}

export interface LayoutAuditReport {
  issues: LayoutAuditIssue[];
}

/** The share of an overflow that still reads as a rounding difference. */
const OVERFLOW_TOLERANCE = 1.02;
/** The share of the smaller frame two texts must share to count as a collision. */
const OVERLAP_SHARE = 0.12;

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersectionArea(left: Frame, right: Frame): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** The height the copy needs, measured the way the renderer breaks it. */
function textHeightPt(element: TextElement): number {
  const widthPt = element.frame.width / 12_700;
  const lines = estimateTextLines(element.text, widthPt, element.style.fontSizePt, element.style.fontFamily);
  // The renderer defaults to 1.25 when a style never set a leading.
  return lines * element.style.fontSizePt * (element.style.lineHeight ?? 1.25);
}

/**
 * Every measurable layout problem of the document, in page order.
 *
 * Hidden objects are skipped: an editor-only object is not on the page and must
 * not decide whether the page passes.
 */
export function auditSlideLayout(document: PresentationDocument): LayoutAuditReport {
  const issues: LayoutAuditIssue[] = [];
  const pageWidth = document.pageSize.width;
  const pageHeight = document.pageSize.height;
  document.slides.forEach((slide, slideIndex) => {
    const visible = slide.elements.filter(isElementVisible);
    const texts = visible.filter((element): element is TextElement => element.type === "text");

    for (const element of texts) {
      const heightPt = element.frame.height / 12_700;
      const neededPt = textHeightPt(element);
      if (heightPt > 0 && neededPt > heightPt * OVERFLOW_TOLERANCE) {
        issues.push({
          slideIndex,
          elementIds: [element.id],
          kind: "text-overflow",
          message: `文本需要约 ${Math.round(neededPt)}pt 高度，文本框只有 ${Math.round(heightPt)}pt`,
        });
      }
      // Only text is judged against the page edge: a picture or a band that
      // bleeds past it is a composition technique, while a text box that leaves
      // the page loses characters in the file.
      const frame = element.frame;
      if (
        frame.x < -pageWidth * 0.002 ||
        frame.y < -pageHeight * 0.002 ||
        frame.x + frame.width > pageWidth * 1.002 ||
        frame.y + frame.height > pageHeight * 1.002
      ) {
        issues.push({
          slideIndex,
          elementIds: [element.id],
          kind: "out-of-bounds",
          message: "文本框越过页面边界，导出后会被裁切",
        });
      }
    }

    // Ink boxes are measured once per page: the pairwise loop below would
    // otherwise re-break every text once per neighbour.
    const inks = texts.map((element) => textInkBox(element));
    for (let leftIndex = 0; leftIndex < texts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < texts.length; rightIndex += 1) {
        const left = texts[leftIndex]!;
        const right = texts[rightIndex]!;
        // Two frames may share a band (a left section label and a right page
        // number); the ink is what the reader sees, so that is what collides.
        const leftInk = inks[leftIndex]!;
        const rightInk = inks[rightIndex]!;
        const smaller = Math.min(leftInk.width * leftInk.height, rightInk.width * rightInk.height);
        if (smaller <= 0) continue;
        if (intersectionArea(leftInk, rightInk) > smaller * OVERLAP_SHARE) {
          issues.push({
            slideIndex,
            elementIds: [left.id, right.id],
            kind: "text-overlap",
            message: "两个文本框占据同一块空间，读者会看到文字叠在一起",
          });
        }
      }
    }
  });
  return { issues };
}
