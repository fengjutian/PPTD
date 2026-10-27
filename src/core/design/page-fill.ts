import type { PresentationDocument, SlideElement } from "../document-model";
import type { AiSlideDesign } from "../commands/template-layouts";
import { textInkBox } from "../rendering/text-fit";

/**
 * How much of a page the reader actually sees.
 *
 * A frame is not ink: a 17pt paragraph can sit in a half-page text box and
 * leave the rest of the page empty. The deterministic layout audit measures
 * overflow and overlap, so a page that simply stops early used to pass every
 * check. This module measures the painted area instead, which is what makes a
 * page look unfinished on the contact sheet.
 */

/** Sampling resolution; fine enough for a 16:9 page without reading pixels. */
const COLUMNS = 80;
const ROWS = 45;

/**
 * A shape this large is a page field (background, plate, full-bleed panel),
 * not content. Counting it would report every dark page as 100% full.
 */
const BACKGROUND_AREA = 0.5;

/** Footers live below the content region and must not rescue an empty page. */
const FOOTER_TOP = 0.9;

/** A badge, icon or dot this small is a marker, not a visual anchor. */
const ANCHOR_AREA = 0.04;
/** A number this large is a focal element even without a picture. */
const ANCHOR_FONT_PT = 32;

/** Pages whose layout is allowed to be sparse by design. */
const SPARSE_LAYOUTS = new Set<AiSlideDesign["layout"]>(["cover", "section", "quote"]);

export interface SlideFill {
  /** Share of the page covered by visible content, 0–1. */
  coverage: number;
  /** Whether the page carries a non-text focal object. */
  hasVisualAnchor: boolean;
  /** False for covers, section pages and quotes, which may stay sparse. */
  contentPage: boolean;
}

export interface DeckFill {
  slides: SlideFill[];
  /** Mean coverage across content pages, 0–1. */
  contentCoverage: number;
  /** Share of content pages that carry a visual anchor, 0–1. */
  anchorRatio: number;
  /** Content pages below the severe-underfill threshold. */
  underfilledPages: number[];
}

function isBackground(element: SlideElement, pageArea: number): boolean {
  if (element.type === "image" && element.placement === "layout-background") return true;
  return (element.frame.width * element.frame.height) / pageArea >= BACKGROUND_AREA;
}

function isFooter(frame: { y: number; height: number }, pageHeight: number): boolean {
  return frame.y / pageHeight >= FOOTER_TOP;
}

function anchorOf(element: SlideElement, pageArea: number): boolean {
  if (element.hidden === true) return false;
  if (element.type === "image" && element.placement !== "layout-background") return true;
  if (element.type === "chart" || element.type === "table" || element.type === "icon") return true;
  if (element.type === "text" && element.style.fontSizePt >= ANCHOR_FONT_PT) return true;
  if (element.type === "shape" && (element.frame.width * element.frame.height) / pageArea >= ANCHOR_AREA) return true;
  return false;
}

/**
 * Measures the painted area on every page.
 *
 * Text uses its ink box rather than its frame, so a large box with a short
 * paragraph is not counted as full. Overlapping elements are painted into one
 * grid, so a stack of cards is not counted twice.
 */
export function measureDeckFill(document: PresentationDocument, designs: readonly AiSlideDesign[]): DeckFill {
  const pageArea = document.pageSize.width * document.pageSize.height;
  const slides = document.slides.map((slide, index) => {
    const painted = new Uint8Array(COLUMNS * ROWS);
    let hasVisualAnchor = false;
    for (const element of slide.elements) {
      if (element.hidden === true) continue;
      if (isBackground(element, pageArea)) continue;
      if (isFooter(element.frame, document.pageSize.height)) continue;
      if (anchorOf(element, pageArea)) hasVisualAnchor = true;
      const frame = element.type === "text" ? textInkBox(element) : element.frame;
      const left = Math.max(0, Math.floor((frame.x / document.pageSize.width) * COLUMNS));
      const top = Math.max(0, Math.floor((frame.y / document.pageSize.height) * ROWS));
      const right = Math.min(COLUMNS - 1, Math.floor(((frame.x + frame.width) / document.pageSize.width) * COLUMNS));
      const bottom = Math.min(ROWS - 1, Math.floor(((frame.y + frame.height) / document.pageSize.height) * ROWS));
      if (right < left || bottom < top) continue;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) painted[y * COLUMNS + x] = 1;
      }
    }
    const coverage = painted.reduce((sum, value) => sum + value, 0) / painted.length;
    const layout = designs[index]?.layout;
    return { coverage, hasVisualAnchor, contentPage: !SPARSE_LAYOUTS.has(layout ?? "title-body") };
  });

  const contentSlides = slides.filter((slide) => slide.contentPage);
  const contentCoverage =
    contentSlides.length === 0
      ? 1
      : contentSlides.reduce((sum, slide) => sum + slide.coverage, 0) / contentSlides.length;
  const anchorRatio =
    contentSlides.length === 0
      ? 1
      : contentSlides.filter((slide) => slide.hasVisualAnchor).length / contentSlides.length;
  const underfilledPages = slides.flatMap((slide, index) => (slide.contentPage && slide.coverage < 0.1 ? [index] : []));
  return { slides, contentCoverage, anchorRatio, underfilledPages };
}
