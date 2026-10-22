import { describe, expect, it } from "vitest";
import { buildVisualAssetPrompt, planVisualAssetLayout, resolveVisualAsset, VISUAL_ASSET_STYLE_HINT } from "./visual-asset";

describe("视觉素材意图", () => {
  it("不给没有要求配图的页面配图", () => {
    const decision = resolveVisualAsset({ layout: "title-body", itemCount: 3, hasDeterministicBlock: false, requested: false });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it("不给有结构化内容块的页面配图", () => {
    // 内容块自己就是版面：时间线、对比、流程各有一套图形。
    const decision = resolveVisualAsset({ layout: "title-body", itemCount: 3, hasDeterministicBlock: true, requested: true });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toContain("内容块");
  });

  it("不给要点过多的页面配图", () => {
    const decision = resolveVisualAsset({ layout: "title-body", itemCount: 6, hasDeterministicBlock: false, requested: true });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toContain("6");
  });

  it("给封面页配主视觉", () => {
    expect(resolveVisualAsset({ layout: "cover", itemCount: 0, hasDeterministicBlock: false, requested: true })).toMatchObject({ enabled: true, role: "hero" });
    expect(resolveVisualAsset({ layout: "section", itemCount: 0, hasDeterministicBlock: false, requested: true })).toMatchObject({ enabled: true, role: "hero" });
  });

  it("拒绝把主视觉放在内容页上", () => {
    const decision = resolveVisualAsset({ layout: "title-body", itemCount: 2, hasDeterministicBlock: false, requested: true, requestedRole: "hero" });
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toContain("封面");
  });

  it("采纳 AI 指定的内容页配图角色", () => {
    expect(resolveVisualAsset({ layout: "title-body", itemCount: 2, hasDeterministicBlock: false, requested: true, requestedRole: "band" })).toMatchObject({ enabled: true, role: "band" });
    expect(resolveVisualAsset({ layout: "title-body", itemCount: 2, hasDeterministicBlock: false, requested: true })).toMatchObject({ enabled: true, role: "side" });
  });
});

describe("配图与文字的几何", () => {
  const region = { x: 0.08, y: 0.30, width: 0.84, height: 0.55 };

  it("主视觉占右半页，文字留在左边", () => {
    const layout = planVisualAssetLayout("hero", region);
    expect(layout.image.x + layout.image.width).toBeCloseTo(region.x + region.width, 6);
    expect(layout.text.x).toBeCloseTo(region.x, 6);
    expect(layout.text.width).toBeLessThan(region.width);
    // 图和文字不重叠。
    expect(layout.text.x + layout.text.width).toBeLessThanOrEqual(layout.image.x);
  });

  it("侧栏图在右下角，文字区在左边", () => {
    const layout = planVisualAssetLayout("side", region);
    expect(layout.image.x + layout.image.width).toBeCloseTo(region.x + region.width, 6);
    expect(layout.image.y + layout.image.height).toBeCloseTo(region.y + region.height, 6);
    expect(layout.text.width).toBeLessThan(region.width);
  });

  it("通栏图压在文字上方，文字在其下方", () => {
    const layout = planVisualAssetLayout("band", region);
    expect(layout.image.y).toBeCloseTo(region.y, 6);
    expect(layout.text.y).toBeGreaterThan(layout.image.y + layout.image.height);
    expect(layout.text.width).toBeCloseTo(region.width, 6);
  });
});

describe("配图提示词", () => {
  it("把整册共用的风格前缀和这一页的画面描述合在一起", () => {
    const prompt = buildVisualAssetPrompt("一座明亮的现代化数据中心", "季度业务回顾");
    expect(prompt).toContain(VISUAL_ASSET_STYLE_HINT);
    expect(prompt).toContain("一座明亮的现代化数据中心");
  });

  it("没有画面描述时用主题兜底", () => {
    expect(buildVisualAssetPrompt(undefined, "季度业务回顾")).toContain("季度业务回顾");
  });
});
