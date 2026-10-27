import { describe, expect, it } from "vitest";
import type { PixelImage } from "../../src/core/rendering/png";
import { createContactSheet } from "./contact-sheet";

const pixel = (red: number, green: number, blue: number): PixelImage => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([red, green, blue, 255]),
});

describe("contact sheet", () => {
  it("keeps slide order in a fixed grid with explicit gutters", () => {
    const sheet = createContactSheet([pixel(255, 0, 0), pixel(0, 255, 0), pixel(0, 0, 255)], {
      columns: 2,
      tileWidth: 2,
      tileHeight: 1,
      gap: 1,
      background: [255, 255, 255, 255],
    });

    expect({ width: sheet.width, height: sheet.height }).toEqual({ width: 7, height: 5 });
    const rgbaAt = (x: number, y: number) =>
      Array.from(sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4));
    expect(rgbaAt(1, 1)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(4, 1)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(1, 3)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(4, 3)).toEqual([255, 255, 255, 255]);
  });

  it("rejects an empty page set", () => {
    expect(() => createContactSheet([], { columns: 4, tileWidth: 400, tileHeight: 225, gap: 16 })).toThrow(
      "CONTACT_SHEET_EMPTY",
    );
  });
});
