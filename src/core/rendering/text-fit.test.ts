import { describe, expect, it } from "vitest";
import { createDocument, emu } from "../document-model";
import { estimateTextLines, textLikelyOverflows } from "./text-fit";

describe("text fit estimation", () => {
  it("measures a CJK glyph as a full em", () => {
    // Thirteen full width characters need thirteen em. Measuring them narrower
    // made a headline look like it fits while the renderer wrapped it.
    expect(estimateTextLines("昆佰泰基因测序整体解决方案", 13 * 20, 20)).toBe(1);
    expect(estimateTextLines("昆佰泰基因测序整体解决方案", 12 * 20, 20)).toBe(2);
  });

  it("counts a latin character as roughly half an em", () => {
    expect(estimateTextLines("AAAA", 4 * 10, 10)).toBe(1);
    // Four latin characters are 2.2 em, so they no longer fit a two em line.
    expect(estimateTextLines("AAAA", 2 * 10, 10)).toBe(2);
  });

  it("counts an empty paragraph as a line of its own", () => {
    expect(estimateTextLines("A\n\nB", 4 * 10, 10)).toBe(3);
  });

  it("counts an explicit line height when deciding whether a text fits", () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected a text element");
    element.text = "标题";
    element.frame = { ...element.frame, width: emu(2_000_000), height: emu(24 * 12_700) as typeof element.frame.height };
    element.style = { ...element.style, fontSizePt: 20, lineHeight: 1.2 };
    expect(textLikelyOverflows(element)).toBe(false);
    element.style = { ...element.style, lineHeight: 1.6 };
    expect(textLikelyOverflows(element)).toBe(true);
  });
});
