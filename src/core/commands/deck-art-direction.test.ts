import { describe, expect, it } from "vitest";
import type { AiSlideDesign } from "./template-layouts";
import { applyDeckArtDirection } from "./deck-art-direction";

const slide = (layout: AiSlideDesign["layout"], visualNarrative?: AiSlideDesign["visualNarrative"]): AiSlideDesign => ({
  layout,
  visualNarrative,
  background: "#FFFFFF",
  accent: "#3366CC",
  titleColor: "#111111",
  bodyColor: "#333333",
});

describe("deck art direction", () => {
  it("creates dark visual beats without allowing consecutive dark pages", () => {
    const result = applyDeckArtDirection([
      slide("cover", "statement"),
      slide("section", "statement"),
      slide("cards", "framework"),
      slide("section", "statement"),
    ]);
    expect(result.map((item) => item.palette?.background)).toEqual(["primary", "surface", "surface", "primary"]);
    expect(result[0]!.emphasis).toBe("title-dominant");
  });
});
