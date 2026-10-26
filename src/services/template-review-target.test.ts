import { describe, expect, it } from "vitest";
import { createDocument, emu, type ElementId, type PresentationDocument } from "../core/document-model";
import type { TemplateAnalysis } from "./project-files";
import {
  applyTemplateToGoal,
  buildTemplateReviewTarget,
  checkTemplateFit,
  templateTargetForPrompt,
  templateTargetForSlide,
  templateTargetMatchesDocument,
} from "./template-review-target";
import { defaultPresentationVisualGoal } from "./visual-alignment";

const PAGE_WIDTH = 12_192_000;
const PAGE_HEIGHT = 6_858_000;
const x = (value: number) => emu(Math.round(value * PAGE_WIDTH));
const y = (value: number) => emu(Math.round(value * PAGE_HEIGHT));

const analysis = (overrides: Partial<TemplateAnalysis> = {}): TemplateAnalysis => ({
  contentHash: "hash:test",
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

const titleOf = (document: PresentationDocument) => {
  const element = document.slides[0]!.elements[0]!;
  if (element.type !== "text") throw new Error("fixture title must be text");
  return element;
};

const withBody = (): PresentationDocument => {
  const document = createDocument();
  const slide = document.slides[0]!;
  const title = titleOf(document);
  slide.content.title = "页面标题";
  title.frame = {
    x: x(0.05625),
    y: y(0.086667),
    width: x(0.8875),
    height: y(0.106667),
  };
  title.style = {
    ...title.style,
    color: "#111827",
    fontFamily: "Source Han Sans",
  };
  slide.elements.push({
    id: crypto.randomUUID() as ElementId,
    type: "text",
    contentRef: "body",
    frame: { x: x(0.05625), y: y(0.24), width: x(0.8875), height: y(0.6) },
    rotationMilliDegree: 0,
    locked: false,
    text: "正文",
    style: { fontFamily: "Source Han Sans", fontSizePt: 16, color: "#293241", bold: false, align: "left" },
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
    expect(target!.templateHash).toBe("hash:test");
    expect(target!.titleSizePt).toBe(28);
    expect(target!.bodySizePt).toBe(16);
    expect(target!.titleInk).toBe("#111827");
    expect(target!.bodyInk).toBe("#293241");
    expect(target!.alignment).toBe("left-grid");
    expect(target!.confidence).toBe("high");
    expect(target!.palette).toContain("#0EA58C");
    expect(target!.layouts.find((layout) => layout.name === "封面")?.freeComposition).toBe(true);
  });

  it("does not invent a target when the template has no usable placeholders", () => {
    expect(buildTemplateReviewTarget(analysis({ layouts: [] }))).toBeUndefined();
  });

  it("adds persisted layout capabilities to the prompt-sized target", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    const layoutName = target.layouts[0]!.name;
    document.layouts = [
      {
        id: crypto.randomUUID(),
        name: layoutName,
        capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 2, free: false },
      },
    ];

    const promptTarget = templateTargetForPrompt(target, document);

    expect(promptTarget.layouts).toHaveLength(1);
    expect(promptTarget.layouts[0]).toMatchObject({
      name: layoutName,
      capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 2, free: false },
    });
  });

  it("does not invent prompt capabilities for old documents", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    document.layouts = [{ id: crypto.randomUUID(), name: target.layouts[0]!.name }];

    expect(templateTargetForPrompt(target, document).layouts[0]).not.toHaveProperty("capabilities");
  });

  it("warns when a page's picture has no placeholder in its layout", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const build = (hasImage: boolean) => {
      const document = withBody();
      const layout = {
        id: crypto.randomUUID(),
        name: "内页",
        capabilities: {
          hasTitle: true,
          hasBody: true,
          hasImage,
          columns: 1,
          free: false,
        },
      };
      document.layouts = [layout];
      const slide = document.slides[0]!;
      slide.layoutId = layout.id;
      slide.elements.push({
        id: crypto.randomUUID() as ElementId,
        type: "image",
        placement: "content",
        frame: { x: x(0.6), y: y(0.3), width: x(0.35), height: y(0.5) },
        rotationMilliDegree: 0,
        locked: false,
        source: { kind: "embedded", dataUrl: "data:image/png;base64,AA==", mimeType: "image/png" },
        altText: "配图",
      });
      return document;
    };

    // A picture on a layout with no picture placeholder is on top of body
    // geometry: the page was not laid out by the template.
    const withoutPlaceholder = checkTemplateFit(build(false), target);
    expect(withoutPlaceholder.issues.some((issue) => issue.code === "template-image-region")).toBe(true);

    expect(checkTemplateFit(build(true), target).issues.some((issue) => issue.code === "template-image-region")).toBe(
      false,
    );
  });

  it("passes a page whose title and body sit on the template grid", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const report = checkTemplateFit(withBody(), target);
    expect(report.checked).toBe(true);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.checkedSlides).toBe(1);
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

  it("warns when a title colour falls outside the template palette", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    const title = titleOf(document);
    title.style = {
      ...title.style,
      color: "#FF00AA",
    };
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-palette")).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("warns when body text colour falls outside the template palette", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    const body = document.slides[0]!.elements[1]!;
    if (body.type !== "text") throw new Error("fixture body must be text");
    body.style = { ...body.style, color: "#FF00AA" };
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-palette" && issue.role === "body")).toBe(true);
  });

  it("warns when paragraph alignment differs from the template placeholder", () => {
    const base = analysis();
    const target = buildTemplateReviewTarget({
      ...base,
      layouts: base.layouts.map((layout) => ({
        ...layout,
        regions: layout.regions.map((region) =>
          region.role === "title" ? { ...region, textAlign: "center" as const } : region,
        ),
      })),
    })!;
    const document = withBody();
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-align" && issue.role === "title")).toBe(true);
  });

  it("warns when line spacing differs from the template placeholder", () => {
    const base = analysis();
    const target = buildTemplateReviewTarget({
      ...base,
      layouts: base.layouts.map((layout) => ({
        ...layout,
        regions: layout.regions.map((region) =>
          region.role === "title" ? { ...region, lineSpacing: 1.2 as const } : region,
        ),
      })),
    })!;
    const document = withBody();
    const title = titleOf(document);
    title.style = { ...title.style, lineHeight: 1.0 };
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-line-spacing" && issue.role === "title")).toBe(true);
  });

  it("accepts a CJK alias of the template font", () => {
    const target = buildTemplateReviewTarget(analysis({ majorFont: "Microsoft YaHei", minorFont: "Microsoft YaHei" }))!;
    const document = withBody();
    const title = titleOf(document);
    title.style = { ...title.style, fontFamily: "微软雅黑" };
    const body = document.slides[0]!.elements[1]!;
    if (body.type !== "text") throw new Error("fixture body must be text");
    body.style = { ...body.style, fontFamily: "微软雅黑" };
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-font")).toBe(false);
  });

  it("warns when a title font is not one of the template fonts", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    const title = titleOf(document);
    title.style = {
      ...title.style,
      fontFamily: "Comic Sans MS",
    };
    const report = checkTemplateFit(document, target);
    expect(report.issues.some((issue) => issue.code === "template-font")).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("treats a title-only layout as free composition even without a cover name", () => {
    const target = buildTemplateReviewTarget(
      analysis({
        layouts: [
          {
            index: 0,
            name: "内页",
            backgroundColor: "#FFFFFF",
            decorations: [],
            regions: [
              {
                role: "title",
                x: x(0.2),
                y: y(0.4),
                width: x(0.6),
                height: y(0.2),
                textColor: "#111827",
                fontSizePt: 40,
              },
            ],
          },
        ],
      }),
    )!;
    expect(target.layouts[0]?.freeComposition).toBe(true);
  });

  it("rejects a persisted target after the page size or theme changed", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const document = withBody();
    expect(templateTargetMatchesDocument(target, document)).toBe(true);
    document.pageSize = { ...document.pageSize, width: emu(document.pageSize.width + 300000) };
    expect(templateTargetMatchesDocument(target, document)).toBe(false);
    const themed = withBody();
    themed.theme = {
      name: "另一个模板",
      majorFont: "Source Han Sans",
      minorFont: "Source Han Sans",
      colors: [],
    };
    expect(templateTargetMatchesDocument(target, themed)).toBe(false);
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
    expect(report.checkedSlides).toBe(0);
    expect(templateTargetForSlide(document, target, 0).freeComposition).toBe(true);
  });

  it("inherits the template axis language and fit floor into the review goal", () => {
    const target = buildTemplateReviewTarget(analysis())!;
    const goal = applyTemplateToGoal(defaultPresentationVisualGoal(), target);
    expect(goal.alignment).toBe("left-grid");
    expect(goal.minimumScores.templateFit).toBe(90);
  });
});
