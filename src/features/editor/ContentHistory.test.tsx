import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument } from "../../core/document-model";
import { captureContentVersion } from "../../core/document-model/content-version";
import { ContentHistory } from "./ContentHistory";

describe("content history", () => {
  it("explains how the first version is created when there is no history", () => {
    const markup = renderToStaticMarkup(
      <ContentHistory document={createDocument()} onClose={() => undefined} />,
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

    const markup = renderToStaticMarkup(<ContentHistory document={document} onClose={() => undefined} />);

    expect(markup).toContain("内容 r1");
    expect(markup).toContain("文档 r1");
    expect(markup).toContain("最新");
    expect(markup).toContain("1 页有变化");
    expect(markup).toContain("有修改");
    expect(markup).toContain("旧标题");
    expect(markup).toContain("新标题");
    expect(markup).toContain("标题");
    expect(markup).toContain("只用于对比当前文稿");
  });

  it("says so when the selected version already matches the current copy", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "同名标题";
    captureContentVersion(document);

    const markup = renderToStaticMarkup(<ContentHistory document={document} onClose={() => undefined} />);

    expect(markup).toContain("没有差异");
    expect(markup).toContain("当前内容与这个版本一致");
  });
});
