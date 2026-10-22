import { describe, expect, it } from "vitest";
import {
  assessLayoutCapacity,
  fitComparisonColumn,
  LAYOUT_CAPACITY,
  stripListPrefix,
  type CapacityBlockFacts,
} from "./layout-capacity";

const points = (count: number, length = 8): string[] => Array.from({ length: count }, (_, index) => `${index + 1}. ${"点".repeat(length)}`);

function assess(items: string[], overrides: Partial<Parameters<typeof assessLayoutCapacity>[0]> = {}) {
  return assessLayoutCapacity({ index: 1, title: "标题", items, bodyLength: 0, ...overrides });
}

describe("layout capacity rules", () => {
  it("removes the list marker a writer typed into a point", () => {
    expect(stripListPrefix("1. 第一条")).toBe("第一条");
    expect(stripListPrefix("一、第二条")).toBe("第二条");
    expect(stripListPrefix("• 第三条")).toBe("第三条");
    expect(stripListPrefix("普通要点")).toBe("普通要点");
  });

  it("warns about a title that does not fit the one line of the title box", () => {
    const notes = assess([], { title: "标".repeat(40) });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ severity: "warning", scope: "title" });
    expect(notes[0]!.message).toContain("折成 2 行");
    // A title that fits stays silent.
    expect(assess([], { title: "短标题" })).toHaveLength(0);
  });

  it("reads the point count of a page and names the layout it can carry", () => {
    expect(assess(points(1))[0]!.message).toContain("只有 1 条要点");
    expect(assess(points(2))[0]!.message).toContain("2 条要点");
    expect(assess(points(3))[0]!.message).toContain("3 列卡片网格");
    expect(assess(points(4))[0]!.message).toContain("2 列卡片网格");
    expect(assess(points(5))[0]!.message).toContain("3 列卡片网格");
    const overflow = assess(points(LAYOUT_CAPACITY.cardsMaxItems + 1));
    expect(overflow[0]).toMatchObject({ severity: "warning", scope: "items" });
    expect(overflow[0]!.message).toContain(`超过卡片网格的 ${LAYOUT_CAPACITY.cardsMaxItems} 条上限`);
  });

  it("names the point that is too long for a card", () => {
    const long = assess(["短要点", "长".repeat(LAYOUT_CAPACITY.cardItemLengthLimit + 1)]);
    const note = long.find((entry) => entry.message.includes("超过卡片版式"));
    expect(note).toMatchObject({ severity: "warning" });
    // Between the two limits the point still fits a card, it only wraps.
    const wraps = assess(["长".repeat(LAYOUT_CAPACITY.shortItemLength + 1)]);
    const wrapped = wraps.find((entry) => entry.message.includes("卡片里会折行"));
    expect(wrapped).toMatchObject({ severity: "info" });
  });

  it("reads the body copy against the card limit", () => {
    const over = assess(points(3), { bodyLength: LAYOUT_CAPACITY.cardBodyLengthLimit + 1 });
    expect(over.find((entry) => entry.message.includes("正文"))!.message).toContain("这页排不成卡片网格");
    const near = assess(points(3), { bodyLength: LAYOUT_CAPACITY.cardBodyLength + 1 });
    const note = near.find((entry) => entry.message.includes("正文"));
    expect(note).toMatchObject({ severity: "info" });
    expect(note!.message).toContain("卡片网格最多排");
  });

  it("keeps the cover rules for the first page only", () => {
    const cover = assessLayoutCapacity({ index: 0, title: "封面", items: points(1), bodyLength: LAYOUT_CAPACITY.coverBodyLength + 1 });
    expect(cover[0]!.message).toContain("超过封面");
    const content = assessLayoutCapacity({ index: 0, title: "封面", items: points(3), bodyLength: 0 });
    expect(content[0]).toMatchObject({ severity: "warning" });
    expect(content[0]!.message).toContain("会排成内容页而不是封面");
    // The same content on a later page is a normal page.
    expect(assess(points(3))[0]!.message).toContain("卡片网格");
  });

  it("hangs a note on the block it talks about", () => {
    const notes = assess(points(7), { itemBlockIndex: 2 });
    expect(notes[0]!.blockIndex).toBe(2);
  });

  it("describes a comparison that is out of balance", () => {
    const blocks: CapacityBlockFacts[] = [{ index: 0, type: "comparison", itemCount: 5, leftItems: ["a", "b", "c", "d"], rightItems: ["e"] }];
    const notes = assessLayoutCapacity({ index: 1, title: "对比", items: [], bodyLength: 0, blocks });
    expect(notes[0]).toMatchObject({ severity: "warning", scope: "comparison", blockIndex: 0 });
    expect(notes[0]!.message).toContain("两栏相差 3 条");
  });

  it("warns about a step row that has more steps than a row can carry", () => {
    const blocks: CapacityBlockFacts[] = [{ index: 1, type: "timeline", itemCount: LAYOUT_CAPACITY.rowBlockMaxItems + 2 }];
    const notes = assessLayoutCapacity({ index: 1, title: "里程碑", items: [], bodyLength: 0, blocks });
    expect(notes[0]).toMatchObject({ severity: "warning", scope: "block", blockIndex: 1 });
    expect(notes[0]!.message).toContain("会全部排上");
    // A row that fits stays silent.
    const quiet = assessLayoutCapacity({ index: 1, title: "里程碑", items: [], bodyLength: 0, blocks: [{ index: 1, type: "timeline", itemCount: 3 }] });
    expect(quiet).toHaveLength(0);
  });

  it("warns about a page that carries more metrics than a card grid can show", () => {
    const blocks: CapacityBlockFacts[] = Array.from({ length: LAYOUT_CAPACITY.rowBlockMaxItems + 1 }, (_, index) => ({ index, type: "metric" as const, itemCount: 1 }));
    const notes = assessLayoutCapacity({ index: 1, title: "指标", items: [], bodyLength: 0, blocks });
    expect(notes[0]).toMatchObject({ severity: "warning", scope: "block", blockIndex: 0 });
    expect(notes[0]!.message).toContain("个指标");
  });

  it("does not describe a point list that the page does not carry", () => {
    const blocks: CapacityBlockFacts[] = [{ index: 0, type: "comparison", itemCount: 2, leftItems: ["a"], rightItems: ["b"] }];
    const notes = assessLayoutCapacity({ index: 1, title: "对比", items: points(7), bodyLength: 0, blocks });
    expect(notes.every((note) => note.scope === "comparison")).toBe(true);
  });
});

describe("comparison column fit", () => {
  it("keeps the preferred size when the column has room", () => {
    const fit = fitComparisonColumn(["第一条", "第二条"]);
    expect(fit.fittedFontSizePt).toBe(fit.preferredFontSizePt);
    expect(fit.fits).toBe(true);
  });

  it("shrinks the copy instead of dropping a point", () => {
    const fit = fitComparisonColumn(Array.from({ length: 5 }, () => "比".repeat(20)));
    expect(fit.fits).toBe(true);
    expect(fit.fittedFontSizePt).toBeLessThan(fit.preferredFontSizePt);
    expect(fit.fittedFontSizePt).toBeGreaterThanOrEqual(12);
  });

  it("reports a column that cannot be shrunk far enough", () => {
    const fit = fitComparisonColumn(Array.from({ length: 8 }, () => "比".repeat(30)));
    expect(fit.fits).toBe(false);
  });
});
