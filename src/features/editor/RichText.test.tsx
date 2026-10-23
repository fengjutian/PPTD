import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, type TextElement } from "../../core/document-model";
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
    // Both fragments live in one paragraph box; the vertical-alignment flex
    // wrapper must not turn every styled run into its own line.
    expect(markup).toContain('<div style="width:100%"><span');
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
});
