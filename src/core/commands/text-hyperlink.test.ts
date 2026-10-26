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

  it("links only the selected range and leaves the copy and other styles alone", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.text = "Open report now";
    title.runs = [{ start: 0, end: 4, bold: true }];
    const slide = source.slides[0]!;
    const contentBefore = JSON.stringify(slide.content);

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-hyperlink",
        slideId: slide.id,
        elementIds: [title.id],
        url: "https://example.com/report",
        range: { start: 5, end: 11 },
      }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.text : undefined).toBe("Open report now");
    expect(next.type === "text" ? next.runs : undefined).toEqual([
      { start: 0, end: 4, bold: true },
      { start: 5, end: 11, hyperlinkUrl: "https://example.com/report" },
    ]);
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
    expect(result.slides[0]!.content.contentHash).toBe(slide.content.contentHash);
  });

  it("clears only the selected range of a link", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.text = "Open report now";
    title.runs = [
      { start: 0, end: 4, hyperlinkUrl: "https://example.com/open" },
      { start: 5, end: 11, hyperlinkUrl: "https://example.com/report" },
    ];
    const slide = source.slides[0]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-hyperlink",
        slideId: slide.id,
        elementIds: [title.id],
        url: null,
        range: { start: 5, end: 11 },
      }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.runs : undefined).toEqual([
      { start: 0, end: 4, hyperlinkUrl: "https://example.com/open" },
    ]);
  });

  it("refuses a range that addresses more than one text box or leaves the copy", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = titleOf(source);
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-hyperlink",
          slideId: slide.id,
          elementIds: [title.id, title.id],
          url: "https://example.com",
          range: { start: 0, end: 2 },
        }),
      ),
    ).toThrow("TEXT_HYPERLINK_RANGE_INVALID");
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-hyperlink",
          slideId: slide.id,
          elementIds: [title.id],
          url: "https://example.com",
          range: { start: 0, end: title.text.length + 1 },
        }),
      ),
    ).toThrow("TEXT_HYPERLINK_RANGE_INVALID");
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

    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-text-emphasis",
          slideId: slide.id,
          elementId: title.id,
          start: 0,
          end: 2,
          style: { hyperlinkUrl: "file:///C:/secret" },
        }),
      ),
    ).toThrow("INVALID_TEXT_EMPHASIS");

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

  it("adds emphasis without clearing a link in the same range", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.runs = [{ start: 0, end: 4, hyperlinkUrl: "https://example.com/report" }];
    const slide = source.slides[0]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "set-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 2,
        style: { bold: true },
      }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.runs : undefined).toEqual([
      { start: 0, end: 2, bold: true, hyperlinkUrl: "https://example.com/report" },
      { start: 2, end: 4, hyperlinkUrl: "https://example.com/report" },
    ]);
  });

  it("clears emphasis without clearing a link in the same range", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.runs = [{ start: 0, end: 4, bold: true, hyperlinkUrl: "https://example.com/report" }];
    const slide = source.slides[0]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, {
        type: "clear-text-emphasis",
        slideId: slide.id,
        elementId: title.id,
        start: 0,
        end: 2,
      }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.runs : undefined).toEqual([
      { start: 0, end: 2, hyperlinkUrl: "https://example.com/report" },
      { start: 2, end: 4, bold: true, hyperlinkUrl: "https://example.com/report" },
    ]);
  });

  it("keeps links when the character format is cleared", () => {
    const source = createDocument();
    const title = titleOf(source);
    title.runs = [{ start: 0, end: 4, bold: true, hyperlinkUrl: "https://example.com/report" }];
    const slide = source.slides[0]!;

    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "clear-text-format", slideId: slide.id, elementIds: [title.id] }),
    );
    const next = result.slides[0]!.elements[0]!;
    expect(next.type === "text" ? next.runs : undefined).toEqual([
      { start: 0, end: 4, hyperlinkUrl: "https://example.com/report" },
    ]);
    expect(next.type === "text" ? next.text : undefined).toBe(title.text);
  });

  it("knows when a range link would not change anything", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const title = titleOf(source);
    title.runs = [{ start: 0, end: 4, hyperlinkUrl: "https://example.com/report" }];
    const command = {
      type: "set-text-hyperlink" as const,
      slideId: slide.id,
      elementIds: [title.id],
      url: "https://example.com/report",
      range: { start: 0, end: 4 },
    };
    expect(commandDomain(command, source)).toBeNull();

    title.runs = [{ start: 0, end: 2, hyperlinkUrl: "https://example.com/report" }];
    expect(commandDomain(command, source)).toBe("design");
    expect(commandDomain({ ...command, url: null }, source)).toBe("design");

    title.runs = [];
    expect(commandDomain({ ...command, url: null }, source)).toBeNull();
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
