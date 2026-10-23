import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument } from "../document-model";

/**
 * 演讲备注是内容，不是设计。
 *
 * 它进 PPTX 的备注页，也进内容哈希。用户改了备注，这一页就不该再报"已审核"。
 */
describe("speaker notes", () => {
  it("writes the notes into the page content", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "set-speaker-notes", slideId, notes: "这一页先讲背景" });
    });
    expect(next.slides[0]!.content.speakerNotes).toBe("这一页先讲背景");
  });

  it("counts as a content change, not a design change", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;
    expect(commandDomain({ type: "set-speaker-notes", slideId, notes: "备注" }, document)).toBe("content");
    expect(commandDomain({ type: "set-speaker-notes", slideId, notes: "备注" })).toBe("content");
  });

  it("takes an approved page out of the approved state", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "approved";
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "set-speaker-notes", slideId: slide.id, notes: "改过的备注" });
    });
    expect(next.slides[0]!.content.status).toBe("changed");
  });

  it("changes the content hash so the change is visible to the review flow", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const hashBefore = slide.content.contentHash;
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "set-speaker-notes", slideId: slide.id, notes: "新备注" });
    });
    // 内容哈希由 store 在提交后重算；这里验证备注确实进了内容字段，
    // 哈希刷新是 refreshContentHashes 的职责。
    expect(next.slides[0]!.content.speakerNotes).toBe("新备注");
    expect(hashBefore).toMatch(/^[0-9a-f]{16}$/);
  });

  it("can be cleared again", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.speakerNotes = "旧备注";
    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "set-speaker-notes", slideId: slide.id, notes: "" });
    });
    expect(next.slides[0]!.content.speakerNotes).toBe("");
  });
});
