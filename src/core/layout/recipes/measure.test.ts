import { describe, expect, it } from "vitest";
import { emu, inches } from "../../document-model";
import { breakIntoLines } from "../../rendering/cjk-linebreak";
import { measureTextWidthEm } from "../../rendering/text-fit";
import {
  fittedFontSize,
  fittedFontSizeInRange,
  fittedFontSizeWithoutOrphan,
  frameFromNormalized,
  rectsOverlap,
  ruleHeight,
  textFits,
  textHeightPt,
} from "./measure";

const page = { width: inches(13.333), height: inches(7.5) };

describe("recipe measurement", () => {
  it("converts a normalized frame to integer EMU", () => {
    const frame = frameFromNormalized({ x: 0.1, y: 0.2, width: 0.5, height: 0.3 }, page);
    expect(frame.x).toBe(Math.round(0.1 * page.width));
    expect(frame.y).toBe(Math.round(0.2 * page.height));
    expect(frame.width).toBe(Math.round(0.5 * page.width));
    expect(frame.height).toBe(Math.round(0.3 * page.height));
  });

  it("measures the same line breaking the renderer uses", () => {
    const width = inches(4);
    const height = inches(1);
    const frame = { x: emu(0), y: emu(0), width, height };
    const oneLine = textHeightPt("四个字", width / 12_700, 18, "Microsoft YaHei", 1.25);
    expect(oneLine).toBeGreaterThan(18);
    expect(textFits("四个字", frame, 18, "Microsoft YaHei", 1.25)).toBe(true);
  });

  it("drops to a smaller size when the text does not fit", () => {
    const frame = { x: emu(0), y: emu(0), width: inches(2), height: inches(0.5) };
    const long = "这是一段很长很长的中文文本，用来测试字号拟合不会让文字溢出框外";
    const size = fittedFontSize(long, frame, 24, 12, "Microsoft YaHei", 1.25);
    expect(size).toBeLessThan(24);
    expect(size).toBeGreaterThanOrEqual(12);
  });

  it("grows short text up to the maximum the slot allows", () => {
    const frame = { x: emu(0), y: emu(0), width: inches(8), height: inches(2) };
    const size = fittedFontSizeInRange("三个短句", frame, 18, 14, 28, "Microsoft YaHei", 1.25);
    expect(size).toBeGreaterThan(18);
    expect(size).toBeLessThanOrEqual(28);
    expect(fittedFontSize("三个短句", frame, 18, 14, "Microsoft YaHei", 1.25)).toBe(18);
  });

  it("caps the grown size even when the slot is much larger", () => {
    const frame = { x: emu(0), y: emu(0), width: inches(12), height: inches(5) };
    expect(fittedFontSizeInRange("短", frame, 18, 14, 24, "Microsoft YaHei", 1.25)).toBe(24);
  });

  it("converts a rule width into a page-relative height", () => {
    expect(ruleHeight(0.75, page.height)).toBeCloseTo(0.75 / 72 / 7.5, 6);
  });

  it("detects overlapping frames", () => {
    const a = { x: emu(0), y: emu(0), width: emu(100), height: emu(100) };
    const b = { x: emu(50), y: emu(50), width: emu(100), height: emu(100) };
    const c = { x: emu(200), y: emu(0), width: emu(100), height: emu(100) };
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(a, c)).toBe(false);
  });

  it("shrinks a headline until its last line is not a single character", () => {
    const frame = { x: emu(0), y: emu(0), width: inches(6), height: inches(1.6) };
    const headline = "广告基本盘与 AI 第二曲线同时加速";
    const plain = fittedFontSize(headline, frame, 48, 24, "Microsoft YaHei", 1.25);
    const balanced = fittedFontSizeWithoutOrphan(headline, frame, 48, 24, "Microsoft YaHei", 1.25);
    expect(balanced).toBeLessThanOrEqual(plain);
    // Whatever size it lands on, the break it produces keeps a readable tail.
    const lines = breakIntoLines(headline, {
      widthEm: frame.width / 12_700 / balanced,
      widthOf: (character) => measureTextWidthEm(character, "Microsoft YaHei"),
    });
    expect((lines[lines.length - 1] ?? "").length).toBeGreaterThanOrEqual(3);
  });
});
