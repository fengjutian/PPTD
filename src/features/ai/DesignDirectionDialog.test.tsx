import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignDirectionDialog, type DirectionOptionView } from "./DesignDirectionDialog";

const OPTIONS: DirectionOptionView[] = ["编辑式", "纪实全幅", "纸本专栏", "数据仪表"].map((presetLabel, index) => ({
  id: `direction-${index}`,
  name: `方向 ${index + 1}`,
  idea: `${presetLabel}的一句话立意。`,
  rationale: `${presetLabel}的适配理由。`,
  presetLabel,
  images: ["data:image/png;base64,AA", "data:image/png;base64,BB"],
  pageCount: 10,
}));

const noop = () => undefined;
const renderPages = async () => OPTIONS[0]!.images;

describe("DesignDirectionDialog", () => {
  it("shows all four directions at once", () => {
    const markup = renderToStaticMarkup(
      <DesignDirectionDialog
        options={OPTIONS}
        regenerations={0}
        onSelect={noop}
        onSkip={noop}
        onRetry={noop}
        renderPages={renderPages}
      />,
    );
    expect((markup.match(/class="design-direction-card"/g) ?? []).length).toBe(4);
    expect((markup.match(/aria-label="选择方向：/g) ?? []).length).toBe(4);
    expect((markup.match(/aria-label="整册预览：/g) ?? []).length).toBe(4);
    expect((markup.match(/第 1 页预览/g) ?? []).length).toBe(4);
    for (const option of OPTIONS) {
      expect(markup).toContain(`选择方向：${option.name}`);
      expect(markup).toContain(option.presetLabel);
    }
    expect(markup).toContain("四种版面骨架");
  });

  it("disables another proposal after the second regeneration", () => {
    const markup = renderToStaticMarkup(
      <DesignDirectionDialog
        options={OPTIONS}
        regenerations={2}
        onSelect={noop}
        onSkip={noop}
        onRetry={noop}
        renderPages={renderPages}
      />,
    );
    expect(markup).toContain("换一组（2/2）");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>.*?换一组/s);
  });
});
