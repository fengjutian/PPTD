import { describe, expect, it } from "vitest";
import { findHalfWidthPunctuation, normalizeChinesePunctuation } from "./punctuation";

describe("中文标点规范化", () => {
  it("把中文语境里的半角标点转成全角", () => {
    // 实测真实产出：模型把中文标题里的逗号写成了半角。
    expect(normalizeChinesePunctuation("Q2 营收达成预算目标,盈利能力出现结构性压力")).toBe(
      "Q2 营收达成预算目标，盈利能力出现结构性压力",
    );
    expect(normalizeChinesePunctuation("增长放缓;毛利率承压")).toBe("增长放缓；毛利率承压");
    expect(normalizeChinesePunctuation("结论:三点")).toBe("结论：三点");
  });

  it("保留西文语境里的半角标点", () => {
    // 千分位不是标点，Revenue, net 也不是。
    expect(normalizeChinesePunctuation("营收 12,345 万元")).toBe("营收 12,345 万元");
    expect(normalizeChinesePunctuation("Revenue, net")).toBe("Revenue, net");
    expect(normalizeChinesePunctuation("2026,2027")).toBe("2026,2027");
  });

  it("只转成对的括号，不留下半边", () => {
    expect(normalizeChinesePunctuation("增长(target)明确")).toBe("增长（target）明确");
    // 右括号在中文语境里也要转。
    expect(normalizeChinesePunctuation("规模扩大(显著)")).toBe("规模扩大（显著）");
  });

  it("纯西文文本完全不动", () => {
    const text = "Revenue, net margin: 12% (Q2)";
    expect(normalizeChinesePunctuation(text)).toBe(text);
  });

  it("空文本安全", () => {
    expect(normalizeChinesePunctuation("")).toBe("");
  });

  it("报出混用的半角标点及其上下文", () => {
    const found = findHalfWidthPunctuation("目标,盈利");
    expect(found).toHaveLength(1);
    expect(found[0]!.character).toBe(",");
    expect(found[0]!.context).toContain("目标,盈利");
  });

  it("西文语境里的半角标点不算问题", () => {
    expect(findHalfWidthPunctuation("12,345 万元")).toHaveLength(0);
  });
});
