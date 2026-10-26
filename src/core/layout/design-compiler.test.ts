import { describe, expect, it } from "vitest";
import { createDocument, inches, type SlideContent } from "../document-model";
import { defaultConceptForPreset, defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import { deriveDesignTokens, deriveSemanticColors } from "../design/design-tokens";
import type { CompositionFacts } from "../commands/design-intent";
import { compileDesignPlan, planRecipeId } from "./design-compiler";
import { planPageChrome } from "./page-chrome";
import type { RecipeContext } from "./recipes/types";

const page = { width: inches(13.333), height: inches(7.5) };
const safe = { x: 0.052, y: 0.03, width: 0.896, height: 0.9 };
const title = { x: inches(0.7), y: inches(0.9), width: inches(12), height: inches(0.9) };
const content = { x: inches(0.7), y: inches(2), width: inches(12), height: inches(4.5) };

const contentDocument: SlideContent = {
  title: "反垄断裁决与 AI 资本开支，将主导 Alphabet 下一财年的估值走向",
  body: [
    "美国与欧盟反垄断诉讼可能改变搜索与 Android 分发模式",
    "AI 数据中心与芯片投入将推高资本开支，压制短期利润率",
    "搜索广告与云收入仍是估值的基本锚点",
    "生成式 AI 商业化进度决定长期估值溢价",
  ].join("\n"),
  speakerNotes: "",
  status: "approved",
};

const facts: CompositionFacts = {
  itemCount: 4,
  shortItems: false,
  longestItemLength: 30,
  bodyLength: 0,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: false,
  layout: "split",
};

function input(plan: Parameters<typeof compileDesignPlan>[0]["plan"]) {
  const chrome = planPageChrome({ page, title, content, safe, showRule: true });
  const colors = {
    title: "#FFFFFF",
    body: "#293241",
    accent: "#B08A2E",
    background: "#486A67",
    rule: "#DCE3EA",
    panel: "#B08A2E",
    ...deriveSemanticColors({ surface: "#486A67", ink: "#293241", accent: "#B08A2E" }),
  };
  const frame: RecipeContext["frame"] = { title, content, safe, page };
  const concept = resolveDeckConcept({
    concept: defaultEditorialConcept(),
    pageFacts: [facts],
    pageCount: 1,
    id: "compiler-test",
  }).concept;
  return {
    plan,
    content: contentDocument,
    facts,
    concept,
    tokens: deriveDesignTokens(createDocument().theme, page, concept),
    colors,
    frame,
    page: { index: 0, total: 10 },
    chrome,
    hasTemplate: true,
    hasArtwork: true,
    hasAsset: false,
  } as Parameters<typeof compileDesignPlan>[0];
}

describe("design plan compiler", () => {
  it("lays a clean surface over the template body before compiling the recipe", () => {
    const result = compileDesignPlan(
      input({
        role: "claim",
        composition: { primitive: "split", ratio: 0.38 },
        density: "normal",
        templatePolicy: "takeover",
        recipe: "asymmetric-split",
      }),
    );
    expect("elements" in result).toBe(true);
    if (!("elements" in result)) return;
    const surface = result.elements[0]!;
    expect(surface.type).toBe("shape");
    expect(surface.type === "shape" ? surface.style.fill : "").toBe("#486A67");
    expect(surface.frame.width / page.width).toBeGreaterThan(0.85);
    const texts = result.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(texts).toContain(contentDocument.title);
    expect(texts).toEqual(expect.arrayContaining(["美国与欧盟反垄断诉讼可能改变搜索与 Android 分发模式"]));
    // The surface is dark, so the compiler must not keep the dark template body ink.
    const body = result.elements.find(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" && element.text.startsWith("搜索广告"),
    )!;
    expect(body.style.color).not.toBe("#293241");
  });

  it("does not add a surface when the plan uses the template", () => {
    const result = compileDesignPlan(
      input({
        role: "claim",
        composition: { primitive: "split" },
        density: "normal",
        templatePolicy: "use",
        recipe: "asymmetric-split",
      }),
    );
    expect("elements" in result).toBe(true);
    if (!("elements" in result)) return;
    expect(result.elements[0]!.type).toBe("text");
  });

  it("maps a claim to a recipe from the facts", () => {
    expect(
      planRecipeId(
        input({ role: "claim", density: "normal", templatePolicy: "use", composition: { primitive: "stack" } }).plan,
        facts,
      ),
    ).toBe("asymmetric-split");
    expect(
      planRecipeId(
        input({
          role: "claim",
          density: "normal",
          templatePolicy: "use",
          composition: { primitive: "stack" },
        }).plan,
        { ...facts, shortItems: true },
      ),
    ).toBe("editorial-index");
    expect(
      planRecipeId(
        {
          role: "comparison",
          composition: { primitive: "split", ratio: 0.62 },
          density: "normal",
          templatePolicy: "use",
        },
        { ...facts, hasComparison: true },
      ),
    ).toBe("weighted-split");
  });

  it("gives a direction its own composition before the role table", () => {
    const paper = resolveDeckConcept({
      concept: defaultConceptForPreset("paper"),
      pageFacts: [facts],
      pageCount: 1,
      id: "compiler-paper",
    }).concept;
    const claim = {
      role: "claim" as const,
      density: "normal" as const,
      templatePolicy: "ignore" as const,
      composition: { primitive: "stack" as const },
    };
    const options = { hasArtwork: false, hasAsset: false, hasTemplate: false };
    // The role table alone would keep drawing the editorial list on a paper
    // deck; the direction's own page has to win.
    expect(planRecipeId(claim, facts)).toBe("asymmetric-split");
    expect(planRecipeId(claim, facts, { concept: paper, options })).toBe("paper-column");
    // The model's request for the shared list is about the content shape, so it
    // is taken over as well; a structured request is not.
    expect(planRecipeId({ ...claim, recipe: "editorial-index" }, facts, { concept: paper, options })).toBe(
      "paper-column",
    );
    expect(planRecipeId({ ...claim, recipe: "comparison" }, facts, { concept: paper, options })).toBe("comparison");
  });

  it("uses the planned density to choose a denser claim or summary", () => {
    const denseClaim = input({
      role: "claim",
      density: "dense",
      templatePolicy: "use",
      composition: { primitive: "stack" },
    }).plan;
    expect(planRecipeId(denseClaim, { ...facts, shortItems: true })).toBe("asymmetric-split");

    const denseSummary = input({
      role: "summary",
      density: "dense",
      templatePolicy: "use",
      composition: { primitive: "stack" },
    }).plan;
    expect(planRecipeId(denseSummary, { ...facts, shortItems: true })).toBe("asymmetric-split");
  });

  it("lets the plan focal promote the body layer", () => {
    const base = compileDesignPlan(
      input({
        role: "claim",
        density: "normal",
        templatePolicy: "use",
        composition: { primitive: "split", ratio: 0.38 },
        recipe: "asymmetric-split",
      }),
    );
    const focused = compileDesignPlan(
      input({
        role: "claim",
        density: "normal",
        templatePolicy: "use",
        composition: { primitive: "split", ratio: 0.38 },
        recipe: "asymmetric-split",
        focal: { kind: "number" },
      }),
    );
    if (!("elements" in base) || !("elements" in focused)) throw new Error("compile failed");
    const baseBody = base.elements.find((element) => element.type === "text" && element.text.includes("美国与欧盟"));
    const focusedBody = focused.elements.find(
      (element) => element.type === "text" && element.text.includes("美国与欧盟"),
    );
    expect(baseBody?.type === "text" ? baseBody.style.fontSizePt : 0).toBeLessThan(
      focusedBody?.type === "text" ? focusedBody.style.fontSizePt : 0,
    );
  });

  it("refuses a recipe that the content cannot carry", () => {
    const result = compileDesignPlan(
      input({
        role: "claim",
        composition: { primitive: "rail" },
        density: "normal",
        templatePolicy: "use",
        recipe: "process-rail",
      }),
    );
    expect("conflict" in result).toBe(true);
    expect(result.compileReport).toMatchObject({
      outcome: "rejected",
      requestedRecipe: "process-rail",
      selectedRecipe: "process-rail",
    });
    expect(result.compileReport.diagnostics.at(-1)?.code).toBe("RECIPE_CAPACITY_EXCEEDED");
  });

  it("reports the recipe selected from role and content facts", () => {
    const result = compileDesignPlan(
      input({
        role: "claim",
        composition: { primitive: "stack" },
        density: "normal",
        templatePolicy: "use",
      }),
    );
    expect(result.compileReport).toMatchObject({
      outcome: "accepted",
      selectedRecipe: "asymmetric-split",
    });
    expect(result.compileReport.diagnostics).toContainEqual(
      expect.objectContaining({ code: "RECIPE_SELECTED", intent: "designPlan.role" }),
    );
  });

  it("reports a direction-owned recipe substitution instead of hiding it", () => {
    const paper = resolveDeckConcept({
      concept: defaultConceptForPreset("paper"),
      pageFacts: [facts],
      pageCount: 1,
      id: "compiler-paper-report",
    }).concept;
    const compileInput = input({
      role: "claim",
      composition: { primitive: "stack" },
      density: "normal",
      templatePolicy: "ignore",
      recipe: "editorial-index",
    });
    const result = compileDesignPlan({ ...compileInput, concept: paper, hasTemplate: false, hasArtwork: false });
    expect(result.compileReport).toMatchObject({
      outcome: "accepted-with-adjustments",
      requestedRecipe: "editorial-index",
      selectedRecipe: "paper-column",
    });
    expect(result.compileReport.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DIRECTION_RECIPE_SUBSTITUTED", severity: "warning" }),
    );
  });

  it("records template takeover as an accepted compiler decision", () => {
    const result = compileDesignPlan(
      input({
        role: "claim",
        composition: { primitive: "split" },
        density: "normal",
        templatePolicy: "takeover",
        recipe: "asymmetric-split",
      }),
    );
    expect(result.compileReport.outcome).toBe("accepted");
    expect(result.compileReport.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TEMPLATE_BODY_TAKEN_OVER", intent: "designPlan.templatePolicy" }),
    );
  });

  it("reports a missing template as a visible degradation", () => {
    const compileInput = input({
      role: "claim",
      composition: { primitive: "stack" },
      density: "normal",
      templatePolicy: "use",
      recipe: "asymmetric-split",
    });
    const result = compileDesignPlan({ ...compileInput, hasTemplate: false, hasArtwork: false });
    expect(result.compileReport.outcome).toBe("accepted-with-adjustments");
    expect(result.compileReport.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TEMPLATE_UNAVAILABLE", severity: "warning" }),
    );
  });

  it("distinguishes a missing image from generic capacity failure", () => {
    const concept = resolveDeckConcept({
      concept: { ...defaultEditorialConcept(), imagery: "side" },
      pageFacts: [facts],
      pageCount: 1,
      id: "compiler-image-capability",
    }).concept;
    const compileInput = input({
      role: "claim",
      composition: { primitive: "split" },
      density: "normal",
      templatePolicy: "ignore",
      recipe: "side-image-text",
    });
    const result = compileDesignPlan({ ...compileInput, concept, hasAsset: false });
    expect(result.compileReport).toMatchObject({ outcome: "rejected", selectedRecipe: "side-image-text" });
    expect(result.compileReport.diagnostics.at(-1)?.code).toBe("VISUAL_ASSET_REQUIRED");
  });

  it("rejects a recipe outside the selected direction's renderable set", () => {
    const compileInput = input({
      role: "process",
      composition: { primitive: "rail" },
      density: "normal",
      templatePolicy: "ignore",
      recipe: "process-rail",
    });
    const restricted = { ...compileInput.concept, recipes: ["asymmetric-split" as const] };
    const result = compileDesignPlan({ ...compileInput, concept: restricted });
    expect(result.compileReport.outcome).toBe("rejected");
    expect(result.compileReport.diagnostics.at(-1)?.code).toBe("RECIPE_NOT_ALLOWED_BY_DIRECTION");
  });
});
