import { describe, expect, it } from "vitest";
import {
  createDocument,
  createSlide,
  inches,
  type ContentBlock,
  type ElementId,
  type PresentationDocument,
  type ShapeElement,
  type SlideElement,
  type TextContentRole,
  type TextElement,
  type TextElementStyle,
  type TextRun,
} from "../document-model";
import { hexToHsl, isNeutralColor, normalizeHexColor } from "../rendering/color-analysis";
import { lintTaste, minimumBodyPt, minimumLabelPt } from "./taste-lint";

const PAGE = { width: 13.333, height: 7.5 };

function textElement(
  text: string,
  style: Partial<TextElementStyle> = {},
  frame = { x: 0.8, y: 1.7, width: 11.5, height: 4.6 },
  role?: TextContentRole,
  runs?: TextRun[],
): TextElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "text",
    text,
    ...(role ? { contentRef: role } : {}),
    ...(runs ? { runs } : {}),
    frame: {
      x: inches(frame.x),
      y: inches(frame.y),
      width: inches(frame.width),
      height: inches(frame.height),
    },
    rotationMilliDegree: 0,
    locked: false,
    origin: "generated",
    style: {
      fontFamily: "Microsoft YaHei",
      fontSizePt: 16,
      color: "#222222",
      bold: false,
      align: "left",
      ...style,
    },
  };
}

function shapeElement(fill: string, frame = { x: 0.8, y: 1.7, width: 2, height: 1 }): ShapeElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "shape",
    shape: "rectangle",
    frame: {
      x: inches(frame.x),
      y: inches(frame.y),
      width: inches(frame.width),
      height: inches(frame.height),
    },
    rotationMilliDegree: 0,
    locked: false,
    origin: "generated",
    style: { fill, stroke: "none", strokeWidthPt: 0, radiusPt: 0 },
  };
}

function addPage(
  document: PresentationDocument,
  options: { body?: string; blocks?: ContentBlock[]; elements?: SlideElement[]; title?: string } = {},
): PresentationDocument {
  const slide = createSlide(document.slides.length + 1);
  slide.content = {
    title: options.title ?? "季度经营回顾与下一步判断",
    body: options.body ?? "",
    ...(options.blocks ? { blocks: options.blocks } : {}),
    speakerNotes: "",
    status: "approved",
  };
  slide.elements = options.elements ?? [
    textElement(
      options.title ?? "季度经营回顾与下一步判断",
      { fontSizePt: 36 },
      { x: 0.8, y: 0.6, width: 11.5, height: 0.8 },
      "title",
    ),
    ...(options.body
      ? [textElement(options.body, { fontSizePt: 14 }, { x: 0.8, y: 1.7, width: 11.5, height: 4.6 }, "body")]
      : []),
  ];
  document.slides.push(slide);
  return document;
}

function documentWith(pageCount: number): PresentationDocument {
  const document = createDocument();
  document.pageSize = { width: inches(PAGE.width), height: inches(PAGE.height) };
  document.slides = [];
  for (let index = 0; index < pageCount; index += 1) addPage(document, { body: "内容" });
  return document;
}

describe("taste lint", () => {
  it("computes the page-relative floor and keeps the absolute minimum", () => {
    const document = documentWith(1);
    expect(minimumBodyPt(document)).toBeCloseTo(12, 5);
    expect(minimumLabelPt(document)).toBeCloseTo(9, 5);
    expect(minimumBodyPt(document, { minBodyPt: 18 })).toBeCloseTo(18, 5);
  });

  it("flags body copy below the floor and passes just above it", () => {
    const failing = documentWith(1);
    failing.slides[0]!.elements = [
      textElement("标题", { fontSizePt: 36 }, undefined, "title"),
      textElement("这是一段足够长的正文内容用于测试字号下限", { fontSizePt: 11.9 }, undefined, "body"),
    ];
    expect(lintTaste(failing).counts.BODY_TEXT_TOO_SMALL).toBe(1);

    const passing = documentWith(1);
    passing.slides[0]!.elements = [
      textElement("标题", { fontSizePt: 36 }, undefined, "title"),
      textElement("这是一段足够长的正文内容用于测试字号下限", { fontSizePt: 12.1 }, undefined, "body"),
    ];
    expect(lintTaste(passing).counts.BODY_TEXT_TOO_SMALL).toBe(0);
  });

  it("flags labels below the label floor, ignoring page numbers", () => {
    const document = documentWith(1);
    const page = document.slides[0]!;
    page.elements = [
      textElement("标题", { fontSizePt: 36 }, undefined, "title"),
      textElement("这是一段足够长的正文内容用于测试字号下限", { fontSizePt: 14 }, undefined, "body"),
      textElement("数据来源", { fontSizePt: 8, color: "#777777" }, { x: 0.8, y: 6.4, width: 2, height: 0.3 }),
      textElement("3 / 12", { fontSizePt: 8, color: "#777777" }, { x: 12, y: 7.1, width: 1, height: 0.3 }),
    ];
    const report = lintTaste(document);
    expect(report.counts.LABEL_TEXT_TOO_SMALL).toBe(1);
    expect(report.issues.find((issue) => issue.code === "LABEL_TEXT_TOO_SMALL")?.elementIds).toHaveLength(1);
  });

  it("flags a title/body ratio below 2.5", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("标题", { fontSizePt: 28 }, undefined, "title"),
      textElement("这是一段足够长的正文内容用于测试字阶比例", { fontSizePt: 14 }, undefined, "body"),
    ];
    const report = lintTaste(document);
    expect(report.counts.TITLE_BODY_RATIO_LOW).toBe(1);
    expect(report.issues[0]?.metrics?.ratio).toBeCloseTo(2, 5);
  });

  it("allows one display face on top of the body face", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("标题", { fontSizePt: 36, fontFamily: "华文中宋" }, undefined, "title"),
      textElement(
        "这是一段足够长的正文内容用于测试字体数量",
        { fontSizePt: 14, fontFamily: "微软雅黑" },
        undefined,
        "body",
      ),
      textElement("注释", { fontSizePt: 10, fontFamily: "Arial" }, { x: 0.8, y: 6.6, width: 2, height: 0.3 }),
    ];
    // Two text faces plus one face used only at display size is a designed
    // pairing, not three voices fighting on one page.
    expect(lintTaste(document).counts.FONT_FAMILY_COUNT).toBe(0);
  });

  it("flags three text families even when a display face is set", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("标题", { fontSizePt: 36, fontFamily: "华文中宋" }, undefined, "title"),
      textElement(
        "这是一段足够长的正文内容用于测试字体数量",
        { fontSizePt: 14, fontFamily: "微软雅黑" },
        undefined,
        "body",
      ),
      textElement("注释", { fontSizePt: 10, fontFamily: "Arial" }, { x: 0.8, y: 6.6, width: 2, height: 0.3 }),
      textElement("来源", { fontSizePt: 10, fontFamily: "楷体" }, { x: 3.2, y: 6.6, width: 2, height: 0.3 }),
    ];
    expect(lintTaste(document).counts.FONT_FAMILY_COUNT).toBe(1);
  });

  it("counts non-neutral colours and ignores greys", () => {
    const document = documentWith(1);
    const page = document.slides[0]!;
    const fills = ["#C0392B", "#2E75B6", "#2F6B5F", "#D59B43", "#7657C8"];
    page.elements = [
      textElement("标题", { fontSizePt: 36 }, undefined, "title"),
      textElement("这是一段足够长的正文内容用于测试颜色数量", { fontSizePt: 14 }, undefined, "body"),
      ...fills.map((fill, index) => shapeElement(fill, { x: 0.8 + index * 1.2, y: 5.2, width: 1, height: 0.6 })),
      shapeElement("#ECECEC", { x: 7, y: 5.2, width: 1, height: 0.6 }),
    ];
    const report = lintTaste(document);
    expect(report.counts.COLOR_COUNT).toBe(1);
    expect(report.issues.find((issue) => issue.code === "COLOR_COUNT")?.metrics?.count).toBe(5);
  });

  it("flags a small label sitting directly above the title", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("2026 年度经营复盘", { fontSizePt: 9, color: "#888888" }, { x: 0.8, y: 0.2, width: 3, height: 0.25 }),
      textElement(
        "季度经营回顾与下一步判断",
        { fontSizePt: 36 },
        { x: 0.8, y: 0.6, width: 11.5, height: 0.8 },
        "title",
      ),
      textElement("这是一段足够长的正文内容用于测试标题上方标签", { fontSizePt: 14 }, undefined, "body"),
    ];
    expect(lintTaste(document).counts.DECORATION_KICKER).toBe(1);
  });

  it("flags a bare index number only when the page has no sequence", () => {
    const withoutSequence = documentWith(1);
    withoutSequence.slides[0]!.elements = [
      textElement("01", { fontSizePt: 12, color: "#888888" }, { x: 0.8, y: 1.2, width: 0.4, height: 0.3 }),
      textElement("季度经营回顾与下一步判断", { fontSizePt: 36 }, { x: 1.4, y: 1.1, width: 10, height: 0.8 }, "title"),
      textElement("这是一段足够长的正文内容用于测试编号装饰", { fontSizePt: 14 }, undefined, "body"),
    ];
    expect(lintTaste(withoutSequence).counts.DECORATION_INDEX_NUMBER).toBe(1);

    const withSequence = documentWith(1);
    withSequence.slides[0]!.content.blocks = [
      {
        id: "process-1",
        type: "process",
        items: [
          { label: "诊断", text: "找出瓶颈" },
          { label: "改造", text: "调整流程" },
        ],
      },
    ];
    withSequence.slides[0]!.elements = withoutSequence.slides[0]!.elements.map((element) => ({ ...element }));
    expect(lintTaste(withSequence).counts.DECORATION_INDEX_NUMBER).toBe(0);
  });

  it("flags emoji in text", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("增长 🚀", { fontSizePt: 36 }, undefined, "title"),
      textElement("这是一段足够长的正文内容用于测试 emoji 装饰", { fontSizePt: 14 }, undefined, "body"),
    ];
    expect(lintTaste(document).counts.DECORATION_EMOJI).toBe(1);
  });

  it("allows one highlighted phrase inside the title", () => {
    const document = documentWith(1);
    const title = "季度增长来自复购";
    document.slides[0]!.elements = [
      textElement(title, { fontSizePt: 36 }, undefined, "title", [{ start: 6, end: 8, color: "#C0392B" }]),
      textElement("这是一段足够长的正文内容用于测试单字变色", { fontSizePt: 14 }, undefined, "body"),
    ];
    // One emphasis is the page's point; the check exists to stop word-by-word
    // colouring, not to forbid emphasis.
    expect(lintTaste(document).counts.DECORATION_ACCENT_WORD).toBe(0);
  });

  it("flags a second highlighted phrase inside the title", () => {
    const document = documentWith(1);
    const title = "季度增长来自复购";
    document.slides[0]!.elements = [
      textElement(title, { fontSizePt: 36 }, undefined, "title", [
        { start: 0, end: 2, color: "#C0392B" },
        { start: 6, end: 8, color: "#C0392B" },
      ]),
      textElement("这是一段足够长的正文内容用于测试单字变色", { fontSizePt: 14 }, undefined, "body"),
    ];
    const report = lintTaste(document);
    expect(report.counts.DECORATION_ACCENT_WORD).toBe(1);
    expect(report.issues.find((issue) => issue.code === "DECORATION_ACCENT_WORD")?.metrics?.runs).toBe(2);
  });

  it("flags three consecutive pages with the same skeleton", () => {
    const document = documentWith(6);
    document.slides[0]!.elements = [
      textElement("封面", { fontSizePt: 44 }, { x: 0.8, y: 2, width: 11, height: 1 }, "title"),
    ];
    document.slides[0]!.content.body = "";
    for (let index = 1; index <= 3; index += 1) {
      const page = document.slides[index]!;
      page.content.body = "这是一段足够长的正文内容用于测试连续页面骨架";
      page.elements = [
        textElement(`第 ${index + 1} 页标题`, { fontSizePt: 36 }, { x: 0.8, y: 0.6, width: 11, height: 0.8 }, "title"),
        textElement("这是一段足够长的正文内容用于测试连续页面骨架", { fontSizePt: 14 }, undefined, "body"),
      ];
    }
    const report = lintTaste(document);
    expect(report.counts.RHYTHM_REPEAT).toBe(1);
    expect(report.issues.find((issue) => issue.code === "RHYTHM_REPEAT")?.slideIndex).toBe(1);
  });

  it("flags a page whose content occupies only a corner", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("标题", { fontSizePt: 36 }, { x: 0.8, y: 0.6, width: 3, height: 0.6 }, "title"),
      textElement(
        "这是一段足够长的正文内容用于测试留白失衡",
        { fontSizePt: 14 },
        { x: 0.8, y: 1.3, width: 3, height: 0.8 },
        "body",
      ),
    ];
    expect(lintTaste(document).counts.WHITESPACE_IMBALANCE).toBe(1);
  });

  it("does not read cover panels as content filling the page", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      shapeElement("#1E2A32", { x: 0, y: 0, width: 0.5, height: 7.5 }),
      shapeElement("#2F6B5F", { x: 10.5, y: 0, width: 2.8, height: 7.5 }),
      textElement("季度经营回顾与下一步判断", { fontSizePt: 36 }, { x: 0.8, y: 0.6, width: 8, height: 0.8 }, "title"),
      textElement(
        "本季度门店效率提升主要来自陈列调整与预约制。",
        { fontSizePt: 14 },
        { x: 0.8, y: 1.7, width: 8, height: 4.6 },
        "body",
      ),
    ];
    expect(lintTaste(document).counts.WHITESPACE_IMBALANCE).toBe(0);
  });

  it("does not count a one-glyph quote mark as a third font family", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement(
        "季度经营回顾与下一步判断",
        { fontSizePt: 36 },
        { x: 0.8, y: 0.6, width: 11.5, height: 0.8 },
        "title",
      ),
      textElement("“", { fontSizePt: 72, fontFamily: "Georgia" }, { x: 0.8, y: 1.2, width: 0.6, height: 0.8 }),
      textElement(
        "本季度门店效率提升主要来自陈列调整与预约制，复购率连续三个月上升。",
        { fontSizePt: 14 },
        { x: 1.6, y: 1.7, width: 10.7, height: 4.6 },
        "body",
      ),
    ];
    expect(lintTaste(document).counts.FONT_FAMILY_COUNT).toBe(0);
  });

  it("does not flag an index the layout actually uses", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement(
        "季度经营回顾与下一步判断",
        { fontSizePt: 36 },
        { x: 0.8, y: 0.6, width: 11.5, height: 0.8 },
        "title",
      ),
      ...["01", "02", "03"].map((value, index) =>
        textElement(
          value,
          { fontSizePt: 12, color: "#888888" },
          { x: 0.8, y: 1.2 + index * 0.4, width: 0.5, height: 0.3 },
        ),
      ),
      textElement(
        "本季度门店效率提升主要来自陈列调整与预约制，复购率连续三个月上升。",
        { fontSizePt: 14 },
        { x: 1.6, y: 1.7, width: 10.7, height: 4.6 },
        "body",
      ),
    ];
    expect(lintTaste(document).counts.DECORATION_INDEX_NUMBER).toBe(0);
  });

  it("returns an empty report for a clean page and is deterministic", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement(
        "季度经营回顾与下一步判断",
        { fontSizePt: 36 },
        { x: 0.8, y: 0.6, width: 11.5, height: 0.8 },
        "title",
      ),
      textElement(
        "本季度门店效率提升主要来自陈列调整与预约制，复购率连续三个月上升。",
        { fontSizePt: 14 },
        // 6.4in at 14pt holds about 32 汉字 — inside the readable band. An 11.5in
        // column would hold 59 and read like a printed page seen through a
        // letterbox, which the measure check now reports.
        { x: 0.8, y: 1.7, width: 6.4, height: 4.6 },
        "body",
      ),
    ];
    const first = lintTaste(document);
    const second = lintTaste(document);
    expect(first.issues).toEqual([]);
    expect(first.skipped).toEqual([]);
    expect(first).toEqual(second);
  });

  it("reports a body line that runs wider than a readable measure", () => {
    const document = documentWith(1);
    const long = "本季度门店效率提升主要来自陈列调整与预约制，复购率连续三个月上升，客单价同步走高。";
    document.slides[0]!.elements = [
      textElement("季度经营回顾", { fontSizePt: 36 }, { x: 0.8, y: 0.6, width: 11.5, height: 0.8 }, "title"),
      // The same copy in the full page width: 14pt across 11.5in is about 59
      // 汉字 per line, well past the 36 the band allows.
      textElement(long, { fontSizePt: 14 }, { x: 0.8, y: 1.7, width: 11.5, height: 4.6 }, "body"),
    ];
    const report = lintTaste(document);
    expect(report.counts.MEASURE_TOO_WIDE).toBe(1);
    const issue = report.issues.find((entry) => entry.code === "MEASURE_TOO_WIDE");
    expect(issue?.metrics?.script).toBe("cjk");
    expect(Number(issue?.metrics?.characters)).toBeGreaterThan(36);
    expect(issue?.severity).toBe("soft");
  });

  it("reports a body column too narrow to hold a sentence", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("季度经营回顾", { fontSizePt: 36 }, { x: 0.8, y: 0.6, width: 11.5, height: 0.8 }, "title"),
      // 1.6in at 16pt holds about 9 汉字: the sentence is shredded.
      textElement(
        "本季度门店效率提升主要来自陈列调整与预约制，复购率连续上升。",
        { fontSizePt: 16 },
        { x: 0.8, y: 1.7, width: 1.6, height: 4.6 },
        "body",
      ),
    ];
    const report = lintTaste(document);
    expect(report.counts.MEASURE_TOO_NARROW).toBe(1);
    expect(report.issues.find((entry) => entry.code === "MEASURE_TOO_NARROW")?.metrics?.script).toBe("cjk");
  });

  it("measures Latin copy against its own band", () => {
    const document = documentWith(1);
    document.slides[0]!.elements = [
      textElement("Quarterly review", { fontSizePt: 36 }, { x: 0.8, y: 0.6, width: 11.5, height: 0.8 }, "title"),
      textElement(
        "Store efficiency improved through display changes and appointment slots, and repeat purchase rose for three consecutive quarters.",
        { fontSizePt: 14 },
        { x: 0.8, y: 1.7, width: 5.2, height: 4.6 },
        "body",
      ),
    ];
    const report = lintTaste(document);
    // 5.2in at 14pt holds about 48 Latin characters — inside 40–85.
    expect(report.counts.MEASURE_TOO_WIDE).toBe(0);
    expect(report.counts.MEASURE_TOO_NARROW).toBe(0);
  });

  it("reports skipped checks instead of pretending they passed", () => {
    const document = documentWith(1);
    const page = document.slides[0]!;
    page.elements = [
      textElement("封面", { fontSizePt: 44 }, { x: 0.8, y: 2, width: 11, height: 1 }, "title"),
      {
        id: crypto.randomUUID() as ElementId,
        type: "image",
        placement: "layout-background",
        frame: { x: inches(0), y: inches(0), width: inches(PAGE.width), height: inches(PAGE.height) },
        rotationMilliDegree: 0,
        locked: true,
        origin: "generated",
        source: { kind: "embedded", dataUrl: "data:image/png;base64,", mimeType: "image/png" },
        altText: "模板版式背景",
      },
    ];
    page.content.body = "";
    const report = lintTaste(document);
    expect(report.skipped).toContain("template-artwork:color-whitespace");
    expect(report.skipped).toContain("typography:no-body");
  });
});

describe("colour analysis", () => {
  it("normalizes hex colours and classifies greys as neutral", () => {
    expect(normalizeHexColor("#abc")).toBeUndefined();
    expect(normalizeHexColor("#aabbcc")).toBe("#AABBCC");
    expect(isNeutralColor("#8A8A8A")).toBe(true);
    expect(isNeutralColor("#C0392B")).toBe(false);
    expect(hexToHsl("#C0392B")?.h).toBeCloseTo(6, 0);
  });
});
