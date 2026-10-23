import { describe, expect, it } from "vitest";
import { findThemePreset } from "./theme-presets";
import { themePresetAiPrompt } from "./theme-preset-guidance";

describe("themePresetAiPrompt", () => {
  it("includes visual direction, editable-output and immutable-content constraints", () => {
    const preset = findThemePreset("paper-ink")!;
    const prompt = themePresetAiPrompt(preset);
    expect(prompt).toContain("纸墨");
    expect(prompt).toContain("accent2=#B36A3C");
    expect(prompt).toContain("不要使用纯黑");
    expect(prompt).toContain("不得改写");
    expect(prompt).toContain("原生可编辑对象");
  });
});
