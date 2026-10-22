import { describe, expect, it } from "vitest";
import { coverCrop, visibleSourceRect } from "./image-fit";

describe("配图填充裁剪", () => {
  it("比例相同时不裁", () => {
    expect(coverCrop({ width: 800, height: 600 }, { width: 400, height: 300 })).toBeUndefined();
  });

  it("图更宽时切掉左右", () => {
    const crop = coverCrop({ width: 1600, height: 900 }, { width: 900, height: 900 });
    expect(crop).toEqual({ top: 0, bottom: 0, left: expect.any(Number), right: expect.any(Number) });
    // 左右切掉的量相等，图才不会变形。
    expect(crop!.left).toBeCloseTo(crop!.right, 6);
    expect(crop!.left).toBeGreaterThan(0);
  });

  it("图更高时切掉上下", () => {
    const crop = coverCrop({ width: 900, height: 1600 }, { width: 900, height: 900 });
    expect(crop!.top).toBeCloseTo(crop!.bottom, 6);
    expect(crop!.top).toBeGreaterThan(0);
    expect(crop!.left).toBe(0);
  });

  it("裁剪后露出的比例就是框的比例", () => {
    const natural = { width: 1600, height: 900 };
    const target = { width: 900, height: 900 };
    const crop = coverCrop(natural, target)!;
    const visible = visibleSourceRect(natural, crop);
    const visibleAspect = (visible.width * natural.width) / (visible.height * natural.height);
    expect(visibleAspect).toBeCloseTo(target.width / target.height, 6);
  });

  it("没有裁剪时露出整张图", () => {
    const visible = visibleSourceRect({ width: 100, height: 100 }, undefined);
    expect(visible).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("尺寸非法时不给出裁剪", () => {
    expect(coverCrop({ width: 0, height: 100 }, { width: 100, height: 100 })).toBeUndefined();
  });
});
