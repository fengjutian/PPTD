import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, type SlideId, type TextElement } from "../../core/document-model";
import { TextFormatToolbar } from "./TextFormatToolbar";

const SLIDE_ID = "slide-1" as SlideId;

function textElements(count: number): TextElement[] {
  const document = createDocument();
  const first = document.slides[0]!.elements[0]!;
  if (first.type !== "text") throw new Error("expected a text element");
  return Array.from({ length: count }, (_, index) => ({
    ...first,
    id: `${index + 1}` as never,
    style: { ...first.style, italic: index === 0 },
  }));
}

function buttonTag(markup: string, label: string): string {
  return markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
}

function selectTag(markup: string, label: string): string {
  return markup.match(new RegExp(`<select[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
}

describe("text format toolbar", () => {
  it("disables the controls when no text is selected", () => {
    const markup = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={[]} execute={() => undefined} />,
    );
    expect(buttonTag(markup, "加粗")).toContain("disabled");
    expect(buttonTag(markup, "项目符号")).toContain("disabled");
    expect(buttonTag(markup, "格式刷")).toContain("disabled");
    expect(selectTag(markup, "字符间距")).toContain("disabled");
  });

  it("shows a mixed value as a dashed, unpressed toggle", () => {
    const markup = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={textElements(2)} execute={() => undefined} />,
    );
    const italic = buttonTag(markup, "斜体");
    expect(italic).toContain('data-mixed="true"');
    expect(italic).toContain('aria-pressed="false"');
  });

  it("shows the shared value of the selection", () => {
    const elements = textElements(2).map((element) => ({
      ...element,
      style: { ...element.style, italic: true },
    }));
    const markup = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={elements} execute={() => undefined} />,
    );
    expect(buttonTag(markup, "斜体")).toContain('aria-pressed="true"');
  });

  it("offers character spacing as a quick preset and marks a mixed selection", () => {
    const elements = textElements(2).map((element, index) => ({
      ...element,
      style: { ...element.style, letterSpacingPt: index === 0 ? 0.8 : 1.5 },
    }));
    const markup = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={elements} execute={() => undefined} section="font" />,
    );

    expect(selectTag(markup, "字符间距")).toContain('data-mixed="true"');
    expect(markup).toContain(">多值</option>");
    expect(markup).toContain(">很紧</option>");
    expect(markup).toContain(">常规</option>");
  });

  it("treats a locked object as not editable", () => {
    const [element] = textElements(1);
    const markup = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={[{ ...element!, locked: true }]} execute={() => undefined} />,
    );
    expect(buttonTag(markup, "加粗")).toContain("disabled");
  });

  it("splits the font and paragraph commands without losing either group", () => {
    const elements = textElements(1);
    const font = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={elements} execute={() => undefined} section="font" />,
    );
    const paragraph = renderToStaticMarkup(
      <TextFormatToolbar slideId={SLIDE_ID} elements={elements} execute={() => undefined} section="paragraph" />,
    );

    expect(font).toContain('aria-label="字体"');
    expect(buttonTag(font, "加粗")).not.toBe("");
    expect(buttonTag(font, "清除格式")).not.toBe("");
    expect(selectTag(font, "字符间距")).not.toBe("");
    expect(buttonTag(font, "项目符号")).toBe("");

    expect(buttonTag(paragraph, "项目符号")).not.toBe("");
    expect(paragraph).toContain('aria-label="水平对齐"');
    expect(buttonTag(paragraph, "加粗")).toBe("");
    expect(paragraph).not.toContain('aria-label="字体"');
    expect(paragraph).not.toContain('aria-label="字符间距"');
  });
});
