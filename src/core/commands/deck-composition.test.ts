import { describe, expect, it } from "vitest";
import { alternativeComposition, planDeckCompositions, type DeckPageFacts } from "./deck-composition";
import type { CompositionFacts } from "./design-intent";

const facts = (overrides: Partial<CompositionFacts> = {}): CompositionFacts => ({
  itemCount: 4,
  shortItems: true,
  longestItemLength: 20,
  bodyLength: 80,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: false,
  layout: "cards",
  ...overrides,
});

const page = (overrides: Partial<CompositionFacts> = {}, requested?: DeckPageFacts["requested"]): DeckPageFacts => ({
  facts: facts(overrides),
  requested,
});

describe("整册构图编排", () => {
  it("不让同一构图连续出现三页", () => {
    const plan = planDeckCompositions([page(), page(), page(), page()]);
    // 三页同样的内容形状，本来会得到三页一样的骨架。
    expect(plan.compositions[0]).toBe("grid");
    expect(plan.compositions[1]).toBe("grid");
    expect(plan.compositions[2]).not.toBe("grid");
    // 任何构图都不该连续出现三次。
    const run = (index: number) => plan.compositions[index] === plan.compositions[index - 1] && plan.compositions[index] === plan.compositions[index - 2];
    expect([0, 1, 2, 3].some(run)).toBe(false);
  });

  it("记录为了节奏而改动的构图和原因", () => {
    const plan = planDeckCompositions([page(), page(), page()]);
    expect(plan.adjustments).toHaveLength(1);
    expect(plan.adjustments[0]).toMatchObject({ slideIndex: 2, from: "grid" });
    expect(plan.adjustments[0]!.reason).toContain("构图");
  });

  it("模型明确指定的构图不被节奏改掉", () => {
    const plan = planDeckCompositions([page({}, "grid"), page({}, "grid"), page({}, "grid")]);
    expect(plan.compositions).toEqual(["grid", "grid", "grid"]);
    expect(plan.adjustments).toHaveLength(0);
  });

  it("内容装不下的构图不会被采用", () => {
    // 八条长要点排不成卡片网格。
    const plan = planDeckCompositions([page({ itemCount: 8, shortItems: false, longestItemLength: 90 }, "grid")]);
    expect(plan.compositions[0]).not.toBe("grid");
  });

  it("备选构图必须是这一页装得下的", () => {
    // 两条要点撑不起编辑式页面。
    expect(alternativeComposition(facts({ itemCount: 2 }), ["editorial", "columns", "grid"])).toBe("stacked");
    // 八条长要点排不成卡片网格，也放不进编辑式页面。
    expect(alternativeComposition(facts({ itemCount: 8, shortItems: false, longestItemLength: 90 }), ["columns"])).toBe("stacked");
    // 备选不会选到刚刚用过的构图。
    expect(alternativeComposition(facts(), ["editorial"])).toBe("columns");
  });

  it("带结构化内容块的页面由内容块决定构图", () => {
    const plan = planDeckCompositions([page({ hasRowBlock: true }), page({ hasRowBlock: true })]);
    expect(plan.compositions).toEqual(["auto", "auto"]);
  });
});
