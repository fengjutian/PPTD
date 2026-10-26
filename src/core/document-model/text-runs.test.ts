import { describe, expect, it } from "vitest";
import {
  applyTextRun,
  clearTextEmphasisRange,
  isSafeTextHyperlinkUrl,
  keepTextHyperlinks,
  mergeTextRunStyle,
  mergeTextRuns,
  resolveFragmentStyle,
  setTextHyperlink,
  setTextHyperlinkRange,
  subtractTextRange,
  textFragments,
} from "./text-runs";
import type { TextElementStyle } from "./types";

const ELEMENT_STYLE: TextElementStyle = {
  fontFamily: "Microsoft YaHei",
  fontSizePt: 18,
  color: "#17181c",
  bold: false,
  align: "left",
};

describe("text runs", () => {
  it("keeps different hyperlink destinations as separate editable fragments", () => {
    const fragments = textFragments("AB", [
      { start: 0, end: 1, hyperlinkUrl: "https://example.com/a" },
      { start: 1, end: 2, hyperlinkUrl: "mailto:team@example.com" },
    ]);
    expect(fragments.map((fragment) => fragment.style.hyperlinkUrl)).toEqual([
      "https://example.com/a",
      "mailto:team@example.com",
    ]);
  });
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
    expect(runs).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2, end: 6, color: "#FF6600" },
    ]);
  });

  it("keeps the parts of a run that stick out of the range", () => {
    expect(subtractTextRange([{ start: 0, end: 10, bold: true }], 3, 5)).toEqual([
      { start: 0, end: 3, bold: true },
      { start: 5, end: 10, bold: true },
    ]);
  });

  it("merges the runs that touch each other and carry the same style", () => {
    expect(
      mergeTextRuns([
        { start: 0, end: 3, bold: true },
        { start: 3, end: 6, bold: true },
      ]),
    ).toEqual([{ start: 0, end: 6, bold: true }]);
    expect(
      mergeTextRuns([
        { start: 0, end: 3, bold: true },
        { start: 3, end: 6, color: "#FF6600" },
      ]),
    ).toHaveLength(2);
  });

  it("sets a link across a box without losing fragment emphasis", () => {
    const runs = setTextHyperlink(
      [
        { start: 0, end: 2, bold: true },
        { start: 4, end: 6, color: "#FF6600" },
      ],
      7,
      "https://example.com/report",
    );
    expect(runs).toEqual([
      { start: 0, end: 2, bold: true, hyperlinkUrl: "https://example.com/report" },
      { start: 2, end: 4, hyperlinkUrl: "https://example.com/report" },
      { start: 4, end: 6, color: "#FF6600", hyperlinkUrl: "https://example.com/report" },
      { start: 6, end: 7, hyperlinkUrl: "https://example.com/report" },
    ]);
  });

  it("clears a link and leaves the rest of the fragment styles alone", () => {
    expect(setTextHyperlink([{ start: 0, end: 3, bold: true, hyperlinkUrl: "https://example.com" }], 3, null)).toEqual([
      { start: 0, end: 3, bold: true },
    ]);
  });

  it("links only the selected range and keeps links outside it", () => {
    expect(
      setTextHyperlinkRange(
        [
          { start: 0, end: 4, hyperlinkUrl: "https://example.com/a" },
          { start: 4, end: 8, bold: true },
        ],
        10,
        2,
        6,
        "https://example.com/b",
      ),
    ).toEqual([
      { start: 0, end: 2, hyperlinkUrl: "https://example.com/a" },
      { start: 2, end: 4, hyperlinkUrl: "https://example.com/b" },
      { start: 4, end: 6, bold: true, hyperlinkUrl: "https://example.com/b" },
      { start: 6, end: 8, bold: true },
    ]);
  });

  it("clears only the range and leaves the rest of a link intact", () => {
    expect(
      setTextHyperlinkRange([{ start: 0, end: 10, hyperlinkUrl: "https://example.com/a" }], 10, 3, 6, null),
    ).toEqual([
      { start: 0, end: 3, hyperlinkUrl: "https://example.com/a" },
      { start: 6, end: 10, hyperlinkUrl: "https://example.com/a" },
    ]);
  });

  it("merges emphasis without dropping the colour or link on the words", () => {
    expect(
      mergeTextRunStyle([{ start: 0, end: 4, color: "#FF6600", hyperlinkUrl: "https://example.com/report" }], 4, 1, 3, {
        bold: true,
      }),
    ).toEqual([
      { start: 0, end: 1, color: "#FF6600", hyperlinkUrl: "https://example.com/report" },
      { start: 1, end: 3, bold: true, color: "#FF6600", hyperlinkUrl: "https://example.com/report" },
      { start: 3, end: 4, color: "#FF6600", hyperlinkUrl: "https://example.com/report" },
    ]);
  });

  it("clears emphasis without clearing the link that shares the run", () => {
    expect(
      clearTextEmphasisRange(
        [
          {
            start: 0,
            end: 6,
            bold: true,
            color: "#FF6600",
            underline: true,
            hyperlinkUrl: "https://example.com/report",
          },
        ],
        6,
        2,
        4,
      ),
    ).toEqual([
      {
        start: 0,
        end: 2,
        bold: true,
        color: "#FF6600",
        underline: true,
        hyperlinkUrl: "https://example.com/report",
      },
      { start: 2, end: 4, hyperlinkUrl: "https://example.com/report" },
      {
        start: 4,
        end: 6,
        bold: true,
        color: "#FF6600",
        underline: true,
        hyperlinkUrl: "https://example.com/report",
      },
    ]);
  });

  it("keeps only the links when character formatting is cleared", () => {
    expect(
      keepTextHyperlinks([
        { start: 0, end: 2, bold: true, hyperlinkUrl: "https://example.com/a" },
        { start: 2, end: 4, color: "#FF6600" },
        { start: 4, end: 6, underline: true, hyperlinkUrl: "https://example.com/a" },
      ]),
    ).toEqual([{ start: 0, end: 6, hyperlinkUrl: "https://example.com/a" }]);
    expect(keepTextHyperlinks([{ start: 0, end: 2, bold: true }])).toBeUndefined();
  });

  it("accepts only the documented hyperlink destinations", () => {
    expect(isSafeTextHyperlinkUrl("https://example.com/report?id=7")).toBe(true);
    expect(isSafeTextHyperlinkUrl("mailto:team@example.com")).toBe(true);
    expect(isSafeTextHyperlinkUrl("file:///C:/secret")).toBe(false);
    expect(isSafeTextHyperlinkUrl("https://example.com/\nnext")).toBe(false);
    expect(isSafeTextHyperlinkUrl("javascript:alert(1)")).toBe(false);
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
