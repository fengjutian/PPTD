import { describe, expect, it } from "vitest";
import { analyzeImageBackdrop, hasNearBlackBackdrop, NEAR_BLACK_LUMINANCE, NEAR_BLACK_SHARE } from "./image-backdrop";

type Rgb = [number, number, number];

/** A small RGBA frame with one colour everywhere. */
function frame(width: number, height: number, color: Rgb, alpha = 255): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = alpha;
  }
  return pixels;
}

/** Paints a rectangle into a frame. */
function paint(pixels: Uint8ClampedArray, width: number, x: number, y: number, w: number, h: number, color: Rgb): void {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const offset = (row * width + column) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
}

describe("配图背景测量", () => {
  it("拒绝四周接近黑色的画面", () => {
    // 实测的失败样张：深色科技渐变加霓虹光带，整张图边缘全是近黑色。
    const pixels = frame(64, 64, [6, 8, 14]);
    paint(pixels, 64, 20, 20, 24, 24, [70, 220, 255]);
    const sample = analyzeImageBackdrop(pixels, 64, 64);
    expect(sample.nearBlackShare).toBeGreaterThanOrEqual(NEAR_BLACK_SHARE);
    expect(hasNearBlackBackdrop(sample)).toBe(true);
  });

  it("接受浅色留白的画面", () => {
    const pixels = frame(64, 64, [248, 249, 252]);
    paint(pixels, 64, 20, 20, 24, 24, [37, 99, 235]);
    expect(hasNearBlackBackdrop(analyzeImageBackdrop(pixels, 64, 64))).toBe(false);
  });

  it("浅色底上有一块深色主体仍然通过", () => {
    // 规则约束的是背景，不是画面里不能有深色物体。
    const pixels = frame(64, 64, [250, 250, 250]);
    paint(pixels, 64, 8, 12, 48, 40, [12, 14, 18]);
    const sample = analyzeImageBackdrop(pixels, 64, 64);
    // 深色主体没有吃掉整个边缘带：上下两条边仍然是浅色。
    expect(hasNearBlackBackdrop(sample)).toBe(false);
  });

  it("深色只有一条边时不判成黑底", () => {
    // 例如夜空在画面上半部分、地面是亮的室外照片：仍是一张浅色底的图。
    const pixels = frame(64, 64, [232, 236, 240]);
    paint(pixels, 64, 0, 0, 64, 10, [4, 6, 10]);
    expect(hasNearBlackBackdrop(analyzeImageBackdrop(pixels, 64, 64))).toBe(false);
  });

  it("透明背景不算黑色背景", () => {
    const pixels = frame(64, 64, [8, 8, 8], 0);
    const sample = analyzeImageBackdrop(pixels, 64, 64);
    expect(sample.opaquePixels).toBe(0);
    expect(hasNearBlackBackdrop(sample)).toBe(false);
  });

  it("阈值两侧行为正确", () => {
    // 0.08 的相对亮度约等于 #505050：更深的灰算黑底，中灰已是页面能承载的背景。
    expect(NEAR_BLACK_LUMINANCE).toBeCloseTo(0.08, 5);
    expect(hasNearBlackBackdrop(analyzeImageBackdrop(frame(16, 16, [0, 0, 0]), 16, 16))).toBe(true);
    expect(hasNearBlackBackdrop(analyzeImageBackdrop(frame(16, 16, [72, 72, 72]), 16, 16))).toBe(true);
    expect(hasNearBlackBackdrop(analyzeImageBackdrop(frame(16, 16, [128, 128, 128]), 16, 16))).toBe(false);
  });
});
