import { describe, expect, it } from "vitest";
import { tableGeometry } from "./table-geometry";

const FAMILY = "Microsoft YaHei";

describe("table geometry", () => {
  it("splits the frame into equal columns and takes the padding out of the text width", () => {
    const geometry = tableGeometry({
      header: ["项目", "数值", "备注"],
      rows: [["覆盖机构", "12", "年度"]],
      frameWidthPt: 300,
      fontSizePt: 14,
      fontFamily: FAMILY,
    });
    expect(geometry.columnWidthPt).toBeCloseTo(100, 5);
    // Four points of padding on each side of a cell, the exporter's default.
    expect(geometry.textWidthPt).toBeCloseTo(92, 5);
  });

  it("wraps a long cell instead of cutting it", () => {
    const geometry = tableGeometry({
      header: ["说明"],
      rows: [["十二家三级甲等医院与三十家区域检验中心"]],
      frameWidthPt: 120,
      fontSizePt: 14,
      fontFamily: FAMILY,
    });
    const cell = geometry.rows[1]!.cells[0]!;
    expect(cell.text).toBe("十二家三级甲等医院与三十家区域检验中心");
    expect(cell.lines.length).toBeGreaterThan(1);
    // Every character is on some line: nothing was dropped to make it fit.
    expect(cell.lines.join("")).toBe(cell.text);
  });

  it("makes a row as tall as its tallest cell, padding included", () => {
    const geometry = tableGeometry({
      header: ["项目", "说明"],
      rows: [
        ["覆盖机构", "短"],
        ["覆盖机构", "十二家三级甲等医院与三十家区域检验中心"],
      ],
      frameWidthPt: 240,
      fontSizePt: 14,
      fontFamily: FAMILY,
    });
    const shortRow = geometry.rows[1]!;
    const tallRow = geometry.rows[2]!;
    expect(tallRow.heightPt).toBeGreaterThan(shortRow.heightPt);
    const tallest = tallRow.cells[1]!;
    expect(tallRow.heightPt).toBeCloseTo(tallest.heightPt, 5);
    expect(tallest.heightPt).toBeCloseTo(tallest.lines.length * 14 * 1.2 + 8, 5);
  });

  it("keeps a minimum row height for empty cells", () => {
    const geometry = tableGeometry({
      header: ["项目", "数值"],
      rows: [["", ""]],
      frameWidthPt: 400,
      fontSizePt: 14,
      fontFamily: FAMILY,
    });
    expect(geometry.rows[1]!.heightPt).toBeGreaterThan(14);
    expect(geometry.neededHeightPt).toBeGreaterThan(0);
  });

  it("adds the rows up into the height the table needs", () => {
    const geometry = tableGeometry({
      header: ["项目", "说明"],
      rows: [
        ["覆盖机构", "十二家"],
        ["样本量", "三十八万"],
      ],
      frameWidthPt: 300,
      fontSizePt: 14,
      fontFamily: FAMILY,
    });
    const sum = geometry.rows.reduce((total, row) => total + row.heightPt, 0);
    expect(geometry.neededHeightPt).toBeCloseTo(sum, 5);
    expect(geometry.rows).toHaveLength(3);
    expect(geometry.rows[0]!.header).toBe(true);
    expect(geometry.rows[1]!.header).toBe(false);
  });
});
