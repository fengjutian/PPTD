import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlideId } from "../../core/document-model";
import { MetricFields, TableDataFields } from "./StructuredContentFields";

const SLIDE_ID = "slide-1" as SlideId;

describe("structured content fields", () => {
  it("shows the name and the value of every metric the chart draws", () => {
    const markup = renderToStaticMarkup(
      <MetricFields
        slideId={SLIDE_ID}
        metrics={[
          { blockId: "a", label: "增长率", value: "42%" },
          { blockId: "b", label: "客户数", value: "120" },
        ]}
        onCommand={() => undefined}
      />,
    );
    expect(markup).toContain("指标 1 名称");
    expect(markup).toContain("增长率");
    expect(markup).toContain("42%");
    expect(markup).toContain("指标 2 数值");
    expect(markup).toContain("客户数");
    expect(markup).toContain("120");
    // The fields edit reviewed content, so the warning must say so.
    expect(markup).toContain("标记本页待确认");
  });

  it("renders the table as an editable grid with its dimensions", () => {
    const markup = renderToStaticMarkup(
      <TableDataFields
        slideId={SLIDE_ID}
        blockId="block"
        header={["项目", "数值"]}
        rows={[
          ["样本量", "38万"],
          ["增长率", "12%"],
        ]}
        onCommand={() => undefined}
      />,
    );
    // Header plus two body rows, two columns.
    expect(markup).toContain("编辑表格数据（3 行 × 2 列）");
    expect(markup).toContain("项目");
    expect(markup).toContain("样本量");
    expect(markup).toContain("38万");
    expect(markup).toContain("增长率");
    expect(markup).toContain("12%");
    expect(markup).toContain("表头第 2 列");
    expect(markup).toContain("第 2 行第 1 列");
  });

  it("disables the grid when the table object is locked", () => {
    const markup = renderToStaticMarkup(
      <TableDataFields
        slideId={SLIDE_ID}
        blockId="block"
        header={["项目"]}
        rows={[["样本量"]]}
        disabled
        onCommand={() => undefined}
      />,
    );
    expect(markup.match(/disabled=""/g)?.length).toBe(2);
  });
});
