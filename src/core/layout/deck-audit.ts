import { isElementVisible, type PresentationDocument, type TextElement } from "../document-model";

/**
 * The consistency a deck owes across its pages, as a deterministic read.
 *
 * A single page can be perfect and the deck still look wrong: the title of page
 * five sits a hair to the right of the other seven, or one page's footer drifted
 * two points down. No per-page check can see that, and the repairs that move a
 * group of elements (alignment, whitespace, region fixes) are exactly the
 * operations that can push one page out of step with its siblings.
 *
 * Only invariants a deck really holds are checked, and only between pages that
 * set the **same band**: pages whose title frame has the same width must share
 * its left edge, and footers of the same size must share a baseline. A cover, a
 * pull quote or a closing page uses a different band on purpose, so it is not
 * compared with the body pages; pages bound to a template layout keep the
 * template's geometry and are left out entirely.
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

/** How far a title axis may sit from its band's axis before it counts as drift. */
const TITLE_AXIS_TOLERANCE = 0.008;
/** The same for a footer baseline, in page heights; a footer is a hairline of a thing. */
const FOOTER_TOLERANCE = 0.004;
/** Copy at or below this size on the last tenth of a page reads as a footer. */
const FOOTER_MAX_SIZE_PT = 13;
/** How many pages a band needs before a majority is meaningful. */
const MINIMUM_PAGES = 3;
/** Title frames within this share of a page width count as the same band. */
const BAND_WIDTH = 0.005;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

interface Sample {
  slideIndex: number;
  element: TextElement;
  value: number;
}

/**
 * Reports the pages of one band that do not match the band's own axis.
 *
 * A band is a set of pages that place the same kind of text in the same geometry:
 * the body pages of a deck share one title band, and their footers share one
 * baseline. Comparing a cover's display title with a content title would report a
 * design decision as a defect, so the comparison never crosses a band.
 */
function checkBand(
  samples: readonly Sample[],
  bandOf: (sample: Sample) => string,
  tolerance: number,
  kind: DeckAuditKind,
  label: string,
): DeckAuditIssue[] {
  const bands = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = bandOf(sample);
    const members = bands.get(key);
    if (members) members.push(sample);
    else bands.set(key, [sample]);
  }
  const issues: DeckAuditIssue[] = [];
  for (const members of bands.values()) {
    if (members.length < MINIMUM_PAGES) continue;
    const axis = median(members.map((sample) => sample.value));
    for (const sample of members) {
      if (Math.abs(sample.value - axis) <= tolerance) continue;
      issues.push({
        slideIndex: sample.slideIndex,
        elementIds: [sample.element.id],
        kind,
        message: `${label}与同版式的其它页不一致（第 ${sample.slideIndex + 1} 页在 ${sample.value.toFixed(
          3,
        )}，其余页在 ${axis.toFixed(3)}）`,
      });
    }
  }
  return issues.sort((left, right) => left.slideIndex - right.slideIndex);
}

/**
 * Every cross-page inconsistency of the document, in page order.
 *
 * Hidden objects are skipped (they are not on the page), and pages bound to a
 * template layout are left out: their geometry belongs to the template.
 */
export function auditDeckLayout(document: PresentationDocument): DeckAuditReport {
  const pageWidth = document.pageSize.width;
  const pageHeight = document.pageSize.height;
  if (pageWidth <= 0 || pageHeight <= 0) return { issues: [] };

  const titles: Sample[] = [];
  const footers: Sample[] = [];
  document.slides.forEach((slide, slideIndex) => {
    if (slide.layoutId !== undefined) return;
    for (const element of slide.elements) {
      if (element.type !== "text") continue;
      if (!isElementVisible(element)) continue;
      if (!element.text.trim()) continue;
      const footerBand = element.frame.y >= pageHeight * 0.85;
      if (element.contentRef === "title" && !footerBand) {
        // Centred and right-aligned titles are placed on their own axis by design.
        if ((element.style.align ?? "left") === "left") {
          titles.push({ slideIndex, element, value: element.frame.x / pageWidth });
        }
      }
      if (element.style.fontSizePt <= FOOTER_MAX_SIZE_PT && footerBand) {
        footers.push({ slideIndex, element, value: element.frame.y / pageHeight });
      }
    }
  });

  return {
    issues: [
      ...checkBand(
        titles,
        (sample) => (Math.round(sample.element.frame.width / pageWidth / BAND_WIDTH) * BAND_WIDTH).toFixed(3),
        TITLE_AXIS_TOLERANCE,
        "title-axis-drift",
        "标题轴",
      ),
      ...checkBand(
        footers,
        (sample) => `${sample.element.style.fontSizePt}`,
        FOOTER_TOLERANCE,
        "footer-drift",
        "页脚基线",
      ),
    ],
  };
}
