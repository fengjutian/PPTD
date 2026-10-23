import { describe, expect, it } from "vitest";
import { createDocument } from "./factory";
import {
  MAX_CONTENT_VERSIONS,
  captureContentVersion,
  contentSignature,
  contentVersionSlides,
} from "./content-version";
import type { ContentBlock } from "./types";

function metric(id: string, value: string): ContentBlock {
  return { id, type: "metric", label: "收入", value };
}

describe("content versions", () => {
  it("copies content fields and leaves design and review status out", () => {
    const document = createDocument();
    document.slides[0]!.content.blocks = [metric(crypto.randomUUID(), "38万")];
    document.slides[0]!.content.speakerNotes = "讲给管理层听";
    document.slides[0]!.content.status = "approved";

    expect(captureContentVersion(document)).toBe(true);

    const version = document.contentVersions![0]!;
    expect(version.documentRevision).toBe(1);
    expect(version.contentRevision).toBe(1);
    expect(version.slides[0]).toMatchObject({
      slideId: document.slides[0]!.id,
      speakerNotes: "讲给管理层听",
      blocks: [{ type: "metric", label: "收入", value: "38万" }],
    });
    expect("elements" in version.slides[0]!).toBe(false);
    expect("status" in version.slides[0]!).toBe(false);
  });

  it("does not add a version for the same copy with regenerated ids", () => {
    const document = createDocument();
    document.slides[0]!.content.blocks = [metric(crypto.randomUUID(), "38万")];
    expect(captureContentVersion(document)).toBe(true);

    // A design re-application creates fresh slide and block ids. The reviewed
    // copy is the same, so the history must not grow.
    document.slides[0]!.id = crypto.randomUUID() as never;
    document.slides[0]!.content.blocks = [metric(crypto.randomUUID(), "38万")];
    expect(captureContentVersion(document)).toBe(false);
    expect(document.contentVersions).toHaveLength(1);
  });

  it("adds a version when the reviewed copy changes", () => {
    const document = createDocument();
    document.slides[0]!.content.title = "旧标题";
    document.revisions = { document: 1, content: 1, design: 0 };
    captureContentVersion(document);

    document.slides[0]!.content.title = "新标题";
    document.revisions = { document: 2, content: 2, design: 0 };
    expect(captureContentVersion(document)).toBe(true);

    const versions = document.contentVersions!;
    expect(versions).toHaveLength(2);
    expect(versions[1]!.contentRevision).toBe(3);
    expect(versions[1]!.slides[0]!.title).toBe("新标题");
  });

  it("keeps only the newest versions", () => {
    const document = createDocument();
    for (let index = 0; index < MAX_CONTENT_VERSIONS + 5; index += 1) {
      document.slides[0]!.content.title = `标题 ${index}`;
      captureContentVersion(document, { documentRevision: index, contentRevision: index });
    }
    expect(document.contentVersions).toHaveLength(MAX_CONTENT_VERSIONS);
    expect(document.contentVersions![0]!.slides[0]!.title).toBe("标题 5");
    expect(document.contentVersions!.at(-1)!.slides[0]!.title).toBe(`标题 ${MAX_CONTENT_VERSIONS + 4}`);
  });

  it("writes a signature that ignores block ids", () => {
    const document = createDocument();
    document.slides[0]!.content.blocks = [metric("id-a", "38万")];
    const first = contentVersionSlides(document);
    document.slides[0]!.content.blocks = [metric("id-b", "38万")];
    const second = contentVersionSlides(document);
    expect(contentSignature(first)).toBe(contentSignature(second));
  });
});
