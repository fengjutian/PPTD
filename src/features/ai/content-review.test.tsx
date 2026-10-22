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
  slideMetrics,
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
});
