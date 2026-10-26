import { describe, expect, it } from "vitest";
import { createDocument, emu } from "../document-model";
import { estimateTextLines, fitTextToFrame, textLikelyOverflows } from "./text-fit";

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

describe("fitting a text block to its frame", () => {
  it("keeps the requested size when the whole block fits", () => {
    const fit = fitTextToFrame("昆佰泰基因测序整体解决方案", {
      width: 13 * 20,
      height: 20 * 1.25,
      fontSize: 20,
      lineHeight: 1.25,
    });
    expect(fit.fontSize).toBe(20);
    expect(fit.lines).toHaveLength(1);
    expect(fit.shrunk).toBe(false);
    expect(fit.overflow).toBe(false);
  });

  it("breaks exactly where the layout counted its lines", () => {
    // The preview used to measure the same text with the canvas metrics of its
    // own font size, count one line more than the layout and drop the overflow.
    const text = "规模最大，贡献绝大多数收入与利润";
    const lines = estimateTextLines(text, 16.5 * 18, 18);
    const fit = fitTextToFrame(text, { width: 16.5 * 18, height: 18 * 1.3 * 3, fontSize: 18, lineHeight: 1.3 });
    expect(fit.lines).toHaveLength(lines);
  });

  it("shrinks an overfull block instead of dropping its last line", () => {
    // A frame measured for one line, holding a sentence that needs two. Picking
    // the first line and returning it is how the last character of a reviewed
    // sentence disappeared from the preview.
    const text = "昆佰泰基因测序整体解决方案";
    const fit = fitTextToFrame(text, { width: 12 * 20, height: 20 * 1.25, fontSize: 20, lineHeight: 1.25 });
    expect(fit.shrunk).toBe(true);
    expect(fit.overflow).toBe(false);
    expect(fit.lines).toHaveLength(1);
    expect(fit.lines.join("")).toBe(text);
    expect(fit.fontSize).toBeLessThan(20);
  });

  it("keeps every paragraph and every character when it shrinks", () => {
    const text = "搜索与广告\n利润率行业领先\n面临监管与生成式 AI 双重压力";
    const fit = fitTextToFrame(text, { width: 200, height: 60, fontSize: 18, lineHeight: 1.25 });
    expect(fit.shrunk).toBe(true);
    expect(fit.overflow).toBe(false);
    expect(fit.lines).toHaveLength(3);
    expect(fit.lines.join("")).toBe(text.replace(/\n/g, ""));
  });

  it("reports a conflict when even the smallest size cannot hold the copy", () => {
    const fit = fitTextToFrame("昆佰泰基因测序整体解决方案", {
      width: 40,
      height: 4,
      fontSize: 20,
      lineHeight: 1.25,
      minimumScale: 0.55,
    });
    expect(fit.overflow).toBe(true);
    // It stops at the floor instead of shrinking the copy into unreadable type.
    expect(fit.fontSize).toBeGreaterThanOrEqual(20 * 0.55);
    expect(fit.fontSize).toBeLessThanOrEqual(20 * 0.55 + 0.01);
  });
});
