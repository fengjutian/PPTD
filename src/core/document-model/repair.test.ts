import { describe, expect, it } from "vitest";
import { createDocument, parsePresentationDocument, repairDanglingLayoutReferences } from "./index";

describe("dangling layout references", () => {
  it("drops a page reference the document cannot resolve and keeps the page", () => {
    const document = createDocument();
    const layoutId = crypto.randomUUID();
    document.slides[0]!.layoutId = layoutId;
    document.slides[0]!.content.title = "仍然保留的标题";
    document.slides[0]!.content.body = "仍然保留的正文";

    const repair = repairDanglingLayoutReferences(document);

    expect(repair.removedLayoutReferences).toBe(1);
    const parsed = parsePresentationDocument(repair.document);
    expect(parsed.slides[0]!.layoutId).toBeUndefined();
    expect(parsed.slides[0]!.content.title).toBe("仍然保留的标题");
    expect(parsed.slides[0]!.elements).toHaveLength(document.slides[0]!.elements.length);
  });

  it("keeps a reference the document declares", () => {
    const document = createDocument();
    const layoutId = crypto.randomUUID();
    document.layouts = [{ id: layoutId, name: "内页（浅色）1" }];
    document.slides[0]!.layoutId = layoutId;

    const repair = repairDanglingLayoutReferences(document);

    expect(repair.removedLayoutReferences).toBe(0);
    expect(repair.document).toBe(document);
  });

  it("leaves a document without pages alone", () => {
    expect(repairDanglingLayoutReferences({ schemaVersion: 9 }).removedLayoutReferences).toBe(0);
    expect(repairDanglingLayoutReferences(null).removedLayoutReferences).toBe(0);
  });
});
