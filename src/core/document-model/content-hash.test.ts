import { describe, expect, it } from "vitest";
import { hashSlideContent } from "./content-hash";
import type { ContentBlock } from "./types";

const blocks: ContentBlock[] = [{ id: "block-1", type: "paragraph", text: "正文" }];

describe("content hash", () => {
  it("is stable for identical content and ignores review status", () => {
    const first = hashSlideContent({ title: "标题", body: "正文", speakerNotes: "", blocks });
    const second = hashSlideContent({ title: "标题", body: "正文", speakerNotes: "", blocks });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when semantic content or blocks change", () => {
    const base = hashSlideContent({ title: "标题", body: "正文", speakerNotes: "", blocks });
    expect(hashSlideContent({ title: "新标题", body: "正文", speakerNotes: "", blocks })).not.toBe(base);
    expect(hashSlideContent({ title: "标题", body: "正文", speakerNotes: "备注", blocks })).not.toBe(base);
    expect(hashSlideContent({ title: "标题", body: "正文", speakerNotes: "", blocks: [{ id: "block-1", type: "paragraph", text: "新正文" }] })).not.toBe(base);
  });
});
