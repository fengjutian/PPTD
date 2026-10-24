import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { applyCommand } from "../../core/commands";
import { createDocument } from "../../core/document-model";
import { buildSpecimenDocument } from "../../services/theme-specimen";
import { buildDesignPreviewDocument } from "../../../tools/design-preview/fixture";
import { buildPptx } from "./export-pptx";
import { replaceSlidePart, verifyExportedPptx } from "./verify-export";

describe("export read-back parity", () => {
  it("confirms a normal export against the document", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const added = slide.elements[slide.elements.length - 1]!;
    applyCommand(document, {
      type: "edit-text",
      slideId: slide.id,
      elementId: added.id,
      text: "回读校验文本",
    });

    const result = await buildPptx(document);
    expect(result.report.parity?.passed).toBe(true);
    expect(result.report.parity?.checked.slides).toBe(1);
    expect(result.report.parity?.checked.textFragments).toBeGreaterThan(0);
  });

  it("notices text that never reached the slide XML", async () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const added = slide.elements[slide.elements.length - 1]!;
    applyCommand(document, {
      type: "edit-text",
      slideId: slide.id,
      elementId: added.id,
      text: "这段文字必须出现在包里",
    });
    const result = await buildPptx(document);
    const xml = strFromU8(unzipSync(result.bytes)["ppt/slides/slide1.xml"]!);
    // Simulate a package that lost its text runs; the check must not trust the
    // exporter's intermediate plan.
    const damaged = replaceSlidePart(result.bytes, 1, xml.replace(/<a:t[^>]*>[\s\S]*?<\/a:t>/g, ""));
    const report = verifyExportedPptx(damaged, document);
    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.kind === "missing-text")).toBe(true);
  });

  it("counts native tables and charts on the specimen deck", async () => {
    const result = await buildPptx(buildSpecimenDocument());
    expect(result.report.parity?.passed).toBe(true);
    expect(result.report.parity?.checked.tables).toBe(1);
    expect(result.report.parity?.checked.charts).toBe(1);
  });

  it("notices a dropped picture", async () => {
    const document = buildDesignPreviewDocument();
    const result = await buildPptx(document);
    expect(result.report.parity?.passed).toBe(true);

    const imageSlide = document.slides.findIndex((slide) =>
      slide.elements.some((element) => element.type === "image" && element.placement === "content"),
    );
    expect(imageSlide).toBeGreaterThanOrEqual(0);
    const xml = strFromU8(unzipSync(result.bytes)[`ppt/slides/slide${imageSlide + 1}.xml`]!);
    const damaged = replaceSlidePart(result.bytes, imageSlide + 1, xml.replace(/<p:pic[\s\S]*?<\/p:pic>/g, ""));
    const report = verifyExportedPptx(damaged, document);
    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.kind === "picture-count")).toBe(true);
  });
});
