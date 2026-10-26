import { describe, expect, it } from "vitest";
import {
  planTemplateLayouts,
  planTemplateLayoutsWithReport,
  templateLayoutCandidates,
  templateLayoutHasFooterMarker,
  type AiTemplateLayout,
} from "./template-layouts";

const region = (role: "title" | "body" | "image", x: number, y: number, width: number, height: number) => ({
  role,
  frame: { x, y, width, height },
});

const contentLayout = (index: number, name: string): AiTemplateLayout => ({
  index,
  name,
  backgroundImageDataUrl: `data:image/png;base64,${index}`,
  regions: [
    region("title", 0.052, 0.03, 0.799, 0.059),
    region("body", 0.052, 0.119, 0.423, 0.046),
    region("body", 0.052, 0.222, 0.897, 0.621),
  ],
});

describe("template layout selection", () => {
  it("matches a localized layout name to the requested page kind", () => {
    const layouts = [
      {
        index: 1,
        name: "封面1",
        regions: [region("title", 0.084, 0.34, 0.832, 0.167), region("body", 0.125, 0.589, 0.75, 0.167)],
      },
      {
        index: 7,
        name: "篇章页1",
        regions: [region("title", 0.08, 0.088, 0.863, 0.165), region("body", 0.08, 0.275, 0.488, 0.219)],
      },
      contentLayout(11, "内页（浅色）1"),
    ];
    expect(templateLayoutCandidates(layouts, "body").map((layout) => layout.index)).toEqual([11]);
    expect(planTemplateLayouts({ layouts, intents: ["cover"] })[0]?.index).toBe(1);
    expect(planTemplateLayouts({ layouts, intents: ["section"] })[0]?.index).toBe(7);
    expect(planTemplateLayouts({ layouts, intents: ["body"] })[0]?.index).toBe(11);
  });

  it("prefers a layout with a picture placeholder for an image page", () => {
    const withImage: AiTemplateLayout = {
      index: 21,
      name: "图文页",
      regions: [
        region("title", 0.052, 0.03, 0.45, 0.08),
        region("body", 0.052, 0.2, 0.44, 0.6),
        region("image", 0.54, 0.12, 0.4, 0.7),
      ],
    };
    expect(
      templateLayoutCandidates([contentLayout(11, "内页"), withImage], "image").map((layout) => layout.index),
    ).toEqual([21]);
    expect(planTemplateLayouts({ layouts: [contentLayout(11, "内页"), withImage], intents: ["image"] })[0]?.index).toBe(
      21,
    );
  });

  it("rejects an image page instead of silently using a text-only layout", () => {
    const result = planTemplateLayoutsWithReport({ layouts: [contentLayout(11, "内页")], intents: ["image"] });
    expect(result.layouts).toEqual([undefined]);
    expect(result.issues).toEqual([expect.objectContaining({ slideIndex: 0, code: "TEMPLATE_LAYOUT_IMAGE_REQUIRED" })]);
  });

  it("rejects a split page when the template has no two-column layout", () => {
    const oneColumn: AiTemplateLayout = {
      index: 31,
      name: "单栏正文",
      regions: [region("title", 0.05, 0.04, 0.9, 0.1), region("body", 0.05, 0.2, 0.9, 0.65)],
    };
    const result = planTemplateLayoutsWithReport({ layouts: [oneColumn], intents: ["split"] });
    expect(result.layouts).toEqual([undefined]);
    expect(result.issues[0]?.code).toBe("TEMPLATE_LAYOUT_COLUMNS_REQUIRED");
  });

  it("keeps issue indexes aligned with their pages", () => {
    const result = planTemplateLayoutsWithReport({
      layouts: [contentLayout(11, "内页")],
      intents: ["body", "image", "body"],
    });
    expect(result.layouts.map((layout) => layout?.index)).toEqual([11, undefined, 11]);
    expect(result.issues.map((issue) => issue.slideIndex)).toEqual([1]);
  });

  it("does not report template conflicts when no template was supplied", () => {
    const result = planTemplateLayoutsWithReport({ layouts: [], intents: ["body", "image"] });
    expect(result.layouts).toEqual([undefined, undefined]);
    expect(result.issues).toEqual([]);
  });

  it("never keeps a layout whose own title collides with its body", () => {
    const broken: AiTemplateLayout = {
      index: 1,
      name: "损坏版式",
      regions: [region("title", 0.1, 0.35, 0.7, 0.2), region("body", 0.08, 0.3, 0.82, 0.5)],
    };
    expect(templateLayoutCandidates([broken], "body")).toEqual([]);
    expect(planTemplateLayouts({ layouts: [broken], intents: ["body"] })).toEqual([undefined]);
  });

  it("rotates through the content layouts instead of repeating one artwork", () => {
    const layouts = [
      contentLayout(11, "内页（浅色）1"),
      contentLayout(13, "内页（浅色）3"),
      contentLayout(14, "内页（深色）1"),
    ];
    const chosen = planTemplateLayouts({ layouts, intents: ["body", "body", "body", "body"] });
    expect(chosen.map((layout) => layout?.index)).toEqual([11, 13, 14, 11]);
  });

  it("keeps the same layout from repeating more often than the repeat limit allows", () => {
    const layouts = [contentLayout(11, "内页（浅色）1")];
    const chosen = planTemplateLayouts({
      layouts,
      intents: ["body", "body", "body"],
      rhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 },
    });
    expect(chosen.map((layout) => layout?.index)).toEqual([11, 11, 11]);
  });

  it("gives the cover its own single variant so the opening page stays stable", () => {
    const layouts = [
      {
        index: 1,
        name: "封面1",
        regions: [region("title", 0.084, 0.34, 0.832, 0.167), region("body", 0.125, 0.589, 0.75, 0.167)],
      },
      {
        index: 3,
        name: "封面2",
        regions: [region("title", 0.049, 0.406, 0.832, 0.119), region("body", 0.049, 0.582, 0.75, 0.065)],
      },
    ];
    const chosen = planTemplateLayouts({
      layouts,
      intents: ["cover", "cover"],
      rhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 },
    });
    expect(chosen.map((layout) => layout?.index)).toEqual([1, 1]);
  });

  it("sees a footer already declared by the template", () => {
    expect(templateLayoutHasFooterMarker(contentLayout(11, "内页"))).toBe(false);
    const withFooter: AiTemplateLayout = {
      ...contentLayout(12, "内页带页脚"),
      regions: [...contentLayout(12, "内页带页脚").regions, region("body", 0.86, 0.93, 0.08, 0.035)],
    };
    expect(templateLayoutHasFooterMarker(withFooter)).toBe(true);
  });
});
