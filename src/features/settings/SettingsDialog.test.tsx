import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsWorkspace } from "./SettingsDialog";

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
});
