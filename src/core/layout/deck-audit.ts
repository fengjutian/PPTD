import { isElementVisible, type PresentationDocument, type TextElement } from "../document-model";

/**
 * The consistency a deck owes across its pages, as a deterministic read.
 *
 * A single page can be perfect and the deck still look wrong: the title of page
 * five sits a hair to the right of the other seven, or one page's footer drifted
 * two points down. No per-page check can see that, and repairs that move a group
 * of elements (alignment, whitespace, region fixes) are exactly the operations
 * that can push one page out of step with its siblings.
 *
 * Only invariants that a deck really holds are checked here: a left-aligned title
 * axis and the footer baseline. Centred and right-aligned titles are statement
 * layouts (a cover, a pull quote) and are not compared, and pages bound to a
 * template layout keep the template's geometry instead of the deck's.
 */
export type DeckAuditKind = "title-axis-drift" | "footer-drift";

export interface DeckAuditIssue {
  /** The page that does not match the rest of the deck. */
  slideIndex: number;
  elementIds: string[];
  kind: DeckAuditKind;
  message: string;
}

export interface DeckAuditReport {
  issues: DeckAuditIssue[];
}

/** How far a title axis may sit from the deck's own axis before it counts as drift. */
const TITLE_AXIS_TOLERANCE = 0.008;
/** The same for a footer baseline, in page heights; a footer is a hairline of a thing. */
const FOOTER_TOLERANCE = 0.004;
/** Copy at or below this size on the last tenth of a page reads as a footer. */
const FOOTER_MAX_SIZE_PT = 13;
/** How many pages an invariant needs before a majority is meaningful. */
const MINIMUM_PAGES = 3;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Every cross-page inconsistency of the document, in page order.
 *
 * Hidden objects are skipped (they are not on the page), and pages bound to a
 * template layout are left out entirely: their geometry belongs to the template.
 */
export function auditDeckLayout(document: PresentationDocument): DeckAuditReport {
  const pageWidth = document.pageSize.width;
  const pageHeight = document.pageSize.height;
  if (pageWidth <= 0 || pageHeight <= 0) return { issues: [] };
  const issues: DeckAuditIssue[] = [];

  interface Sample {
    slideIndex: number;
    element: TextElement;
    value: number;
  }
  const titles: Sample[] = [];
  const footers: Sample[] = [];
  document.slides.forEach((slide, slideIndex) => {
    if (slide.layoutId !== undefined) return;
    for (const element of slide.elements) {
      if (element.type !== "text") continue;
      if (!isElementVisible(element)) continue;
      if (!element.text.trim()) continue;
      if (element.contentRef === "title") {
        // Centred and right-aligned titles are placed on their own axis by design.
        const align = element.style.align ?? "left";
        if (align === "left") titles.push({ slideIndex, element, value: element.frame.x / pageWidth });
      }
      if (element.style.fontSizePt <= FOOTER_MAX_SIZE_PT && element.frame.y >= pageHeight * 0.85) {
        footers.push({ slideIndex, element, value: element.frame.y / pageHeight });
      }
    }
  });

  const check = (samples: Sample[], tolerance: number, kind: DeckAuditKind, label: string): void => {
    if (samples.length < MINIMUM_PAGES) return;
    const axis = median(samples.map((sample) => sample.value));
    for (const sample of samples) {
      if (Math.abs(sample.value - axis) <= tolerance) continue;
      issues.push({
        slideIndex: sample.slideIndex,
        elementIds: [sample.element.id],
        kind,
        message: `${label}与多数页不一致（第 ${sample.slideIndex + 1} 页在 ${sample.value.toFixed(
          3,
        )}，其余页在 ${axis.toFixed(3)}）`,
      });
    }
  };

  check(titles, TITLE_AXIS_TOLERANCE, "title-axis-drift", "标题轴");
  check(footers, FOOTER_TOLERANCE, "footer-drift", "页脚基线");
  return { issues };
}
