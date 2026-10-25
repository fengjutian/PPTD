import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { VariantOptionView } from "../../app/app-shared";
import { VariantPreviewDialog } from "./VariantPreviewDialog";

const OPTIONS: VariantOptionView[] = [
  {
    id: "variant-0",
    presetId: "finance-gold",
    name: "金融金",
    description: "稳健、可信、精致。",
    reason: "题材匹配「财务与投资」",
    images: ["data:image/png;base64,AA", "data:image/png;base64,BB"],
    pageCount: 12,
    issueCount: 0,
  },
  {
    id: "variant-1",
    presetId: "consulting-navy",
    name: "藏青",
    description: "严谨、专业、结构明确。",
    reason: "题材匹配「经营汇报与提案」",
    images: ["data:image/png;base64,CC"],
    pageCount: 8,
    issueCount: 2,
  },
];

const noop = () => undefined;
const renderPages = async () => [];

describe("VariantPreviewDialog", () => {
  it("opens on the chosen version and says how many pages it will render", () => {
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={OPTIONS}
        option={OPTIONS[1]!}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
      />,
    );
    expect(markup).toContain("藏青 · 整册预览");
    expect(markup).toContain("共 8 页");
    expect(markup).toContain("正在渲染整册，共 8 页…");
    expect(markup).toContain("配图位以占位块显示");
    expect(markup).toContain("用这个版本");
    expect(markup).toContain("返回对比");
  });

  it("lists every version so the deck can be compared without closing the preview", () => {
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={OPTIONS}
        option={OPTIONS[0]!}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
      />,
    );
    expect((markup.match(/aria-pressed="/g) ?? []).length).toBe(2);
    expect((markup.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(markup).toContain("AI 推荐");
    // The chosen version is the only selected chip.
    expect(markup.indexOf('aria-pressed="true"') < markup.indexOf("AI 推荐")).toBe(true);
  });

  it("keeps the measured issue count visible when deciding to keep a version", () => {
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={OPTIONS}
        option={OPTIONS[1]!}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
      />,
    );
    expect(markup).toContain("2 处排版待调整");
  });
});
