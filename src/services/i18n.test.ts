import { describe, expect, it } from "vitest";
import { createTranslator, translate, UI_LANGUAGE_OPTIONS, UI_MESSAGES } from "./i18n";

describe("界面语言字典", () => {
  it("中英文使用同一组文案键，没有漏译", () => {
    const zhKeys = Object.keys(UI_MESSAGES.zh).sort();
    const enKeys = Object.keys(UI_MESSAGES.en).sort();
    expect(enKeys).toEqual(zhKeys);
    for (const key of enKeys) {
      expect(UI_MESSAGES.en[key as keyof typeof UI_MESSAGES.en].trim()).not.toBe("");
    }
  });

  it("语言卡片只提供中文和英文两种界面", () => {
    expect(UI_LANGUAGE_OPTIONS.map((option) => option.id)).toEqual(["zh", "en"]);
    for (const option of UI_LANGUAGE_OPTIONS) {
      expect(translate("zh", option.noteKey)).not.toBe("");
      expect(translate("en", option.noteKey)).not.toBe("");
    }
  });

  it("替换占位符且不改动其他文案", () => {
    const t = createTranslator("en");
    expect(t("settings.model.apiKeyPlaceholder", { provider: "MiniMax (China)" })).toBe(
      "Enter your MiniMax (China) API key",
    );
    expect(t("settings.model.apiKeyPlaceholder", { provider: "MiniMax (China)" })).not.toContain("{provider}");
    expect(translate("zh", "settings.message.saveFailed", { detail: "disk full" })).toContain("disk full");
  });
});
