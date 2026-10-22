import { describe, expect, it } from "vitest";
import { buildVisualAssetPrompt, planVisualAssetLayout, resolveVisualAsset, VISUAL_ASSET_ASPECT, VISUAL_ASSET_REQUEST_SIZE, VISUAL_ASSET_STYLE_HINT } from "./visual-asset";
import { coverCrop } from "../rendering/image-fit";

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
  const pageWidth = 12_191_695;
  const pageHeight = 6_858_000;

  it("主视觉占右半页，文字留在左边", () => {
    const layout = planVisualAssetLayout("hero", region, pageWidth, pageHeight);
    expect(layout.image.x + layout.image.width).toBeCloseTo(region.x + region.width, 6);
    expect(layout.text.x).toBeCloseTo(region.x, 6);
    expect(layout.text.width).toBeLessThan(region.width);
    // 图和文字不重叠。
    expect(layout.text.x + layout.text.width).toBeLessThanOrEqual(layout.image.x);
  });

  it("侧栏图在右下角，文字区在左边", () => {
    const layout = planVisualAssetLayout("side", region, pageWidth, pageHeight);
    expect(layout.image.x + layout.image.width).toBeCloseTo(region.x + region.width, 6);
    expect(layout.image.y + layout.image.height).toBeCloseTo(region.y + region.height, 6);
    expect(layout.text.width).toBeLessThan(region.width);
  });

  it("通栏图压在文字上方，文字在其下方", () => {
    const layout = planVisualAssetLayout("band", region, pageWidth, pageHeight);
    expect(layout.image.y).toBeCloseTo(region.y, 6);
    expect(layout.text.y).toBeGreaterThan(layout.image.y + layout.image.height);
    expect(layout.text.width).toBeCloseTo(region.width, 6);
  });

  it("图框的比例和请求图片的比例一致，填充裁剪什么都不用切", () => {
    // 请求尺寸和图框尺寸必须是同一份契约：比例不一致时，裁剪会把画面
    // 切掉一大半——实测最差的情况只剩四分之一画面。
    for (const role of ["hero", "side", "band"] as const) {
      const layout = planVisualAssetLayout(role, region, pageWidth, pageHeight);
      const requested = VISUAL_ASSET_REQUEST_SIZE[role];
      const crop = coverCrop(requested, {
        width: layout.image.width * pageWidth,
        height: layout.image.height * pageHeight,
      });
      expect(crop, `${role} 角色的图框比例应与请求比例一致`).toBeUndefined();
    }
  });

  it("请求尺寸满足厂商的边长与步进限制", () => {
    // 厂商要求边长在 [512, 2048] 之间且是 8 的倍数，超出会被参数校验拒绝。
    for (const role of ["hero", "side", "band"] as const) {
      const { width, height } = VISUAL_ASSET_REQUEST_SIZE[role];
      for (const edge of [width, height]) {
        expect(edge).toBeGreaterThanOrEqual(512);
        expect(edge).toBeLessThanOrEqual(2048);
        expect(edge % 8).toBe(0);
      }
      expect(width / height).toBeCloseTo(VISUAL_ASSET_ASPECT[role], 6);
    }
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
