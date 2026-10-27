import { describe, expect, it } from "vitest";
import { legacySlidePlan, type AiDraft, type DesignTemplateContext, type SlideBrief } from "./ai-contracts";
import { buildDesignIntelligence } from "./design-intelligence";

const draft: AiDraft = {
  title: "经营复盘",
  presentationBrief: {
    objective: "复盘经营结果",
    audience: "管理层",
    scenario: "季度复盘",
    expectedAction: "确认下一步",
    coreConclusion: "产品升级带来增长",
    narrativeStrategy: "retrospective",
    assumptions: [],
  },
  slides: [
    { title: "结论", body: "增长来自产品升级", speakerNotes: "", blocks: [], plan: legacySlidePlan },
    {
      title: "前后对比",
      body: "升级前\n升级后",
      speakerNotes: "",
      blocks: [{ type: "comparison", leftLabel: "前", rightLabel: "后", leftItems: ["旧"], rightItems: ["新"] }],
      plan: legacySlidePlan,
    },
    { title: "总结", body: "下一步", speakerNotes: "", blocks: [], plan: legacySlidePlan },
  ],
};

const briefs: SlideBrief[] = draft.slides.map((_, slideIndex) => ({
  slideIndex,
  purpose: "说明",
  conclusion: "结论",
  visualIntent: slideIndex === 1 ? "comparison" : "structured-text",
  density: "medium",
}));

const template: DesignTemplateContext = {
  slideWidthEmu: 10_000,
  slideHeightEmu: 5_625,
  themeColors: [{ name: "accent", value: "#2255AA" }],
  majorFont: "Aptos Display",
  minorFont: "Aptos",
  defaultBackgroundColor: "#FFFFFF",
  slides: [],
  layouts: [
    {
      index: 0,
      name: "双栏",
      backgroundColor: "#FFFFFF",
      regions: [
        { role: "title", x: 800, y: 500, width: 8400, height: 800 },
        { role: "body", x: 800, y: 1600, width: 8400, height: 3200 },
      ],
      capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 2, free: false },
    },
  ],
};

describe("design intelligence", () => {
  it("recognizes semantic relations and plans a deck rhythm before layout", () => {
    const plan = buildDesignIntelligence(draft, briefs, template);
    expect(plan.slides.map((slide) => slide.rhythmRole)).toEqual(["opening", "turn", "close"]);
    expect(plan.slides[1]).toMatchObject({ relation: "comparison", focalPriority: "body" });
    expect(plan.slides[1]!.preferredFamilies).toContain("comparison");
  });

  it("extracts normalized brand axes, columns, palette and fonts", () => {
    const plan = buildDesignIntelligence(draft, briefs, template);
    expect(plan.brandGrammar).toMatchObject({
      titleAxes: [80],
      bodyColumns: [2],
      palette: ["#2255AA"],
      fonts: ["Aptos Display", "Aptos"],
    });
  });
});
