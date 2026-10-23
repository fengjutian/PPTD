import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import type { AiSlideDesign } from "./template-layouts";
import { createDocument } from "../document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import type { CompositionFacts } from "./design-intent";

const items = ["销售收入保持正增长", "移动端成为增长引擎", "资源向高质量业务倾斜", "管理转向质量与效率"];

function facts(overrides: Partial<CompositionFacts> = {}): CompositionFacts {
  return {
    itemCount: 4,
    shortItems: true,
    longestItemLength: 20,
    bodyLength: 80,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "summary",
    ...overrides,
  };
}

function design(overrides: Partial<AiSlideDesign> = {}): AiSlideDesign {
  return {
    layout: "summary",
    background: "#FFFFFF",
    accent: "#1F4E79",
    titleColor: "#12233D",
    bodyColor: "#465368",
    recipe: "editorial-index",
    ...overrides,
  };
}

function concept() {
  return resolveDeckConcept({
    concept: defaultEditorialConcept(),
    pageFacts: [facts()],
    pageCount: 1,
    id: "deck-concept",
  }).concept;
}

describe("recipe rendering through the design command", () => {
  it("renders an editorial page without white cards", () => {
    const document = createDocument();
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "百度销售情况汇报",
      slides: [
        {
          title: "百度销售整体保持增长并持续优化结构",
          body: items.join("\n"),
          speakerNotes: "",
          blocks: [{ type: "bullet-list", items }],
        },
      ],
      designs: [design()],
      designConcept: concept(),
      themePresetId: "consulting-navy",
    });

    const slide = document.slides[0]!;
    expect(slide.content.title).toBe("百度销售整体保持增长并持续优化结构");
    expect(slide.content.body).toBe(items.join("\n"));
    expect(slide.content.status).toBe("approved");
    const text = slide.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(text).toEqual(expect.arrayContaining(["01", "02", "03", "04", ...items]));
    const whiteCards = slide.elements.filter(
      (element) => element.type === "shape" && element.style.fill.toUpperCase() === "#FFFFFF",
    );
    expect(whiteCards).toHaveLength(0);
    const block = slide.content.blocks?.find((candidate) => candidate.type === "bullet-list");
    expect(block?.type === "bullet-list" ? block.items : []).toEqual(items);
  });

  it("falls back to the legacy branch when the recipe cannot carry the content", () => {
    const document = createDocument();
    const seven = ["一", "二", "三", "四", "五", "六", "七"];
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "fallback",
      slides: [
        {
          title: "七个要点",
          body: seven.join("\n"),
          speakerNotes: "",
          blocks: [{ type: "bullet-list", items: seven }],
        },
      ],
      designs: [design()],
      designConcept: resolveDeckConcept({
        concept: defaultEditorialConcept(),
        pageFacts: [facts({ itemCount: 7 })],
        pageCount: 1,
        id: "fallback",
      }).concept,
      themePresetId: "consulting-navy",
    });
    const slide = document.slides[0]!;
    const text = slide.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(text).toContain("七个要点");
    // The recipe refuses seven points; the page still renders through the
    // legacy branch instead of throwing or dropping a point.
    expect(slide.content.body).toBe(seven.join("\n"));
  });

  it("keeps the legacy output when no concept is supplied", () => {
    const document = createDocument();
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "legacy",
      slides: [
        {
          title: "百度销售整体保持增长并持续优化结构",
          body: items.join("\n"),
          speakerNotes: "",
          blocks: [{ type: "bullet-list", items }],
        },
      ],
      designs: [design({ recipe: undefined })],
      themePresetId: "consulting-navy",
    });
    const slide = document.slides[0]!;
    const text = slide.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    // Without a concept the page keeps the legacy editorial anchor panel.
    expect(text).toContain("项要点");
  });
});
