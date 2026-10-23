import { describe, expect, it } from "vitest";
import { BUILTIN_ICONS, iconForText, iconSvgMarkup, type BuiltinIconName } from "./icons";

const NAMES = Object.keys(BUILTIN_ICONS) as BuiltinIconName[];

describe("built-in icons", () => {
  it("defines drawable geometry for every name", () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(10);
    for (const name of NAMES) {
      const definition = BUILTIN_ICONS[name];
      expect(definition.paths.length).toBeGreaterThan(0);
      const markup = iconSvgMarkup(name, "#2F6B5F", 2);
      expect(markup.startsWith("<svg")).toBe(true);
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('stroke="#2F6B5F"');
      expect(markup).toContain("<path");
    }
  });

  it("maps explicit nouns to icons and leaves prose alone", () => {
    expect(iconForText("目标：提升覆盖率")).toBe("target");
    expect(iconForText("数据：增长 32%")).toBe("chart");
    expect(iconForText("团队：三人小组")).toBe("users");
    expect(iconForText("知人论世：生平与时代")).toBeUndefined();
    expect(iconForText("览物之情，得无异乎")).toBeUndefined();
  });
});
