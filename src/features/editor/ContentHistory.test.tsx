import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument } from "../../core/document-model";
import { captureContentVersion } from "../../core/document-model/content-version";
import { ContentHistory } from "./ContentHistory";

describe("content history", () => {
  it("explains how the first version is created when there is no history", () => {
    const markup = renderToStaticMarkup(
      <ContentHistory document={createDocument()} onClose={() => undefined} onRestore={() => undefined} />,
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
      <ContentHistory document={document} onClose={() => undefined} onRestore={() => undefined} />,
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
      <ContentHistory document={document} onClose={() => undefined} onRestore={() => undefined} />,
    );

    expect(markup).toContain("没有差异");
    expect(markup).toContain("当前内容与这个版本一致");
    expect(markup).not.toContain("恢复此版本内容");
  });

  it("only offers content restore when the page set still matches", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "第一页";
    captureContentVersion(document);
    const added = createDocument().slides[0]!;
    document.slides.push(added);
    document.slides[1]!.content.title = "后来新增的页";

    const markup = renderToStaticMarkup(
      <ContentHistory document={document} onClose={() => undefined} onRestore={() => undefined} />,
    );

    expect(markup).toContain("新增页");
    expect(markup).toContain("恢复此版本内容");
    expect(markup).toContain("disabled");
    expect(markup).toContain("此版本与当前页面集合不同");
  });
});
