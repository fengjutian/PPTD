import { describe, expect, it } from "vitest";
import { darkPageTone } from "./image-tone";
import { colorLuminance } from "../rendering/contrast";

const brand = { accent: "#F2F6FA", accentStrong: "#0F7869" };

describe("picture tone", () => {
  it("tones a picture on a dark page with the brand colour", () => {
    const tone = darkPageTone({ ...brand, background: "#12233D" });
    expect(tone).toBeDefined();
    // The dark end is the brand, not the near-white ink the accent carries on a
    // dark page; using the ink would wash the picture out to grey.
    expect(tone!.dark).toBe("#0F7869");
    expect(tone!.light).not.toBe("#F2F6FA");
    expect((colorLuminance(tone!.light) ?? 0) > (colorLuminance(tone!.dark) ?? 1)).toBe(true);
  });

  it("leaves a picture alone on a light page", () => {
    // On white the picture already belongs; a duotone there is decoration.
    expect(darkPageTone({ ...brand, background: "#FFFFFF" })).toBeUndefined();
    expect(darkPageTone({ ...brand, background: "#F7F5F0" })).toBeUndefined();
  });

  it("still tones near the boundary, where a page stops reading as dark", () => {
    // 0.45 luminance is the same threshold the colour roles use for appearance.
    expect(darkPageTone({ ...brand, background: "#6E6E6E" })).toBeDefined();
    expect(darkPageTone({ ...brand, background: "#B4B4B4" })).toBeUndefined();
  });
});
