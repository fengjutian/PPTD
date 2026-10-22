import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, type ElementId, type TextElement } from "../../core/document-model";
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
  });

  it("draws a text without fragments in one piece", () => {
    const element = textElement("普通文本");
    const markup = renderToStaticMarkup(<RichText element={element} scale={1} />);
    expect((markup.match(/<span/g) ?? []).length).toBe(1);
    expect(markup).toContain("普通文本");
  });
});
