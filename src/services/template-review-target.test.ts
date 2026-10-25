import { describe, expect, it } from "vitest";
import { createDocument, emu, type ElementId, type PresentationDocument } from "../core/document-model";
import type { TemplateAnalysis } from "./project-files";
import {
  applyTemplateToGoal,
  buildTemplateReviewTarget,
  checkTemplateFit,
  templateTargetForSlide,
} from "./template-review-target";
import { defaultPresentationVisualGoal } from "./visual-alignment";

const PAGE_WIDTH = 12_192_000;
const PAGE_HEIGHT = 6_858_000;
const x = (value: number) => emu(Math.round(value * PAGE_WIDTH));
const y = (value: number) => emu(Math.round(value * PAGE_HEIGHT));

const analysis = (overrides: Partial<TemplateAnalysis> = {}): TemplateAnalysis => ({
  slideCount: 3,
  slideWidthEmu: PAGE_WIDTH,
  slideHeightEmu: PAGE_HEIGHT,
  masterCount: 1,
  layoutCount: 2,
  themeCount: 1,
  themeColors: [
    { name: "accent1", value: "#0EA58C" },
    { name: "dk1", value: "#111827" },
  ],
  majorFont: "Source Han Sans",
  minorFont: "Source Han Sans",
  defaultBackgroundColor: "#FFFFFF",
  defaultDecorations: [],
  slides: [],
  warnings: [],
  layouts: [
    {
      index: 0,
      name: "内页",
      backgroundColor: "#FFFFFF",
      decorations: [],
      regions: [
        {
          role: "title",
          x: x(0.05625),
          y: y(0.086667),
          width: x(0.8875),
          height: y(0.106667),
          textColor: "#111827",
          fontSizePt: 28,
        },
        {
          role: "body",
          x: x(0.05625),
          y: y(0.24),
          width: x(0.8875),
          height: y(0.6),
          textColor: "#293241",
          fontSizePt: 16,
        },
      ],
    },
    {
      index: 1,
      name: "封面",
      backgroundColor: "#111827",
      decorations: [],
      regions: [
        {
          role: "title",
          x: x(0.2),
          y: y(0.4),
          width: x(0.6),
          height: y(0.2),
          textColor: "#FFFFFF",
          fontSizePt: 40,
        },
      ],
    },
  ],
  ...overrides,
});

const withBody = (): PresentationDocument => {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.content.title = "页面标题";
  slide.elements[0]!.frame = {
    x: x(0.05625),
    y: y(0.086667),
    width: x(0.8875),
    height: y(0.106667),
  };
  slide.elements.push({
    id: crypto.randomUUID() as ElementId,
    type: "text",
    contentRef: "body",
    frame: { x: x(0.05625), y: y(0.24), width: x(0.8875), height: y(0.6) },
    rotationMilliDegree: 0,
    locked: false,
    text: "正文",
    style: { fontFamily: "Microsoft YaHei", fontSizePt: 16, color: "#293241", bold: false, align: "left" },
  });
  return document;
};

describe("template review target", () => {
  it("compiles the template grid, type sizes and axis language", () => {
    const target = buildTemplateReviewTarget(analysis(), "示例模板");
    expect(target).toBeDefined();
    expect(target!.grid.left).toBeCloseTo(0.05625, 4);
    expect(target!.grid.right).toBeCloseTo(0.94375, 4);
    expect(target!.grid.titleX).toBeCloseTo(0.05625, 4);
    expect(target!.grid.titleY).toBeCloseTo(0.086667, 3);
    expect(target!.titleSizePt).toBe(28);
    expect(target!.bodySizePt).toBe(16);
    expect(target!.alignment).toBe("left-grid");
    expect(target!.confidence).toBe("high");
    expect(target!.palette).toContain("#0EA58C");
    expect(target!.layouts.find((layout) => layout.name === "封面")?.freeComposition).toBe(true);
  });

  it("does not invent a target when the template has no usable placeholders", () => {
    expect(buildTemplateReviewTarget(analysis({ layouts: [] }))).toBeUndefined();
  });

  it("passes a page whose title and body sit on the template grid", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const report = checkTemplateFit(withBody(), target);
    expect(report.checked).toBe(true);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("reports a title that drifted off the template axis", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    document.slides[0]!.elements[0]!.frame = {
      ...document.slides[0]!.elements[0]!.frame,
      x: x(0.2),
    };
    const report = checkTemplateFit(document, target);
    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(100);
    expect(report.issues.some((issue) => issue.code === "template-title-axis")).toBe(true);
    expect(report.hardFailures).toBeGreaterThan(0);
  });

  it("reports body copy outside the template content area", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    const body = document.slides[0]!.elements[1]!;
    body.frame = { ...body.frame, x: emu(0), width: x(0.4) };
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-content-bounds")).toBe(true);
  });

  it("skips free-composition cover pages", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    const layoutId = crypto.randomUUID();
    document.layouts = [{ id: layoutId, name: "封面" }];
    document.slides[0]!.layoutId = layoutId;
    document.slides[0]!.elements[0]!.frame = { ...document.slides[0]!.elements[0]!.frame, x: x(0.3), y: y(0.5) };
    const report = checkTemplateFit(document, target);
    expect(report.issues).toEqual([]);
    expect(templateTargetForSlide(document, target, 0).freeComposition).toBe(true);
  });

  it("inherits the template axis language and fit floor into the review goal", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const goal = applyTemplateToGoal(defaultPresentationVisualGoal(), target);
    expect(goal.alignment).toBe("left-grid");
    expect(goal.minimumScores.templateFit).toBe(90);
  });
});
