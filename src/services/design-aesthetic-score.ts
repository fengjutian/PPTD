import type { AiSlideDesign } from "../core/commands";
import type { PresentationDocument, SlideElement, TextElement } from "../core/document-model";
import { textInkBox } from "../core/rendering/text-fit";
import { measureDeckFill } from "../core/design/page-fill";
import type { GeneratedVisualAsset } from "./ai-visual-asset";

export interface AestheticDimensions {
  hierarchy: number;
  balance: number;
  rhythm: number;
  homogeneity: number;
  imageRelevance: number;
  /** How much of each content page is actually painted. */
  coverage: number;
  /** How often a page carries a picture, chart, table, icon or large number. */
  visualAnchor: number;
}

export interface AestheticScore {
  overall: number;
  dimensions: AestheticDimensions;
  issues: string[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Below this share of painted area a content page reads as a caption on a
 * blank sheet. The target is deliberately conservative: a text page with a
 * title, three points and a rule lands around 0.18–0.25.
 */
const COVERAGE_FLOOR = 0.08;
const COVERAGE_TARGET = 0.26;

function visible(element: SlideElement): boolean {
  return element.hidden !== true && element.frame.width > 0 && element.frame.height > 0;
}

function hierarchyScore(document: PresentationDocument): number {
  const scores = document.slides.map((slide) => {
    const title = slide.elements.find(
      (element): element is TextElement => element.type === "text" && element.contentRef === "title",
    );
    const body = slide.elements.filter(
      (element): element is TextElement => element.type === "text" && element.contentRef !== "title",
    );
    if (!title) return 30;
    const bodySize = body.length > 0 ? Math.max(...body.map((element) => element.style.fontSizePt)) : 16;
    const ratio = title.style.fontSizePt / Math.max(1, bodySize);
    let score = 72 + Math.min(22, Math.max(-30, (ratio - 1.35) * 35));
    if (!title.style.bold && ratio < 1.6) score -= 12;
    if (title.frame.y / document.pageSize.height > 0.42) score -= 18;
    return clamp(score);
  });
  return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

/**
 * Balance without punishing composition.
 *
 * The old score pulled every page toward the geometric centre. Editorial
 * layouts put the weight on one side on purpose, so they lost points for being
 * well composed. Only a page whose content has drifted into an edge — or whose
 * centre of mass sits in the top or bottom sliver — is now treated as
 * unbalanced.
 */
function balanceScore(document: PresentationDocument): number {
  const scores = document.slides.map((slide) => {
    const elements = slide.elements.filter(visible);
    if (elements.length === 0) return 0;
    let weightedX = 0;
    let weightedY = 0;
    let weight = 0;
    for (const element of elements) {
      const area = Math.min(
        0.18,
        (element.frame.width * element.frame.height) / (document.pageSize.width * document.pageSize.height),
      );
      weightedX += ((element.frame.x + element.frame.width / 2) / document.pageSize.width) * area;
      weightedY += ((element.frame.y + element.frame.height / 2) / document.pageSize.height) * area;
      weight += area;
    }
    const centerX = weightedX / Math.max(weight, 0.001);
    const centerY = weightedY / Math.max(weight, 0.001);
    const driftX = Math.max(0, Math.abs(centerX - 0.5) - 0.22);
    const driftY = Math.max(0, Math.abs(centerY - 0.48) - 0.26);
    const centerPenalty = driftX * 120 + driftY * 90;
    const edgePenalty =
      elements.filter(
        (element) =>
          element.frame.x < 0 ||
          element.frame.y < 0 ||
          element.frame.x + element.frame.width > document.pageSize.width ||
          element.frame.y + element.frame.height > document.pageSize.height,
      ).length * 30;
    return clamp(100 - centerPenalty - edgePenalty);
  });
  return scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

function rhythmScore(document: PresentationDocument, designs: readonly AiSlideDesign[]): number {
  if (designs.length < 2) return 80;
  let repeated = 0;
  let longestRun = 1;
  let run = 1;
  for (let index = 1; index < designs.length; index += 1) {
    const previous = designs[index - 1]!;
    const current = designs[index]!;
    const same =
      previous.layout === current.layout &&
      previous.recipe === current.recipe &&
      previous.variant === current.variant &&
      previous.visualNarrative === current.visualNarrative;
    if (same) {
      repeated += 1;
      run += 1;
      longestRun = Math.max(longestRun, run);
    } else run = 1;
  }
  // An aligned title axis is a deck-level quality; it must not cost points.
  // Only actual repetition is a rhythm problem.
  return clamp(100 - repeated * 9 - Math.max(0, longestRun - 2) * 12);
}

function tokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function imageRelevanceScore(
  document: PresentationDocument,
  designs: readonly AiSlideDesign[],
  assets: readonly GeneratedVisualAsset[],
): number {
  const requested = designs.flatMap((design, index) => (design.visualAsset?.enabled ? [index] : []));
  // No page asked for a picture. That is a neutral choice, not a pass: the old
  // 85-point floor made a text-only deck outrank one with real images, so the
  // generator learned to skip imagery entirely.
  if (requested.length === 0) return 55;
  const scores = requested.map((index) => {
    const asset = assets.find((candidate) => candidate.slideIndex === index);
    if (!asset || /占位|placeholder/i.test(asset.altText)) return 0;
    const titleTokens = tokens(document.slides[index]?.content.title ?? "");
    const assetTokens = tokens(asset.altText);
    const overlap = [...titleTokens].filter((token) => assetTokens.has(token)).length;
    return clamp(55 + (overlap / Math.max(1, Math.min(titleTokens.size, 12))) * 45);
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/** Candidate similarity is scored separately so colour-only variants cannot all rank highly. */
export function compositionHomogeneity(designs: readonly (readonly AiSlideDesign[])[]): number[] {
  const signatures = designs.map((deck) =>
    deck
      .map((slide) => [slide.layout, slide.recipe ?? "", slide.variant ?? "", slide.visualNarrative ?? ""].join(":"))
      .join("|"),
  );
  return signatures.map((signature, index) => {
    const closest = signatures.reduce((best, other, otherIndex) => {
      if (index === otherIndex) return best;
      const left = signature.split("|");
      const right = other.split("|");
      const same = left.filter((value, slideIndex) => value === right[slideIndex]).length / Math.max(left.length, 1);
      return Math.max(best, same);
    }, 0);
    return clamp(100 - closest * 70);
  });
}

/**
 * Turns measured fill into a score.
 *
 * A page at the floor is unreadable as a composition; a page at the target is
 * full without being crowded. Everything above the target stays at 100 so a
 * deliberately dense page is not punished.
 */
function coverageScore(coverage: number): number {
  return clamp(((coverage - COVERAGE_FLOOR) / (COVERAGE_TARGET - COVERAGE_FLOOR)) * 100);
}

export function scorePresentationAesthetics(input: {
  document: PresentationDocument;
  designs: readonly AiSlideDesign[];
  assets?: readonly GeneratedVisualAsset[];
  homogeneity?: number;
}): AestheticScore {
  const fill = measureDeckFill(input.document, input.designs);
  const dimensions: AestheticDimensions = {
    hierarchy: clamp(hierarchyScore(input.document)),
    balance: clamp(balanceScore(input.document)),
    rhythm: rhythmScore(input.document, input.designs),
    homogeneity: clamp(input.homogeneity ?? 80),
    imageRelevance: imageRelevanceScore(input.document, input.designs, input.assets ?? []),
    coverage: coverageScore(fill.contentCoverage),
    visualAnchor: clamp(40 + fill.anchorRatio * 60),
  };
  const overall = clamp(
    dimensions.hierarchy * 0.2 +
      dimensions.balance * 0.14 +
      dimensions.rhythm * 0.15 +
      dimensions.homogeneity * 0.11 +
      dimensions.imageRelevance * 0.12 +
      dimensions.coverage * 0.18 +
      dimensions.visualAnchor * 0.1,
  );
  const issues = Object.entries(dimensions).flatMap(([name, score]) =>
    score < 55 ? [`AESTHETIC_${name.replace(/[A-Z]/g, (value) => `_${value}`).toUpperCase()}_LOW`] : [],
  );
  if (fill.contentCoverage < COVERAGE_FLOOR) issues.push("AESTHETIC_CONTENT_UNDERFILLED");
  return { overall, dimensions, issues };
}

export function textInkOverlap(document: PresentationDocument, slideIndex: number): boolean {
  const texts = document.slides[slideIndex]?.elements.filter(
    (element): element is TextElement => element.type === "text" && visible(element),
  );
  if (!texts) return false;
  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      const a = textInkBox(texts[left]!);
      const b = textInkBox(texts[right]!);
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (width > 0 && height > 0) return true;
    }
  }
  return false;
}

export function candidateAestheticGate(input: {
  document: PresentationDocument;
  designs: readonly AiSlideDesign[];
  assets?: readonly GeneratedVisualAsset[];
  homogeneity?: number;
}): { passed: boolean; score: AestheticScore; reasons: string[] } {
  const score = scorePresentationAesthetics(input);
  const fill = measureDeckFill(input.document, input.designs);
  const reasons = [...score.issues];
  for (const pageIndex of fill.underfilledPages) {
    // A page this empty is a composition failure, not an airy choice. Naming
    // the page lets the repair loop rebuild that page instead of the deck.
    reasons.push(`SLIDE_UNDERFILLED:${pageIndex}`);
  }
  input.designs.forEach((design, index) => {
    if ((design.layout === "cover" || index === 0) && textInkOverlap(input.document, index)) {
      reasons.push(`COVER_TEXT_OVERLAP:${index}`);
    }
    if (design.visualAsset?.enabled && !input.assets?.some((asset) => asset.slideIndex === index)) {
      reasons.push(`REAL_ASSET_REQUIRED:${index}`);
    }
  });
  if (score.overall < 65) reasons.push("AESTHETIC_SCORE_BELOW_THRESHOLD");
  return { passed: reasons.length === 0, score, reasons };
}
