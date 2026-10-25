import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeSpecimenDialog } from "./ThemeSpecimenDialog";

describe("ThemeSpecimenDialog", () => {
  it("opens on the requested preset in a loading state", () => {
    const markup = renderToStaticMarkup(
      <ThemeSpecimenDialog presetId="blue-white-porcelain" onClose={() => undefined} />,
    );
    expect(markup).toContain("主题样张");
    expect(markup).toContain("青花瓷韵");
    expect(markup).toContain("正在渲染 8 页样张");
  });

  it("can sit above the theme drawer", () => {
    const markup = renderToStaticMarkup(
      <ThemeSpecimenDialog presetId="paper-ink" aboveDrawer onClose={() => undefined} />,
    );
    expect(markup).toContain("theme-specimen-backdrop");
  });
});
