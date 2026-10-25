import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignMemoryDetails, DiagnosticsLog, SettingsWorkspace } from "./SettingsDialog";

describe("SettingsWorkspace 语言", () => {
  it("按英文界面渲染设置分类和模型表单", () => {
    const markup = renderToStaticMarkup(
      <SettingsWorkspace language="en" onLanguageChange={() => undefined} onMessage={() => undefined} />,
    );
    expect(markup).toContain("Language");
    expect(markup).toContain("Model service");
    expect(markup).toContain("AI model service");
    expect(markup).toContain("MiniMax (China)");
    expect(markup).toContain("Save settings");
  });

  it("按中文界面渲染设置分类", () => {
    const markup = renderToStaticMarkup(
      <SettingsWorkspace language="zh" onLanguageChange={() => undefined} onMessage={() => undefined} />,
    );
    expect(markup).toContain("语言");
    expect(markup).toContain("模型服务");
    expect(markup).toContain("保存设置");
  });

  it("renders what design memory stores, including fonts, palette and scope", () => {
    const markup = renderToStaticMarkup(
      <DesignMemoryDetails
        language="zh"
        looks={[
          {
            id: "look-1",
            concept: "documentary",
            pageCount: 8,
            createdAt: Date.UTC(2026, 9, 24),
            palette: ["#112233"],
            fonts: { major: "思源黑体", minor: "思源宋体" },
          },
        ]}
        preferences={[{ id: "pref-1", text: "太素了", scope: "deck", createdAt: 1 }]}
        onRemove={() => undefined}
      />,
    );
    expect(markup).toContain("最近外观");
    expect(markup).toContain("思源黑体");
    expect(markup).toContain("思源宋体");
    expect(markup).toContain("#112233");
    expect(markup).toContain("太素了");
    expect(markup).toContain("deck");
    expect(markup).toContain("删除这条记忆");
  });

  it("shows where the diagnostic log lives", () => {
    const markup = renderToStaticMarkup(
      <DiagnosticsLog language="zh" path={"C:\\Users\\demo\\AppData\\Local\\com.pptd.desktop\\logs\\app.log"} />,
    );
    expect(markup).toContain("诊断日志");
    expect(markup).toContain("app.log");
    // The help text is the user-facing promise about what the log does not contain.
    expect(markup).toContain("不含正文");
  });

  it("explains that the browser preview has no local log", () => {
    const markup = renderToStaticMarkup(<DiagnosticsLog language="en" />);
    expect(markup).toContain("Diagnostic log");
    expect(markup).toContain("no local log");
  });
});
