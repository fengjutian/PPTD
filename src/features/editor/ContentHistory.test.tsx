import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, createSlide } from "../../core/document-model";
import { captureContentVersion } from "../../core/document-model/content-version";
import { ContentHistory } from "./ContentHistory";

describe("content history", () => {
  it("explains how the first version is created when there is no history", () => {
    const markup = renderToStaticMarkup(
      <ContentHistory
        document={createDocument()}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );
    expect(markup).toContain("内容版本");
    expect(markup).toContain("还没有已确认的内容版本");
    expect(markup).toContain("确认本页内容或应用 AI 内容后");
  });

  it("shows the selected version beside the changes that were made after it", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "旧标题";
    captureContentVersion(document);
    document.slides[0]!.content.title = "新标题";

    const markup = renderToStaticMarkup(
      <ContentHistory
        document={document}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );

    expect(markup).toContain("内容 r1");
    expect(markup).toContain("文档 r1");
    expect(markup).toContain("最新");
    expect(markup).toContain("1 页有变化");
    expect(markup).toContain("有修改");
    expect(markup).toContain("旧标题");
    expect(markup).toContain("新标题");
    expect(markup).toContain("标题");
    expect(markup).toContain("可逐页对比");
    expect(markup).toContain("恢复此版本内容");
  });

  it("says so when the selected version already matches the current copy", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "同名标题";
    captureContentVersion(document);

    const markup = renderToStaticMarkup(
      <ContentHistory
        document={document}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );

    expect(markup).toContain("没有差异");
    expect(markup).toContain("当前内容与这个版本一致");
    expect(markup).not.toContain("恢复此版本内容");
  });

  it("numbers a changed page by its position in the current deck", () => {
    const document = createDocument();
    document.slides.push(createSlide(2), createSlide(3));
    document.slides[2]!.content.title = "第三页旧标题";
    captureContentVersion(document);
    document.slides[2]!.content.title = "第三页新标题";

    const markup = renderToStaticMarkup(
      <ContentHistory
        document={document}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );

    expect(markup).toContain("第 3 页");
    expect(markup).toContain("第三页新标题");
  });

  it("lists persisted visual review traces after reopening", () => {
    const document = createDocument();
    document.reviewTraces = [
      {
        id: crypto.randomUUID(),
        createdAt: "2026-10-23T10:00:00.000Z",
        overallScore: 86,
        templateFitScore: 92,
        issueCount: 3,
        slides: [{ slideIndex: 0, overallScore: 90 }],
      },
    ];
    const markup = renderToStaticMarkup(
      <ContentHistory
        document={document}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );
    expect(markup).toContain("AI 视觉评审记录");
    expect(markup).toContain("86 分");
    expect(markup).toContain("模板符合度 92");
  });

  it("offers a design restore when the layout changed after the version", () => {
    const document = createDocument();
    captureContentVersion(document);
    const frame = document.slides[0]!.elements[0]!.frame;
    frame.x = (frame.x + 1000) as never;

    const markup = renderToStaticMarkup(
      <ContentHistory
        document={document}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );
    expect(markup).toContain("同时恢复版式");
  });

  it("only offers content restore when the page set still matches", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "第一页";
    captureContentVersion(document);
    const added = createDocument().slides[0]!;
    document.slides.push(added);
    document.slides[1]!.content.title = "后来新增的页";

    const markup = renderToStaticMarkup(
      <ContentHistory
        document={document}
        onClose={() => undefined}
        onRestore={() => undefined}
        onRestoreDesign={() => undefined}
      />,
    );

    expect(markup).toContain("新增页");
    expect(markup).toContain("恢复此版本内容");
    expect(markup).toContain("disabled");
    expect(markup).toContain("此版本与当前页面集合不同");
  });
});
