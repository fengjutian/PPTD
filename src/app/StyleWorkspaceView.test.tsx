import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StyleWorkspaceView } from "./StyleWorkspaceView";

describe("StyleWorkspaceView", () => {
  it("renders eight selectable style profiles and distinguishes style from theme", () => {
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

    expect((markup.match(/class="style-card(?: active)?"/g) ?? []).length).toBe(8);
    expect(markup).toContain("商务专业");
    expect(markup).toContain("风格决定整册构图、信息密度和图片语言");
    expect(markup).toContain('aria-pressed="true"');
  });
});
