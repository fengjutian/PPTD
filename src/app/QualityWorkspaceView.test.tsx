import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDocument } from "../core/document-model";
import { QualityWorkspaceView } from "./QualityWorkspaceView";

describe("QualityWorkspaceView", () => {
  it("does not present an absent quality report as a pass", () => {
    const markup = renderToStaticMarkup(
      <QualityWorkspaceView
        app={
          {
            activeView: "quality",
            document: createDocument(),
            designQualityReport: undefined,
            exportReport: undefined,
          } as never
        }
      />,
    );

    expect(markup).toContain("尚未检查");
    expect(markup).toContain("生成或复检后统计");
    expect(markup).toContain("导出后提供实测");
    expect(markup).not.toContain("检查通过");
  });

  it("surfaces deterministic page issue counts in the overview", () => {
    const markup = renderToStaticMarkup(
      <QualityWorkspaceView
        app={
          {
            activeView: "quality",
            document: createDocument(),
            designQualityReport: {
              issues: [
                {
                  slideIndex: 0,
                  elementIds: ["element-1"],
                  issue: "text-overflow",
                  message: "正文可能溢出。",
                },
              ],
            },
            exportReport: undefined,
          } as never
        }
      />,
    );

    expect(markup).toContain("需要处理");
    expect(markup).toContain("确定性问题");
    expect(markup).toContain(">1<");
  });

  it("reports the local candidate usage without exposing deck copy", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () =>
          JSON.stringify({
            opened: 7,
            picked: 3,
            abandoned: 2,
            noContext: 1,
            edited: 0,
            noPlan: 1,
            recipes: { "editorial-index": 2, "asymmetric-split": 1 },
          }),
      },
    });

    const markup = renderToStaticMarkup(
      <QualityWorkspaceView
        app={
          {
            activeView: "quality",
            document: createDocument(),
            designQualityReport: undefined,
            exportReport: undefined,
          } as never
        }
      />,
    );

    expect(markup).toContain("换一版使用（本机）");
    expect(markup).toContain("7 次");
    expect(markup).toContain("3 次");
    expect(markup).toContain("编辑索引");
    expect(markup).toContain("2 次");
    vi.unstubAllGlobals();
  });
});
