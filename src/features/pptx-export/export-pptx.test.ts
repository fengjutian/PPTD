import { describe, expect, it } from "vitest";
import { applyCommand } from "../../core/commands";
import { createDocument } from "../../core/document-model";
import { buildPptx } from "./export-pptx";

describe("PPTX export", () => {
  it("creates a ZIP-backed presentation and reports native objects", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-shape", slideId: document.slides[0]!.id, shape: "rectangle" });
    const result = await buildPptx(document);
    expect(String.fromCharCode(...result.bytes.slice(0, 2))).toBe("PK");
    expect(result.report).toEqual({ slideCount: 1, nativeObjectCount: 2, warnings: [] });
  });

  it("exports embedded images as native picture objects", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-image", slideId: document.slides[0]!.id, dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png", altText: "sample" });
    const result = await buildPptx(document);
    expect(String.fromCharCode(...result.bytes.slice(0, 2))).toBe("PK");
    expect(result.report.nativeObjectCount).toBe(2);
  });
});
