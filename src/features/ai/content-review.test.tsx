import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bodyFromBlocks, sanitizeBlocks, sanitizeDraftForSave } from "../../services/ai-draft-content";
import { aiDraftSchema, type AiDraft } from "../../services/ai-service";
import { ContentReview } from "./ContentReview";
import {
  countCharacters,
  densityLabels,
  draftMetrics,
  isSlideEdited,
  itemKeyAction,
  missingTitleIndexes,
  nearestSlideIndex,
  outlineNavTarget,
  reviewIssues,
  slideHasContent,
  slideMetrics,
  TABLE_REVIEW_MAX_COLUMNS,
  TABLE_REVIEW_MAX_ROWS,
  tableBlockOversized,
  tableBlockRagged,
  tableCellKeyAction,
  visualIntentLabels,
  withSlideIds,
} from "./content-review";

const plan = { purpose: "介绍作者经历", conclusion: "经历塑造了作品气质", visualIntent: "structured-text" as const, density: "medium" as const };

function createDraft(): AiDraft {
  return aiDraftSchema.parse({
    title: "岳阳楼记课件",
    presentationBrief: {
      objective: "完成课堂讲解",
      audience: "初中学生",
      scenario: "语文课堂",
      expectedAction: "理解文章主旨",
      coreConclusion: "先天下之忧而忧",
      narrativeStrategy: "training",
      assumptions: [],
    },
    slides: [
      {
        title: "作者简介——范仲淹",
        body: "1. 字希文\n2. 祖籍邠州",
        speakerNotes: "重点介绍政治理想",
        plan,
        blocks: [{ type: "bullet-list", items: ["字希文", "祖籍邠州"] }],
      },
      {
        title: " ",
        body: "这一段还没有标题。",
        speakerNotes: "",
        plan,
        blocks: [{ type: "paragraph", text: "这一段还没有标题。" }],
      },
    ],
  });
}

describe("content review metrics", () => {
  it("counts visible characters without whitespace", () => {
    expect(countCharacters("第 1 页\n\n正文")).toBe(5);
    expect(countCharacters("")).toBe(0);
  });

  it("reads point counts and the outline preview from structured blocks", () => {
    const slide = createDraft().slides[0]!;
    expect(slideMetrics(slide)).toMatchObject({ points: 2, preview: "字希文" });
    expect(slideMetrics(slide).characters).toBeGreaterThan(0);
  });

  it("falls back to body lines for drafts without blocks", () => {
    const slide = createDraft().slides[1]!;
    expect(slideMetrics(slide).points).toBe(1);
  });

  it("sums slide metrics into draft totals", () => {
    const draft = createDraft();
    const total = draftMetrics(draft);
    expect(total.points).toBe(3);
    expect(total.characters).toBe(draft.slides.reduce((sum, slide) => sum + slideMetrics(slide).characters, 0));
  });

  it("localizes internal planning enums for the review UI", () => {
    expect(visualIntentLabels["structured-text"]).toBe("结构化文本");
    expect(densityLabels.medium).toBe("中等信息密度");
    expect(Object.values(densityLabels).join(" ")).not.toContain("density");
  });

  it("finds pages that cannot be confirmed yet", () => {
    expect(missingTitleIndexes(createDraft())).toEqual([1]);
  });

  it("reports blocking issues with the page each one should jump to", () => {
    const draft = createDraft();
    expect(reviewIssues(draft)).toEqual([{ kind: "missing-title", indexes: [1], message: "还有 1 页缺少标题", blocking: true }]);

    const empty: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide, index) => (index === 1 ? { ...slide, title: "空白页", body: "", blocks: [] } : slide)),
    };
    expect(reviewIssues(empty)).toEqual([{ kind: "empty-content", indexes: [1], message: "还有 1 页没有内容", blocking: true }]);
  });

  it("warns about duplicate titles without blocking confirmation", () => {
    const draft = createDraft();
    const duplicated: AiDraft = { ...draft, slides: draft.slides.map((slide) => ({ ...slide, title: "同一个标题" })) };
    const issues = reviewIssues(duplicated);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-title", blocking: false, indexes: [0, 1] });
  });

  it("moves the outline selection with arrow, Home and End keys", () => {
    expect(outlineNavTarget("ArrowDown", 0, 3)).toBe(1);
    expect(outlineNavTarget("ArrowUp", 2, 3)).toBe(1);
    expect(outlineNavTarget("ArrowDown", 2, 3)).toBe(2);
    expect(outlineNavTarget("ArrowUp", 0, 3)).toBe(0);
    expect(outlineNavTarget("Home", 2, 3)).toBe(0);
    expect(outlineNavTarget("End", 0, 3)).toBe(2);
    expect(outlineNavTarget("Tab", 0, 3)).toBeUndefined();
    expect(outlineNavTarget("ArrowDown", 0, 0)).toBeUndefined();
  });

  it("highlights the card nearest the list top while scrolling", () => {
    const cards = [
      { index: 0, top: -420 },
      { index: 1, top: 4 },
      { index: 2, top: 380 },
    ];
    expect(nearestSlideIndex(cards, 0)).toBe(1);
    expect(nearestSlideIndex([{ index: 0, top: 200 }], 0)).toBe(0);
    expect(nearestSlideIndex([], 0)).toBeUndefined();
  });

  it("adds a row on Enter and removes an empty row on Backspace", () => {
    expect(itemKeyAction("Enter", "", 0, 2, 6)).toEqual({ type: "insert" });
    expect(itemKeyAction("Enter", "", 5, 6, 6)).toBeUndefined();
    expect(itemKeyAction("Backspace", "  ", 2, 3, 6)).toEqual({ type: "remove", focus: 1 });
    expect(itemKeyAction("Backspace", "已经写好的要点", 1, 3, 6)).toBeUndefined();
    expect(itemKeyAction("Backspace", "", 0, 1, 6)).toBeUndefined();
    expect(itemKeyAction("a", "", 0, 2, 6)).toBeUndefined();
  });

  it("detects edited slides against the AI original", () => {
    const draft = createDraft();
    expect(isSlideEdited(draft.slides[0]!, draft.slides[0])).toBe(false);
    expect(isSlideEdited({ ...draft.slides[0]!, body: "改过的正文" }, draft.slides[0])).toBe(true);
    // A block-only edit (for example a corrected metric value) must still count,
    // because the block is what the deck renders.
    expect(isSlideEdited({ ...draft.slides[0]!, blocks: [{ type: "bullet-list", items: ["字希文"] }] }, draft.slides[0])).toBe(true);
    expect(isSlideEdited(draft.slides[0]!, undefined)).toBe(false);
  });

  it("upgrades legacy slides with stable ids and keeps existing ids", () => {
    const first = withSlideIds(createDraft());
    expect(first.slides.every((slide) => Boolean(slide.id))).toBe(true);
    expect(new Set(first.slides.map((slide) => slide.id)).size).toBe(first.slides.length);
    expect(withSlideIds(first).slides.map((slide) => slide.id)).toEqual(first.slides.map((slide) => slide.id));
  });
});

describe("structured content editing", () => {
  it("projects structured blocks into the plain-text body the layout heuristics read", () => {
    expect(
      bodyFromBlocks([
        { type: "metric", label: "增长率", value: "38%" },
        { type: "comparison", leftLabel: "现状", rightLabel: "目标", leftItems: ["人工"], rightItems: ["自动"] },
      ]),
    ).toBe("增长率：38%\n现状\n人工\n目标\n自动");
  });

  it("drops emptied items and blocks without touching a table", () => {
    const table = { type: "table-data" as const, header: ["项目", "数值"], rows: [["营收", "38万"]] };
    expect(
      sanitizeBlocks([
        { type: "bullet-list", items: ["保留", "  "] },
        { type: "paragraph", text: " " },
        { type: "metric", label: "指标", value: "" },
        table,
      ]),
    ).toEqual([{ type: "bullet-list", items: ["保留"] }, table]);
  });

  it("keeps a half-written draft loadable instead of dropping it from history", () => {
    const draft = createDraft();
    const messy: AiDraft = {
      ...draft,
      title: "",
      slides: [
        { ...draft.slides[0]!, title: "", blocks: [{ type: "bullet-list", items: ["字希文", ""] }] },
        draft.slides[1]!,
      ],
    };
    const cleaned = sanitizeDraftForSave(messy);
    expect(() => aiDraftSchema.parse(cleaned)).not.toThrow();
    expect(cleaned.slides[0]!.blocks).toEqual([{ type: "bullet-list", items: ["字希文"] }]);
    // The review UI trims the stored placeholder, so the page still reads as missing a title.
    expect(cleaned.slides[0]!.title.trim()).toBe("");
    expect(cleaned.title.trim()).toBe("");
  });

  it("stores a cleared table header cell as a placeholder instead of failing validation", () => {
    const draft = createDraft();
    const table = { type: "table-data" as const, header: ["项目", ""], rows: [["营收", ""]] };
    const cleaned = sanitizeDraftForSave({ ...draft, slides: [{ ...draft.slides[0]!, blocks: [table] }] });
    expect(() => aiDraftSchema.parse(cleaned)).not.toThrow();
    const stored = cleaned.slides[0]!.blocks[0]!;
    expect(stored.type === "table-data" && stored.header[1]).toBe(" ");
    // Blank body cells are legitimate data, so they are kept untouched.
    expect(stored.type === "table-data" && stored.rows[0]![1]).toBe("");
  });

  it("trims blank table cells out of the plain-text projection", () => {
    expect(bodyFromBlocks([{ type: "table-data", header: ["项目", " "], rows: [["营收", ""]] }])).toBe("项目 | \n营收 | ");
  });
});

describe("table grid editing", () => {
  const table = { type: "table-data" as const, header: ["项目", "数值"], rows: [["营收", "38万"], ["成本", "12万"]] };

  it("moves between cells like a grid and appends a row from the last one", () => {
    expect(tableCellKeyAction("ArrowDown", 0, 2, true)).toEqual({ type: "focus", row: 1 });
    expect(tableCellKeyAction("ArrowUp", 1, 2, true)).toEqual({ type: "focus", row: 0 });
    expect(tableCellKeyAction("ArrowUp", 0, 2, true)).toEqual({ type: "focus", row: 0 });
    expect(tableCellKeyAction("Enter", 0, 2, true)).toEqual({ type: "focus", row: 1 });
    expect(tableCellKeyAction("Enter", 1, 2, true)).toEqual({ type: "append-row", row: 2 });
    expect(tableCellKeyAction("Enter", 1, 2, false)).toBeUndefined();
    expect(tableCellKeyAction("Tab", 0, 2, true)).toBeUndefined();
  });

  it("flags a table the document model cannot store", () => {
    expect(tableBlockOversized(table)).toBe(false);
    expect(tableBlockOversized({ ...table, header: Array.from({ length: TABLE_REVIEW_MAX_COLUMNS + 1 }, (_, i) => `列${i}`) })).toBe(true);
    expect(tableBlockOversized({ ...table, rows: Array.from({ length: TABLE_REVIEW_MAX_ROWS + 1 }, () => ["a", "b"]) })).toBe(true);
    // A wider row is storable but is called out separately: the export would
    // drop the cells the header has no column for.
    expect(tableBlockOversized({ ...table, rows: [["a", "b", "c"]] })).toBe(false);
    expect(tableBlockRagged({ ...table, rows: [["a", "b", "c"]] })).toBe(true);
    expect(tableBlockRagged(table)).toBe(false);

    const draft = createDraft();
    const wide: AiDraft = {
      ...draft,
      slides: [{ ...draft.slides[0]!, blocks: [{ ...table, header: Array.from({ length: TABLE_REVIEW_MAX_COLUMNS + 1 }, (_, i) => `列${i}`) }] }],
    };
    expect(reviewIssues(wide)).toEqual([
      { kind: "table-too-large", indexes: [0], message: `还有 1 页表格超过上限（最多 ${TABLE_REVIEW_MAX_COLUMNS} 列、${TABLE_REVIEW_MAX_ROWS} 行）`, blocking: true },
    ]);

    const ragged: AiDraft = { ...draft, slides: [{ ...draft.slides[0]!, blocks: [{ ...table, rows: [["营收", "38万", "备注"]] }] }] };
    expect(reviewIssues(ragged)).toEqual([
      { kind: "table-ragged", indexes: [0], message: "还有 1 页表格行比表头宽，导出会丢失多出的列", blocking: true },
    ]);
  });

  it("treats a table whose cells are all blank as a page without content", () => {
    const draft = createDraft();
    const blank: AiDraft = { ...draft, slides: [{ ...draft.slides[0]!, body: "", blocks: [{ type: "table-data", header: ["", ""], rows: [["", ""]] }] }] };
    expect(slideHasContent(blank.slides[0]!)).toBe(false);
    expect(slideHasContent({ ...blank.slides[0]!, blocks: [{ type: "table-data", header: ["项目", ""], rows: [["", ""]] }] })).toBe(true);
    // Pages without blocks still fall back to their body copy.
    expect(slideHasContent({ ...draft.slides[0]!, blocks: [], body: "纯文本正文" })).toBe(true);
  });
});

function renderReview(draft: AiDraft, activeIndex = 0) {
  return renderToStaticMarkup(
    <ContentReview
      draft={draft}
      activeIndex={activeIndex}
      saveState="saved"
      restoreUndoIndexes={[]}
      onActiveIndexChange={() => undefined}
      onDraftTitleChange={() => undefined}
      onSlideFieldChange={() => undefined}
      onSlideBlocksChange={() => undefined}
      onRestoreSlide={() => undefined}
      onUndoRestore={() => undefined}
      onNewDraft={() => undefined}
    />,
  );
}

describe("content review layout", () => {
  it("shows every page in one continuous list with localized plan labels", () => {
    const markup = renderReview(withSlideIds(createDraft()));
    expect(markup).toContain("结构化文本 · 中等信息密度");
    expect(markup).not.toContain("medium density");
    expect(markup).toContain("还有 1 页缺少标题");
    expect(markup).toContain("标题不能为空");
    expect(markup.match(/data-slide-index=/g)).toHaveLength(2);
    expect(markup).toContain("已自动保存");
  });

  it("keeps the outline as a single tab stop with arrow-key movement", () => {
    const markup = renderReview(withSlideIds(createDraft()));
    expect(markup).toContain('data-outline-index="0"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("edits structured pages through their blocks instead of flattening them into body text", () => {
    const markup = renderReview(withSlideIds(createDraft()));
    expect(markup).toContain("要点列表");
    expect(markup).toContain("第 1 页要点第 1 条");
    expect(markup).not.toContain("第 1 页正文");
  });

  it("falls back to a plain body field for legacy drafts without blocks", () => {
    const draft = withSlideIds(createDraft());
    const legacy: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide) => ({ ...slide, blocks: [] })),
    };
    const markup = renderReview(legacy);
    expect(markup).toContain("第 1 页正文");
    expect(markup).not.toContain("要点列表");
  });

  it("flags a page with neither blocks nor body copy", () => {
    const draft = withSlideIds(createDraft());
    const empty: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide) => ({ ...slide, body: "", blocks: [] })),
    };
    const markup = renderReview(empty);
    expect(markup).toContain("本页还没有内容，补全后才能确认");
    expect(markup).toContain("还有 2 页没有内容");
  });

  it("edits table cells in place and can still shrink an oversized table", () => {
    const draft = withSlideIds(createDraft());
    const withTable: AiDraft = {
      ...draft,
      slides: [
        { ...draft.slides[0]!, title: "数据页", blocks: [{ type: "table-data", header: ["项目", "数值"], rows: [["营收", "38万"]] }] },
        draft.slides[1]!,
      ],
    };
    const markup = renderReview(withTable);
    expect(markup).toContain("第 1 页表格表头第 2 列");
    expect(markup).toContain("第 1 页表格第 1 行第 1 列");
    expect(markup).toContain("删除第 1 页表格第 2 列");
    expect(markup).toContain("添加一列");
    expect(markup).toContain("导出为可编辑的 PowerPoint 表格");

    const wide: AiDraft = {
      ...withTable,
      slides: [
        { ...withTable.slides[0]!, blocks: [{ type: "table-data", header: Array.from({ length: TABLE_REVIEW_MAX_COLUMNS + 1 }, (_, i) => `列${i}`), rows: [["a"]] }] },
        draft.slides[1]!,
      ],
    };
    const wideMarkup = renderReview(wide);
    expect(wideMarkup).toContain("表格超过可编辑上限");
    expect(wideMarkup).toContain("还有 1 页表格超过上限");
    // The extra column can still be removed, so no column is read-only.
    expect(wideMarkup.match(/删除第 1 页表格第 \d+ 列/g)).toHaveLength(TABLE_REVIEW_MAX_COLUMNS + 1);
  });
});
