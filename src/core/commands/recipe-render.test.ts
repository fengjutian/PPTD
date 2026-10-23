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

  it("renders a cover through the cover-statement recipe", () => {
    const document = createDocument();
    const coverFacts = facts({ layout: "cover", itemCount: 2 });
    const coverConcept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: [coverFacts],
      pageCount: 1,
      id: "cover",
    }).concept;
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "年度销售汇报",
      slides: [
        {
          title: "年度销售汇报",
          body: "2026 财年 · 董事会",
          speakerNotes: "",
        },
      ],
      designs: [design({ layout: "cover", recipe: "cover-statement" })],
      designConcept: coverConcept,
      themePresetId: "consulting-navy",
    });
    const slide = document.slides[0]!;
    const text = slide.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(text).toEqual(expect.arrayContaining(["年度销售汇报", "2026 财年 · 董事会"]));
    expect(slide.elements.filter((element) => element.type === "shape").length).toBeGreaterThanOrEqual(2);
  });

  it("maps a ten-page deck to the two recipes and leaves the process page alone", () => {
    const counts = [4, 4, 5, 5, 4, 4, 4, 4, 4, 4];
    const slides = counts.map((count, index) =>
      index === 6
        ? {
            title: "销售流程从线索到订单逐步推进",
            body: "线索\n筛选\n跟进\n成交",
            speakerNotes: "",
            blocks: [
              {
                type: "process" as const,
                items: [
                  { label: "线索", text: "多渠道触达" },
                  { label: "筛选", text: "分级管理" },
                  { label: "跟进", text: "响应加快" },
                  { label: "成交", text: "转化提升" },
                ],
              },
            ],
          }
        : {
            title: `第 ${index + 1} 页结论标题`,
            body: items.slice(0, count).join("\n"),
            speakerNotes: "",
            blocks: [{ type: "bullet-list" as const, items: items.slice(0, count) }],
          },
    );
    const pageFacts = counts.map((count, index) =>
      facts({
        itemCount: count,
        hasRowBlock: index === 6,
        layout: index === 6 ? "cards" : index % 2 === 0 ? "summary" : "split",
        shortItems: index % 2 === 0,
      }),
    );
    const deckConcept = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts,
      pageCount: 10,
      id: "ten-pages",
    }).concept;
    const document = createDocument();
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "十页样例",
      slides,
      designs: slides.map((_, index) =>
        design({ layout: index === 6 ? "cards" : index % 2 === 0 ? "summary" : "split", recipe: undefined }),
      ),
      designConcept: deckConcept,
      themePresetId: "consulting-navy",
    });
    expect(document.slides).toHaveLength(10);
    const textOf = (index: number) =>
      document.slides[index]!.elements.filter((element) => element.type === "text").map((element) =>
        element.type === "text" ? element.text : "",
      );
    // Index pages carry numbered rows; split pages carry no count panel.
    expect(textOf(0)).toEqual(expect.arrayContaining(["01", "02", "03", "04"]));
    expect(textOf(1)).not.toContain("项要点");
    // The process page keeps the legacy branch and the content block.
    expect(textOf(6)).toEqual(expect.arrayContaining(["线索", "筛选", "跟进", "成交"]));
  });
});
