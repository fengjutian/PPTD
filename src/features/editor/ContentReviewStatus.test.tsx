import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlideId } from "../../core/document-model";
import { ContentReviewStatus } from "./ContentReviewStatus";

const SLIDE_ID = "slide-1" as SlideId;

describe("content review status", () => {
  it("offers confirmation for a page whose reviewed content was edited", () => {
    const markup = renderToStaticMarkup(
      <ContentReviewStatus slideId={SLIDE_ID} status="changed" onCommand={() => undefined} />,
    );
    expect(markup).toContain("内容已变更");
    expect(markup).toContain("确认本页内容");
    // 都已经变了，不该再提供"退回审核"——那不是待确认页面需要的动作。
    expect(markup).not.toContain("退回审核");
  });

  it("offers reopening only for a confirmed page", () => {
    const markup = renderToStaticMarkup(
      <ContentReviewStatus slideId={SLIDE_ID} status="approved" onCommand={() => undefined} />,
    );
    expect(markup).toContain("内容已确认");
    expect(markup).toContain("退回审核");
    expect(markup).not.toContain("确认本页内容");
  });

  it("explains that an unconfirmed page blocks the export", () => {
    const markup = renderToStaticMarkup(
      <ContentReviewStatus slideId={SLIDE_ID} status="draft" onCommand={() => undefined} />,
    );
    expect(markup).toContain("内容草稿");
    expect(markup).toContain("导出前");
  });
});
