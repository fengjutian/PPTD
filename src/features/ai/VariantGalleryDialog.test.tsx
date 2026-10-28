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
    pageCount: 12,
    issueCount: 0,
  },
  {
    id: "variant-1",
    presetId: "consulting-navy",
    name: "藏青",
    description: "严谨、专业、结构明确，适合结论先行与证据支撑。",
    reason: "题材匹配「经营汇报与提案」",
    images: ["data:image/png;base64,CC"],
    pageCount: 8,
    issueCount: 2,
  },
];

const noop = () => undefined;
const renderPages = async () => [];

describe("VariantGalleryDialog", () => {
  it("shows one card per generated version with its previews", () => {
    const markup = renderToStaticMarkup(
      <VariantGalleryDialog options={OPTIONS} onSelect={noop} onDiscard={noop} renderPages={renderPages} />,
    );
    expect((markup.match(/class="variant-gallery-card"/g) ?? []).length).toBe(2);
    expect((markup.match(/aria-label="使用版本：/g) ?? []).length).toBe(2);
    expect(markup).toContain("AI 生成了 2 个版本");
    for (const option of OPTIONS) expect(markup).toContain(option.name);
    expect((markup.match(/第 1 页预览/g) ?? []).length).toBe(2);
  });

  it("offers a full-deck preview from every card and names its page count", () => {
    const markup = renderToStaticMarkup(
      <VariantGalleryDialog options={OPTIONS} onSelect={noop} onDiscard={noop} renderPages={renderPages} />,
    );
    expect((markup.match(/aria-label="预览整册：/g) ?? []).length).toBe(2);
    expect(markup).toContain("整册预览 · 12 页");
    expect(markup).toContain("整册预览 · 8 页");
  });

  it("marks only the first card as the recommendation and reports the measured issues", () => {
    const markup = renderToStaticMarkup(
      <VariantGalleryDialog options={OPTIONS} onSelect={noop} onDiscard={noop} renderPages={renderPages} />,
    );
    expect((markup.match(/AI 推荐/g) ?? []).length).toBe(1);
    expect(markup).toContain("排版检查通过");
    expect(markup).toContain("2 处排版待调整");
    // Candidate evaluation uses its own real low-resolution artwork.
    expect(markup).toContain("真实低清配图完成审美评估");
    expect(markup).toContain("选定后只保留这一版");
  });

  it("names the template and its palette on every card", () => {
    const markup = renderToStaticMarkup(
      <VariantGalleryDialog options={OPTIONS} onSelect={noop} onDiscard={noop} renderPages={renderPages} />,
    );
    expect(markup).toContain("模板「金融金」");
    expect(markup).toContain("模板「藏青」");
    // The swatch strip is the preset's own accent, not a generic accent colour.
    expect(markup).toContain("background:#A67C2E");
    // The description and font pairing belong to the enlarged preview; a card
    // only has room for the name and the palette.
    expect(markup).not.toContain("华文中宋");
    expect(markup).not.toContain("白底、墨黑与哑金强调");
  });

  it("does not invent a template for a candidate without a built-in preset", () => {
    const direction: VariantOptionView[] = [{ ...OPTIONS[0]!, id: "direction-0", presetId: "图文报道" }];
    const markup = renderToStaticMarkup(
      <VariantGalleryDialog options={direction} onSelect={noop} onDiscard={noop} renderPages={renderPages} />,
    );
    expect(markup).not.toContain("模板「");
  });

  it("does not announce a layout check for a card that has not been laid out", () => {
    const unpublished: VariantOptionView[] = [{ ...OPTIONS[0]!, id: "direction-0", issueCount: undefined }];
    const markup = renderToStaticMarkup(
      <VariantGalleryDialog options={unpublished} onSelect={noop} onDiscard={noop} renderPages={renderPages} />,
    );
    expect(markup).not.toContain("排版检查通过");
    expect(markup).not.toContain("排版待调整");
  });
});
