import type { AiSlideDesign, AiNormalizedRect } from "../core/commands/commands";
import type { PresentationDocument, RectEmu, TextElement } from "../core/document-model";

export type PresentationQualityIssueKind = "out-of-bounds" | "text-overlap" | "obstacle-overlap" | "low-contrast" | "text-overflow";
export interface PresentationQualityIssue { slideIndex: number; elementIds: string[]; issue: PresentationQualityIssueKind; message: string }
export interface PresentationQualityReport { passed: boolean; issues: PresentationQualityIssue[] }

const intersects = (left: AiNormalizedRect, right: AiNormalizedRect): boolean => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
const normalized = (frame: RectEmu, pageWidth: number, pageHeight: number): AiNormalizedRect => ({ x: frame.x / pageWidth, y: frame.y / pageHeight, width: frame.width / pageWidth, height: frame.height / pageHeight });
const rgb = (hex: string): [number, number, number] | undefined => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const luminance = (hex: string): number | undefined => {
  const value = rgb(hex);
  if (!value) return undefined;
  const channels = value.map((channel) => { const normalizedChannel = channel / 255; return normalizedChannel <= 0.03928 ? normalizedChannel / 12.92 : ((normalizedChannel + 0.055) / 1.055) ** 2.4; });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
};
const contrastRatio = (foreground: string, background: string): number | undefined => {
  const first = luminance(foreground); const second = luminance(background);
  if (first === undefined || second === undefined) return undefined;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};
const likelyOverflows = (element: TextElement): boolean => {
  const widthPt = element.frame.width / 12_700; const heightPt = element.frame.height / 12_700;
  const unitsPerLine = Math.max(1, widthPt / (element.style.fontSizePt * 0.92));
  const lines = element.text.split("\n").reduce((total, paragraph) => total + Math.max(1, Math.ceil([...paragraph].reduce((sum, character) => sum + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1), 0) / unitsPerLine)), 0);
  return lines * element.style.fontSizePt * 1.2 > heightPt * 1.08;
};

/** Deterministic final gate; no AI score can override these observable failures. */
export function validatePresentationVisualQuality(document: PresentationDocument, designs: AiSlideDesign[]): PresentationQualityReport {
  const issues: PresentationQualityIssue[] = [];
  document.slides.forEach((slide, slideIndex) => {
    const design = designs[slideIndex];
    const obstacles = design?.obstacleRegions ?? [];
    const texts = slide.elements.filter((element): element is TextElement => element.type === "text");
    for (const element of texts) {
      const region = normalized(element.frame, document.pageSize.width, document.pageSize.height);
      if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.0001 || region.y + region.height > 1.0001) issues.push({ slideIndex, elementIds: [element.id], issue: "out-of-bounds", message: "文本框超出页面边界" });
      if (obstacles.some((obstacle) => intersects(region, obstacle))) issues.push({ slideIndex, elementIds: [element.id], issue: "obstacle-overlap", message: "文本覆盖 Logo、页脚或复杂背景区域" });
      if (likelyOverflows(element)) issues.push({ slideIndex, elementIds: [element.id], issue: "text-overflow", message: "文本容量超过文本框可用空间" });
      const background = design?.backgroundTreatment === "content-panel" ? "#F7F8FA" : slide.background;
      const ratio = contrastRatio(element.style.color, background);
      if (ratio !== undefined && ratio < (element.style.fontSizePt >= 24 || element.style.bold ? 3 : 4.5)) issues.push({ slideIndex, elementIds: [element.id], issue: "low-contrast", message: "文字与承载背景的对比度不足" });
    }
    for (let leftIndex = 0; leftIndex < texts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < texts.length; rightIndex += 1) {
        const left = texts[leftIndex]!; const right = texts[rightIndex]!;
        if (intersects(normalized(left.frame, document.pageSize.width, document.pageSize.height), normalized(right.frame, document.pageSize.width, document.pageSize.height))) issues.push({ slideIndex, elementIds: [left.id, right.id], issue: "text-overlap", message: "两个文本框发生可见重叠" });
      }
    }
  });
  return { passed: issues.length === 0, issues };
}
