import { describe, expect, it } from "vitest";
import { evaluateVisualRegression, type VisualRegressionPolicy } from "./visual-regression";
import type { PixelImage } from "./png";

function picture(
  width: number,
  height: number,
  colour: [number, number, number, number] = [255, 255, 255, 255],
): PixelImage {
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

const policy: VisualRegressionPolicy = { channelTolerance: 8, maxChangedRatio: 0.01 };

describe("视觉回归判定", () => {
  it("一致的渲染判为没有回归", () => {
    const outcome = evaluateVisualRegression(picture(20, 20), picture(20, 20), { policy });
    expect(outcome.status).toBe("match");
    expect(outcome.changedRatio).toBe(0);
    expect(outcome.message).toContain("一致");
  });

  it("少量像素在容忍度内仍然算没有回归", () => {
    const current = withPixel(picture(20, 20), 1, 1, [0, 0, 0, 255]);
    const outcome = evaluateVisualRegression(current, picture(20, 20), { policy });
    expect(outcome.status).toBe("match");
    expect(outcome.changedPixels).toBe(1);
  });

  it("超过容忍度的差异算回归，并给出变化区域", () => {
    const current = picture(20, 20);
    for (let index = 0; index < 20; index += 1) withPixel(current, index, 5, [0, 0, 0, 255]);
    const outcome = evaluateVisualRegression(current, picture(20, 20), { policy });
    expect(outcome.status).toBe("regressed");
    expect(outcome.bounds).toEqual({ x: 0, y: 5, width: 20, height: 1 });
    expect(outcome.message).toContain("超过");
  });

  it("尺寸不同一律算回归", () => {
    const outcome = evaluateVisualRegression(picture(20, 20), picture(20, 19), { policy });
    expect(outcome.status).toBe("dimension-mismatch");
    expect(outcome.message).toContain("尺寸");
  });
});
