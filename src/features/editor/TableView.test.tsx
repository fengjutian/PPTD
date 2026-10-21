import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type ElementId, type TableElement } from "../../core/document-model";
import { TableView } from "./TableView";

function tableElement(contentBlockId: string): TableElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "table",
    contentBlockId,
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    style: { fontFamily: "Microsoft YaHei", fontSizePt: 14, headerFill: "#3366CC", headerTextColor: "#FFFFFF", bodyTextColor: "#17181c", borderColor: "#E2E7EC", firstColumnBold: true },
  };
}

describe("table view", () => {
  it("shows the header and the cells of the reviewed table block", () => {
    const document = createDocument();
    const block = { id: crypto.randomUUID(), type: "table-data" as const, header: ["项目", "数量"], rows: [["样本量", "38万"]] };
    document.slides[0]!.content.blocks = [block];
    const markup = renderToStaticMarkup(<TableView element={tableElement(block.id)} slide={document.slides[0]!} scale={1} />);
    expect(markup).toContain("<table");
    expect(markup).toContain("项目");
    expect(markup).toContain("数量");
    expect(markup).toContain("样本量");
    expect(markup).toContain("38万");
  });

  it("tells the user when the cells are gone instead of drawing an empty grid", () => {
    const document = createDocument();
    const markup = renderToStaticMarkup(<TableView element={tableElement(crypto.randomUUID())} slide={document.slides[0]!} scale={1} />);
    expect(markup).toContain("表格数据缺失");
    expect(markup).not.toContain("<table");
  });
});
