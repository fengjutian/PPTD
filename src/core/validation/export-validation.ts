import { EMU_PER_INCH, type PresentationDocument, type SlideElement } from "../document-model";
import { textLikelyOverflows } from "../rendering/text-fit";

export type ExportIssueCode =
  | "content-not-approved"
  | "out-of-bounds"
  | "text-overflow"
  | "missing-font"
  | "unsupported-image-source"
  | "empty-slide"
  | "missing-alt-text"
  | "duplicate-id";

export type ExportIssueSeverity = "error" | "warning";

export interface ExportIssue {
  code: ExportIssueCode;
  severity: ExportIssueSeverity;
  message: string;
  slideIndex: number;
  elementId?: string;
}

export interface ExportValidationOptions {
  /** Returns whether a font family is available in the target environment. */
  fontAvailable?: (fontFamily: string) => boolean | Promise<boolean>;
}

const TOLERANCE_EMU = 1_000;

function frameOutsidePage(element: SlideElement, document: PresentationDocument): boolean {
  const { frame } = element;
  return (
    frame.x < -TOLERANCE_EMU ||
    frame.y < -TOLERANCE_EMU ||
    frame.x + frame.width > document.pageSize.width + TOLERANCE_EMU ||
    frame.y + frame.height > document.pageSize.height + TOLERANCE_EMU
  );
}

/**
 * Pure preflight used by export and by any caller that needs a snapshot-level
 * check. It never mutates the document and never depends on PptxGenJS.
 */
export async function validatePresentationForExport(
  document: PresentationDocument,
  options: ExportValidationOptions = {},
): Promise<ExportIssue[]> {
  const issues: ExportIssue[] = [];
  const seenIds = new Set<string>();
  const fontCache = new Map<string, boolean>();

  for (const [slideIndex, slide] of document.slides.entries()) {
    if (slide.elements.length === 0) {
      issues.push({ code: "empty-slide", severity: "warning", message: `第 ${slideIndex + 1} 页没有可导出对象`, slideIndex });
    }
    if (slide.content.status !== "approved") {
      issues.push({
        code: "content-not-approved",
        severity: "warning",
        message: `第 ${slideIndex + 1} 页内容状态为 ${slide.content.status}，尚未完成审核`,
        slideIndex,
      });
    }

    for (const element of slide.elements) {
      if (seenIds.has(element.id)) {
        issues.push({ code: "duplicate-id", severity: "error", message: "文档中存在重复的元素 ID", slideIndex, elementId: element.id });
      }
      seenIds.add(element.id);

      if (frameOutsidePage(element, document)) {
        issues.push({
          code: "out-of-bounds",
          severity: "warning",
          message: `第 ${slideIndex + 1} 页存在超出页面边界的对象`,
          slideIndex,
          elementId: element.id,
        });
      }

      if (element.type === "text") {
        if (textLikelyOverflows(element)) {
          issues.push({
            code: "text-overflow",
            severity: "warning",
            message: `第 ${slideIndex + 1} 页文本框可能溢出`,
            slideIndex,
            elementId: element.id,
          });
        }
        if (options.fontAvailable) {
          let available = fontCache.get(element.style.fontFamily);
          if (available === undefined) {
            available = await options.fontAvailable(element.style.fontFamily);
            fontCache.set(element.style.fontFamily, available);
          }
          if (!available) {
            issues.push({
              code: "missing-font",
              severity: "warning",
              message: `字体“${element.style.fontFamily}”不可用，导出时将依赖查看端替代字体`,
              slideIndex,
              elementId: element.id,
            });
          }
        }
      }

      if (element.type === "image") {
        if (!element.source.dataUrl.startsWith("data:image/")) {
          issues.push({
            code: "unsupported-image-source",
            severity: "error",
            message: "图片不是内嵌 data URL，无法保证导出后仍可访问",
            slideIndex,
            elementId: element.id,
          });
        }
        if (!element.altText.trim()) {
          issues.push({
            code: "missing-alt-text",
            severity: "warning",
            message: "图片缺少替代文本，影响可访问性",
            slideIndex,
            elementId: element.id,
          });
        }
      }
    }
  }

  return issues;
}

/** Browser-only default font probe; returns true when the platform exposes no font API. */
export async function isFontAvailable(fontFamily: string): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts) return true;
  try {
    return document.fonts.check(`12px "${fontFamily.replace(/"/g, '\\"')}"`);
  } catch {
    return true;
  }
}

export const EMU_PER_INCH_VALUE = EMU_PER_INCH;
