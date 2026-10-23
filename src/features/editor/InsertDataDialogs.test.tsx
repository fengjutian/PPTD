import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InsertTableDialog } from "./InsertTableDialog";
import { InsertChartDialog } from "./InsertChartDialog";

describe("insert table dialog", () => {
  it("shows the default grid, its size hint and the preview header", () => {
    const markup = renderToStaticMarkup(<InsertTableDialog onClose={() => undefined} onInsert={() => undefined} />);
    expect(markup).toContain("插入表格");
    expect(markup).toContain("列数");
    expect(markup).toContain("数据行数");
    expect(markup).toContain("4 行 × 3 列（含表头）");
    expect(markup).toContain("列 1");
    expect(markup).not.toContain('disabled=""');
  });
});

describe("insert chart dialog", () => {
  it("offers four native chart kinds and starts on column", () => {
    const markup = renderToStaticMarkup(<InsertChartDialog onClose={() => undefined} onInsert={() => undefined} />);
    expect(markup).toContain("柱状图");
    expect(markup).toContain("条形图");
    expect(markup).toContain("折线图");
    expect(markup).toContain("饼图");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("3 项示例数据");
  });
});
