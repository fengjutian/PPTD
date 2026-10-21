import { describe, expect, it } from "vitest";
import versionOneFixture from "./__fixtures__/v1-document.json";
import versionTwoFixture from "./__fixtures__/v2-document.json";
import { createDocument } from "./factory";
import { parsePresentationDocument, presentationDocumentSchema } from "./schema";

describe("presentation document schema", () => {
  it("migrates the fixed version 1 fixture to the current version", () => {
    const migrated = parsePresentationDocument(versionOneFixture);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.slides[0]!.content.title).toBe("Fixture");
    expect(versionOneFixture.schemaVersion).toBe(1);
  });

  it("migrates the fixed version 2 fixture without losing pages or objects", () => {
    const migrated = parsePresentationDocument(versionTwoFixture);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.slides).toHaveLength(1);
    expect(migrated.slides[0]!.elements).toHaveLength(1);
    expect(migrated.slides[0]!.content.title).toBe("Fixture");
    // A version 2 document has no template binding, so it exports without a
    // master instead of inheriting one it never declared.
    expect(migrated.layouts).toBeUndefined();
    expect(migrated.slides[0]!.layoutId).toBeUndefined();
    expect(versionTwoFixture.schemaVersion).toBe(2);
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
});
