import { describe, expect, it } from "vitest";
import { produce } from "immer";

import { applyCommand, commandDomain } from "./commands";
import { createDocument, type TextElement } from "../document-model";

function titleOf(document = createDocument()): TextElement {
  const element = document.slides[0]!.elements[0]!;
  if (element.type !== "text") throw new Error("expected a text element");
  return element;
}

describe("text hyperlink commands", () => {
  it("links the whole selected text box and keeps the reviewed copy untouched", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = titleOf(source);
    const contentBefore = JSON.stringify(slide.content);

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-hyperlink",
        slideId: slide.id,
        elementIds: [title.id],
        url: "https://example.com/report",
      }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.runs : undefined).toEqual([
      { start: 0, end: title.text.length, hyperlinkUrl: "https://example.com/report" },
    ]);
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(result.slides[0]!.content.contentHash).toBe(slide.content.contentHash);
  });

  it("keeps existing emphasis when a link is added", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.runs = [{ start: 0, end: 2, bold: true }];
    const slide = source.slides[0]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-hyperlink",
        slideId: slide.id,
        elementIds: [title.id],
        url: "mailto:team@example.com",
      }),
    );
    const next = result.slides[0]!.elements[0]!;
    const runs = next.type === "text" ? (next.runs ?? []) : [];
    expect(runs[0]).toMatchObject({ start: 0, end: 2, bold: true, hyperlinkUrl: "mailto:team@example.com" });
    expect(runs.at(-1)?.end).toBe(title.text.length);
  });

  it("removes a link without changing the text", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.runs = [{ start: 0, end: title.text.length, hyperlinkUrl: "https://example.com" }];
    const slide = source.slides[0]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "set-text-hyperlink", slideId: slide.id, elementIds: [title.id], url: null }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.text : undefined).toBe(title.text);
    expect(next.type === "text" ? next.runs : undefined).toBeUndefined();
  });

  it("refuses an unsafe destination and a selection without editable text", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = titleOf(source);
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-hyperlink",
          slideId: slide.id,
          elementIds: [title.id],
          url: "file:///C:/secret",
        }),
      ),
    ).toThrow("TEXT_HYPERLINK_INVALID");

    title.locked = true;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-hyperlink",
          slideId: slide.id,
          elementIds: [title.id],
          url: "https://example.com",
        }),
      ),
    ).toThrow("ELEMENT_NOT_TEXT");
  });

  it("is design work and creates no undo entry when nothing changes", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = titleOf(source);
    const command = {
      type: "set-text-hyperlink" as const,
      slideId: slide.id,
      elementIds: [title.id],
      url: null,
    };
    expect(commandDomain(command, source)).toBeNull();

    title.runs = [{ start: 0, end: title.text.length, hyperlinkUrl: "https://example.com" }];
    expect(commandDomain(command, source)).toBe("design");
    expect(commandDomain({ ...command, url: "https://example.com" }, source)).toBeNull();
  });
});
