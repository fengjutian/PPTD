import { describe, expect, it } from "vitest";
import {
  createDocument,
  inches,
  type PresentationDocument,
  type RectEmu,
  type TableElement,
  type TextElement,
} from "../document-model";
import { auditSlideLayout } from "./layout-audit";

/** A native table over a reviewed block with the given cells, on the given page. */
function tableElement(
  document: PresentationDocument,
  frame: RectEmu,
  header: string[],
  rows: string[][],
  style: Partial<TableElement["style"]> = {},
): TableElement {
  const blockId = crypto.randomUUID();
  document.slides[0]!.content.blocks = [{ id: blockId, type: "table-data", header, rows }];
  return {
    id: crypto.randomUUID() as TableElement["id"],
    type: "table",
    contentBlockId: blockId,
    frame,
    rotationMilliDegree: 0,
    locked: false,
    style: {
      fontFamily: "Microsoft YaHei",
      fontSizePt: 14,
      headerFill: "#12233D",
      headerTextColor: "#FFFFFF",
      bodyTextColor: "#17181C",
      borderColor: "#E2E7EC",
      firstColumnBold: true,
      ...style,
    },
  };
}

/** A text element with the geometry and copy the case needs. */
function text(overrides: {
  text: string;
  frame: RectEmu;
  fontSizePt: number;
  lineHeight?: number;
  hidden?: boolean;
}): TextElement {
  const document = createDocument();
  const base = document.slides[0]!.elements[0]!;
  if (base.type !== "text") throw new Error("expected the default page to carry a text");
  const { frame, fontSizePt, lineHeight, text: copy } = overrides;
  return {
    ...base,
    text: copy,
    frame,
    ...(overrides.hidden ? { hidden: true } : {}),
    style: {
      ...base.style,
      fontSizePt,
      ...(lineHeight === undefined ? {} : { lineHeight }),
    },
  };
}

function page(elements: TextElement[]): PresentationDocument {
  const document = createDocument();
  document.slides[0]!.elements = elements;
  return document;
}

describe("layout audit", () => {
  it("reports a text whose measured height exceeds its frame", () => {
    // Nineteen full-width characters at 18pt need two lines; the frame holds one.
    const report = auditSlideLayout(
      page([
        text({
          text: "搜索与广告业务规模大利润率高是当前的现金牛",
          frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
          fontSizePt: 18,
          lineHeight: 1.25,
        }),
      ]),
    );
    expect(report.issues.map((issue) => issue.kind)).toEqual(["text-overflow"]);
    expect(report.issues[0]!.slideIndex).toBe(0);
  });

  it("accepts a text that fits its frame", () => {
    const report = auditSlideLayout(
      page([
        text({
          text: "利润率行业领先",
          frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.4) },
          fontSizePt: 18,
          lineHeight: 1.25,
        }),
      ]),
    );
    expect(report.issues).toEqual([]);
  });

  it("reports an object that leaves the page", () => {
    const report = auditSlideLayout(
      page([
        text({
          text: "标题",
          frame: { x: inches(12), y: inches(7), width: inches(4), height: inches(1) },
          fontSizePt: 18,
        }),
      ]),
    );
    expect(report.issues.map((issue) => issue.kind)).toContain("out-of-bounds");
  });

  it("reports two texts that claim the same space", () => {
    const frame: RectEmu = { x: inches(1), y: inches(1), width: inches(3), height: inches(0.5) };
    const report = auditSlideLayout(
      page([text({ text: "第一段", frame, fontSizePt: 18 }), text({ text: "第二段", frame, fontSizePt: 18 })]),
    );
    expect(report.issues.map((issue) => issue.kind)).toContain("text-overlap");
    expect(report.issues.find((issue) => issue.kind === "text-overlap")!.elementIds).toHaveLength(2);
  });

  it("lets a left label and a right page number share the footer band", () => {
    // Same frame, opposite alignment: the boxes overlap but the ink does not,
    // and a page like that is correct.
    const frame: RectEmu = { x: inches(1), y: inches(6.9), width: inches(8), height: inches(0.22) };
    const left = text({ text: "第二部分 门店效率", frame, fontSizePt: 10 });
    const right = text({ text: "03 / 10", frame, fontSizePt: 10 });
    const report = auditSlideLayout(page([left, { ...right, style: { ...right.style, align: "right" } }]));
    expect(report.issues).toEqual([]);
  });

  it("does not judge an object the editor hid", () => {
    const report = auditSlideLayout(
      page([
        text({
          text: "搜索与广告业务规模大利润率高是当前的现金牛",
          frame: { x: inches(1), y: inches(1), width: inches(4), height: inches(0.3) },
          fontSizePt: 18,
          lineHeight: 1.25,
          hidden: true,
        }),
      ]),
    );
    expect(report.issues).toEqual([]);
  });

  it("reports a table whose cells need more height than its frame", () => {
    // Three columns of 2in leave 1.7in of text per cell: a cell of twenty
    // full-width characters wraps to three lines, and PowerPoint grows the row
    // past the 1in frame instead of cutting the text.
    const document = createDocument();
    const table = tableElement(
      document,
      {
        x: inches(1),
        y: inches(1),
        width: inches(6),
        height: inches(1),
      },
      ["项目", "说明", "备注"],
      [["覆盖机构", "十二家三级甲等医院与三十家区域检验中心", "年度复核"]],
    );
    document.slides[0]!.elements = [table];
    const report = auditSlideLayout(document);
    expect(report.issues.map((issue) => issue.kind)).toEqual(["table-overflow"]);
    expect(report.issues[0]!.elementIds).toEqual([table.id]);
    expect(report.issues[0]!.message).toContain("第 2 列");
    expect(report.issues[0]!.message).toContain("要 3 行");
  });

  it("accepts a table that fits its frame", () => {
    const document = createDocument();
    const table = tableElement(
      document,
      {
        x: inches(1),
        y: inches(1),
        width: inches(9),
        height: inches(3),
      },
      ["项目", "数值"],
      [["覆盖机构", "12 家"]],
    );
    document.slides[0]!.elements = [table];
    expect(auditSlideLayout(document).issues).toEqual([]);
  });
});
