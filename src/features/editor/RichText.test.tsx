import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type TextElement } from "../../core/document-model";
import { estimateTextLines, runMetricsOf } from "../../core/rendering/text-fit";
import { RichText } from "./RichText";

function textElement(text: string, runs?: TextElement["runs"]): TextElement {
  const document = createDocument();
  const element = document.slides[0]!.elements[0]!;
  if (element.type !== "text") throw new Error("expected a text element");
  element.text = text;
  element.style = { ...element.style, bold: false };
  element.runs = runs;
  return element;
}

describe("rich text", () => {
  it("draws the emphasised words with their own weight", () => {
    const element = textElement("覆盖机构：12万", [{ start: 0, end: 4, bold: true }]);
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect(markup).toContain("覆盖机构");
    expect(markup).toContain("：12万");
    // The emphasised fragment carries the weight, the rest does not.
    expect((markup.match(/font-weight:700/g) ?? []).length).toBe(1);
    // Both fragments live in one line box; the vertical-alignment wrapper must
    // not turn every styled run into its own line.
    expect((markup.match(/data-line=/g) ?? []).length).toBe(1);
  });

  it("draws a text without fragments in one piece", () => {
    const element = textElement("普通文本");
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect((markup.match(/<span/g) ?? []).length).toBe(1);
    expect(markup).toContain("普通文本");
  });

  it("draws the tracking and leading of the text style", () => {
    const element = textElement("标题");
    element.style = { ...element.style, letterSpacingPt: 0.8, lineHeight: 1.3 };
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect(markup).toContain("letter-spacing");
    expect(markup).toContain("line-height:1.3");
  });

  it("draws italic, underline and strike without changing the copy", () => {
    const element = textElement("斜体文字");
    element.style = { ...element.style, italic: true, underline: true, strikethrough: true };
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect(markup).toContain("font-style:italic");
    expect(markup).toContain("text-decoration:underline line-through");
    expect(markup).toContain("斜体文字");
  });

  it("draws a marker for every line of a bulleted text", () => {
    const element = textElement("甲\n乙");
    element.style = { ...element.style, bullet: "dot" };
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect((markup.match(/•/g) ?? []).length).toBe(2);
    expect(markup).toContain("甲");
    expect(markup).toContain("乙");
    // The marker is drawn next to the copy, never written into it.
    expect(element.text).toBe("甲\n乙");
  });

  it("numbers the lines and honours the vertical alignment", () => {
    const element = textElement("第一行\n第二行");
    element.style = { ...element.style, bullet: "number", verticalAlign: "middle" };
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect(markup).toContain("1.");
    expect(markup).toContain("2.");
    expect(markup).toContain("justify-content:center");
  });

  it("breaks the copy where the layout counted the lines", () => {
    // The canvas used to let the browser wrap; a headline that the engine
    // measured as two lines could show as one on the canvas and as three in the
    // file. Each measured line is now its own no-wrap box.
    const element = textElement("搜索与广告业务规模大、利润率高，是 Alphabet 当前的现金牛，但增速持续放缓");
    element.style = { ...element.style, fontSizePt: 18, lineHeight: 1.25 };
    element.frame = { ...element.frame, width: emu(4 * 914_400), height: emu(2.4 * 914_400) };
    const expected = estimateTextLines(
      element.text,
      element.frame.width / 12_700,
      element.style.fontSizePt,
      element.style.fontFamily,
      runMetricsOf(element),
    );
    expect(expected).toBeGreaterThan(1);
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect((markup.match(/data-line=/g) ?? []).length).toBe(expected);
    // Every line is locked against the browser wrapping it a second time.
    expect((markup.match(/white-space:pre/g) ?? []).length).toBe(expected);
  });
});
