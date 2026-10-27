import { describe, expect, it } from "vitest";
import { createDocument } from "../document-model";
import { compileLayoutFramePlan, createStarterLayoutDefinition } from "../layout/tree";
import { applyCommand, commandDomain, type DocumentCommand } from "./commands";

describe("declarative layout transaction", () => {
  it("persists the definition, binding and compiled geometry as design only", () => {
    const document = createDocument();
    const contentTitle = document.slides[0]!.content.title;
    const slide = document.slides[0]!;
    const definition = createStarterLayoutDefinition();
    const titleSlot = definition.tree.root.children[0]!;
    const binding = { definitionId: definition.id, slotBindings: { [titleSlot.id]: slide.elements[0]!.id } };
    const plan = compileLayoutFramePlan(definition, binding, slide, document.pageSize);
    const command: DocumentCommand = {
      type: "apply-layout-plan",
      expectedRevision: { ...document.revisions },
      definitions: [definition],
      slides: [{ slideId: slide.id, binding, elementFrames: plan.frames }],
    };
    expect(commandDomain(command, document)).toBe("design");
    applyCommand(document, command);
    expect(document.layoutDefinitions?.[0]?.id).toBe(definition.id);
    expect(document.slides[0]!.layoutBinding?.definitionId).toBe(definition.id);
    expect(document.slides[0]!.content.title).toBe(contentTitle);
  });

  it("rejects a stale proposal before changing the document", () => {
    const document = createDocument();
    const before = structuredClone(document);
    const definition = createStarterLayoutDefinition();
    expect(() =>
      applyCommand(document, {
        type: "apply-layout-plan",
        expectedRevision: { document: 1, content: 0, design: 0 },
        definitions: [definition],
        slides: [],
      }),
    ).toThrow("REVISION_CONFLICT");
    expect(document).toEqual(before);
  });

  it("does not overwrite geometry after a slot is detached", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const definition = createStarterLayoutDefinition();
    const slot = definition.tree.root.children[0]!;
    const binding = {
      definitionId: definition.id,
      slotBindings: { [slot.id]: slide.elements[0]!.id },
      overrides: [{ nodeId: slot.id, layoutState: "detached" as const }],
    };
    expect(compileLayoutFramePlan(definition, binding, slide, document.pageSize).frames).toHaveLength(0);
  });
});
