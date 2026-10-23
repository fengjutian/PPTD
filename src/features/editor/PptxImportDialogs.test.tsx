import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportModeDialog, ImportReportDialog } from "./PptxImportDialogs";
import type { ImportReport } from "../../core/commands/pptx-import";

const report: ImportReport = {
  format: "pptx",
  compatibility: "B",
  slideCount: 2,
  counts: { text: 3, image: 1, shape: 2, table: 1 },
  unsupported: [
    { slideIndex: 0, kind: "chart", detail: "图表未导入" },
    { slideIndex: 1, kind: "group", detail: "组合形状未导入" },
  ],
  warnings: ["第 1 页形状 roundRect 按矩形导入"],
  assets: { extracted: 1, skipped: 0, bytes: 100 },
};

describe("PPTX import dialogs", () => {
  it("explains both open intents without promising more than each does", () => {
    const markup = renderToStaticMarkup(
      <ImportModeDialog
        fileName="deck.pptx"
        busy={false}
        onClose={() => undefined}
        onImportContent={() => undefined}
        onExtractTemplate={() => undefined}
      />,
    );
    expect(markup).toContain("导入内容（Level A）");
    expect(markup).toContain("仅提取模板主题");
    expect(markup).toContain("只读取主题色");
    expect(markup).not.toContain("Level B");
  });

  it("shows counts, skipped objects and the review/save warning", () => {
    const markup = renderToStaticMarkup(
      <ImportReportDialog
        fileName="deck.pptx"
        report={report}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(markup).toContain("Level B");
    expect(markup).toContain("2 页");
    expect(markup).toContain("图表未导入");
    expect(markup).toContain("组合形状未导入");
    expect(markup).toContain("未审核");
    expect(markup).toContain("不会");
  });
});
