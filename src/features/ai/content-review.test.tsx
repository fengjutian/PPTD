import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bodyFromBlocks, sanitizeBlocks, sanitizeDraftForSave } from "../../services/ai-draft-content";
import { aiDraftSchema, chooseSlideLayout, type AiDraft } from "../../services/ai-service";
import { ContentReview, type ImagePromptAssist } from "./ContentReview";
import {
  countCharacters,
  densityLabels,
  draftMetrics,
  isSlideEdited,
  itemKeyAction,
  missingTitleIndexes,
  nearestSlideIndex,
  outlineNavTarget,
  remapChecks,
  reviewIssues,
  resolveActiveSlideIndex,
  slideCardScrollTop,
  slideCapacityNotes,
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

const plan = {
  purpose: "介绍作者经历",
  conclusion: "经历塑造了作品气质",
  visualIntent: "structured-text" as const,
  density: "medium" as const,
};

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
    expect(reviewIssues(draft)).toEqual([
      { kind: "missing-title", indexes: [1], message: "还有 1 页缺少标题", blocking: true },
    ]);

    const empty: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide, index) =>
        index === 1 ? { ...slide, title: "空白页", body: "", blocks: [] } : slide,
      ),
    };
    expect(reviewIssues(empty)).toEqual([
      { kind: "empty-content", indexes: [1], message: "还有 1 页没有内容", blocking: true },
    ]);
  });

  it("warns about duplicate titles without blocking confirmation", () => {
    const draft = createDraft();
    const duplicated: AiDraft = { ...draft, slides: draft.slides.map((slide) => ({ ...slide, title: "同一个标题" })) };
    const issues = reviewIssues(duplicated);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-title", blocking: false, indexes: [0, 1] });
  });

  it("names every group of repeated titles instead of only the first one", () => {
    const draft = createDraft();
    const titles = ["甲", "甲", "乙", "乙"];
    const repeated: AiDraft = { ...draft, slides: titles.map((title) => ({ ...draft.slides[0]!, title })) };
    const issues = reviewIssues(repeated);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "duplicate-title", blocking: false, indexes: [0, 1, 2, 3] });
    expect(issues[0]!.message).toBe("2 组标题重复（第 1 页、第 2 页：甲；第 3 页、第 4 页：乙）");
  });

  it("warns about titles that are template column names without blocking confirmation", () => {
    const draft = createDraft();
    const templated: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide, index) => ({ ...slide, title: index === 0 ? "现状" : "作者简介——范仲淹" })),
    };
    const issues = reviewIssues(templated);
    const issue = issues.find((item) => item.kind === "templated-title");
    expect(issue).toMatchObject({ blocking: false, indexes: [0] });
    expect(issue!.message).toContain("第 1 页");
  });

  it("warns when several pages share the same title sentence pattern", () => {
    const draft = createDraft();
    const titles = ["增长放缓与利润承压", "获客成本上升与转化下滑", "团队扩张与交付放缓"];
    const repeated: AiDraft = { ...draft, slides: titles.map((title) => ({ ...draft.slides[0]!, title })) };
    const issues = reviewIssues(repeated);
    const issue = issues.find((item) => item.kind === "repeated-title-pattern");
    expect(issue).toMatchObject({ blocking: false, indexes: [0, 1, 2] });
    expect(issue!.message).toContain("句式重复");
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
    expect(
      isSlideEdited({ ...draft.slides[0]!, blocks: [{ type: "bullet-list", items: ["字希文"] }] }, draft.slides[0]),
    ).toBe(true);
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
    expect(bodyFromBlocks([{ type: "table-data", header: ["项目", " "], rows: [["营收", ""]] }])).toBe(
      "项目 | \n营收 | ",
    );
  });
});

describe("table grid editing", () => {
  const table = {
    type: "table-data" as const,
    header: ["项目", "数值"],
    rows: [
      ["营收", "38万"],
      ["成本", "12万"],
    ],
  };

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
    expect(
      tableBlockOversized({
        ...table,
        header: Array.from({ length: TABLE_REVIEW_MAX_COLUMNS + 1 }, (_, i) => `列${i}`),
      }),
    ).toBe(true);
    expect(
      tableBlockOversized({ ...table, rows: Array.from({ length: TABLE_REVIEW_MAX_ROWS + 1 }, () => ["a", "b"]) }),
    ).toBe(true);
    // A wider row is storable but is called out separately: the export would
    // drop the cells the header has no column for.
    expect(tableBlockOversized({ ...table, rows: [["a", "b", "c"]] })).toBe(false);
    expect(tableBlockRagged({ ...table, rows: [["a", "b", "c"]] })).toBe(true);
    expect(tableBlockRagged(table)).toBe(false);

    const draft = createDraft();
    const wide: AiDraft = {
      ...draft,
      slides: [
        {
          ...draft.slides[0]!,
          blocks: [{ ...table, header: Array.from({ length: TABLE_REVIEW_MAX_COLUMNS + 1 }, (_, i) => `列${i}`) }],
        },
      ],
    };
    expect(reviewIssues(wide)).toEqual([
      {
        kind: "table-too-large",
        indexes: [0],
        message: `还有 1 页表格超过上限（最多 ${TABLE_REVIEW_MAX_COLUMNS} 列、${TABLE_REVIEW_MAX_ROWS} 行）`,
        blocking: true,
      },
    ]);

    const ragged: AiDraft = {
      ...draft,
      slides: [{ ...draft.slides[0]!, blocks: [{ ...table, rows: [["营收", "38万", "备注"]] }] }],
    };
    expect(reviewIssues(ragged)).toEqual([
      { kind: "table-ragged", indexes: [0], message: "还有 1 页表格行比表头宽，导出会丢失多出的列", blocking: true },
    ]);
  });

  it("shows the picture intent of a page so it can be reviewed", () => {
    const draft = createDraft();
    const withImage: AiDraft = {
      ...draft,
      slides: [
        {
          ...draft.slides[0]!,
          plan: {
            ...draft.slides[0]!.plan,
            visualAsset: { enabled: true, prompt: "一间明亮的现代化数据中心", role: "side", source: "model" },
          },
        },
      ],
    };
    const markup = renderReview(withImage);
    // 审核阶段是唯一还没花钱生成图片的时机：这一页要配什么图必须看得见。
    expect(markup).toContain("页面配图");
    expect(markup).toContain("一间明亮的现代化数据中心");
    expect(markup).toContain("侧栏图");
  });

  it("reports a picture prompt that asks for text in the picture", () => {
    const draft = createDraft();
    const withImage: AiDraft = {
      ...draft,
      slides: [
        {
          ...draft.slides[0]!,
          plan: {
            ...draft.slides[0]!.plan,
            visualAsset: { enabled: true, prompt: "一块写着「季度增长」的指示牌", role: "side", source: "model" },
          },
        },
      ],
    };
    const issues = reviewIssues(withImage);
    // 配图的问题不阻塞审核：内容本身没问题，图的事可以之后再定。
    expect(issues).toContainEqual({
      kind: "image-text-request",
      indexes: [0],
      message: "画面描述里要求出现文字或字母，生成图的文字几乎总是错的",
      blocking: false,
    });
  });

  it("treats a table whose cells are all blank as a page without content", () => {
    const draft = createDraft();
    const blank: AiDraft = {
      ...draft,
      slides: [{ ...draft.slides[0]!, body: "", blocks: [{ type: "table-data", header: ["", ""], rows: [["", ""]] }] }],
    };
    expect(slideHasContent(blank.slides[0]!)).toBe(false);
    expect(
      slideHasContent({
        ...blank.slides[0]!,
        blocks: [{ type: "table-data", header: ["项目", ""], rows: [["", ""]] }],
      }),
    ).toBe(true);
    // Pages without blocks still fall back to their body copy.
    expect(slideHasContent({ ...draft.slides[0]!, blocks: [], body: "纯文本正文" })).toBe(true);
  });
});

function renderReview(
  draft: AiDraft,
  activeIndex = 0,
  originalDraft?: AiDraft,
  regeneration?: { label: string; percent: number },
  imagePromptAssist?: ImagePromptAssist,
) {
  return renderToStaticMarkup(
    <ContentReview
      draft={draft}
      originalDraft={originalDraft}
      activeIndex={activeIndex}
      saveState="saved"
      restoreUndoSlideIds={[]}
      canUndo={false}
      canRedo={false}
      regenerating={Boolean(regeneration)}
      regenerateProgress={regeneration}
      onActiveIndexChange={() => undefined}
      onDraftTitleChange={() => undefined}
      onSlideFieldChange={() => undefined}
      onSlideVisualAssetChange={() => undefined}
      onSlideBlocksChange={() => undefined}
      onSlideChecksChange={() => undefined}
      onSlideReviewedChange={() => undefined}
      onReviewAllSlides={() => undefined}
      onAddSlide={() => undefined}
      onDuplicateSlide={() => undefined}
      onDeleteSlide={() => undefined}
      onMoveSlide={() => undefined}
      onRestoreSlide={() => undefined}
      onUndoRestore={() => undefined}
      onRewriteSlide={() => undefined}
      onSuggestTitle={() => undefined}
      onWriteNotes={() => undefined}
      onSplitSlide={() => undefined}
      onReviewDeck={() => undefined}
      imagePromptAssist={imagePromptAssist}
      onSuggestImagePrompts={() => undefined}
      onDismissImagePrompts={() => undefined}
      onUndo={() => undefined}
      onRedo={() => undefined}
    />,
  );
}

describe("content review layout", () => {
  it("shows only the active page editor with localized plan labels", () => {
    const markup = renderReview(withSlideIds(createDraft()));
    expect(markup).toContain("结构化文本 · 中等信息密度");
    expect(markup).not.toContain("medium density");
    expect(markup).toContain("还有 1 页缺少标题");
    expect(markup.match(/data-slide-index=/g)).toHaveLength(1);
    expect(markup).toContain("已自动保存");
    expect(markup).toContain("内容编辑历史");
    expect(markup).toContain("下一处问题");
    expect(markup).toContain("新增页面");
    expect(markup).toContain("复制第 1 页");
    expect(markup).toContain("上移第 1 页");
    expect(markup).toContain("删除第 1 页");
    // 审核页的 AI 入口只在这个页面出现：整份重新生成不认识单页上下文。
    expect(markup).toContain("AI 重写");
    expect(markup).toContain("AI 换标题");
    expect(markup).toContain("AI 备注");
    expect(markup).toContain("AI 拆页");
    expect(markup).toContain("AI 审稿");
    expect(markup).toContain("恢复 AI 原稿");
    expect(markup.match(/draft-slide-card active/g)).toHaveLength(1);
    expect(markup).not.toContain("draft-slide-card collapsed");
  });

  it("renders the page selected from the outline and omits the other editor cards", () => {
    const draft = withSlideIds(createDraft());
    const markup = renderReview(draft, 1);
    expect(markup).toContain('data-slide-index="1"');
    expect(markup).not.toContain('data-slide-index="0"');
    expect(markup).toContain(`value="${draft.slides[1]!.title}`);
    expect(markup).not.toContain(`value="${draft.slides[0]!.title}`);
    expect(markup).toContain("标题不能为空");
    // 没有标题就没有重写依据，入口保持禁用。
    expect(markup).toContain("先补全页面标题");
  });

  it("keeps the outline as a single tab stop with arrow-key movement", () => {
    const markup = renderReview(withSlideIds(createDraft()));
    expect(markup).toContain('data-outline-index="0"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("marks changed pages and names the destructive reset explicitly", () => {
    const original = withSlideIds(createDraft());
    const edited = {
      ...original,
      slides: original.slides.map((slide, index) => (index === 0 ? { ...slide, body: "修改后的正文" } : slide)),
    };
    const markup = renderReview(edited, 0, original);
    expect(markup).toContain("已修改");
    expect(markup).toContain("1 页已修改");
    expect(markup).toContain("恢复 AI 原稿");
    expect(markup).toContain("撤销");
    expect(markup).toContain("重做");
  });

  it("keeps the current draft readable while the whole draft is regenerated", () => {
    const draft = withSlideIds(createDraft());
    const markup = renderReview(draft, 0, draft, { label: "正在生成正文（已写 4 页）", percent: 42 });
    // 重新生成期间旧草稿仍是屏幕上的内容：不能先清空再看结果。
    expect(markup).toContain(`value="${draft.slides[0]!.title}"`);
    expect(markup).toContain("draft-regenerate-progress");
    expect(markup).toContain("正在生成正文（已写 4 页）");
    expect(markup).toContain("可以用撤销回到这一版");
    // 进度条反映的是这次重新生成，不是某个已完成的任务。
    expect(markup).toContain('aria-valuenow="42"');
    expect(renderReview(draft, 0, draft)).not.toContain("draft-regenerate-progress");
  });

  it("shows persisted review progress and the unified content block entry", () => {
    const draft = withSlideIds(createDraft());
    const reviewed = {
      ...draft,
      slides: draft.slides.map((slide, index) => (index === 0 ? { ...slide, reviewed: true } : slide)),
    };
    const markup = renderReview(reviewed, 0, draft);
    expect(markup).toContain("1/2 页已审核");
    expect(markup).toContain("下一未审核页");
    expect(markup).toContain("标记已审核");
    expect(markup).toContain("新增内容块类型");
    expect(markup).toContain("添加内容块");
    expect(markup).toContain("全部标记已审核");
    expect(markup).toContain("上移第 1 页的");
    expect(markup).toContain("下移第 1 页的");
  });

  it("shows picture-description candidates inside the page's image section", () => {
    const draft = withSlideIds(createDraft());
    const withAsset: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide, index) =>
        index === 0
          ? {
              ...slide,
              plan: {
                ...slide.plan,
                visualAsset: { enabled: true, prompt: "", role: "side" as const, source: "model" as const },
              },
            }
          : slide,
      ),
    };
    const markup = renderReview(withAsset, 0, undefined, undefined, {
      index: 0,
      status: "ready",
      candidates: ["一间明亮的现代化数据中心", "抽象几何线条构成的上升箭头"],
    });

    expect(markup).toContain("AI 写画面描述");
    expect(markup).toContain("一间明亮的现代化数据中心");
    expect(markup).toContain("收起");
  });

  it("keeps the per-page review flag when a draft is sanitized for history", () => {
    const draft = createDraft();
    const saved = sanitizeDraftForSave({
      ...draft,
      slides: draft.slides.map((slide, index) => ({ ...slide, reviewed: index === 0 })),
    });
    expect(aiDraftSchema.parse(saved).slides.map((slide) => slide.reviewed)).toEqual([true, false]);
  });

  it("scrolls the card list itself when a page is selected", () => {
    // The list is the only container that may move: scrolling the page would
    // shift the whole application window and leave an empty band below.
    expect(slideCardScrollTop({ listTop: 100, cardTop: 420, scrollTop: 0, margin: 12 })).toBe(308);
    expect(slideCardScrollTop({ listTop: 100, cardTop: 420, scrollTop: 200, margin: 12 })).toBe(508);
    expect(slideCardScrollTop({ listTop: 100, cardTop: 90, scrollTop: 0, margin: 12 })).toBe(0);
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
        {
          ...draft.slides[0]!,
          title: "数据页",
          blocks: [{ type: "table-data", header: ["项目", "数值"], rows: [["营收", "38万"]] }],
        },
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
        {
          ...withTable.slides[0]!,
          blocks: [
            {
              type: "table-data",
              header: Array.from({ length: TABLE_REVIEW_MAX_COLUMNS + 1 }, (_, i) => `列${i}`),
              rows: [["a"]],
            },
          ],
        },
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

describe("page selection history", () => {
  it("keeps the active logical page selected after reorder", () => {
    const draft = withSlideIds(createDraft());
    const activeId = draft.slides[1]!.id;
    const reordered = { ...draft, slides: [draft.slides[1]!, draft.slides[0]!] };
    expect(resolveActiveSlideIndex(reordered, activeId, 1)).toBe(0);
  });

  it("uses a bounded fallback after the active page is deleted", () => {
    const draft = withSlideIds(createDraft());
    const remaining = { ...draft, slides: [draft.slides[0]!] };
    expect(resolveActiveSlideIndex(remaining, draft.slides[1]!.id, 1)).toBe(0);
    expect(resolveActiveSlideIndex(remaining, undefined, 99)).toBe(0);
  });
});

describe("layout pre-check", () => {
  it("warns about a page that carries more copy than the layout can show", () => {
    const draft = withSlideIds(createDraft());
    const heavy: AiDraft = {
      ...draft,
      slides: [
        draft.slides[0]!,
        {
          ...draft.slides[1]!,
          title: "很长的标题会把标题框撑破所以必须改短一点才放得下并把正文挤到页面下面去",
          body: "",
          blocks: [{ type: "bullet-list", items: Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 条要点`) }],
        },
      ],
    };
    const markup = renderReview(heavy, 1);
    expect(markup).toContain("排版预检");
    expect(markup).toContain("超过卡片网格的 6 条上限");
    expect(markup).toContain("标题框只放得下 1 行");
    // The pre-check is advice, not a blocker: the page can still be confirmed.
    expect(markup).not.toContain("还有 1 页缺少标题");
  });

  it("hangs the note of a point list on the list it talks about", () => {
    const notes = slideCapacityNotes(
      { title: "标题", body: "", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items: ["一", "二", "三"] }] },
      1,
    );
    expect(notes.map((note) => note.scope)).toContain("items");
    expect(notes.every((note) => note.blockIndex === 0)).toBe(true);
  });

  it("describes the copy the same way the layout chooser reads it", () => {
    // The advice and the layout have to come from the same thresholds, or the
    // review screen describes a page the generator does not build.
    const items = ["一条要点", "第二条要点", "第三条要点", "第四条要点", "第五条要点"];
    const notes = slideCapacityNotes(
      { title: "标题", body: "", speakerNotes: "", plan, blocks: [{ type: "bullet-list", items }] },
      1,
    );
    expect(notes.find((note) => note.message.includes("卡片网格"))!.message).toContain("3 列");
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: items.join("\n"),
        blocks: [{ type: "bullet-list", items }],
      }),
    ).toBe("cards");
  });

  it("shows the two sides of a comparison next to each other", () => {
    const draft = withSlideIds(createDraft());
    const comparison: AiDraft = {
      ...draft,
      slides: [
        {
          ...draft.slides[0]!,
          title: "方案对比",
          blocks: [
            {
              type: "comparison",
              leftLabel: "方案 A",
              rightLabel: "方案 B",
              leftItems: ["稳定"],
              rightItems: ["快速"],
            },
          ],
        },
        draft.slides[1]!,
      ],
    };
    const markup = renderReview(comparison);
    expect(markup).toContain("comparison-columns");
    expect(markup.match(/comparison-column"/g)).toHaveLength(2);
    expect(markup).toContain("第 1 页左侧标题");
    expect(markup).toContain("第 1 页右侧标题");
    // The left side comes before the right side, so the markup reads like the page.
    expect(markup.indexOf("第 1 页左侧标题")).toBeLessThan(markup.indexOf("第 1 页右侧标题"));
  });

  it("warns about a comparison whose columns do not balance", () => {
    const notes = slideCapacityNotes(
      {
        title: "方案对比",
        body: "",
        speakerNotes: "",
        plan,
        blocks: [
          {
            type: "comparison",
            leftLabel: "方案 A",
            rightLabel: "方案 B",
            leftItems: ["一", "二", "三", "四"],
            rightItems: ["一"],
          },
        ],
      },
      1,
    );
    expect(notes.find((note) => note.scope === "comparison")!.message).toContain("两栏相差 3 条");
  });
});

describe("核实标记", () => {
  it("块重排时标记跟着换位置，被删掉的块连标记一起消失", () => {
    const checks = [
      { blockIndex: 1, kind: "number" as const, status: "unverified" as const },
      { blockIndex: undefined, kind: "fact" as const, status: "verified" as const },
    ];

    expect(remapChecks(checks, (old) => (old === 1 ? 0 : old))).toEqual([
      { blockIndex: 0, kind: "number", status: "unverified" },
      { blockIndex: undefined, kind: "fact", status: "verified" },
    ]);
    expect(remapChecks(checks, () => undefined)).toEqual([{ blockIndex: undefined, kind: "fact", status: "verified" }]);
  });

  it("待核实作为非阻塞提醒出现在问题清单里", () => {
    const draft = createDraft();
    const checked: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide, index) =>
        index === 0
          ? { ...slide, checks: [{ blockIndex: 0, kind: "number" as const, status: "unverified" as const }] }
          : slide,
      ),
    };

    expect(reviewIssues(checked)).toContainEqual({
      kind: "unverified-claims",
      indexes: [0],
      message: "还有 1 处内容待核实",
      blocking: false,
    });
  });

  it("每个内容块都有待核实入口，页头显示未核实数量", () => {
    const draft = withSlideIds(createDraft());
    const checked: AiDraft = {
      ...draft,
      slides: draft.slides.map((slide, index) =>
        index === 0
          ? { ...slide, checks: [{ blockIndex: 0, kind: "number" as const, status: "unverified" as const }] }
          : slide,
      ),
    };
    const markup = renderReview(checked);

    expect(markup).toContain("数字 · 待核实");
    expect(markup).toContain("1 处待核实");
    expect(markup).toContain("删除第 1 页的要点列表核实标记");
    // 没有标记的块提供添加入口。
    expect(renderReview(draft)).toContain("标记第 1 页的要点列表待核实");
  });
});
