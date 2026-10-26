import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
});
