import {
  EMU_PER_INCH,
  animationExportsNatively,
  hiddenElementCount,
  isElementVisible,
  resolveChartData,
  resolveTableData,
  type PresentationDocument,
  type SlideElement,
} from "../document-model";
import { contrastRatio, MINIMUM_CONTRAST } from "../rendering/contrast";
import { textLikelyOverflows } from "../rendering/text-fit";

export type ExportIssueCode =
  | "content-not-approved"
  | "out-of-bounds"
  | "text-overflow"
  | "semantic-role-contrast"
  | "missing-font"
  | "unsupported-image-source"
  | "empty-slide"
  | "missing-alt-text"
  | "duplicate-id"
  | "invalid-chart-data"
  | "invalid-table-data"
  | "animation-not-exported"
  | "hidden-not-exported";

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

interface SemanticRoleContrastContract {
  carrierRole: "surface" | "surfaceRaised" | "surfaceSunken" | "accentSubtle" | "accentStrong";
  inkRoles: readonly ("primary" | "textMuted" | "onAccent")[];
}

/**
 * The semantic surfaces that are allowed to carry copy.
 *
 * Lines (`border`/`borderStrong`) do not carry text, so they deliberately do
 * not appear here. Keeping this contract beside export validation means a new
 * recipe cannot rely only on the palette derivation tests: a damaged or
 * hand-authored theme is reported on the actual page that would export it.
 */
export const SEMANTIC_ROLE_CONTRAST_CONTRACTS: readonly SemanticRoleContrastContract[] = [
  { carrierRole: "surface", inkRoles: ["primary", "textMuted"] },
  { carrierRole: "surfaceRaised", inkRoles: ["primary"] },
  { carrierRole: "surfaceSunken", inkRoles: ["primary"] },
  { carrierRole: "accentSubtle", inkRoles: ["primary"] },
  { carrierRole: "accentStrong", inkRoles: ["onAccent"] },
];

function validateSemanticRoleContrast(
  document: PresentationDocument,
  slideIndex: number,
  slideBackground: string,
): ExportIssue[] {
  if (!document.theme) return [];
  const colors = new Map(document.theme.colors.map(({ name, value }) => [name, value]));
  const issues: ExportIssue[] = [];

  for (const contract of SEMANTIC_ROLE_CONTRAST_CONTRACTS) {
    // The page background is the real `surface`; it may be a per-page dark
    // variant and therefore takes precedence over the theme's default slot.
    const carrier = contract.carrierRole === "surface" ? slideBackground : colors.get(contract.carrierRole);
    if (!carrier) continue;
    for (const inkRole of contract.inkRoles) {
      const ink = colors.get(inkRole);
      if (!ink) continue;
      const ratio = contrastRatio(ink, carrier);
      if (ratio !== undefined && ratio < MINIMUM_CONTRAST) {
        issues.push({
          code: "semantic-role-contrast",
          severity: "warning",
          message: `第 ${slideIndex + 1} 页颜色角色 ${contract.carrierRole} 不能承载 ${inkRole}（${ratio.toFixed(2)}:1，至少需要 ${MINIMUM_CONTRAST}:1）`,
          slideIndex,
        });
      }
    }
  }
  return issues;
}

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
    issues.push(...validateSemanticRoleContrast(document, slideIndex, slide.background));
    const hiddenCount = hiddenElementCount(slide);
    if (slide.elements.length - hiddenCount === 0) {
      issues.push({
        code: "empty-slide",
        severity: "warning",
        message: `第 ${slideIndex + 1} 页没有可导出对象`,
        slideIndex,
      });
    }
    if (hiddenCount > 0) {
      // The exporter writes a snapshot without hidden objects. Say it before the
      // file is written instead of letting the report imply nothing was left out.
      issues.push({
        code: "hidden-not-exported",
        severity: "warning",
        message: `第 ${slideIndex + 1} 页有 ${hiddenCount} 个隐藏对象，导出时不会写入 PPTX`,
        slideIndex,
      });
    }
    if (slide.content.status !== "approved") {
      issues.push({
        code: "content-not-approved",
        severity: "warning",
        message: `第 ${slideIndex + 1} 页内容状态为 ${slide.content.status}，尚未完成审核`,
        slideIndex,
      });
    }
    const hiddenIds = new Set(
      slide.elements.filter((element) => !isElementVisible(element)).map((element) => element.id),
    );
    const exportedAnimations = (slide.animations ?? []).filter((animation) => !hiddenIds.has(animation.elementId));
    if (exportedAnimations.length > 0) {
      // Every current effect has a native node; this guard stays for future
      // effects so a new enum value cannot silently disappear at export.
      const unsupported = exportedAnimations.filter((animation) => !animationExportsNatively(animation.effect));
      if (unsupported.length > 0) {
        issues.push({
          code: "animation-not-exported",
          severity: "warning",
          message: `第 ${slideIndex + 1} 页有 ${unsupported.length} 个动画（${unsupported
            .map((animation) => animation.effect)
            .join("、")}）没有原生导出，放映时会直接显示最终画面`,
          slideIndex,
        });
      }
    }

    for (const element of slide.elements) {
      if (seenIds.has(element.id)) {
        issues.push({
          code: "duplicate-id",
          severity: "error",
          message: "文档中存在重复的元素 ID",
          slideIndex,
          elementId: element.id,
        });
      }
      seenIds.add(element.id);
      // Hidden objects never reach the package, so their geometry, fonts and
      // data cannot block or warn about an export they are not part of.
      if (!isElementVisible(element)) continue;

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

      if (element.type === "chart") {
        // A chart without readable numbers would export as an empty chart, and
        // an empty chart in a deck is worse than a missing one.
        if (!resolveChartData(slide, element)) {
          issues.push({
            code: "invalid-chart-data",
            severity: "error",
            message: `第 ${slideIndex + 1} 页图表缺少可用的数值，无法导出`,
            slideIndex,
            elementId: element.id,
          });
        }
      }

      if (element.type === "table") {
        // A table without readable cells would export as an empty grid, and an
        // empty grid in a deck is worse than a missing one.
        const table = resolveTableData(slide, element);
        if (!table) {
          issues.push({
            code: "invalid-table-data",
            severity: "error",
            message: `第 ${slideIndex + 1} 页表格缺少可用的单元格，无法导出`,
            slideIndex,
            elementId: element.id,
          });
        } else if (table.rows.some((row) => row.length > table.header.length)) {
          // The exporter writes one cell per header column; extra cells would
          // disappear silently. Stop before the writer loses their data.
          issues.push({
            code: "invalid-table-data",
            severity: "error",
            message: `第 ${slideIndex + 1} 页表格有整行比表头宽，导出会丢失多出的列`,
            slideIndex,
            elementId: element.id,
          });
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
