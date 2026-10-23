import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { applyCommand, commandDomain } from "./commands";
import { createDocument, type ElementId } from "../document-model";

describe("batch lock command", () => {
  it("locks every selected object as one design change", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    applyCommand(source, { type: "add-text", slideId: slide.id });
    applyCommand(source, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    const ids = slide.elements.map((element) => element.id);
    const result = produce(source, (draft) =>
      applyCommand(draft, { type: "set-elements-lock", slideId: slide.id, elementIds: ids, locked: true }),
    );
    expect(result.slides[0]!.elements.every((element) => element.locked)).toBe(true);
    expect(commandDomain({ type: "set-elements-lock", slideId: slide.id, elementIds: ids, locked: true })).toBe(
      "design",
    );

    const unlocked = produce(result, (draft) =>
      applyCommand(draft, { type: "set-elements-lock", slideId: slide.id, elementIds: ids, locked: false }),
    );
    expect(unlocked.slides[0]!.elements.some((element) => element.locked)).toBe(false);
  });

  it("refuses a batch that names no existing object", () => {
    const source = createDocument();
    const slide = source.slides[0]!;
    expect(() =>
      produce(source, (draft) =>
        applyCommand(draft, {
          type: "set-elements-lock",
          slideId: slide.id,
          elementIds: [crypto.randomUUID() as ElementId],
          locked: true,
        }),
      ),
    ).toThrow("ELEMENT_NOT_FOUND");
  });
});
