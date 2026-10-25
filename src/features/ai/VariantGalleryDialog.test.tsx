import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { VariantOptionView } from "../../app/app-shared";
import { VariantGalleryDialog } from "./VariantGalleryDialog";

const OPTIONS: VariantOptionView[] = [
  {
    id: "variant-0",
    presetId: "finance-gold",
    name: "金融金",
    description: "稳健、可信、精致，以克制金色传达价值与秩序。",
    reason: "题材匹配「财务与投资」；本稿有 3 个图表或表格页，正好用它推荐的证据页",
    images: ["data:image/png;base64,AA", "data:image/png;base64,BB"],
    issueCount: 0,
  },
  {
    id: "variant-1",
    presetId: "consulting-navy",
    name: "藏青",
    description: "严谨、专业、结构明确，适合结论先行与证据支撑。",
    reason: "题材匹配「经营汇报与提案」",
    images: ["data:image/png;base64,CC"],
    issueCount: 2,
  },
];

const noop = () => undefined;

describe("VariantGalleryDialog", () => {
  it("shows one card per generated version with its previews", () => {
    const markup = renderToStaticMarkup(<VariantGalleryDialog options={OPTIONS} onSelect={noop} onDiscard={noop} />);
    expect((markup.match(/class="variant-gallery-card"/g) ?? []).length).toBe(2);
    expect((markup.match(/aria-label="使用版本：/g) ?? []).length).toBe(2);
    expect(markup).toContain("AI 生成了 2 个版本");
    for (const option of OPTIONS) expect(markup).toContain(option.name);
    expect((markup.match(/第 1 页预览/g) ?? []).length).toBe(2);
  });

  it("marks only the first card as the recommendation and reports the measured issues", () => {
    const markup = renderToStaticMarkup(<VariantGalleryDialog options={OPTIONS} onSelect={noop} onDiscard={noop} />);
    expect((markup.match(/AI 推荐/g) ?? []).length).toBe(1);
    expect(markup).toContain("排版检查通过");
    expect(markup).toContain("2 处排版待调整");
    // The preview is not the final deck; the dialog has to say why.
    expect(markup).toContain("预览版不生成配图");
    expect(markup).toContain("选定后只保留这一版");
  });
});
