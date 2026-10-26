import { describe, expect, it } from "vitest";
import { createDocument } from "../document-model";
import { buildDesignAudit } from "./design-audit";

describe("design audit", () => {
  it("records component counts, versions, layout capabilities and degradations", () => {
    const document = createDocument();
    const layout = {
      id: crypto.randomUUID(),
      name: "双栏图文",
      capabilities: { hasTitle: true, hasBody: true, hasImage: true, columns: 2, free: false },
    };
    document.layouts = [layout];
    document.slides[0]!.layoutId = layout.id;
    document.slides.push(
      { ...structuredClone(document.slides[0]!), id: crypto.randomUUID() as never },
      { ...structuredClone(document.slides[0]!), id: crypto.randomUUID() as never },
    );
    const report = buildDesignAudit(document, { nativeAnimationSkipped: 2, nativeGroupSkipped: 1 });
    expect(report.components.text).toBeGreaterThan(0);
    expect(report.layouts[0]).toMatchObject({ name: "双栏图文", usedBySlides: 3, capabilities: { columns: 2 } });
    expect(report.degradations.map((item) => item.code)).toEqual(["ANIMATION_NATIVE_SKIPPED", "GROUP_NATIVE_SKIPPED"]);
    expect(report.recipes.coverage).toBe(0);
    expect(report.rhythm).toEqual({ uniqueLayouts: 1, longestRepeat: 3, repeatedRuns: 1 });
  });
});
