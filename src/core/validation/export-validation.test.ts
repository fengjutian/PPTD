import { describe, expect, it } from "vitest";
import { createDocument } from "../document-model";
import { findThemePreset, THEME_PRESETS } from "../design/theme-presets";
import { validatePresentationForExport } from "./export-validation";

describe("export semantic color role validation", () => {
  it("accepts the declared role carriers of every built-in theme", async () => {
    for (const preset of THEME_PRESETS) {
      const document = createDocument();
      document.theme = structuredClone(preset.theme);
      document.slides[0]!.background =
        document.theme.colors.find((color) => color.name === "surface")?.value ?? "#FFFFFF";

      const issues = await validatePresentationForExport(document);

      expect(
        issues.filter((issue) => issue.code === "semantic-role-contrast"),
        preset.id,
      ).toEqual([]);
    }
  });

  it("reports the carrier role, ink role and page when a theme contract fails", async () => {
    const document = createDocument();
    document.theme = structuredClone(findThemePreset("paper-ink")!.theme);
    const accent = document.theme.colors.find((color) => color.name === "accentStrong")!;
    const onAccent = document.theme.colors.find((color) => color.name === "onAccent")!;
    accent.value = "#EEEEEE";
    onAccent.value = "#FFFFFF";

    const issues = await validatePresentationForExport(document);
    const contrast = issues.find((issue) => issue.code === "semantic-role-contrast");

    expect(contrast).toMatchObject({ severity: "warning", slideIndex: 0 });
    expect(contrast?.message).toContain("accentStrong");
    expect(contrast?.message).toContain("onAccent");
  });

  it("keeps legacy template themes without semantic roles compatible", async () => {
    const document = createDocument();
    document.theme = {
      name: "legacy",
      majorFont: "Arial",
      minorFont: "Arial",
      colors: [{ name: "accent1", value: "#3366CC" }],
    };

    const issues = await validatePresentationForExport(document);

    expect(issues.some((issue) => issue.code === "semantic-role-contrast")).toBe(false);
  });
});
