import { describe, expect, it } from "vitest";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, inches, type ContentBlock, type ElementId, type TextElement } from "../document-model";

type MetricBlock = Extract<ContentBlock, { type: "metric" }>;
type TableBlock = Extract<ContentBlock, { type: "table-data" }>;

function textCard(blockId: string, field: "label" | "value", text: string): TextElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "text",
    text,
    contentRef: "decorative",
    contentBlockRef: { blockId, field },
    frame: { x: inches(1), y: inches(1), width: inches(2), height: inches(1) },
    rotationMilliDegree: 0,
    locked: false,
    origin: "generated",
    style: { fontFamily: "Microsoft YaHei", fontSizePt: 18, color: "#17181c", bold: true, align: "center" },
  };
}

function pageWithMetricAndTable() {
  const document = createDocument();
  const slide = document.slides[0]!;
  const metric: MetricBlock = { id: crypto.randomUUID(), type: "metric", label: "收入", value: "38万" };
  const table: TableBlock = {
    id: crypto.randomUUID(),
    type: "table-data",
    header: ["项目", "数值"],
    rows: [["样本量", "38万"]],
  };
  slide.content.blocks = [metric, table];
  slide.content.status = "approved";
  const card = textCard(metric.id, "value", "38万");
  slide.elements.push(card);
  return { document, slide, metric, table, card };
}

describe("structured content editing", () => {
  it("writes an edit of a stat card into the reviewed metric", () => {
    const { document, slide, metric, card } = pageWithMetricAndTable();

    applyCommand(document, { type: "edit-text", slideId: slide.id, elementId: card.id, text: "42万" });

    // The card is a view of the metric: the reviewed number follows the text.
    expect(metric.value).toBe("42万");
    expect(card.text).toBe("42万");
    expect(slide.content.status).toBe("changed");
  });

  it("writes an edit of a metric label into the block and its other views", () => {
    const { document, slide, metric } = pageWithMetricAndTable();
    const label = textCard(metric.id, "label", "收入");
    const secondLabel = textCard(metric.id, "label", "收入");
    slide.elements.push(label, secondLabel);

    applyCommand(document, { type: "edit-text", slideId: slide.id, elementId: label.id, text: "营业收入" });

    expect(metric.label).toBe("营业收入");
    expect(label.text).toBe("营业收入");
    // One content fact, several visuals: the other view must not keep the old word.
    expect(secondLabel.text).toBe("营业收入");
  });

  it("updates every card text when a metric is edited from the chart panel", () => {
    const { document, slide, metric, card } = pageWithMetricAndTable();

    applyCommand(document, {
      type: "set-metric",
      slideId: slide.id,
      blockId: metric.id,
      field: "value",
      value: "42万",
    });

    expect(metric.value).toBe("42万");
    expect(card.text).toBe("42万");
    expect(slide.content.status).toBe("changed");
  });

  it("edits a table header and a body cell", () => {
    const { document, slide, table } = pageWithMetricAndTable();

    applyCommand(document, {
      type: "set-table-cell",
      slideId: slide.id,
      blockId: table.id,
      cell: { section: "header", column: 1 },
      value: "数量",
    });
    applyCommand(document, {
      type: "set-table-cell",
      slideId: slide.id,
      blockId: table.id,
      cell: { section: "body", row: 0, column: 1 },
      value: "40万",
    });

    expect(table.header).toEqual(["项目", "数量"]);
    expect(table.rows[0]).toEqual(["样本量", "40万"]);
    expect(slide.content.status).toBe("changed");
  });

  it("fills a missing trailing cell instead of writing a hole", () => {
    const { document, slide, table } = pageWithMetricAndTable();
    table.rows = [["样本量"]];

    applyCommand(document, {
      type: "set-table-cell",
      slideId: slide.id,
      blockId: table.id,
      cell: { section: "body", row: 0, column: 1 },
      value: "40万",
    });

    // A sparse array would serialize as null and fail the document schema.
    expect(table.rows[0]).toEqual(["样本量", "40万"]);
  });

  it("counts as a content change, not a design change", () => {
    const { document, slide, metric, table, card } = pageWithMetricAndTable();
    expect(commandDomain({ type: "edit-text", slideId: slide.id, elementId: card.id, text: "42万" }, document)).toBe(
      "content",
    );
    expect(
      commandDomain(
        { type: "set-metric", slideId: slide.id, blockId: metric.id, field: "value", value: "42万" },
        document,
      ),
    ).toBe("content");
    expect(
      commandDomain(
        {
          type: "set-table-cell",
          slideId: slide.id,
          blockId: table.id,
          cell: { section: "body", row: 0, column: 1 },
          value: "40万",
        },
        document,
      ),
    ).toBe("content");
    // A plain decorative text still belongs to the design.
    const designText = textCard(metric.id, "value", "38万");
    delete designText.contentBlockRef;
    slide.elements.push(designText);
    expect(
      commandDomain({ type: "edit-text", slideId: slide.id, elementId: designText.id, text: "随便写" }, document),
    ).toBe("design");
  });

  it("produces no transaction when the value does not change", () => {
    const { document, slide, metric, table, card } = pageWithMetricAndTable();
    expect(
      commandDomain({ type: "edit-text", slideId: slide.id, elementId: card.id, text: "38万" }, document),
    ).toBeNull();
    expect(
      commandDomain(
        { type: "set-metric", slideId: slide.id, blockId: metric.id, field: "value", value: "38万" },
        document,
      ),
    ).toBeNull();
    expect(
      commandDomain(
        {
          type: "set-table-cell",
          slideId: slide.id,
          blockId: table.id,
          cell: { section: "body", row: 0, column: 1 },
          value: "38万",
        },
        document,
      ),
    ).toBeNull();
  });

  it("rejects an unknown block and an out-of-range cell", () => {
    const { document, slide } = pageWithMetricAndTable();
    expect(() =>
      applyCommand(document, {
        type: "set-metric",
        slideId: slide.id,
        blockId: "missing",
        field: "value",
        value: "1",
      }),
    ).toThrow("CONTENT_BLOCK_NOT_METRIC");
    expect(() =>
      applyCommand(document, {
        type: "set-table-cell",
        slideId: slide.id,
        blockId: "missing",
        cell: { section: "body", row: 0, column: 0 },
        value: "1",
      }),
    ).toThrow("CONTENT_BLOCK_NOT_TABLE");
    expect(() =>
      applyCommand(document, {
        type: "set-table-cell",
        slideId: slide.id,
        blockId: slide.content.blocks!.find((block) => block.type === "table-data")!.id,
        cell: { section: "body", row: 4, column: 0 },
        value: "1",
      }),
    ).toThrow("TABLE_CELL_OUT_OF_RANGE");
  });

  it("refuses a metric text longer than the document can store", () => {
    const { document, slide, metric, card } = pageWithMetricAndTable();
    expect(() =>
      applyCommand(document, { type: "edit-text", slideId: slide.id, elementId: card.id, text: "长".repeat(1_001) }),
    ).toThrow("CONTENT_TEXT_TOO_LONG");
    expect(() =>
      applyCommand(document, {
        type: "set-metric",
        slideId: slide.id,
        blockId: metric.id,
        field: "label",
        value: "长".repeat(1_001),
      }),
    ).toThrow("CONTENT_TEXT_TOO_LONG");
  });

  it("keeps the card edit inside the transaction boundary", () => {
    const { document, slide, metric, card } = pageWithMetricAndTable();
    const before = structuredClone(document);

    applyCommand(document, { type: "edit-text", slideId: slide.id, elementId: card.id, text: "42万" });

    // The composition did not move and no other page changed.
    expect(document.slides).toHaveLength(before.slides.length);
    expect(slide.elements.find((element) => element.id === card.id)?.frame).toEqual(card.frame);
    expect(document.title).toBe(before.title);
    expect(metric.value).toBe("42万");
  });

  it("falls back to plain text when the referenced block is gone", () => {
    const { document, slide } = pageWithMetricAndTable();
    const orphan = textCard("missing", "value", "38万");
    slide.elements.push(orphan);

    // Nothing content-bound is left to update, so the edit is a design edit and
    // the page keeps its review state.
    expect(commandDomain({ type: "edit-text", slideId: slide.id, elementId: orphan.id, text: "旧数" }, document)).toBe(
      "design",
    );
    applyCommand(document, { type: "edit-text", slideId: slide.id, elementId: orphan.id, text: "旧数" });
    expect(orphan.text).toBe("旧数");
    expect(slide.content.status).toBe("approved");
  });
});
