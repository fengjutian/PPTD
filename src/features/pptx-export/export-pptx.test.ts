import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { applyCommand } from "../../core/commands";
import { createDocument, inches } from "../../core/document-model";
import { buildPptx } from "./export-pptx";
import { validatePptxPackage } from "./pptx-package";

describe("PPTX export", () => {
  it("creates a structurally valid ZIP-backed presentation and reports native objects", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-shape", slideId: document.slides[0]!.id, shape: "rectangle" });
    const result = await buildPptx(document);
    expect(String.fromCharCode(...result.bytes.slice(0, 2))).toBe("PK");
    expect(result.report.slideCount).toBe(1);
    expect(result.report.nativeObjectCount).toBe(2);
    expect(result.report.package.valid).toBe(true);
    expect(result.report.package.slideCount).toBe(1);
    expect(result.report.warnings.some((warning) => warning.includes("尚未完成审核"))).toBe(true);
  });

  it("exports embedded images as native picture objects", async () => {
    const document = createDocument();
    applyCommand(document, { type: "add-image", slideId: document.slides[0]!.id, dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png", altText: "sample" });
    const result = await buildPptx(document);
    expect(String.fromCharCode(...result.bytes.slice(0, 2))).toBe("PK");
    expect(result.report.nativeObjectCount).toBe(2);
    expect(result.report.package.valid).toBe(true);
  });

  it("preserves document z-order in the slide XML", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    applyCommand(document, { type: "add-shape", slideId, shape: "rectangle" });
    const shape = document.slides[0]!.elements[1]!;
    applyCommand(document, { type: "move-element", slideId, elementId: shape.id, x: shape.frame.x, y: (0.1 * 914_400) as typeof shape.frame.y });
    const result = await buildPptx(document);
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    const titleIndex = slideXml.indexOf("开始创造你的演示文稿");
    const shapeIndex = slideXml.indexOf("D35230");
    expect(titleIndex).toBeGreaterThan(-1);
    expect(shapeIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeLessThan(shapeIndex);
    expect((slideXml.match(/<p:sp>/g) ?? []).length).toBe(2);
  });

  it("warns about objects outside the page without changing the document", async () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const elementId = document.slides[0]!.elements[0]!.id;
    applyCommand(document, {
      type: "transform-element",
      slideId,
      elementId,
      frame: { x: inches(13), y: inches(1), width: inches(2), height: inches(1) },
      rotationMilliDegree: 0,
    });
    const before = JSON.stringify(document);
    const result = await buildPptx(document);
    expect(result.report.issues.some((issue) => issue.code === "out-of-bounds")).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects a package whose central directory is corrupted", () => {
    const bytes = new Uint8Array(64);
    expect(validatePptxPackage(bytes).valid).toBe(false);
  });
});
