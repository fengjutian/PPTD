import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SlideLayoutOption } from "../../core/commands";

import { SlideLayoutMenu } from "./SlideLayoutMenu";

const content = {
  layout: {
    id: "content",
    name: "内页（浅色）1",
    capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 1, free: false },
  },
  current: true,
};

const split = {
  layout: {
    id: "split",
    name: "双栏对比",
    capabilities: { hasTitle: true, hasBody: true, hasImage: false, columns: 2, free: false },
  },
  current: false,
};

describe("slide layout menu", () => {
  it("opens from a labelled button when another layout fits the page", () => {
    const markup = renderToStaticMarkup(
      <SlideLayoutMenu options={[content, split]} onApply={() => undefined} />,
    );
    expect(markup).toContain('aria-label="当前版式：内页（浅色）1；更改版式"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("does not render a command when only the current layout is usable", () => {
    const blocked: SlideLayoutOption = {
      layout: {
        id: "cover",
        name: "封面",
        capabilities: { hasTitle: true, hasBody: false, hasImage: false, columns: 1, free: true },
      },
      current: false,
      issue: "该页有正文，封面或空白版式会隐藏内容",
    };
    expect(renderToStaticMarkup(<SlideLayoutMenu options={[content, blocked]} onApply={() => undefined} />)).toBe(
      "",
    );
  });
});
