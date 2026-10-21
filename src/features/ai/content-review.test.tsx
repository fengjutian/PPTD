import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { aiDraftSchema, type AiDraft } from "../../services/ai-service";
import { ContentReview } from "./ContentReview";
import {
  countCharacters,
  densityLabels,
  draftMetrics,
  isSlideEdited,
  missingTitleIndexes,
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

  it("detects edited slides against the AI original", () => {
    const draft = createDraft();
    expect(isSlideEdited(draft.slides[0]!, draft.slides[0])).toBe(false);
    expect(isSlideEdited({ ...draft.slides[0]!, body: "改过的正文" }, draft.slides[0])).toBe(true);
    expect(isSlideEdited(draft.slides[0]!, undefined)).toBe(false);
  });

  it("upgrades legacy slides with stable ids and keeps existing ids", () => {
    const first = withSlideIds(createDraft());
    expect(first.slides.every((slide) => Boolean(slide.id))).toBe(true);
    expect(new Set(first.slides.map((slide) => slide.id)).size).toBe(first.slides.length);
    expect(withSlideIds(first).slides.map((slide) => slide.id)).toEqual(first.slides.map((slide) => slide.id));
  });
});

describe("content review layout", () => {
  it("shows every page in one continuous list with localized plan labels", () => {
    const draft = withSlideIds(createDraft());
    const markup = renderToStaticMarkup(
      <ContentReview
        draft={draft}
        activeIndex={0}
        saveState="saved"
        onActiveIndexChange={() => undefined}
        onDraftTitleChange={() => undefined}
        onSlideFieldChange={() => undefined}
        onRestoreSlide={() => undefined}
        onNewDraft={() => undefined}
      />,
    );
    expect(markup).toContain("结构化文本 · 中等信息密度");
    expect(markup).not.toContain("medium density");
    expect(markup).toContain("还有 1 页缺少标题");
    expect(markup).toContain("标题不能为空");
    expect(markup.match(/data-slide-index=/g)).toHaveLength(2);
    expect(markup).toContain("已自动保存");
  });
});
