import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { THEME_PRESETS } from "../../core/design/theme-presets";
import { ThemePresetPicker } from "./ThemePresetPicker";

describe("ThemePresetPicker", () => {
  it("renders one radio card per preset", () => {
    const markup = renderToStaticMarkup(<ThemePresetPicker onChange={() => undefined} />);
    expect((markup.match(/role="radio"/g) ?? []).length).toBe(THEME_PRESETS.length);
    for (const preset of THEME_PRESETS) expect(markup).toContain(preset.name);
    expect(markup).toContain("视觉主题");
  });

  it("marks the selected preset as checked", () => {
    const markup = renderToStaticMarkup(<ThemePresetPicker value="consulting-navy" onChange={() => undefined} />);
    expect(markup.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="藏青"');
    expect(markup).toContain("border:2px solid #1F4E79");
  });
});
