import { describe, expect, it } from "vitest";
import { produce } from "immer";
import {
  applyCommand,
  buildReplaceAllEdits,
  commandDomain,
  findTextMatches,
  replaceAllOccurrences,
  replaceOccurrence,
} from "./index";
import { createDocument, inches, type ElementId } from "../document-model";

function documentWithTwoSlides() {
  const document = createDocument();
  applyCommand(document, { type: "add-slide" });
  const [first, second] = document.slides;
  return { document, first: first!, second: second! };
}

describe("text search", () => {
  it("finds every occurrence across slides, case-insensitively by default", () => {
    const { document, first, second } = documentWithTwoSlides();
    const firstText = first.elements[0]!;
    const secondText = second.elements[0]!;
    if (firstText.type !== "text" || secondText.type !== "text") throw new Error("expected text");
    firstText.text = "Alpha alpha ALPHA";
    secondText.text = "alpha";

    const matches = findTextMatches(document, "alpha");
    expect(matches).toHaveLength(4);
    expect(matches.map((match) => match.slideIndex)).toEqual([0, 0, 0, 1]);
    expect(matches.map((match) => match.start)).toEqual([0, 6, 12, 0]);
    expect(findTextMatches(document, "alpha", { matchCase: true })).toHaveLength(2);
    expect(findTextMatches(document, "")).toEqual([]);
  });

  it("finds CJK copy and returns the exact offsets", () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected text");
    element.text = "《岳阳楼记》是中国古代以记为论文章的典范之作";
    const matches = findTextMatches(document, "以记为论");
    expect(matches).toHaveLength(1);
    expect(element.text.slice(matches[0]!.start, matches[0]!.end)).toBe("以记为论");
  });

  it("replaces literally instead of interpreting $ patterns", () => {
    expect(replaceAllOccurrences("a a", "a", "$&$1", { matchCase: true })).toBe("$&$1 $&$1");
    expect(replaceOccurrence("abcdef", 2, 4, "X")).toBe("abXef");
  });

  it("builds one edit per element and drops elements whose copy did not change", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type !== "text") throw new Error("expected text");
    title.text = "甲 甲";
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const other = slide.elements[1]!;
    if (other.type !== "text") throw new Error("expected text");
    other.text = "乙";

    const edits = buildReplaceAllEdits(document, "甲", "丙");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ kind: "text", elementId: title.id, text: "丙 丙" });
  });
});

describe("replace-text-edits command", () => {
  it("writes the whole batch as one content change and clears old fragments", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type !== "text") throw new Error("expected text");
    title.text = "旧标题";
    title.runs = [{ start: 0, end: 1, bold: true }];
    slide.content.title = "旧标题";
    slide.content.status = "approved";
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const decorative = slide.elements[1]!;
    if (decorative.type !== "text") throw new Error("expected text");
    decorative.text = "旧副标题";

    const result = produce(document, (draft) =>
      applyCommand(draft, {
        type: "replace-text-edits",
        edits: [
          { kind: "text", slideId: slide.id, elementId: title.id, text: "新标题" },
          { kind: "text", slideId: slide.id, elementId: decorative.id, text: "新副标题" },
        ],
      }),
    );
    expect(result.slides[0]!.content.title).toBe("新标题");
    expect(result.slides[0]!.content.status).toBe("changed");
    const elements = result.slides[0]!.elements;
    expect(elements[0]!.type === "text" ? elements[0]!.runs : "missing").toBeUndefined();
    expect(elements[1]!.type === "text" ? elements[1]!.text : "").toBe("新副标题");
    expect(commandDomain({ type: "replace-text-edits", edits: [] })).toBe("content");
    expect(
      commandDomain(
        {
          type: "replace-text-edits",
          edits: [
            { kind: "text", slideId: slide.id, elementId: title.id, text: "a" },
            { kind: "text", slideId: slide.id, elementId: decorative.id, text: "b" },
          ],
        },
        document,
      ),
    ).toBe("both");
  });

  it("updates a metric card and its reviewed block together", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const block = { id: crypto.randomUUID(), type: "metric" as const, label: "收入", value: "38万" };
    slide.content.blocks = [block];
    const card = {
      id: crypto.randomUUID() as ElementId,
      type: "text" as const,
      text: "38万",
      contentRef: "decorative" as const,
      contentBlockRef: { blockId: block.id, field: "value" as const },
      frame: { x: 0 as never, y: 0 as never, width: inches(2), height: inches(1) },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user" as const,
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 18, color: "#17181c", bold: false, align: "left" as const },
    };
    slide.elements.push(card);
    slide.content.status = "approved";

    const result = produce(document, (draft) =>
      applyCommand(draft, {
        type: "replace-text-edits",
        edits: [{ kind: "text", slideId: slide.id, elementId: card.id, text: "42万" }],
      }),
    );
    const nextBlock = result.slides[0]!.content.blocks![0]!;
    expect(nextBlock.type === "metric" ? nextBlock.value : "").toBe("42万");
    expect(result.slides[0]!.content.status).toBe("changed");
  });

  it("searches locked text but refuses to rewrite it", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const title = slide.elements[0]!;
    if (title.type !== "text") throw new Error("expected text");
    title.text = "锁定";
    title.locked = true;
    expect(findTextMatches(document, "锁定")).toHaveLength(1);
    expect(buildReplaceAllEdits(document, "锁定", "替换")).toEqual([]);
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "replace-text-edits",
          edits: [{ kind: "text", slideId: slide.id, elementId: title.id, text: "替换" }],
        }),
      ),
    ).toThrow("ELEMENT_LOCKED");
  });

  it("searches table cells, chart labels, speaker notes and the document title", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    document.title = "季度汇报";
    slide.content.speakerNotes = "开场汇报";
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 2, rows: 1 });
    applyCommand(document, { type: "add-chart", slideId: slide.id, kind: "column" });

    const table = slide.elements.find((element) => element.type === "table");
    const chart = slide.elements.find((element) => element.type === "chart");
    if (table?.type !== "table" || chart?.type !== "chart") throw new Error("expected table and chart");
    const tableBlock = slide.content.blocks!.find((block) => block.id === table.contentBlockId);
    if (tableBlock?.type !== "table-data") throw new Error("expected table block");
    tableBlock.header[0] = "汇报";
    tableBlock.rows[0]![0] = "汇报";
    const metric = slide.content.blocks!.find(
      (block) => block.type === "metric" && block.id === chart.contentBlockIds[0],
    );
    if (metric?.type !== "metric") throw new Error("expected metric block");
    metric.label = "汇报";

    const matches = findTextMatches(document, "汇报");
    expect(matches.map((match) => match.kind)).toEqual([
      "document-title",
      "speaker-notes",
      "table-cell",
      "table-cell",
      "metric",
    ]);
    expect(matches.map((match) => match.slideIndex)).toEqual([-1, 0, 0, 0, 0]);
    expect(matches[0]!.text).toBe("季度汇报");
    expect(matches[1]!.text).toBe("开场汇报");
    expect(matches[3]!.kind === "table-cell" ? matches[3]!.cell : undefined).toEqual({
      section: "body",
      row: 0,
      column: 0,
    });
  });

  it("replaces every target kind in one batch and marks the page changed", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    document.title = "季度汇报";
    slide.content.speakerNotes = "开场汇报";
    slide.content.status = "approved";
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 2, rows: 1 });
    applyCommand(document, { type: "add-chart", slideId: slide.id, kind: "column" });

    const table = slide.elements.find((element) => element.type === "table");
    const chart = slide.elements.find((element) => element.type === "chart");
    if (table?.type !== "table" || chart?.type !== "chart") throw new Error("expected table and chart");
    const tableBlock = slide.content.blocks!.find((block) => block.id === table.contentBlockId);
    if (tableBlock?.type !== "table-data") throw new Error("expected table block");
    tableBlock.header[0] = "汇报";
    tableBlock.rows[0]![0] = "汇报";
    const metric = slide.content.blocks!.find(
      (block) => block.type === "metric" && block.id === chart.contentBlockIds[0],
    );
    if (metric?.type !== "metric") throw new Error("expected metric block");
    metric.label = "汇报";

    const edits = buildReplaceAllEdits(document, "汇报", "总结");
    expect(edits.map((edit) => edit.kind)).toEqual([
      "document-title",
      "speaker-notes",
      "table-cell",
      "table-cell",
      "metric",
    ]);
    applyCommand(document, { type: "replace-text-edits", edits });

    expect(document.title).toBe("季度总结");
    expect(slide.content.speakerNotes).toBe("开场总结");
    expect(tableBlock.header[0]).toBe("总结");
    expect(tableBlock.rows[0]![0]).toBe("总结");
    expect(metric.label).toBe("总结");
    expect(slide.content.status).toBe("changed");
  });

  it("skips a locked table but still replaces searchable notes", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.speakerNotes = "汇报";
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 2, rows: 1 });
    const table = slide.elements.find((element) => element.type === "table");
    if (table?.type !== "table") throw new Error("expected table");
    const block = slide.content.blocks!.find((candidate) => candidate.id === table.contentBlockId);
    if (block?.type !== "table-data") throw new Error("expected table block");
    block.header[0] = "汇报";
    table.locked = true;

    const edits = buildReplaceAllEdits(document, "汇报", "总结");
    expect(edits.map((edit) => edit.kind)).toEqual(["speaker-notes"]);
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "replace-text-edits",
          edits: [
            {
              kind: "table-cell",
              slideId: slide.id,
              elementId: table.id,
              blockId: table.contentBlockId,
              cell: { section: "header", column: 0 },
              text: "总结",
            },
          ],
        }),
      ),
    ).toThrow("ELEMENT_LOCKED");
  });

  it("refuses the whole batch when one target is invalid", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const title = slide.elements[0]!;
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, {
          type: "replace-text-edits",
          edits: [
            { kind: "text", slideId: slide.id, elementId: title.id, text: "会被丢弃" },
            { kind: "text", slideId: slide.id, elementId: crypto.randomUUID() as ElementId, text: "不存在" },
          ],
        }),
      ),
    ).toThrow("TEXT_EDIT_TARGET_INVALID");
  });
});
