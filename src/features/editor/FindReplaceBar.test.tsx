import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument } from "../../core/document-model";
import { useEditorStore } from "../../store/editor-store";
import { FindReplaceBar } from "./FindReplaceBar";

describe("find and replace bar", () => {
  beforeEach(() => {
    const document = createDocument();
    useEditorStore.setState({
      document,
      activeSlideId: document.slides[0]!.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
  });

  it("offers find, replace, case sensitivity and navigation", () => {
    const markup = renderToStaticMarkup(<FindReplaceBar onClose={() => undefined} />);
    expect(markup).toContain("查找和替换");
    expect(markup).toContain("替换为");
    expect(markup).toContain("区分大小写");
    expect(markup).toContain('aria-label="上一个匹配"');
    expect(markup).toContain('aria-label="下一个匹配"');
    expect(markup).toContain("全部替换");
  });

  it("starts with an empty result set and disabled navigation", () => {
    const markup = renderToStaticMarkup(<FindReplaceBar onClose={() => undefined} />);
    expect(markup).toContain("输入要查找的文字");
    const previous = markup.match(/<button[^>]*aria-label="上一个匹配"[^>]*>/)?.[0] ?? "";
    expect(previous).toContain("disabled");
  });
});
