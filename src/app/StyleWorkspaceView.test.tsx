import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { STYLE_PROFILES } from "../core/design/style-profiles";
import { StyleDetailDrawer, StyleWorkspaceView } from "./StyleWorkspaceView";

describe("StyleWorkspaceView", () => {
  it("renders the complete selectable style catalog and distinguishes style from theme", () => {
    const markup = renderToStaticMarkup(
      <StyleWorkspaceView
        app={
          {
            activeView: "style",
            styleProfileId: "corporate",
            handleSelectStyleProfile: vi.fn(),
            changeActiveView: vi.fn(),
          } as never
        }
      />,
    );

    expect((markup.match(/class="style-card(?: active)?"/g) ?? []).length).toBe(16);
    expect(markup).toContain("商务专业");
    expect(markup).toContain("风格决定整册构图、信息密度和图片语言");
    expect((markup.match(/aria-haspopup="dialog"/g) ?? []).length).toBe(16);
    expect(markup).toContain("查看商务专业风格详情");
  });

  it("shows the complete style contract in the detail drawer", () => {
    const markup = renderToStaticMarkup(
      <StyleDetailDrawer profile={STYLE_PROFILES[2]!} selected={false} onClose={vi.fn()} onSelect={vi.fn()} />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("未来科技");
    expect(markup).toContain("页面构图");
    expect(markup).toContain("图片语言");
    expect(markup).toContain("避免使用");
    expect(markup).toContain("选择此风格");
  });
});
