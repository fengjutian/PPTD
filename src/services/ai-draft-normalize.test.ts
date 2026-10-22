import { describe, expect, it } from "vitest";
import { normalizeDraftPunctuation } from "./ai-draft-normalize";
import type { AiDraft } from "./ai-service";

function draft(slides: AiDraft["slides"]): AiDraft {
  return {
    title: "季度经营回顾",
    presentationBrief: {
      objective: "回顾经营情况",
      audience: "管理层",
      scenario: "季度会",
      expectedAction: "确认下季度重点",
      coreConclusion: "毛利承压",
      narrativeStrategy: "management-report",
      assumptions: ["数据来自内部系统"],
    },
    slides,
  };
}

describe("草稿标点规范化", () => {
  it("把标题与正文里的半角标点转成全角", () => {
    // 实测真实产出：模型把中文标题的逗号写成了半角。
    const result = normalizeDraftPunctuation(draft([
      { title: "营收达成预算目标,盈利能力承压", body: "毛利率同比下降;费用节约未能对冲", speakerNotes: "先讲营收,再讲毛利" },
    ]));
    expect(result.slides[0]!.title).toBe("营收达成预算目标，盈利能力承压");
    expect(result.slides[0]!.body).toBe("毛利率同比下降；费用节约未能对冲");
    expect(result.slides[0]!.speakerNotes).toBe("先讲营收，再讲毛利");
  });

  it("规范化内容块里的文字", () => {
    const result = normalizeDraftPunctuation(draft([
      {
        title: "标题",
        body: "",
        speakerNotes: "",
        blocks: [
          { type: "paragraph", text: "营收增长,毛利率承压" },
          { type: "bullet-list", items: ["门店扩张放缓,单店效率分化"] },
          { type: "quote", text: "增长来自客流,不是客单", attribution: "《季度回顾》,第 3 页" },
          { type: "metric", label: "毛利率(同比)", value: "18.2%" },
          { type: "comparison", leftLabel: "核心商圈", rightLabel: "社区店", leftItems: ["坪效高,复购稳"], rightItems: ["客群老化"] },
          { type: "table-data", header: ["指标", "同比"], rows: [["营收", "12,345 万元"]] },
        ],
      },
    ]));
    const blocks = result.slides[0]!.blocks!;
    expect(blocks[0]).toMatchObject({ text: "营收增长，毛利率承压" });
    expect(blocks[1]).toMatchObject({ items: ["门店扩张放缓，单店效率分化"] });
    expect(blocks[2]).toMatchObject({ text: "增长来自客流，不是客单", attribution: "《季度回顾》，第 3 页" });
    expect(blocks[3]).toMatchObject({ label: "毛利率（同比）" });
    expect(blocks[4]).toMatchObject({ leftItems: ["坪效高，复购稳"] });
    // 表格里的千分位不是标点，不能动。
    expect(blocks[5]).toMatchObject({ rows: [["营收", "12,345 万元"]] });
  });

  it("不动西文语境里的半角标点", () => {
    const result = normalizeDraftPunctuation(draft([
      { title: "营收 12,345 万元", body: "Revenue, net 保持增长", speakerNotes: "" },
    ]));
    expect(result.slides[0]!.title).toBe("营收 12,345 万元");
    expect(result.slides[0]!.body).toBe("Revenue, net 保持增长");
  });

  it("规范化文稿标题与页面计划", () => {
    const result = normalizeDraftPunctuation({
      ...draft([]),
      title: "经营回顾,下季度重点",
      slides: [{
        title: "页标题",
        body: "",
        speakerNotes: "",
        plan: { purpose: "回顾经营,确认重点", conclusion: "毛利承压,客单待提", visualIntent: "summary", density: "medium" },
      }],
    });
    expect(result.title).toBe("经营回顾，下季度重点");
    expect(result.slides[0]!.plan!.purpose).toBe("回顾经营，确认重点");
    expect(result.slides[0]!.plan!.conclusion).toBe("毛利承压，客单待提");
  });
});
