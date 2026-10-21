import { describe, expect, it } from "vitest";
import { planTemplateLayouts, templateLayoutCandidates, type AiTemplateLayout } from "./template-layouts";

const region = (role: "title" | "body" | "image", x: number, y: number, width: number, height: number) => ({ role, frame: { x, y, width, height } });

const contentLayout = (index: number, name: string): AiTemplateLayout => ({
  index,
  name,
  backgroundImageDataUrl: `data:image/png;base64,${index}`,
  regions: [region("title", 0.052, 0.03, 0.799, 0.059), region("body", 0.052, 0.119, 0.423, 0.046), region("body", 0.052, 0.222, 0.897, 0.621)],
});

describe("template layout selection", () => {
  it("matches a localized layout name to the requested page kind", () => {
    const layouts = [
      { index: 1, name: "封面1", regions: [region("title", 0.084, 0.34, 0.832, 0.167), region("body", 0.125, 0.589, 0.75, 0.167)] },
      { index: 7, name: "篇章页1", regions: [region("title", 0.08, 0.088, 0.863, 0.165), region("body", 0.08, 0.275, 0.488, 0.219)] },
      contentLayout(11, "内页（浅色）1"),
    ];
    expect(templateLayoutCandidates(layouts, "body").map((layout) => layout.index)).toEqual([11]);
    expect(planTemplateLayouts({ layouts, intents: ["cover"] })[0]?.index).toBe(1);
    expect(planTemplateLayouts({ layouts, intents: ["section"] })[0]?.index).toBe(7);
    expect(planTemplateLayouts({ layouts, intents: ["body"] })[0]?.index).toBe(11);
  });

  it("never keeps a layout whose own title collides with its body", () => {
    const broken: AiTemplateLayout = { index: 1, name: "损坏版式", regions: [region("title", 0.1, 0.35, 0.7, 0.2), region("body", 0.08, 0.3, 0.82, 0.5)] };
    expect(templateLayoutCandidates([broken], "body")).toEqual([]);
    expect(planTemplateLayouts({ layouts: [broken], intents: ["body"] })).toEqual([undefined]);
  });

  it("rotates through the content layouts instead of repeating one artwork", () => {
    const layouts = [contentLayout(11, "内页（浅色）1"), contentLayout(13, "内页（浅色）3"), contentLayout(14, "内页（深色）1")];
    const chosen = planTemplateLayouts({ layouts, intents: ["body", "body", "body", "body"] });
    expect(chosen.map((layout) => layout?.index)).toEqual([11, 13, 14, 11]);
  });

  it("keeps the same layout from repeating more often than the repeat limit allows", () => {
    const layouts = [contentLayout(11, "内页（浅色）1")];
    const chosen = planTemplateLayouts({ layouts, intents: ["body", "body", "body"], rhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 } });
    expect(chosen.map((layout) => layout?.index)).toEqual([11, 11, 11]);
  });

  it("gives the cover its own single variant so the opening page stays stable", () => {
    const layouts = [
      { index: 1, name: "封面1", regions: [region("title", 0.084, 0.34, 0.832, 0.167), region("body", 0.125, 0.589, 0.75, 0.167)] },
      { index: 3, name: "封面2", regions: [region("title", 0.049, 0.406, 0.832, 0.119), region("body", 0.049, 0.582, 0.75, 0.065)] },
    ];
    const chosen = planTemplateLayouts({ layouts, intents: ["cover", "cover"], rhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 } });
    expect(chosen.map((layout) => layout?.index)).toEqual([1, 1]);
  });
});
