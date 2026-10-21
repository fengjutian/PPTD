import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, inches } from "../document-model";

describe("document commands", () => {
  it("keeps design commands out of content", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const contentBefore = JSON.stringify(slide.content);
    const result = produce(source, (draft) => applyCommand(draft, { type: "move-element", slideId: slide.id, elementId: element.id, x: inches(2), y: inches(2) }));
    expect(commandDomain({ type: "move-element", slideId: slide.id, elementId: element.id, x: inches(2), y: inches(2) })).toBe("design");
    expect(JSON.stringify(result.slides[0]!.content)).toBe(contentBefore);
  });

  it("marks approved content as changed after editing", () => {
    const source = createDocument();
    source.slides[0]!.content.status = "approved";
    const slide = source.slides[0]!;
    const element = slide.elements[0]!;
    const result = produce(source, (draft) => applyCommand(draft, { type: "edit-text", slideId: slide.id, elementId: element.id, text: "新的标题" }));
    expect(result.slides[0]!.content.status).toBe("changed");
    expect(result.slides[0]!.content.title).toBe("新的标题");
  });
});
