import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FactPicker } from "./FactPicker";
import { selectedFacts } from "./facts";

const facts = [
  {
    id: "F1",
    statement: "2024 年智能云收入 320 亿元，同比增长 12%",
    figure: "320 亿元",
    period: "2024 年",
    source: "2024 年报",
  },
  { id: "F2", statement: "2024 年在线营销收入 730 亿元", figure: "730 亿元" },
];

describe("素材事实清单", () => {
  it("显示每条事实的编号、出处和参与生成的条数", () => {
    const markup = renderToStaticMarkup(
      <FactPicker facts={facts} excluded={new Set(["F2"])} onToggle={() => undefined} onRemove={() => undefined} />,
    );
    expect(markup).toContain("1/2 条将用于生成");
    expect(markup).toContain("2024 年智能云收入 320 亿元，同比增长 12%");
    expect(markup).toContain("320 亿元 · 2024 年 · 2024 年报");
    // 被排除的条目仍然在清单里，只是变灰；删除是另一个动作。
    expect(markup).toContain("删除事实 F2");
    expect(markup).toContain("excluded");
  });

  it("没有事实时不占位置", () => {
    const markup = renderToStaticMarkup(
      <FactPicker facts={[]} excluded={new Set()} onToggle={() => undefined} onRemove={() => undefined} />,
    );
    expect(markup).toBe("");
  });

  it("只把没被勾掉的事实交给生成，顺序不变", () => {
    expect(selectedFacts(facts, new Set(["F2"])).map((fact) => fact.id)).toEqual(["F1"]);
    expect(selectedFacts(facts, new Set(["F1", "F2"]))).toEqual([]);
    expect(selectedFacts(facts, new Set()).map((fact) => fact.id)).toEqual(["F1", "F2"]);
  });
});
