import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document-model";
import { readStoredDocument } from "./project-files";

describe("stored documents", () => {
  it("reads a document whose page references resolve", () => {
    const document = createDocument();
    const layoutId = crypto.randomUUID();
    document.layouts = [{ id: layoutId, name: "内页（浅色）1" }];
    document.slides[0]!.layoutId = layoutId;

    const stored = readStoredDocument(document);

    expect(stored.removedLayoutReferences).toBe(0);
    expect(stored.document.slides[0]!.layoutId).toBe(layoutId);
  });

  it("keeps the pages of a document whose layout references dangle", () => {
    const document = createDocument();
    document.slides[0]!.layoutId = crypto.randomUUID();
    document.slides[0]!.content.title = "仍然保留的标题";

    const stored = readStoredDocument(document);

    expect(stored.removedLayoutReferences).toBe(1);
    expect(stored.document.slides[0]!.content.title).toBe("仍然保留的标题");
    expect(stored.document.slides[0]!.layoutId).toBeUndefined();
  });

  it("reports a broken document instead of returning half of it", () => {
    expect(() => readStoredDocument({ schemaVersion: 9, title: "缺少页面" })).toThrow();
  });
});
