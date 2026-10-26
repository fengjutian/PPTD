import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";
import { createDocument, type SlideElement, type TextElement } from "../document-model";
import { defaultConceptForPreset, resolveDeckConcept } from "../design/deck-concept";
import { endsInOrphan } from "../layout/recipes/measure";

/**
 * A two-panel "columns" page on the instrument surface.
 *
 * The direction indents its content behind an accent rail, and the panel pair
 * used to be hard-coded to the editorial margin (0.08–0.92): the left panel
 * started 0.09 of the page left of the rail and the rail ran through it. These
 * tests pin the pair to the content box and keep the points off a stranded last
 * line.
 */
const ITEMS = [
  "Google Services：搜索、YouTube、订阅与硬件构成主要现金流",
  "Google Cloud：基础设施与 Workspace 服务，面向企业客户",
  "Other Bets：Waymo、Verily 等长期创新项目，尚未规模化",
];
const TITLE = "Alphabet 的业务版图由 Google Services、Google Cloud 与 Other Bets 三块构成";

function instrumentColumnsPage(): SlideElement[] {
  const content = {
    title: TITLE,
    body: "广告业务是现金牛，云业务进入兑现期，长期项目仍在投入。",
    speakerNotes: "",
    blocks: [{ id: "bullets-1", type: "bullet-list" as const, items: ITEMS }],
  };
  const facts = {
    itemCount: ITEMS.length,
    shortItems: true,
    longestItemLength: 30,
    bodyLength: content.body.length,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "cards" as const,
  };
  const concept = resolveDeckConcept({
    concept: defaultConceptForPreset("instrument"),
    pageFacts: [facts],
    pageCount: 1,
    id: "columns-rail",
  }).concept;
  const source = createDocument();
  const result = produce(source, (draft) =>
    applyCommand(draft, {
      type: "apply-ai-designed-draft",
      title: "Alphabet 年报",
      slides: [content],
      designConcept: concept,
      designs: [
        {
          layout: "cards",
          background: "#F8F9FD",
          accent: "#2B5CE6",
          titleColor: "#12233E",
          bodyColor: "#3E5068",
          composition: "columns",
        },
      ],
    }),
  );
  return result.slides[0]!.elements;
}

/** The accent rail is the only tall, hairline-wide shape on the page. */
function railOf(elements: readonly SlideElement[], pageWidth: number, pageHeight: number): SlideElement {
  const rail = elements.find(
    (element) =>
      element.type === "shape" && element.frame.width <= pageWidth * 0.01 && element.frame.height >= pageHeight * 0.2,
  );
  if (!rail) throw new Error("expected the instrument rail to be drawn");
  return rail;
}

describe("columns on the instrument surface", () => {
  it("starts the panel pair at the rail instead of in the left margin", () => {
    const elements = instrumentColumnsPage();
    const pageWidth = createDocument().pageSize.width;
    const pageHeight = createDocument().pageSize.height;
    const rail = railOf(elements, pageWidth, pageHeight);
    const railRight = rail.frame.x + rail.frame.width;
    const itemTexts = elements.filter(
      (element): element is TextElement =>
        element.type === "text" && ITEMS.includes(element.text) && element.frame.y / pageHeight < 0.9,
    );
    expect(itemTexts).toHaveLength(3);
    for (const item of itemTexts) {
      expect(item.frame.x, item.text.slice(0, 12)).toBeGreaterThanOrEqual(railRight - pageWidth * 0.002);
      expect(item.frame.x + item.frame.width).toBeLessThanOrEqual(pageWidth * 0.95);
    }
  });

  it("keeps every point off a stranded last line", () => {
    const elements = instrumentColumnsPage();
    for (const item of elements.filter(
      (element): element is TextElement => element.type === "text" && ITEMS.includes(element.text),
    )) {
      expect(
        endsInOrphan(item.text, item.frame.width / 12_700, item.style.fontSizePt, item.style.fontFamily),
        item.text.slice(0, 20),
      ).toBe(false);
    }
  });
});
