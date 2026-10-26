import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SlideId } from "../../core/document-model";
import { SlideBackgroundTools } from "./SlideBackgroundTools";

const slideId = "bbbbbbbb-bbbb-9bbb-8bbb-bbbbbbbbbbbb" as SlideId;

describe("slide background tools", () => {
  it("offers a colour and a background picture", () => {
    const markup = renderToStaticMarkup(
      <SlideBackgroundTools
        slideId={slideId}
        background="#2563EB"
        hasBackgroundImage={false}
        onCommand={() => undefined}
      />,
    );
    expect(markup).toContain("页面背景色");
    expect(markup.toLowerCase()).toContain('value="#2563eb"');
    expect(markup).toContain("背景图");
    expect(markup).toContain("image/png,image/jpeg,image/webp");
    expect(markup).not.toContain("移除页面背景图片");
  });

  it("offers removal only when the page already has a background picture", () => {
    const markup = renderToStaticMarkup(
      <SlideBackgroundTools slideId={slideId} background="#FFFFFF" hasBackgroundImage onCommand={() => undefined} />,
    );
    expect(markup).toContain("换图");
    expect(markup).toContain("移除页面背景图片");
  });
});
