import { describe, expect, it } from "vitest";
import { comparePixels } from "./pixel-diff";
import type { PixelImage } from "./png";

function picture(width: number, height: number, colour: [number, number, number, number] = [255, 255, 255, 255]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = colour[0];
    data[offset + 1] = colour[1];
    data[offset + 2] = colour[2];
    data[offset + 3] = colour[3];
  }
  return { width, height, data };
}

function withPixel(image: PixelImage, x: number, y: number, colour: [number, number, number, number]): PixelImage {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = colour[0];
  image.data[offset + 1] = colour[1];
  image.data[offset + 2] = colour[2];
  image.data[offset + 3] = colour[3];
  return image;
}

describe("像素比较", () => {
  it("完全相同的两张图没有差异", () => {
    const result = comparePixels(picture(4, 4), picture(4, 4));
    expect(result.kind).toBe("identical");
    expect(result.changedPixels).toBe(0);
    expect(result.changedRatio).toBe(0);
    expect(result.bounds).toBeUndefined();
  });

  it("指出变化像素的数量与位置", () => {
    const actual = withPixel(picture(10, 10), 3, 4, [0, 0, 0, 255]);
    const result = comparePixels(picture(10, 10), actual);
    expect(result.kind).toBe("different");
    expect(result.changedPixels).toBe(1);
    expect(result.changedRatio).toBeCloseTo(0.01);
    expect(result.bounds).toEqual({ x: 3, y: 4, width: 1, height: 1 });
  });

  it("容差以内的颜色漂移不算变化", () => {
    const actual = withPixel(picture(4, 4), 0, 0, [250, 255, 255, 255]);
    const result = comparePixels(picture(4, 4), actual, { channelTolerance: 8 });
    expect(result.kind).toBe("identical");
  });

  it("超过容差的颜色漂移算变化", () => {
    const actual = withPixel(picture(4, 4), 0, 0, [200, 255, 255, 255]);
    const result = comparePixels(picture(4, 4), actual, { channelTolerance: 8 });
    expect(result.kind).toBe("different");
    expect(result.changedPixels).toBe(1);
  });

  it("尺寸不同不逐像素比较，而是报尺寸不符", () => {
    const result = comparePixels(picture(4, 4), picture(4, 5));
    expect(result.kind).toBe("dimension-mismatch");
    expect(result.changedRatio).toBe(1);
  });

  it("差异图把变化的像素标成红色", () => {
    const actual = withPixel(picture(2, 2), 1, 1, [0, 0, 0, 255]);
    const result = comparePixels(picture(2, 2), actual, { includeDiffImage: true });
    expect(result.diff).toBeDefined();
    const offset = (1 * 2 + 1) * 4;
    expect([result.diff!.data[offset], result.diff!.data[offset + 1], result.diff!.data[offset + 2]]).toEqual([220, 30, 40]);
    const other = 0;
    expect([result.diff!.data[other], result.diff!.data[other + 1], result.diff!.data[other + 2]]).not.toEqual([220, 30, 40]);
  });
});
