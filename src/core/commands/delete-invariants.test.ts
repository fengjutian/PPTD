import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { createDocument, inches, type SlideElement } from "../document-model";

const lockedShape = (): SlideElement => ({
  id: crypto.randomUUID() as never,
  type: "shape",
  shape: "rectangle",
  frame: { x: inches(1), y: inches(1), width: inches(1), height: inches(1) },
  rotationMilliDegree: 0,
  locked: true,
  origin: "user",
  style: { fill: "#FFFFFF", stroke: "#000000", strokeWidthPt: 1, radiusPt: 0 },
});

describe("delete commands and content status", () => {
  it("keeps a locked object in a group delete", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const locked = lockedShape();
    slide.elements.push(locked);
    const unlockedIds = slide.elements.filter((element) => element.id !== locked.id).map((element) => element.id);

    applyCommand(document, {
      type: "delete-elements",
      slideId: slide.id,
      elementIds: [...unlockedIds, locked.id],
    });

    // 锁定是用户明确的保护意图，批量删除不能绕过它。
    expect(slide.elements.map((element) => element.id)).toEqual([locked.id]);
  });

  it("marks approved content changed when a content-bound title is deleted", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "approved";
    const title = slide.elements.find((element) => element.type === "text" && element.contentRef === "title")!;

    applyCommand(document, { type: "delete-element", slideId: slide.id, elementId: title.id });

    expect(slide.content.title).toBe("");
    expect(slide.content.status).toBe("changed");
  });

  it("marks approved content changed when a content-bound body is deleted in a group", () => {
    const document = createDocument();
    applyCommand(document, {
      type: "apply-ai-draft",
      title: "测试",
      slides: [{ title: "标题", body: "正文", speakerNotes: "" }],
    });
    const slide = document.slides[0]!;
    expect(slide.content.status).toBe("approved");
    const body = slide.elements.find((element) => element.type === "text" && element.contentRef === "body")!;

    applyCommand(document, { type: "delete-elements", slideId: slide.id, elementIds: [body.id] });

    expect(slide.content.body).toBe("");
    expect(slide.content.status).toBe("changed");
  });

  it("leaves the status alone when a decorative text is deleted", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.content.status = "approved";
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const added = slide.elements.at(-1)!;

    applyCommand(document, { type: "delete-element", slideId: slide.id, elementId: added.id });

    expect(slide.content.status).toBe("approved");
  });
});
