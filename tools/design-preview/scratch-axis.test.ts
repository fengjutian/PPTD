import { describe, it } from "vitest";
import { buildDesignPreviewDocument } from "./fixture";
import type { TextElement } from "../../src/core/document-model";

describe("scratch title axis", () => {
  it("prints the title axis per page", () => {
    for (const conceptPresetId of ["editorial", "documentary", "paper", "instrument"] as const) {
      const document = buildDesignPreviewDocument({ conceptPresetId });
      const rows = document.slides.map((slide, index) => {
        const title = slide.elements.find(
          (element): element is TextElement => element.type === "text" && element.contentRef === "title",
        );
        if (!title) return `${index + 1}:-`;
        return `${index + 1}:x=${(title.frame.x / document.pageSize.width).toFixed(4)},w=${(
          title.frame.width / document.pageSize.width
        ).toFixed(3)},${title.style.fontSizePt}pt${slide.layoutId ? ",tpl" : ""}`;
      });
      console.log(conceptPresetId, rows.join("  "));
    }
  });
});
