import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createDocument, type TextElement } from "../../core/document-model";
import { FormatPainterTool } from "./FormatPainterTool";

function textElements(count: number): TextElement[] {
  const document = createDocument();
  const first = document.slides[0]!.elements[0]!;
  if (first.type !== "text") throw new Error("expected a text element");
  return Array.from({ length: count }, (_, index) => ({ ...first, id: `${index + 1}` as never }));
}

const painterButton = (markup: string) => markup.match(/<button[^>]*aria-label="格式刷[^"]*"[^>]*>/)?.[0] ?? "";

describe("format painter tool", () => {
  it("is disabled without an editable text selection", () => {
    const markup = renderToStaticMarkup(<FormatPainterTool elements={[]} />);
    expect(painterButton(markup)).toContain("disabled");
  });

  it("is enabled for an editable text selection", () => {
    const markup = renderToStaticMarkup(<FormatPainterTool elements={textElements(1)} />);
    expect(painterButton(markup)).not.toContain("disabled");
  });

  it("ignores locked text when deciding whether the brush is usable", () => {
    const [element] = textElements(1);
    const markup = renderToStaticMarkup(<FormatPainterTool elements={[{ ...element!, locked: true }]} />);
    expect(painterButton(markup)).toContain("disabled");
  });
});
