import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { applyCommand } from "../../core/commands";
import { createDocument, emu, inches, type PresentationDocument } from "../../core/document-model";
import { buildPptx } from "./export-pptx";
import { validatePptxPackage } from "./pptx-package";

/**
 * A deck that was designed against a template: it carries the theme of the
 * template, one template layout and the artwork of that layout.
 */
function templateDocument(): PresentationDocument {
  const document = createDocument();
  const layoutId = crypto.randomUUID();
  document.theme = { name: "昆佰泰", majorFont: "Source Han Sans", minorFont: "Source Han Serif", colors: [{ name: "accent1", value: "#C04A32" }] };
  document.layouts = [{ id: layoutId, name: "内页（浅色）1", backgroundColor: "#ffffff" }];
  document.slides[0]!.layoutId = layoutId;
  document.slides[0]!.elements.unshift({
    id: crypto.randomUUID() as never,
    type: "image",
    placement: "layout-background",
    frame: { x: emu(0), y: emu(0), width: inches(13.333), height: inches(7.5) },
    rotationMilliDegree: 0,
    locked: true,
    source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
    altText: "模板版式背景",
  });
  return document;
}

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

  it("honors an already-aborted export signal before building the package", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildPptx(createDocument(), { signal: controller.signal })).rejects.toThrow("EXPORT_CANCELLED");
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

  it("writes the template layout as a slide master and keeps the artwork out of the page", async () => {
    const result = await buildPptx(templateDocument());
    const entries = unzipSync(result.bytes);
    const layoutEntries = Object.keys(entries).filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name));
    expect(layoutEntries.length).toBeGreaterThan(1);
    // The slide inherits the layout, it does not carry its own background.
    const slideXml = strFromU8(entries["ppt/slides/slide1.xml"]!);
    expect(slideXml).not.toContain("<p:bg>");
    const slideRels = strFromU8(entries["ppt/slides/_rels/slide1.xml.rels"]!);
    const layoutTarget = /Target="\.\.\/slideLayouts\/(slideLayout\d+\.xml)"/.exec(slideRels)?.[1];
    expect(layoutTarget).toBeDefined();
    const layoutXml = strFromU8(entries[`ppt/slideLayouts/${layoutTarget}`]!);
    expect(layoutXml).toContain('name="内页（浅色）1"');
    // The artwork of the layout is the background of the layout.
    expect(layoutXml).toContain("<a:blipFill");
    expect(slideXml).not.toContain("<p:pic>");
    expect(result.report.masters).toContain("内页（浅色）1");
  });

  it("writes the theme of the template into the theme part of the package", async () => {
    const result = await buildPptx(templateDocument());
    const themeXml = strFromU8(unzipSync(result.bytes)["ppt/theme/theme1.xml"]!);
    expect(themeXml).toContain('<a:latin typeface="Source Han Sans"/>');
    expect(themeXml).toContain('<a:latin typeface="Source Han Serif"/>');
    expect(themeXml).toContain('<a:accent1><a:srgbClr val="C04A32"/></a:accent1>');
    expect(result.report.themeFonts).toEqual({ major: "Source Han Sans", minor: "Source Han Serif" });
    expect(result.report.themeColors).toEqual(["accent1"]);
  });

  it("keeps the page background on slides that were not designed against a template", async () => {
    const result = await buildPptx(createDocument());
    const slideXml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    expect(slideXml).toContain("<p:bg>");
    expect(result.report.masters).toEqual([]);
  });
});
