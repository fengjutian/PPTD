import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, type SlideId } from "../document-model";

/**
 * 内容复核闭环。
 *
 * 内容被改动后页面从 approved 变成 changed，导出预检会一直报"尚未完成审核"。
 * 这里验证用户能把页面重新确认回去，而确认动作本身不改动任何一个字。
 */
describe("content approval", () => {
  it("moves an edited page back to approved", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "changed";

    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "approve-slide-content", slideId: slide.id });
    });

    expect(next.slides[0]!.content.status).toBe("approved");
  });

  it("reopens an approved page for review, not as a draft", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "approved";

    const next = produce(document, (draft) => {
      applyCommand(draft, { type: "reopen-slide-content", slideId: slide.id });
    });

    // 内容本身没有变，只是重新进入审核，所以不是 draft。
    expect(next.slides[0]!.content.status).toBe("review");
  });

  it("does not touch the reviewed copy or the composition", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "changed";
    const before = structuredClone(slide);

    applyCommand(document, { type: "approve-slide-content", slideId: slide.id });

    // 确认是复核状态，不是编辑：文字、块、备注和对象都不该动。
    expect(slide.content.title).toBe(before.content.title);
    expect(slide.content.body).toBe(before.content.body);
    expect(slide.content.blocks).toEqual(before.content.blocks);
    expect(slide.content.speakerNotes).toBe(before.content.speakerNotes);
    expect(slide.elements).toEqual(before.elements);
  });

  it("counts as a content change, not a design change", () => {
    const document = createDocument();
    const slideId = document.slides[0]!.id;

    expect(commandDomain({ type: "approve-slide-content", slideId }, document)).toBe("content");
    expect(commandDomain({ type: "reopen-slide-content", slideId }, document)).toBe("content");
    // 没有文档可查时也要能判定，命令不能因为缺少上下文被静默丢掉。
    expect(commandDomain({ type: "approve-slide-content", slideId })).toBe("content");
  });

  it("produces no transaction when the page is already in that state", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "approved";

    // null 表示 store 直接返回：状态没变，不该多出一个撤销项。
    expect(commandDomain({ type: "approve-slide-content", slideId: slide.id }, document)).toBeNull();

    slide.content.status = "review";
    expect(commandDomain({ type: "reopen-slide-content", slideId: slide.id }, document)).toBeNull();
  });

  it("rejects an unknown page instead of silently doing nothing", () => {
    const document = createDocument();
    expect(() => applyCommand(document, { type: "approve-slide-content", slideId: "missing" as SlideId })).toThrow(
      "SLIDE_NOT_FOUND",
    );
  });
});
