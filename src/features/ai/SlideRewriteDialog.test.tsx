import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideRewriteDialog, type SlideRewriteDialogProps } from "./SlideRewriteDialog";

function renderDialog(props: Partial<SlideRewriteDialogProps> = {}) {
  return renderToStaticMarkup(
    <SlideRewriteDialog
      slideIndex={2}
      title="广告基本盘稳固，云与 AI 重塑增长路径"
      body={"搜索广告仍是利润来源\n云业务首次全年盈利"}
      speakerNotes="先讲结论，再展开两条业务线"
      status="editing"
      onGenerate={() => undefined}
      onApply={() => undefined}
      onClose={() => undefined}
      {...props}
    />,
  );
}

const proposal = {
  body: "搜索广告仍是利润来源，现金流稳定\n云业务首次实现全年盈利\nAI 已进入搜索、办公与云三条主线",
  speakerNotes: "用 30 秒说明三个判断",
  blocks: [
    {
      type: "bullet-list" as const,
      items: ["搜索广告仍是利润来源，现金流稳定", "云业务首次实现全年盈利", "AI 已进入搜索、办公与云三条主线"],
    },
  ],
};

/** 按按钮文字取出它自己的开标签，避免匹配到别的按钮的 disabled。 */
function buttonMarkup(markup: string, label: string): string {
  const end = markup.indexOf(label);
  return markup.slice(markup.lastIndexOf("<button", end), end);
}

describe("AI 重写对话框", () => {
  it("打开时先给出现有内容，还没有发起请求", () => {
    const markup = renderDialog();
    expect(markup).toContain("AI 重写第 3 页");
    expect(markup).toContain("当前内容");
    expect(markup).toContain("搜索广告仍是利润来源");
    expect(markup).toContain("尚未生成");
    expect(markup).toContain("开始重写");
    // 还没生成候选时不能替换。
    expect(buttonMarkup(markup, "替换本页")).toContain("disabled");
  });

  it("从审稿建议进来时预填改写要求", () => {
    const markup = renderDialog({ defaultInstruction: "按这条审稿意见重写本页：与第 4 页重复" });
    expect(markup).toContain("按这条审稿意见重写本页");
  });

  it("标题只读，并说明它不参与重写", () => {
    const markup = renderDialog();
    expect(markup).toContain("本页标题");
    expect(markup).toContain("标题由大纲决定，保持不变");
    expect(markup).not.toContain("<input");
  });

  it("生成中说明进度，并挡住取消之外的重复提交", () => {
    const markup = renderDialog({ status: "running" });
    expect(markup).toContain("正在按本页标题和页面计划重写");
    expect(markup).toContain("重写中");
    expect(markup).toContain("生成中…");
  });

  it("候选版本出现后可以替换，并显示两边字数", () => {
    const markup = renderDialog({ status: "ready", proposal });
    expect(markup).toContain("AI 新版本");
    expect(markup).toContain("云业务首次实现全年盈利");
    expect(markup).toContain("用 30 秒说明三个判断");
    // 有候选时"替换本页"不再是禁用状态。
    expect(buttonMarkup(markup, "替换本页")).not.toContain("disabled");
  });

  it("失败时把原因说出来，并允许重新生成", () => {
    const markup = renderDialog({ status: "error", error: "AI 服务连接超时，请检查网络后重试" });
    expect(markup).toContain("AI 服务连接超时，请检查网络后重试");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("开始重写");
  });
});
