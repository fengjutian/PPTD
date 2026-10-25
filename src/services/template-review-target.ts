import type { PresentationDocument } from "../core/document-model";
import type { PresentationVisualGoal, VisualReview } from "./visual-alignment";
import type { TemplateAnalysis, TemplateLayoutSummary, TemplateRegion } from "./project-files";

/**
 * The measurable target a reviewed deck is compared against when the user
 * uploaded a template.
 *
 * A template is already visible in every rendered page, but "visible" is not
 * "measurable": the review model sees pixels, not the title axis, the content
 * margins or the placeholder type size. This target compiles the analysis of
 * the uploaded template into page-normalized geometry and tolerances, so the
 * deterministic check, the review prompt, the repair planner and the report all
 * speak about the same numbers.
 *
 * Coordinates are normalized to 0–1 page space. The compiler never invents a
 * layout: a template without a title or content placeholder simply yields fewer
 * layouts, and pages that do not resolve to one fall back to the deck-wide grid.
 */
export interface TemplateGrid {
  /** Left edge shared by the title and the content placeholder. */
  left: number;
  /** Right edge shared by the title and the content placeholder. */
  right: number;
  /** Top edge of the title placeholder. */
  top: number;
  /** Bottom edge of the content placeholder. */
  bottom: number;
  titleX: number;
  titleY: number;
  titleWidth: number;
  titleHeight: number;
  bodyTop: number;
  bodyBottom: number;
}

export interface TemplateLayoutTarget {
  name: string;
  grid: TemplateGrid;
  titleSizePt?: number;
  bodySizePt?: number;
  /**
   * Cover, section, quote and closing pages are allowed to break the content
   * grid on purpose. Applying the content page axis to them would penalize the
   * template's own composition.
   */
  freeComposition: boolean;
}

export interface TemplateTolerances {
  /** Normalized page-width tolerance for a vertical axis (left/right). */
  axis: number;
  /** Normalized page-height tolerance for a horizontal axis (top/bottom). */
  axisY: number;
  /** Allowed distance outside the content placeholder. */
  margin: number;
  /** Allowed title/body font size difference in points. */
  fontSizePt: number;
}

export interface TemplateReviewTarget {
  name: string;
  page: { widthEmu: number; heightEmu: number };
  /** Deck-wide fallback, built from the content layouts of the template. */
  grid: TemplateGrid;
  layouts: TemplateLayoutTarget[];
  /** Normalized hex values of the template theme, used by the review prompt. */
  palette: string[];
  titleSizePt?: number;
  bodySizePt?: number;
  /** Axis language the review goal should use for this template. */
  alignment: "left-grid" | "centered-grid";
  confidence: "high" | "low";
  minimumFit: number;
  tolerances: TemplateTolerances;
}

export type TemplateFitCode =
  "template-title-axis" | "template-content-bounds" | "template-title-size" | "template-body-size" | "template-palette";

export interface TemplateFitIssue {
  slideIndex: number;
  code: TemplateFitCode;
  severity: "error" | "warning";
  message: string;
  suggestion: string;
  elementIds: string[];
  /** Normalized distance that caused the finding, when there is one. */
  deviation?: number;
}

export interface TemplateFitReport {
  /** False when the template has no usable title/content placeholder. */
  checked: boolean;
  score: number;
  threshold: number;
  passed: boolean;
  issues: TemplateFitIssue[];
  hardFailures: number;
  /** How many slides resolved to a concrete template layout. */
  layoutCoverage: number;
}

const DEFAULT_PAGE = { widthEmu: 12_192_000, heightEmu: 6_858_000 };
const DEFAULT_TOLERANCES: TemplateTolerances = {
  axis: 0.01,
  axisY: 0.005,
  margin: 0.01,
  fontSizePt: 1.5,
};
const FREE_LAYOUT_PATTERN =
  /封面|标题幻灯片|扉页|章节|篇章|过渡|分隔|结束|谢谢|引用|引言|金句|cover|section|quote|closing|end/i;

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

const normalizeHex = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
};

interface NormalizedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function normalizeRegion(region: TemplateRegion, widthEmu: number, heightEmu: number): NormalizedFrame | undefined {
  if (widthEmu <= 0 || heightEmu <= 0 || region.width <= 0 || region.height <= 0) return undefined;
  const x = region.x / widthEmu;
  const y = region.y / heightEmu;
  const width = region.width / widthEmu;
  const height = region.height / heightEmu;
  if (x < 0 || y < 0 || x + width > 1.02 || y + height > 1.02) return undefined;
  return { x, y, width, height, left: x, right: x + width, top: y, bottom: y + height };
}

function layoutGrid(
  layout: TemplateLayoutSummary,
  widthEmu: number,
  heightEmu: number,
): { grid: TemplateGrid; titleSizePt?: number; bodySizePt?: number } | undefined {
  const title = layout.regions.find((region) => region.role === "title");
  const bodies = layout.regions
    .filter((region) => region.role === "body")
    .sort((left, right) => right.width * right.height - left.width * left.height);
  const content = bodies[0];
  if (!title && !content) return undefined;
  const titleFrame = title ? normalizeRegion(title, widthEmu, heightEmu) : undefined;
  const contentFrame = content ? normalizeRegion(content, widthEmu, heightEmu) : undefined;
  if (!titleFrame && !contentFrame) return undefined;
  const reference = (titleFrame ?? contentFrame)!;
  const grid: TemplateGrid = {
    left: Math.min(titleFrame?.left ?? reference.left, contentFrame?.left ?? reference.left),
    right: Math.max(titleFrame?.right ?? reference.right, contentFrame?.right ?? reference.right),
    top: Math.min(titleFrame?.top ?? reference.top, contentFrame?.top ?? reference.top),
    bottom: Math.max(titleFrame?.bottom ?? reference.bottom, contentFrame?.bottom ?? reference.bottom),
    titleX: titleFrame?.x ?? reference.x,
    titleY: titleFrame?.y ?? reference.y,
    titleWidth: titleFrame?.width ?? reference.width,
    titleHeight: titleFrame?.height ?? reference.height,
    bodyTop: contentFrame?.y ?? titleFrame?.bottom ?? reference.y,
    bodyBottom: contentFrame?.bottom ?? reference.bottom,
  };
  return {
    grid,
    ...(title?.fontSizePt == null ? {} : { titleSizePt: title.fontSizePt }),
    ...(content?.fontSizePt == null ? {} : { bodySizePt: content.fontSizePt }),
  };
}

/**
 * Compiles the raw `analyze_pptx_template` payload into a review target.
 *
 * The compiler prefers layout placeholders over template sample slides: sample
 * pages are frequently hand-adjusted and are not the template's own grid.
 */
export function buildTemplateReviewTarget(
  analysis: TemplateAnalysis,
  name = "上传模板",
): TemplateReviewTarget | undefined {
  const widthEmu = analysis.slideWidthEmu ?? DEFAULT_PAGE.widthEmu;
  const heightEmu = analysis.slideHeightEmu ?? DEFAULT_PAGE.heightEmu;
  const layouts: TemplateLayoutTarget[] = [];
  for (const layout of analysis.layouts) {
    const compiled = layoutGrid(layout, widthEmu, heightEmu);
    if (!compiled) continue;
    const label = layout.name?.trim() || `模板版式 ${layout.index + 1}`;
    layouts.push({
      name: label,
      grid: compiled.grid,
      ...(compiled.titleSizePt === undefined ? {} : { titleSizePt: compiled.titleSizePt }),
      ...(compiled.bodySizePt === undefined ? {} : { bodySizePt: compiled.bodySizePt }),
      freeComposition: FREE_LAYOUT_PATTERN.test(label),
    });
  }
  // Some templates expose usable placeholder geometry on their sample slides
  // but not on the layouts. Sample geometry is a weaker source (pages may have
  // been hand-adjusted), so it is used only as a fallback and stays low
  // confidence.
  if (layouts.length === 0) {
    for (const sample of analysis.slides) {
      const compiled = layoutGrid(
        {
          index: sample.index,
          name: sample.title,
          backgroundColor: sample.backgroundColor,
          decorations: sample.decorations,
          regions: sample.regions,
        },
        widthEmu,
        heightEmu,
      );
      if (!compiled) continue;
      const label = sample.title?.trim() || `模板样张 ${sample.index + 1}`;
      layouts.push({
        name: label,
        grid: compiled.grid,
        ...(compiled.titleSizePt === undefined ? {} : { titleSizePt: compiled.titleSizePt }),
        ...(compiled.bodySizePt === undefined ? {} : { bodySizePt: compiled.bodySizePt }),
        freeComposition: sample.index === 0 || FREE_LAYOUT_PATTERN.test(label),
      });
    }
  }
  if (layouts.length === 0) return undefined;
  const contentLayouts = layouts.filter((layout) => !layout.freeComposition);
  const reference = contentLayouts.length > 0 ? contentLayouts : layouts;
  const grid: TemplateGrid = {
    left: median(reference.map((layout) => layout.grid.left)) ?? 0,
    right: median(reference.map((layout) => layout.grid.right)) ?? 1,
    top: median(reference.map((layout) => layout.grid.top)) ?? 0,
    bottom: median(reference.map((layout) => layout.grid.bottom)) ?? 1,
    titleX: median(reference.map((layout) => layout.grid.titleX)) ?? 0,
    titleY: median(reference.map((layout) => layout.grid.titleY)) ?? 0,
    titleWidth: median(reference.map((layout) => layout.grid.titleWidth)) ?? 1,
    titleHeight: median(reference.map((layout) => layout.grid.titleHeight)) ?? 0.1,
    bodyTop: median(reference.map((layout) => layout.grid.bodyTop)) ?? 0,
    bodyBottom: median(reference.map((layout) => layout.grid.bodyBottom)) ?? 1,
  };
  const titleSizePt = median(
    reference.flatMap((layout) => (layout.titleSizePt === undefined ? [] : [layout.titleSizePt])),
  );
  const bodySizePt = median(
    reference.flatMap((layout) => (layout.bodySizePt === undefined ? [] : [layout.bodySizePt])),
  );
  const titleCenter = grid.titleX + grid.titleWidth / 2;
  const centered = Math.abs(titleCenter - 0.5) < 0.05 && grid.titleWidth < 0.8;
  const completeLayouts = reference.filter(
    (layout) => layout.titleSizePt !== undefined && layout.bodySizePt !== undefined,
  ).length;
  // A cover with only a title is still a measured layout. Two measured layouts
  // give the target enough evidence to claim high confidence, even when only
  // one of them carries a body placeholder.
  const measuredLayouts = layouts.filter(
    (layout) => layout.titleSizePt !== undefined || layout.bodySizePt !== undefined,
  ).length;
  const confident = measuredLayouts >= 2 && completeLayouts >= 1;
  return {
    name,
    page: { widthEmu, heightEmu },
    grid,
    layouts,
    palette: analysis.themeColors
      .map((color) => normalizeHex(color.value))
      .filter((value): value is string => value !== undefined),
    ...(titleSizePt === undefined ? {} : { titleSizePt }),
    ...(bodySizePt === undefined ? {} : { bodySizePt }),
    alignment: centered ? "centered-grid" : "left-grid",
    confidence: confident ? "high" : "low",
    minimumFit: confident ? 90 : 85,
    tolerances: DEFAULT_TOLERANCES,
  };
}

/** The layout a slide was designed against, falling back to the deck grid. */
export function templateTargetForSlide(
  document: PresentationDocument,
  target: TemplateReviewTarget,
  slideIndex: number,
): { grid: TemplateGrid; titleSizePt?: number; bodySizePt?: number; freeComposition: boolean; layoutName?: string } {
  const slide = document.slides[slideIndex];
  const layoutName = slide?.layoutId
    ? document.layouts?.find((layout) => layout.id === slide.layoutId)?.name
    : undefined;
  const layout =
    (layoutName ? target.layouts.find((candidate) => candidate.name === layoutName) : undefined) ??
    (target.layouts.length === 1 ? target.layouts[0] : undefined);
  const titleSizePt = layout?.titleSizePt ?? target.titleSizePt;
  const bodySizePt = layout?.bodySizePt ?? target.bodySizePt;
  return {
    grid: layout?.grid ?? target.grid,
    ...(titleSizePt === undefined ? {} : { titleSizePt }),
    ...(bodySizePt === undefined ? {} : { bodySizePt }),
    freeComposition: layout?.freeComposition ?? false,
    ...(layout?.name === undefined ? {} : { layoutName: layout.name }),
  };
}

const rectOf = (frame: { x: number; y: number; width: number; height: number }, width: number, height: number) => ({
  x: frame.x / width,
  y: frame.y / height,
  width: frame.width / width,
  height: frame.height / height,
});

const unionRect = (rects: Array<{ x: number; y: number; width: number; height: number }>) => {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * Measures a document against the uploaded template.
 *
 * Only checks that can be observed from the document are reported: title axis,
 * content bounds and placeholder type size. Decorative geometry, sampled ink
 * inside artwork and visual balance stay with the vision review.
 */
export function checkTemplateFit(document: PresentationDocument, target: TemplateReviewTarget): TemplateFitReport {
  const pageWidth = document.pageSize.width;
  const pageHeight = document.pageSize.height;
  const issues: TemplateFitIssue[] = [];
  let checkedSlides = 0;
  let layoutCoverage = 0;
  for (const [slideIndex, slide] of document.slides.entries()) {
    const resolved = templateTargetForSlide(document, target, slideIndex);
    if (resolved.layoutName) layoutCoverage += 1;
    if (resolved.freeComposition) continue;
    const title =
      slide.elements.find((element) => element.type === "text" && element.contentRef === "title") ??
      slide.elements.find((element) => element.type === "text" && element.text === slide.content.title);
    const bodies = slide.elements.filter((element) => element.type === "text" && element.contentRef === "body");
    if (!title && bodies.length === 0) continue;
    checkedSlides += 1;
    const grid = resolved.grid;
    if (title && title.type === "text") {
      const box = rectOf(title.frame, pageWidth, pageHeight);
      const dx = Math.abs(box.x - grid.titleX);
      const dy = Math.abs(box.y - grid.titleY);
      if (dx > target.tolerances.axis || dy > target.tolerances.axisY) {
        issues.push({
          slideIndex,
          code: "template-title-axis",
          severity: "error",
          message: `标题未贴合模板轴线：当前 x=${box.x.toFixed(3)}、y=${box.y.toFixed(3)}，模板 x=${grid.titleX.toFixed(3)}、y=${grid.titleY.toFixed(3)}`,
          suggestion: `把标题移回模板标题区 x=${grid.titleX.toFixed(3)}、y=${grid.titleY.toFixed(3)}，保持左轴与顶边一致`,
          elementIds: [title.id],
          deviation: Math.max(dx, dy),
        });
      }
      if (resolved.titleSizePt !== undefined && slide.content.blocks === undefined) {
        const difference = Math.abs(title.style.fontSizePt - resolved.titleSizePt);
        if (difference > target.tolerances.fontSizePt) {
          issues.push({
            slideIndex,
            code: "template-title-size",
            severity: "warning",
            message: `标题字号 ${title.style.fontSizePt}pt 与模板 ${resolved.titleSizePt}pt 不一致`,
            suggestion: `把标题字号恢复到模板的 ${resolved.titleSizePt}pt，或说明为什么必须偏离`,
            elementIds: [title.id],
            deviation: difference,
          });
        }
      }
    }
    if (bodies.length > 0) {
      const bounds = unionRect(bodies.map((body) => rectOf(body.frame, pageWidth, pageHeight)));
      const outside =
        grid.left - bounds.x > target.tolerances.margin ||
        bounds.x + bounds.width - grid.right > target.tolerances.margin ||
        grid.bodyTop - bounds.y > target.tolerances.margin ||
        bounds.y + bounds.height - grid.bodyBottom > target.tolerances.margin;
      if (outside) {
        issues.push({
          slideIndex,
          code: "template-content-bounds",
          severity: "error",
          message: `正文超出模板内容区：正文范围 x=${bounds.x.toFixed(3)}–${(bounds.x + bounds.width).toFixed(3)}、y=${bounds.y.toFixed(3)}–${(bounds.y + bounds.height).toFixed(3)}，模板内容区 x=${grid.left.toFixed(3)}–${grid.right.toFixed(3)}、y=${grid.bodyTop.toFixed(3)}–${grid.bodyBottom.toFixed(3)}`,
          suggestion: "把正文移回模板内容区，不要为了页内平衡越过模板边距",
          elementIds: bodies.map((body) => body.id),
          deviation: Math.max(
            grid.left - bounds.x,
            bounds.x + bounds.width - grid.right,
            grid.bodyTop - bounds.y,
            bounds.y + bounds.height - grid.bodyBottom,
          ),
        });
      }
      if (resolved.bodySizePt !== undefined && slide.content.blocks === undefined && bodies[0]?.type === "text") {
        const difference = Math.abs(bodies[0].style.fontSizePt - resolved.bodySizePt);
        if (difference > target.tolerances.fontSizePt) {
          issues.push({
            slideIndex,
            code: "template-body-size",
            severity: "warning",
            message: `正文字号 ${bodies[0].style.fontSizePt}pt 与模板 ${resolved.bodySizePt}pt 不一致`,
            suggestion: `把正文字号恢复到模板的 ${resolved.bodySizePt}pt，或说明为什么必须偏离`,
            elementIds: [bodies[0].id],
            deviation: difference,
          });
        }
      }
    }
  }
  const checked = checkedSlides > 0;
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const score = checked ? Math.max(0, 100 - errors * 10 - warnings * 3) : 0;
  return {
    checked,
    score,
    threshold: target.minimumFit,
    passed: checked && errors === 0 && score >= target.minimumFit,
    issues,
    hardFailures: errors,
    layoutCoverage,
  };
}

/** Converts template findings into the review vocabulary the repair loop reads. */
export function templateFitVisualIssues(report: TemplateFitReport): VisualReview["issues"] {
  return report.issues.map((issue) => ({
    slideIndex: issue.slideIndex,
    severity: issue.severity,
    issue:
      issue.code === "template-title-size" || issue.code === "template-body-size" || issue.code === "template-palette"
        ? "theme-mismatch"
        : "misalignment",
    elementIds: issue.elementIds,
    suggestion: issue.suggestion,
    code: issue.code,
  }));
}

/** The review goal inherits the template's axis language and fit threshold. */
export function applyTemplateToGoal(
  goal: PresentationVisualGoal,
  target: TemplateReviewTarget,
): PresentationVisualGoal {
  return {
    ...goal,
    alignment: target.alignment,
    minimumScores: { ...goal.minimumScores, templateFit: target.minimumFit },
  };
}
