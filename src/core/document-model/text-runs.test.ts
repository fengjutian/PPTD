import { describe, expect, it } from "vitest";
import { applyTextRun, mergeTextRuns, resolveFragmentStyle, subtractTextRange, textFragments } from "./text-runs";
import type { TextElementStyle } from "./types";

const ELEMENT_STYLE: TextElementStyle = { fontFamily: "Microsoft YaHei", fontSizePt: 18, color: "#17181c", bold: false, align: "left" };

describe("text runs", () => {
  it("returns the whole text as one fragment when nothing is emphasised", () => {
    expect(textFragments("覆盖机构", undefined)).toEqual([{ text: "覆盖机构", style: {}, start: 0, end: 4 }]);
  });

  it("splits the text into the fragments the runs describe", () => {
    const fragments = textFragments("覆盖机构：12万", [{ start: 0, end: 4, bold: true }]);
    expect(fragments.map((fragment) => fragment.text)).toEqual(["覆盖机构", "：12万"]);
    expect(fragments[0]!.style.bold).toBe(true);
    expect(fragments[1]!.style.bold).toBeUndefined();
    expect(fragments[0]!.start).toBe(0);
    expect(fragments[0]!.end).toBe(4);
  });

  it("applies a style to a range and replaces the runs that covered it", () => {
    const runs = applyTextRun([{ start: 0, end: 4, bold: true }], 2, 6, { color: "#FF6600" });
    expect(runs).toEqual([{ start: 0, end: 2, bold: true }, { start: 2, end: 6, color: "#FF6600" }]);
  });

  it("keeps the parts of a run that stick out of the range", () => {
    expect(subtractTextRange([{ start: 0, end: 10, bold: true }], 3, 5)).toEqual([{ start: 0, end: 3, bold: true }, { start: 5, end: 10, bold: true }]);
  });

  it("merges the runs that touch each other and carry the same style", () => {
    expect(mergeTextRuns([{ start: 0, end: 3, bold: true }, { start: 3, end: 6, bold: true }])).toEqual([{ start: 0, end: 6, bold: true }]);
    expect(mergeTextRuns([{ start: 0, end: 3, bold: true }, { start: 3, end: 6, color: "#FF6600" }])).toHaveLength(2);
  });

  it("lets the element decide the properties a run does not mention", () => {
    const bold = resolveFragmentStyle({ ...ELEMENT_STYLE, bold: true }, { color: "#FF6600" });
    expect(bold).toEqual({ bold: true, color: "#FF6600", underline: false });
    const plain = resolveFragmentStyle(ELEMENT_STYLE, {});
    expect(plain).toEqual({ bold: false, color: "#17181c", underline: false });
  });

  it("keeps a run that turns the weight off even when the element is bold", () => {
    const fragments = textFragments("整段加粗", [{ start: 0, end: 2, bold: false }]);
    expect(resolveFragmentStyle({ ...ELEMENT_STYLE, bold: true }, fragments[0]!.style).bold).toBe(false);
  });
});
