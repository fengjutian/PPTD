import type { AiSlideDesign } from "../core/commands";
import type { PresentationDocument, SlideElement, TextElement } from "../core/document-model";
import { textInkBox } from "../core/rendering/text-fit";
import type { GeneratedVisualAsset } from "./ai-visual-asset";

export interface AestheticDimensions {
  hierarchy: number;
  balance: number;
  rhythm: number;
  homogeneity: number;
  imageRelevance: number;
}

export interface AestheticScore {
  overall: number;
  dimensions: AestheticDimensions;
  issues: string[];
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

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
    const centerPenalty = Math.abs(centerX - 0.5) * 90 + Math.max(0, Math.abs(centerY - 0.48) - 0.08) * 70;
    const edgePenalty = elements.filter(
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
  const titleAxes = document.slides
    .map((slide) => slide.elements.find((element) => element.type === "text" && element.contentRef === "title"))
    .filter((element): element is TextElement => Boolean(element))
    .map((element) => Math.round((element.frame.x / document.pageSize.width) * 20));
  const axisCount = new Set(titleAxes).size;
  return clamp(100 - repeated * 9 - Math.max(0, longestRun - 2) * 12 - (axisCount === 1 ? 6 : 0));
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
  if (requested.length === 0) return 85;
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

export function scorePresentationAesthetics(input: {
  document: PresentationDocument;
  designs: readonly AiSlideDesign[];
  assets?: readonly GeneratedVisualAsset[];
  homogeneity?: number;
}): AestheticScore {
  const dimensions: AestheticDimensions = {
    hierarchy: clamp(hierarchyScore(input.document)),
    balance: clamp(balanceScore(input.document)),
    rhythm: rhythmScore(input.document, input.designs),
    homogeneity: clamp(input.homogeneity ?? 80),
    imageRelevance: imageRelevanceScore(input.document, input.designs, input.assets ?? []),
  };
  const overall = clamp(
    dimensions.hierarchy * 0.25 +
      dimensions.balance * 0.22 +
      dimensions.rhythm * 0.2 +
      dimensions.homogeneity * 0.16 +
      dimensions.imageRelevance * 0.17,
  );
  const issues = Object.entries(dimensions).flatMap(([name, score]) =>
    score < 55 ? [`AESTHETIC_${name.replace(/[A-Z]/g, (value) => `_${value}`).toUpperCase()}_LOW`] : [],
  );
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
  const reasons = [...score.issues];
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
