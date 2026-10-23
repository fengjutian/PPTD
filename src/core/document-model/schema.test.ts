import { describe, expect, it } from "vitest";
import versionOneFixture from "./__fixtures__/v1-document.json";
import versionTwoFixture from "./__fixtures__/v2-document.json";
import versionThreeFixture from "./__fixtures__/v3-document.json";
import versionFourFixture from "./__fixtures__/v4-document.json";
import versionFiveFixture from "./__fixtures__/v5-document.json";
import versionSixFixture from "./__fixtures__/v6-document.json";
import versionSevenFixture from "./__fixtures__/v7-document.json";
import versionNineFixture from "./__fixtures__/v9-document.json";
import versionTenFixture from "./__fixtures__/v10-document.json";
import versionElevenFixture from "./__fixtures__/v11-document.json";
import versionTwelveFixture from "./__fixtures__/v12-document.json";
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

  it("migrates the fixed version 9 fixture without turning a normal picture into a background", () => {
    const migrated = parsePresentationDocument(versionNineFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const picture = migrated.slides[0]!.elements[0]!;
    expect(picture.type === "image" ? picture.placement : undefined).toBeUndefined();
    expect(versionNineFixture.schemaVersion).toBe(9);
  });

  it("migrates the fixed version 10 fixture and invents no line", () => {
    const migrated = parsePresentationDocument(versionTenFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    // A version 10 document predates the line, so the migration keeps every
    // page and every object and simply draws nothing extra.
    expect(migrated.slides[0]!.elements.some((element) => element.type === "line")).toBe(false);
    expect(versionTenFixture.schemaVersion).toBe(10);
  });

  it("migrates the fixed version 11 fixture and invents no animation", () => {
    const migrated = parsePresentationDocument(versionElevenFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.slides[0]!.animations).toBeUndefined();
    expect(versionElevenFixture.schemaVersion).toBe(11);
  });

  it("migrates the fixed version 12 fixture and invents no content binding", () => {
    const migrated = parsePresentationDocument(versionTwelveFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const element = migrated.slides[0]!.elements[0]!;
    // A card written before the binding existed stays a plain text element; it
    // is not retroactively pointed at a block it never declared.
    expect(element.type === "text" ? element.contentBlockRef : undefined).toBeUndefined();
    expect(versionTwelveFixture.schemaVersion).toBe(12);
  });

  it("accepts a native line with arrow heads and a dash pattern", () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "line",
      direction: "diagonal",
      frame: { x: 0 as never, y: 0 as never, width: 1_000_000 as never, height: 500_000 as never },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: { stroke: "#7f2f1d", strokeWidthPt: 2, startArrow: "none", endArrow: "arrow", dashed: true },
    });
    expect(() => presentationDocumentSchema.parse(document)).not.toThrow();
  });

  it("rejects a line whose style does not round-trip", () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "line",
      direction: "horizontal",
      frame: { x: 0 as never, y: 0 as never, width: 1_000_000 as never, height: 1_000 as never },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: { stroke: "#7f2f1d", strokeWidthPt: 2, startArrow: "triangle" as never, endArrow: "arrow", dashed: false },
    });
    expect(() => presentationDocumentSchema.parse(document)).toThrow();
  });

  it("accepts a native table that points at a reviewed table block", () => {
    const document = createDocument();
    const block = {
      id: crypto.randomUUID(),
      type: "table-data" as const,
      header: ["项目", "数值"],
      rows: [["样本量", "38万"]],
    };
    document.slides[0]!.content.blocks = [block];
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "table",
      contentBlockId: block.id,
      frame: document.slides[0]!.elements[0]!.frame,
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSizePt: 14,
        headerFill: "#3366CC",
        headerTextColor: "#FFFFFF",
        bodyTextColor: "#17181c",
        borderColor: "#E2E7EC",
        firstColumnBold: true,
      },
    });
    expect(presentationDocumentSchema.parse(document).slides[0]!.elements[1]!.type).toBe("table");
  });

  it("accepts styled fragments of a text and refuses a fragment outside the text", () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected a text element");
    element.runs = [{ start: 0, end: 2, bold: true }];
    const parsed = presentationDocumentSchema.parse(document);
    const parsedElement = parsed.slides[0]!.elements[0]!;
    expect(parsedElement.type === "text" ? parsedElement.runs : undefined).toEqual([{ start: 0, end: 2, bold: true }]);

    const invalid = createDocument();
    const broken = invalid.slides[0]!.elements[0]!;
    if (broken.type !== "text") throw new Error("expected a text element");
    broken.runs = [{ start: 0, end: -1 }];
    expect(() => presentationDocumentSchema.parse(invalid)).toThrow();
  });

  it("accepts a card text linked to a review block and rejects an unknown field", () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected a text element");
    element.contentBlockRef = { blockId: crypto.randomUUID(), field: "value" };
    const parsed = presentationDocumentSchema.parse(document);
    const parsedElement = parsed.slides[0]!.elements[0]!;
    expect(parsedElement.type === "text" ? parsedElement.contentBlockRef : undefined).toEqual(element.contentBlockRef);

    const broken = structuredClone(document);
    const brokenElement = broken.slides[0]!.elements[0]!;
    if (brokenElement.type === "text") {
      brokenElement.contentBlockRef = { blockId: crypto.randomUUID(), field: "unit" as never };
    }
    expect(() => presentationDocumentSchema.parse(broken)).toThrow();
  });

  it("accepts explicit element provenance and rejects an unknown origin", () => {
    const document = createDocument();
    document.slides[0]!.elements[0]!.origin = "user";
    const parsed = presentationDocumentSchema.parse(document);
    expect(parsed.slides[0]!.elements[0]!.origin).toBe("user");

    const invalid = createDocument() as unknown as { slides: Array<{ elements: Array<Record<string, unknown>> }> };
    invalid.slides[0]!.elements[0]!.origin = "ai";
    expect(() => presentationDocumentSchema.parse(invalid)).toThrow();
  });

  it("keeps the template theme and layout binding of a version 3 document", () => {
    const document = createDocument();
    document.theme = {
      name: "昆佰泰",
      majorFont: "思源黑体",
      minorFont: "思源黑体",
      colors: [{ name: "accent1", value: "#c0504d" }],
    };
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
    expect(() => parsePresentationDocument({ ...versionOneFixture, schemaVersion: 99 })).toThrow(
      "UNSUPPORTED_SCHEMA_VERSION: 99",
    );
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

  it("accepts an explicit slide background picture placement", () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "image",
      placement: "slide-background",
      frame: { x: 0 as never, y: 0 as never, width: document.pageSize.width, height: document.pageSize.height },
      rotationMilliDegree: 0,
      locked: true,
      source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
      altText: "页面背景图",
    });
    expect(presentationDocumentSchema.parse(document).slides[0]!.elements.at(-1)).toMatchObject({
      placement: "slide-background",
    });
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
    expect(parsed.slides[0]!.elements[1]!.type === "image" ? parsed.slides[0]!.elements[1]!.crop : undefined).toEqual({
      top: 0.1,
      bottom: 0.2,
      left: 0,
      right: 0.3,
    });

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

  it("accepts a theme that names its type scale and rejects an impossible size", () => {
    const document = createDocument();
    document.theme = {
      name: "纸墨",
      majorFont: "华文中宋",
      minorFont: "微软雅黑",
      colors: [{ name: "accent", value: "#2F6B5F" }],
      textStyles: { title: { fontSizePt: 28, bold: true }, body: { fontSizePt: 16, lineHeight: 1.5 } },
    };
    const parsed = parsePresentationDocument(document);
    expect(parsed.theme?.textStyles?.title?.fontSizePt).toBe(28);
    expect(parsed.theme?.textStyles?.body?.lineHeight).toBe(1.5);

    const broken = structuredClone(document);
    broken.theme!.textStyles!.title!.fontSizePt = 0;
    expect(() => presentationDocumentSchema.parse(broken)).toThrow();
  });

  it("accepts tracking and leading on a text style and rejects an impossible range", () => {
    const document = createDocument();
    const element = document.slides[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected a text element");
    element.style = { ...element.style, letterSpacingPt: 0.8, lineHeight: 1.3 };
    const parsed = parsePresentationDocument(document);
    const parsedElement = parsed.slides[0]!.elements[0]!;
    expect(parsedElement.type === "text" ? parsedElement.style.letterSpacingPt : undefined).toBe(0.8);
    expect(parsedElement.type === "text" ? parsedElement.style.lineHeight : undefined).toBe(1.3);

    const broken = structuredClone(document);
    if (broken.slides[0]!.elements[0]!.type === "text") broken.slides[0]!.elements[0]!.style.letterSpacingPt = 40;
    expect(() => presentationDocumentSchema.parse(broken)).toThrow();
  });

  it("accepts a built-in icon and rejects a name outside the set", () => {
    const document = createDocument();
    document.slides[0]!.elements.push({
      id: crypto.randomUUID() as never,
      type: "icon",
      name: "target",
      frame: document.slides[0]!.elements[0]!.frame,
      rotationMilliDegree: 0,
      locked: false,
      style: { color: "#2F6B5F" },
    });
    expect(() => presentationDocumentSchema.parse(document)).not.toThrow();

    const broken = structuredClone(document);
    (broken.slides[0]!.elements[1] as { name: string }).name = "skull";
    expect(() => presentationDocumentSchema.parse(broken)).toThrow();
  });
});
