import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiImageDialogView } from "./AiImageDialog";

describe("AI 配图对话框", () => {
  it("让用户描述画面，并选择图的位置", () => {
    const markup = renderToStaticMarkup(
      <AiImageDialogView busy={false} onClose={() => undefined} onGenerate={() => undefined} />,
    );

    expect(markup).toContain("AI 配图");
    expect(markup).toContain("画面描述");
    expect(markup).toContain("主视觉");
    expect(markup).toContain("侧栏图");
    expect(markup).toContain("通栏图");
  });

  it("提醒用户别让模型写字", () => {
    const markup = renderToStaticMarkup(
      <AiImageDialogView busy={false} onClose={() => undefined} onGenerate={() => undefined} />,
    );

    // 生成的文字在演示里几乎总是错的，这句提醒比事后解释有用。
    expect(markup).toContain("不要写标题或正文文字");
  });

  it("生成失败时把原因说出来", () => {
    const markup = renderToStaticMarkup(
      <AiImageDialogView busy={false} error="没有可用的图像服务凭据" onClose={() => undefined} onGenerate={() => undefined} />,
    );

    expect(markup).toContain("没有可用的图像服务凭据");
    expect(markup).toContain('role="alert"');
  });

  it("生成中不允许再提交", () => {
    const markup = renderToStaticMarkup(
      <AiImageDialogView busy onClose={() => undefined} onGenerate={() => undefined} />,
    );

    expect(markup).toContain("生成中");
    expect(markup).toContain("disabled");
  });
});
