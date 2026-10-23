import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, nextTextSize, type TextElement } from "../document-model";

function textElement(document = createDocument()): TextElement {
  const element = document.slides[0]!.elements[0]!;
  if (element.type !== "text") throw new Error("expected a text element");
  return element;
}

describe("text formatting commands", () => {
  it("applies one batch style to every selected text and leaves other objects alone", () => {
    const source = createDocument();
    applyCommand(source, { type: "add-shape", slideId: source.slides[0]!.id, shape: "rectangle" });
    const slide = source.slides[0]!;
    const title = slide.elements[0]!;
    const shape = slide.elements[1]!;
    applyCommand(source, { type: "add-text", slideId: slide.id });
    const body = slide.elements[2]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-style-elements",
        slideId: slide.id,
        elementIds: [title.id, shape.id, body.id],
        style: { italic: true, bullet: "dot", indentLevel: 2 },
      }),
    );
    const [nextTitle, nextShape, nextBody] = result.slides[0]!.elements;
    expect(nextTitle!.type === "text" ? nextTitle!.style.italic : undefined).toBe(true);
    expect(nextTitle!.type === "text" ? nextTitle!.style.bullet : undefined).toBe("dot");
    expect(nextTitle!.type === "text" ? nextTitle!.style.indentLevel : undefined).toBe(2);
    expect(nextBody!.type === "text" ? nextBody!.style.italic : undefined).toBe(true);
    // The shape has no text style; it must not gain one or be rejected.
    expect(nextShape!.type).toBe("shape");
    expect(commandDomain({ type: "set-text-style-elements", slideId: slide.id, elementIds: [title.id], style: {} })).toBe(
      "design",
    );
  });

  it("keeps the reviewed copy and its hash out of a formatting change", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-style-elements",
        slideId: slide.id,
        elementIds: [slide.elements[0]!.id],
        style: { bold: false, italic: true },
      }),
    );
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(result.slides[0]!.content.contentHash).toBe(slide.content.contentHash);
  });

  it("skips locked objects and refuses a batch that has nothing editable", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = textElement(source);
    title.locked = true;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-style-elements",
          slideId: slide.id,
          elementIds: [title.id],
          style: { italic: true },
        }),
      ),
    ).toThrow("ELEMENT_NOT_TEXT");
  });

  it("clears formatting back to the theme body token instead of hard-coded values", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = textElement(source);
    element.contentRef = "body";
    element.style = {
      ...element.style,
      fontFamily: "Georgia",
      fontSizePt: 40,
      color: "#FF0000",
      bold: true,
      align: "center",
      italic: true,
      strikethrough: true,
      verticalAlign: "bottom",
      bullet: "number",
      indentLevel: 4,
      lineHeight: 1.8,
    };
    source.theme = {
      name: "Theme",
      majorFont: "Georgia",
      minorFont: "Calibri",
      colors: [{ name: "primaryText", value: "#222222" }],
      textStyles: { body: { fontSizePt: 16, color: "#333333", lineHeight: 1.4 } },
    };

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "clear-text-format", slideId: slide.id, elementIds: [element.id] }),
    );
    const cleared = result.slides[0]!.elements[0]!;
    if (cleared.type !== "text") throw new Error("expected a text element");
    expect(cleared.style).toMatchObject({
      fontFamily: "Calibri",
      fontSizePt: 16,
      color: "#333333",
      bold: false,
      align: "left",
      italic: false,
      strikethrough: false,
      verticalAlign: "top",
      bullet: "none",
      indentLevel: 0,
      lineHeight: 1.4,
    });
    expect(cleared.text).toBe(element.text);
  });

  it("rejects formatting the schema or the exporter could not round-trip", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = textElement(source);
    for (const style of [
      { italic: "yes" },
      { verticalAlign: "center" },
      { bullet: "dash" },
      { indentLevel: 2.5 },
      { indentLevel: 9 },
      { lineHeight: 0.5 },
    ]) {
      expect(() =>
        produce(source, (draft) =>
          applyCommand(draft, {
            type: "set-text-style-elements",
            slideId: slide.id,
            elementIds: [element.id],
            style: style as never,
          }),
        ),
      ).toThrow("INVALID_TEXT_STYLE");
    }
  });

  it("steps the font size along the Office ladder", () => {
    expect(nextTextSize(16, "up")).toBe(18);
    expect(nextTextSize(16, "down")).toBe(14);
    expect(nextTextSize(10.5, "up")).toBe(11);
    expect(nextTextSize(120, "up")).toBe(120);
    expect(nextTextSize(8, "down")).toBe(8);
    // An off-ladder size still moves to the next rung in the requested direction.
    expect(nextTextSize(13, "up")).toBe(14);
    expect(nextTextSize(13, "down")).toBe(12);
  });

  it("formats a text without touching its geometry", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = textElement(source);
    const frame = { ...element.frame };
    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-style-elements",
        slideId: slide.id,
        elementIds: [element.id],
        style: { fontSizePt: 32, verticalAlign: "middle" },
      }),
    );
    expect(result.slides[0]!.elements[0]!.frame).toEqual(frame);
  });
});
