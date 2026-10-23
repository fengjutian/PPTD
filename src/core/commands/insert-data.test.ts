import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import {
  createDocument,
  resolveChartData,
  resolveTableData,
  type ChartElement,
  type TableElement,
} from "../document-model";

describe("manual table insertion", () => {
  it("creates a reviewed table block and the element that reads it", () => {
    const document = createDocument();
    document.slides[0]!.content.status = "approved";
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 3, rows: 2 });

    const block = slide.content.blocks?.at(-1);
    expect(block?.type).toBe("table-data");
    if (block?.type !== "table-data") throw new Error("expected a table block");
    expect(block.header).toEqual(["列 1", "列 2", "列 3"]);
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0]).toHaveLength(3);

    const element = slide.elements.at(-1);
    expect(element?.type).toBe("table");
    if (element?.type !== "table") throw new Error("expected a table element");
    expect(resolveTableData(slide, element)).toBeDefined();
    expect(element.frame.x).toBeGreaterThanOrEqual(0);
    expect(element.frame.x + element.frame.width).toBeLessThanOrEqual(document.pageSize.width);
    expect(element.frame.y + element.frame.height).toBeLessThanOrEqual(document.pageSize.height);
    expect(slide.content.status).toBe("changed");
    expect(commandDomain({ type: "add-table", slideId: slide.id, columns: 3, rows: 2 })).toBe("both");
  });

  it("refuses sizes the table schema or the page cannot hold", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    for (const [columns, rows] of [
      [1, 3],
      [13, 3],
      [3, 0],
      [3, 51],
      [2.5, 3],
      [3, 2.5],
    ]) {
      expect(() =>
        produce(document, (draft) =>
          applyCommand(draft, { type: "add-table", slideId: slide.id, columns: columns!, rows: rows! }),
        ),
      ).toThrow("INVALID_TABLE_SIZE");
    }
  });
});

describe("manual chart insertion", () => {
  it("creates three editable metrics and a native chart that reads them", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-chart", slideId: slide.id, kind: "pie" });

    const element = slide.elements.at(-1) as ChartElement;
    expect(element.type).toBe("chart");
    expect(element.kind).toBe("pie");
    expect(element.contentBlockIds).toHaveLength(3);
    const resolved = resolveChartData(slide, element);
    expect(resolved?.data.map((datum) => datum.value)).toEqual([10, 20, 30]);
    expect(slide.content.blocks?.slice(-3).every((block) => block.type === "metric")).toBe(true);
    expect(commandDomain({ type: "add-chart", slideId: slide.id, kind: "pie" })).toBe("both");
  });

  it("refuses an unknown chart kind before it reaches the document", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const before = slide.elements.length;
    expect(() =>
      produce(document, (draft) =>
        applyCommand(draft, { type: "add-chart", slideId: slide.id, kind: "radar" as never }),
      ),
    ).toThrow("INVALID_CHART_KIND");
    expect(document.slides[0]!.elements).toHaveLength(before);
  });
});

describe("inserted elements keep their data binding", () => {
  it("edits the table block through the inspector data path", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-table", slideId: slide.id, columns: 2, rows: 1 });
    const table = slide.elements.at(-1) as TableElement;
    applyCommand(document, {
      type: "set-table-cell",
      slideId: slide.id,
      blockId: table.contentBlockId,
      cell: { section: "body", row: 0, column: 0 },
      value: "38万",
    });
    expect(resolveTableData(slide, table)?.rows[0]?.[0]).toBe("38万");
  });
});
