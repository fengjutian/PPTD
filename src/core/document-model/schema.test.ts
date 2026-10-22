import { describe, expect, it } from "vitest";
import versionOneFixture from "./__fixtures__/v1-document.json";
import versionTwoFixture from "./__fixtures__/v2-document.json";
import versionThreeFixture from "./__fixtures__/v3-document.json";
import versionFourFixture from "./__fixtures__/v4-document.json";
import versionFiveFixture from "./__fixtures__/v5-document.json";
import versionSixFixture from "./__fixtures__/v6-document.json";
import versionSevenFixture from "./__fixtures__/v7-document.json";
import { createDocument } from "./factory";
import { parsePresentationDocument, presentationDocumentSchema, CURRENT_SCHEMA_VERSION } from "./schema";

describe("presentation document schema", () => {
  it("migrates the fixed version 1 fixture to the current version", () => {
    const migrated = parsePresentationDocument(versionOneFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides[0]!.content.title).toBe("Fixture");
    expect(versionOneFixture.schemaVersion).toBe(1);
  });

  it("migrates the fixed version 2 fixture without losing pages or objects", () => {
    const migrated = parsePresentationDocument(versionTwoFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides).toHaveLength(1);
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    expect(migrated.slides[0]!.content.title).toBe("Fixture");
    // A version 2 document has no template binding, so it exports without a
    // master instead of inheriting one it never declared.
    expect(migrated.layouts).toBeUndefined();
    expect(migrated.slides[0]!.layoutId).toBeUndefined();
    expect(versionTwoFixture.schemaVersion).toBe(2);
  });

  it("migrates the fixed version 3 fixture and keeps its template theme", () => {
    const migrated = parsePresentationDocument(versionThreeFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.theme?.majorFont).toBe("思源黑体");
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    expect(versionThreeFixture.schemaVersion).toBe(3);
  });

  it("migrates the fixed version 4 fixture and keeps its layout binding", () => {
    const migrated = parsePresentationDocument(versionFourFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.layouts).toHaveLength(1);
    expect(migrated.slides[0]!.layoutId).toBe(migrated.layouts![0]!.id);
    // A version 4 document has no chart, so it simply has nothing to chart.
    expect(migrated.slides[0]!.elements.some((element) => element.type === "chart")).toBe(false);
    expect(versionFourFixture.schemaVersion).toBe(4);
  });

  it("migrates the fixed version 5 fixture without inventing provenance", () => {
    const migrated = parsePresentationDocument(versionFiveFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    expect(migrated.slides[0]!.elements[0]!.origin).toBeUndefined();
    expect(versionFiveFixture.schemaVersion).toBe(5);
  });

  it("migrates the fixed version 6 fixture and invents no table", () => {
    const migrated = parsePresentationDocument(versionSixFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    // A version 6 document predates the native table, so the migration keeps
    // every page and never turns a page into a table.
    expect(migrated.slides[0]!.elements.some((element) => element.type === "table")).toBe(false);
    expect(migrated.slides[0]!.elements[0]!.origin).toBe("generated");
    expect(versionSixFixture.schemaVersion).toBe(6);
  });

  it("migrates the fixed version 7 fixture and invents no emphasis", () => {
    const migrated = parsePresentationDocument(versionSevenFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    // A version 7 document predates the styled fragments, so the migration keeps
    // every page and renders one uniform style per text box.
    const element = migrated.slides[0]!.elements[0]!;
    expect(element.type === "text" && element.runs).toBeUndefined();
    expect(versionSevenFixture.schemaVersion).toBe(7);
  });

  it("accepts a native table that points at a reviewed table block", () => {
    const document = createDocument();
    const block = { id: crypto.randomUUID(), type: "table-data" as const, header: ["项目", "数值"], rows: [["样本量", "38万"]] };
    document.slides[0]!.content.blocks = [block];
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "table",
      contentBlockId: block.id,
      frame: document.slides[0]!.elements[0]!.frame,
      rotationMilliDegree: 0,
      locked: false,
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 14, headerFill: "#3366CC", headerTextColor: "#FFFFFF", bodyTextColor: "#17181c", borderColor: "#E2E7EC", firstColumnBold: true },
    });
    expect(presentationDocumentSchema.parse(document).slides[0]!.elements[1]!.type).toBe("table");
  });

  it("accepts styled fragments of a text and refuses a fragment outside the text", () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected a text element");
    element.runs = [{ start: 0, end: 2, bold: true }];
    expect(presentationDocumentSchema.parse(document).slides[0]!.elements[0]!.type === "text"
      ? presentationDocumentSchema.parse(document).slides[0]!.elements[0]!.runs
      : undefined).toEqual([{ start: 0, end: 2, bold: true }]);

    const invalid = createDocument();
    const broken = invalid.slides[0]!.elements[0]!;
    if (broken.type !== "text") throw new Error("expected a text element");
    broken.runs = [{ start: 0, end: -1 }];
    expect(() => presentationDocumentSchema.parse(invalid)).toThrow();
  });

  it("accepts explicit element provenance and rejects an unknown origin", () => {    const document = createDocument();
    document.slides[0]!.elements[0]!.origin = "user";
    const parsed = presentationDocumentSchema.parse(document);
    expect(parsed.slides[0]!.elements[0]!.origin).toBe("user");

    const invalid = createDocument() as unknown as { slides: Array<{ elements: Array<Record<string, unknown>> }> };
    invalid.slides[0]!.elements[0]!.origin = "ai";
    expect(() => presentationDocumentSchema.parse(invalid)).toThrow();
  });

  it("keeps the template theme and layout binding of a version 3 document", () => {
    const document = createDocument();
    document.theme = { name: "昆佰泰", majorFont: "思源黑体", minorFont: "思源黑体", colors: [{ name: "accent1", value: "#c0504d" }] };
    document.layouts = [{ id: crypto.randomUUID(), name: "内页（浅色）1", backgroundColor: "#ffffff" }];
    document.slides[0]!.layoutId = document.layouts[0]!.id;
    const parsed = presentationDocumentSchema.parse(document);
    expect(parsed.theme?.majorFont).toBe("思源黑体");
    expect(parsed.slides[0]!.layoutId).toBe(document.layouts[0]!.id);
  });

  it("rejects a slide that points at an unknown layout", () => {
    const document = createDocument();
    document.slides[0]!.layoutId = crypto.randomUUID();
    expect(() => presentationDocumentSchema.parse(document)).toThrow();
  });

  it("rejects unknown future schema versions with a stable error", () => {
    expect(() => parsePresentationDocument({ ...versionOneFixture, schemaVersion: 99 })).toThrow("UNSUPPORTED_SCHEMA_VERSION: 99");
  });

  it("rejects duplicate slide and element IDs", () => {
    const document = createDocument();
    document.slides.push(structuredClone(document.slides[0]!));
    expect(() => presentationDocumentSchema.parse(document)).toThrow();
  });

  it("validates structured content blocks", () => {
    const document = createDocument();
    document.slides[0]!.content.blocks = [{ id: crypto.randomUUID(), type: "bullet-list", items: ["甲", "乙"] }];
    expect(presentationDocumentSchema.parse(document).slides[0]!.content.blocks?.[0]?.type).toBe("bullet-list");
    document.slides[0]!.content.blocks = [{ id: "not-a-uuid", type: "paragraph", text: "x" }];
    expect(() => presentationDocumentSchema.parse(document)).toThrow();
  });

  it("accepts embedded images from supported MIME types", () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "image",
      frame: document.slides[0]!.elements[0]!.frame,
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
      altText: "sample",
    });
    expect(presentationDocumentSchema.parse(document).slides[0]!.elements[1]!.type).toBe("image");
  });

  it("accepts a cropped picture and refuses a crop that hides the whole image", () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "image",
      frame: document.slides[0]!.elements[0]!.frame,
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
      altText: "sample",
      crop: { top: 0.1, bottom: 0.2, left: 0, right: 0.3 },
    });
    const parsed = presentationDocumentSchema.parse(document);
    expect(parsed.slides[0]!.elements[1]!.type === "image" ? parsed.slides[0]!.elements[1]!.crop : undefined)
      .toEqual({ top: 0.1, bottom: 0.2, left: 0, right: 0.3 });

    const empty = createDocument();
    empty.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "image",
      frame: empty.slides[0]!.elements[0]!.frame,
      rotationMilliDegree: 0,
      locked: false,
      source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
      altText: "sample",
      crop: { top: 0.6, bottom: 0.6, left: 0, right: 0 },
    });
    expect(() => presentationDocumentSchema.parse(empty)).toThrow();
  });
});
