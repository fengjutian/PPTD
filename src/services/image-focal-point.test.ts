import { describe, expect, it } from "vitest";
import { saliencyFocalPoint } from "./image-focal-point";

describe("image focal point", () => {
  it("finds a high-contrast subject away from the centre", () => {
    const width = 12;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(240);
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 8; x <= 10; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 20;
        pixels[offset + 1] = 40;
        pixels[offset + 2] = 180;
        pixels[offset + 3] = 255;
      }
    }
    const focal = saliencyFocalPoint(pixels, width, height);
    expect(focal.x).toBeGreaterThan(0.62);
    expect(focal.y).toBeGreaterThan(0.3);
    expect(focal.y).toBeLessThan(0.7);
  });

  it("falls back to the centre for a flat image", () => {
    expect(saliencyFocalPoint(new Uint8ClampedArray(4 * 4 * 4).fill(128), 4, 4)).toEqual({ x: 0.5, y: 0.5 });
  });
});
