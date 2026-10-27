import { describe, it } from "vitest";
import { buildDesignPreviewDocument } from "./fixture";
import type { TextElement } from "../../src/core/document-model";

describe("scratch footer axis", () => {
  it("prints the small bottom texts per page", () => {
    for (const conceptPresetId of ["editorial", "documentary", "paper", "instrument"] as const) {
      const document = buildDesignPreviewDocument({ conceptPresetId });
      const rows = document.slides.map((slide, index) => {
        const footers = slide.elements.filter(
          (element): element is TextElement =>
            element.type === "text" && element.style.fontSizePt <= 13 && element.frame.y >= document.pageSize.height * 0.85,
        );
        return `${index + 1}:${footers
          .map(
            (footer) =>
              `y=${(footer.frame.y / document.pageSize.height).toFixed(4)}/${footer.style.fontSizePt}pt/${(
                footer.text ?? ""
              ).slice(0, 6)}`,
          )
          .join("|")}`;
      });
      console.log(conceptPresetId, rows.join("  "));
    }
  });
});
