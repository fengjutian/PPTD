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
    expect(markup).toContain("配图与成品一致");
    expect(markup).toContain("用这个版本");
    expect(markup).toContain("返回对比");
  });

  it("can disclose that a direction preview still needs AI design", () => {
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={OPTIONS}
        option={OPTIONS[0]!}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
        loadingLabel="正在生成整册设计并渲染预览"
      />,
    );
    expect(markup).toContain("正在生成整册设计并渲染预览，共 12 页…");
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

  it("shows which template, palette and fonts the opened version used", () => {
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={OPTIONS}
        option={OPTIONS[1]!}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
      />,
    );
    expect(markup).toContain("模板「藏青」");
    expect(markup).toContain("微软雅黑标题 / 微软雅黑正文");
    expect(markup).toContain("background:#1F4E79");
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

  it("names the pages that need adjusting instead of only counting them", () => {
    // A count sends the reader hunting through the thumbnails; the pages are
    // what they need to open.
    const flagged: VariantOptionView = { ...OPTIONS[1]!, issueCount: 4, issuePages: [1, 2, 5] };
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={[flagged]}
        option={flagged}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
      />,
    );
    expect(markup).toContain("4 处排版待调整");
    expect(markup).toContain("第 2–3、6 页");
  });

  it("says nothing about a layout check it has not run", () => {
    // A design direction is rendered on demand, so there is no deck to audit
    // yet. It used to carry a hard-coded zero and announce a pass.
    const unmeasured: VariantOptionView = {
      id: "direction-0",
      presetId: "editorial",
      name: "编辑部",
      description: "冷静、克制、以文字为主。",
      reason: "题材匹配「研究报告」",
      images: [],
      pageCount: 6,
    };
    const markup = renderToStaticMarkup(
      <VariantPreviewDialog
        options={[unmeasured]}
        option={unmeasured}
        onClose={noop}
        onUse={noop}
        renderPages={renderPages}
      />,
    );
    expect(markup).not.toContain("排版检查通过");
    expect(markup).not.toContain("排版待调整");
  });
});
