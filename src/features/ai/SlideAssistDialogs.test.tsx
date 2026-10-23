import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeckReviewDialog } from "./DeckReviewDialog";
import { SlideTitleDialog } from "./SlideTitleDialog";
import { SpeakerNotesDialog } from "./SpeakerNotesDialog";
import { SplitSlideDialog } from "./SplitSlideDialog";

/** 按按钮文字取出它自己的开标签，避免匹配到别的按钮的 disabled。 */
function buttonMarkup(markup: string, label: string): string {
  const end = markup.lastIndexOf(label);
  return markup.slice(markup.lastIndexOf("<button", end), end);
}

const page = (title: string) => ({
  title,
  body: `${title}的正文\n第二条要点`,
  speakerNotes: `${title}的备注`,
  plan: {
    purpose: "目的",
    conclusion: "结论",
    visualIntent: "structured-text" as const,
    density: "medium" as const,
  },
  blocks: [{ type: "bullet-list" as const, items: ["要点一", "要点二"] }],
});

describe("换标题对话框", () => {
  it("生成中说明正在做什么，候选出现前不能替换", () => {
    const markup = renderToStaticMarkup(
      <SlideTitleDialog
        slideIndex={2}
        currentTitle="广告仍是利润来源"
        status="running"
        onPick={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("AI 换标题 · 第 3 页");
    expect(markup).toContain("当前标题");
    expect(markup).toContain("正在按这一页的内容拟标题");
    expect(buttonMarkup(markup, "用这个标题")).toContain("disabled");
  });

  it("候选出现后可以挑一个替换，并说明标题会进撤销栈", () => {
    const markup = renderToStaticMarkup(
      <SlideTitleDialog
        slideIndex={0}
        currentTitle="旧标题"
        status="ready"
        candidates={["广告仍是利润来源", "云业务首次实现全年盈利"]}
        onPick={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("广告仍是利润来源");
    expect(markup).toContain("云业务首次实现全年盈利");
    expect(markup).toContain("进入撤销栈");
    expect(buttonMarkup(markup, "用这个标题")).not.toContain("disabled");
  });

  it("失败时把原因说出来", () => {
    const markup = renderToStaticMarkup(
      <SlideTitleDialog
        slideIndex={0}
        currentTitle="旧标题"
        status="error"
        error="AI 没有给出可用的标题候选，请重试"
        onPick={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("AI 没有给出可用的标题候选");
    expect(markup).toContain('role="alert"');
  });
});

describe("演讲备注对话框", () => {
  it("只对照备注，不碰正文", () => {
    const markup = renderToStaticMarkup(
      <SpeakerNotesDialog
        slideIndex={1}
        title="广告基本盘稳固"
        currentNotes="旧备注"
        status="ready"
        proposal="先讲结论，再讲两条业务线。"
        onApply={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("只替换演讲备注，正文和内容块保持不动");
    expect(markup).toContain("旧备注");
    expect(markup).toContain("先讲结论，再讲两条业务线。");
    expect(buttonMarkup(markup, "采用这段备注")).not.toContain("disabled");
  });

  it("还没有候选时不能采用", () => {
    const markup = renderToStaticMarkup(
      <SpeakerNotesDialog
        slideIndex={1}
        title="标题"
        currentNotes=""
        status="running"
        onApply={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("正在按这一页的内容写备注");
    expect(buttonMarkup(markup, "采用这段备注")).toContain("disabled");
  });
});

describe("拆页对话框", () => {
  it("把两页放在一起对照，并说明会替换原页", () => {
    const markup = renderToStaticMarkup(
      <SplitSlideDialog
        slideIndex={4}
        title="反垄断裁决与资本开支"
        status="ready"
        pages={[page("裁决影响集中在搜索分发"), page("资本开支转向 AI 基础设施")]}
        onApply={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("裁决影响集中在搜索分发");
    expect(markup).toContain("资本开支转向 AI 基础设施");
    expect(markup).toContain("新第 1 页");
    expect(markup).toContain("新第 2 页");
    expect(markup).toContain("可撤销");
    expect(buttonMarkup(markup, "拆成两页")).not.toContain("disabled");
  });

  it("没有两页候选时不能拆", () => {
    const markup = renderToStaticMarkup(
      <SplitSlideDialog
        slideIndex={0}
        title="标题"
        status="running"
        onApply={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("正在按容量重新分配");
    expect(buttonMarkup(markup, "拆成两页")).toContain("disabled");
  });
});

describe("整册审稿对话框", () => {
  it("列出问题、页码与可跳转的入口，不提供自动改写", () => {
    const markup = renderToStaticMarkup(
      <DeckReviewDialog
        status="ready"
        issues={[
          { slideIndex: 1, severity: "warning", kind: "duplicate", message: "与第 4 页重复讲同一件事" },
          { slideIndex: 5, severity: "error", kind: "missing-conclusion", message: "这一页没有结论" },
        ]}
        onJump={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("第 2 页");
    expect(markup).toContain("内容重复");
    expect(markup).toContain("缺少结论");
    expect(markup).toContain("定位到第 6 页");
    // 审稿只出清单：页面里不能出现任何“自动修好”的动作。
    expect(markup).not.toContain("自动改写");
    expect(markup).not.toContain("一键修复");
  });

  it("没有问题时明确说可以继续", () => {
    const markup = renderToStaticMarkup(
      <DeckReviewDialog
        status="ready"
        issues={[]}
        onJump={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("没有发现内容层的问题");
  });

  it("审稿失败时如实说明", () => {
    const markup = renderToStaticMarkup(
      <DeckReviewDialog
        status="error"
        error="这份草稿暂时无法审稿：页数或内容超出了单次请求的上限"
        onJump={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("超出了单次请求的上限");
    expect(markup).toContain('role="alert"');
  });
});
