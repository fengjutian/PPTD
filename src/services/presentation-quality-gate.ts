import type { AiSlideDesign, AiNormalizedRect } from "../core/commands/commands";
import type { PresentationDocument, RectEmu, Slide, TextElement } from "../core/document-model";
import { contrastRatio } from "../core/rendering/contrast";
import { estimateTextLines, textLikelyOverflows } from "../core/rendering/text-fit";

export type PresentationQualityIssueKind = "out-of-bounds" | "text-overlap" | "obstacle-overlap" | "low-contrast" | "text-overflow" | "underfilled-columns";
export interface PresentationQualityIssue { slideIndex: number; elementIds: string[]; issue: PresentationQualityIssueKind; message: string }
export interface PresentationQualityReport { passed: boolean; issues: PresentationQualityIssue[] }

const intersects = (left: AiNormalizedRect, right: AiNormalizedRect): boolean => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
const normalized = (frame: RectEmu, pageWidth: number, pageHeight: number): AiNormalizedRect => ({ x: frame.x / pageWidth, y: frame.y / pageHeight, width: frame.width / pageWidth, height: frame.height / pageHeight });
const contains = (outer: AiNormalizedRect, inner: AiNormalizedRect): boolean => outer.x <= inner.x + 0.001 && outer.y <= inner.y + 0.001 && outer.x + outer.width >= inner.x + inner.width - 0.001 && outer.y + outer.height >= inner.y + inner.height - 0.001;

/**
 * Height the canvas actually paints, not the height of the frame. Split text is
 * centered inside its column, so a tall frame with a short paragraph can still
 * leave most of the page empty.
 */
function renderedTextHeight(element: TextElement, pageHeight: number): number {
  const widthPt = element.frame.width / 12_700;
  const heightPt = estimateTextLines(element.text, widthPt, element.style.fontSizePt) * element.style.fontSizePt * 1.25;
  return (heightPt * 12_700) / pageHeight;
}

/**
 * The background that actually carries a text element: the topmost shape below it
 * that covers its box. Cards and local scrims change the readable contrast, so
 * judging every text against the page background reports false failures.
 */
function carryingBackground(slide: Slide, elementIndex: number, region: AiNormalizedRect, pageWidth: number, pageHeight: number): string | undefined {
  let result: string | undefined;
  slide.elements.forEach((candidate, candidateIndex) => {
    if (candidateIndex >= elementIndex || candidate.type !== "shape") return;
    if (!contains(normalized(candidate.frame, pageWidth, pageHeight), region)) return;
    result = candidate.style.fill;
  });
  return result;
}

/** A full page template artwork hides the page color; pixel inspection owns that case. */
function hasFullPageArtwork(slide: Slide, elementIndex: number, pageWidth: number, pageHeight: number): boolean {
  return slide.elements.some((candidate, candidateIndex) => candidateIndex < elementIndex
    && candidate.type === "image"
    && candidate.frame.width >= pageWidth * 0.98
    && candidate.frame.height >= pageHeight * 0.98);
}

/** Deterministic final gate; no AI score can override these observable failures. */
export function validatePresentationVisualQuality(document: PresentationDocument, designs: AiSlideDesign[]): PresentationQualityReport {
  const issues: PresentationQualityIssue[] = [];
  document.slides.forEach((slide, slideIndex) => {
    const design = designs[slideIndex];
    const obstacles = design?.obstacleRegions ?? [];
    const texts = slide.elements.filter((element): element is TextElement => element.type === "text");
    slide.elements.forEach((element, elementIndex) => {
      if (element.type !== "text") return;
      const region = normalized(element.frame, document.pageSize.width, document.pageSize.height);
      if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.0001 || region.y + region.height > 1.0001) issues.push({ slideIndex, elementIds: [element.id], issue: "out-of-bounds", message: "文本框超出页面边界" });
      if (obstacles.some((obstacle) => intersects(region, obstacle))) issues.push({ slideIndex, elementIds: [element.id], issue: "obstacle-overlap", message: "文本覆盖 Logo、页脚或复杂背景区域" });
      if (textLikelyOverflows(element)) issues.push({ slideIndex, elementIds: [element.id], issue: "text-overflow", message: "文本容量超过文本框可用空间" });
      const shapeBackground = carryingBackground(slide, elementIndex, region, document.pageSize.width, document.pageSize.height);
      // Rendered template artwork is sampled from real pixels by the visual
      // inspector, so the deterministic gate must not guess its color.
      if (!shapeBackground && hasFullPageArtwork(slide, elementIndex, document.pageSize.width, document.pageSize.height)) return;
      const background = shapeBackground ?? slide.background;
      const ratio = contrastRatio(element.style.color, background);
      if (ratio !== undefined && ratio < (element.style.fontSizePt >= 24 || element.style.bold ? 3 : 4.5)) issues.push({ slideIndex, elementIds: [element.id], issue: "low-contrast", message: "文字与承载背景的对比度不足" });
    });
    for (let leftIndex = 0; leftIndex < texts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < texts.length; rightIndex += 1) {
        const left = texts[leftIndex]!; const right = texts[rightIndex]!;
        if (intersects(normalized(left.frame, document.pageSize.width, document.pageSize.height), normalized(right.frame, document.pageSize.width, document.pageSize.height))) issues.push({ slideIndex, elementIds: [left.id, right.id], issue: "text-overlap", message: "两个文本框发生可见重叠" });
      }
    }
    // A split page with two tall columns can still look empty when the copy is
    // short: the frames reserve the full column but the painted text stops in
    // the upper half. Detect that composition instead of accepting it because
    // every individual text box fits.
    const splitColumns = texts.filter((element) => element.contentRef !== "title"
      && element.style.fontSizePt >= 14
      && element.frame.width >= document.pageSize.width * 0.18
      && element.frame.width <= document.pageSize.width * 0.45
      && element.frame.height >= document.pageSize.height * 0.08);
    if (design?.layout === "split" && splitColumns.length === 2) {
      const textHeights = splitColumns.map((element) => renderedTextHeight(element, document.pageSize.height));
      const maxBottom = Math.max(...splitColumns.map((element, index) => element.frame.y / document.pageSize.height + textHeights[index]!));
      if (maxBottom < 0.64 && Math.max(...textHeights) < 0.18) {
        issues.push({ slideIndex, elementIds: splitColumns.map((element) => element.id), issue: "underfilled-columns", message: "双栏正文只占页面上半部，下方连续空白超过三分之一" });
      }
    }
  });
  return { passed: issues.length === 0, issues };
}
