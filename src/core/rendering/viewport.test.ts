import { describe, expect, it } from "vitest";
import { FIT_MARGIN_PX, MAX_ZOOM, MIN_ZOOM, fitZoom } from "./viewport";

/**
 * 视口缩放的几何。
 *
 * "适应窗口"写错的典型表现是：页面看起来放得下，实际底部被裁掉，或者
 * 宽度算对了高度算错了。所以这两个方向都要单独验。
 */
describe("viewport zoom", () => {
  const page = { pageWidth: 12_191_695, pageHeight: 6_858_000, baseWidth: 960 };

  it("shrinks the page so it fits a small container", () => {
    const zoom = fitZoom({ ...page, availableWidth: 600, availableHeight: 400 });
    expect(zoom).toBeLessThan(1);
    // 页面在两个方向上都放得下。
    const pageWidthPx = page.baseWidth * zoom;
    const pageHeightPx = (page.pageHeight / page.pageWidth) * page.baseWidth * zoom;
    expect(pageWidthPx).toBeLessThanOrEqual(600 - FIT_MARGIN_PX * 2 + 1);
    expect(pageHeightPx).toBeLessThanOrEqual(400 - FIT_MARGIN_PX * 2 + 1);
  });

  it("is limited by the height when the container is wide and short", () => {
    const zoom = fitZoom({ ...page, availableWidth: 2000, availableHeight: 300 });
    const pageHeightPx = (page.pageHeight / page.pageWidth) * page.baseWidth * zoom;
    expect(pageHeightPx).toBeLessThanOrEqual(300 - FIT_MARGIN_PX * 2 + 1);
    // 宽度方向还有富余，所以真正的限制来自高度。
    expect(page.baseWidth * zoom).toBeLessThan(2000 - FIT_MARGIN_PX * 2);
  });

  it("is limited by the width when the container is narrow and tall", () => {
    const zoom = fitZoom({ ...page, availableWidth: 400, availableHeight: 2000 });
    expect(page.baseWidth * zoom).toBeLessThanOrEqual(400 - FIT_MARGIN_PX * 2 + 1);
  });

  it("never goes below the minimum or above the maximum zoom", () => {
    expect(fitZoom({ ...page, availableWidth: 10, availableHeight: 10 })).toBe(MIN_ZOOM);
    expect(fitZoom({ ...page, availableWidth: 100_000, availableHeight: 100_000 })).toBe(MAX_ZOOM);
  });

  it("falls back to the original zoom when the container has no size yet", () => {
    expect(fitZoom({ ...page, availableWidth: 0, availableHeight: 0 })).toBe(1);
    expect(fitZoom({ ...page, availableWidth: 800, availableHeight: 600, pageWidth: 0 })).toBe(1);
  });
});
