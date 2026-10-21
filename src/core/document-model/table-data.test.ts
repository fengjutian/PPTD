import { describe, expect, it } from "vitest";
import { createDocument, emu } from "./factory";
import { resolveTableData } from "./table-data";
import type { TableElement } from "./types";

function tableOf(contentBlockId: string): TableElement {
  return {
    id: crypto.randomUUID() as never,
    type: "table",
    contentBlockId,
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    style: { fontFamily: "Microsoft YaHei", fontSizePt: 14, headerFill: "#3366CC", headerTextColor: "#FFFFFF", bodyTextColor: "#17181c", borderColor: "#E2E7EC", firstColumnBold: true },
  };
}

describe("table data", () => {
  it("reads the header and the rows from the reviewed table block", () => {
    const document = createDocument();
    const block = { id: crypto.randomUUID(), type: "table-data" as const, header: ["项目", "数值"], rows: [["样本量", "38万"], ["覆盖机构", "12万"]] };
    document.slides[0]!.content.blocks = [block];
    const resolved = resolveTableData(document.slides[0]!, tableOf(block.id));
    expect(resolved).toEqual({ header: ["项目", "数值"], rows: [["样本量", "38万"], ["覆盖机构", "12万"]] });
  });

  it("refuses a table that points at a block that is gone", () => {
    const document = createDocument();
    expect(resolveTableData(document.slides[0]!, tableOf(crypto.randomUUID()))).toBeUndefined();
  });

  it("refuses a table that points at a block of another kind", () => {
    const document = createDocument();
    const block = { id: crypto.randomUUID(), type: "metric" as const, label: "样本量", value: "38万" };
    document.slides[0]!.content.blocks = [block];
    expect(resolveTableData(document.slides[0]!, tableOf(block.id))).toBeUndefined();
  });

  it("refuses a table without a header or without rows", () => {
    const document = createDocument();
    const empty = { id: crypto.randomUUID(), type: "table-data" as const, header: [], rows: [] };
    document.slides[0]!.content.blocks = [empty];
    expect(resolveTableData(document.slides[0]!, tableOf(empty.id))).toBeUndefined();
  });
});
