import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand } from "./commands";
import { createDocument, type TextElement } from "../document-model";
import { defaultConceptForPreset, resolveDeckConcept } from "../design/deck-concept";
import { endsInOrphan } from "../layout/recipes/measure";

/**
 * A comparison page set from the copy that produced the defect.
 *
 * At the page's own measure (276pt) the preferred 18pt sets
 * "规模最大，贡献绝大多数收入与利润" on two lines whose second line is the
 * single character "润". Nothing overflows, every glyph is inside its box, and
 * the page still reads as a mistake — the case has to stay fixed.
 */
const LEAD =
  "搜索与广告业务规模大、利润率高，是 Alphabet 当前的现金牛，但增速持续放缓；Google Cloud 增速保持双位数、营业利润率首次转正，标志着第二增长曲线由投入期进入兑现期。两条曲线在客户结构、利润率与资本投入上呈现明显差异。";

const LEFT = ["规模最大，贡献绝大多数收入与利润", "利润率行业领先", "面临监管与生成式 AI 双重压力"];
const RIGHT = ["收入增速保持双位数", "营业利润率首次转正", "持续投入数据中心与 AI 算力"];

function comparisonPage(): TextElement[] {
  const content = {
    title: "云业务首次实现年度盈利，标志 Alphabet 的第二增长曲线进入兑现期",
    body: LEAD,
    speakerNotes: "",
    blocks: [
      {
        type: "comparison" as const,
        leftLabel: "搜索与广告",
        rightLabel: "Google Cloud",
        leftItems: LEFT,
        rightItems: RIGHT,
      },
    ],
  };
  const facts = {
    itemCount: 6,
    shortItems: false,
    longestItemLength: 26,
    bodyLength: LEAD.length,
    hasQuote: false,
    hasComparison: true,
    hasRowBlock: false,
    layout: "split" as const,
  };
  const concept = resolveDeckConcept({
    concept: defaultConceptForPreset("instrument"),
    pageFacts: [facts],
    pageCount: 1,
    id: "comparison-orphan",
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
          layout: "split",
          background: "#FFFFFF",
          accent: "#2B5CE6",
          titleColor: "#12233E",
          bodyColor: "#3E5068",
        },
      ],
    }),
  );
  return result.slides[0]!.elements.filter((element): element is TextElement => element.type === "text");
}

describe("comparison page with long points", () => {
  it("sets the two columns so no point ends on a stranded character", () => {
    const items = comparisonPage().filter((element) => [...LEFT, ...RIGHT].includes(element.text));
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(
        endsInOrphan(item.text, item.frame.width / 12_700, item.style.fontSizePt, item.style.fontFamily),
        `${item.text}（${item.style.fontSizePt}pt，${Math.round(item.frame.width / 12_700)}pt 宽）`,
      ).toBe(false);
    }
    // The same point one point larger — the size the page would pick if the
    // orphan were ignored — does strand the last character. Without that, this
    // fixture would not be proving anything.
    const longest = items.find((item) => item.text === LEFT[0]!)!;
    expect(
      endsInOrphan(longest.text, longest.frame.width / 12_700, longest.style.fontSizePt + 1, longest.style.fontFamily),
    ).toBe(true);
  });

  it("keeps both columns on one size while it steps down", () => {
    // The whole list gives up the point together; one item set smaller than its
    // neighbours would be a worse defect than the orphan it fixes.
    const items = comparisonPage().filter((element) => [...LEFT, ...RIGHT].includes(element.text));
    expect(new Set(items.map((item) => item.style.fontSizePt)).size).toBe(1);
  });
});
