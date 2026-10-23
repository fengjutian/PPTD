import { describe, expect, it } from "vitest";
import { clearedTextStyle, normalizeTextFormat, type TextElementStyle } from "../document-model";

const base: TextElementStyle = {
  fontFamily: "Microsoft YaHei",
  fontSizePt: 20,
  color: "#17181c",
  bold: false,
  align: "left",
};

describe("text style helpers", () => {
  it("spells out every optional field so the format painter copies absence too", () => {
    const format = normalizeTextFormat(base);
    expect(format).toMatchObject({
      italic: false,
      underline: false,
      strikethrough: false,
      verticalAlign: "top",
      bullet: "none",
      indentLevel: 0,
    });
    expect(format.lineHeight).toBeUndefined();
    // A target that had a line height must lose it when the source has none.
    expect(Object.keys(format)).toContain("lineHeight");
  });

  it("keeps explicit values instead of replacing them with defaults", () => {
    const format = normalizeTextFormat({
      ...base,
      italic: true,
      underline: true,
      verticalAlign: "middle",
      bullet: "dot",
      indentLevel: 3,
      lineHeight: 1.5,
    });
    expect(format).toMatchObject({
      italic: true,
      underline: true,
      verticalAlign: "middle",
      bullet: "dot",
      indentLevel: 3,
      lineHeight: 1.5,
    });
  });

  it("clears to the theme title token or the body token", () => {
    const theme = {
      name: "Theme",
      majorFont: "Georgia",
      minorFont: "Calibri",
      colors: [{ name: "primaryText", value: "#222222" }],
      textStyles: { title: { fontSizePt: 32, bold: true }, body: { fontSizePt: 16, color: "#333333" } },
    };
    expect(clearedTextStyle("title", theme)).toMatchObject({
      fontFamily: "Georgia",
      fontSizePt: 32,
      bold: true,
      color: "#222222",
    });
    expect(clearedTextStyle("body", theme)).toMatchObject({
      fontFamily: "Calibri",
      fontSizePt: 16,
      color: "#333333",
      bold: false,
    });
    // No theme: same fallback the document factory uses for a new text.
    expect(clearedTextStyle("body")).toMatchObject({ fontFamily: "Microsoft YaHei", fontSizePt: 18, color: "#17181c" });
  });
});
