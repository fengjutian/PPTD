import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { createDocument, hashSlideContent, type DesignDirectionRecord } from "../document-model";
import { defaultDocumentaryConcept, resolveDeckConcept } from "../design/deck-concept";
import type { CompositionFacts } from "./design-intent";
import { useEditorStore } from "../../store/editor-store";

const content = { title: "门店效率", body: "本季度门店效率提升主要来自陈列调整与预约制。", speakerNotes: "" };
const facts: CompositionFacts = {
  itemCount: 2,
  shortItems: true,
  longestItemLength: 16,
  bodyLength: content.body.length,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: false,
  layout: "title-body",
};

const design = {
  layout: "title-body" as const,
  background: "#FFFFFF",
  accent: "#0F7869",
  titleColor: "#1E3550",
  bodyColor: "#5F6B76",
};

function concept() {
  return resolveDeckConcept({
    concept: defaultDocumentaryConcept(),
    pageFacts: [facts],
    pageCount: 1,
    id: "direction-test",
  }).concept;
}

function directionRecord(overrides: Partial<DesignDirectionRecord> = {}): DesignDirectionRecord {
  const proposal = {
    id: crypto.randomUUID(),
    preset: "editorial" as const,
    name: "编辑式",
    idea: "用细线和大字号组织内容。",
    rationale: "内容以判断和要点为主。",
    typeContrast: "strong" as const,
    imagery: "none" as const,
    previewPages: [],
  };
  return {
    id: crypto.randomUUID(),
    createdAt: "2026-10-24T12:00:00.000Z",
    contentRevision: 1,
    contentFingerprint: JSON.stringify([hashSlideContent(content)]),
    proposals: [proposal],
    selectedProposalId: proposal.id,
    selectedBy: "user",
    regenerations: 0,
    promptVersion: "design-directions-v1",
    ...overrides,
  };
}

function commandFor(direction: DesignDirectionRecord) {
  return {
    type: "apply-ai-designed-draft" as const,
    title: "方向记录",
    slides: [content],
    designs: [design],
    designConcept: concept(),
    designDirection: direction,
  };
}

describe("design direction record", () => {
  it("stores the decision with the design and leaves the content fingerprint alone", () => {
    const document = createDocument();
    const before = JSON.stringify([hashSlideContent(content)]);
    applyCommand(document, commandFor(directionRecord()));
    expect(document.designDirections).toHaveLength(1);
    expect(document.designDirections?.[0]?.selectedBy).toBe("user");
    expect(JSON.stringify([hashSlideContent(document.slides[0]!.content)])).toBe(before);
  });

  it("rejects a preset the renderer cannot draw", () => {
    const document = createDocument();
    const record = directionRecord();
    record.proposals[0]!.preset = "instrument" as never;
    expect(() => applyCommand(document, commandFor(record))).toThrow("DESIGN_DIRECTION_INVALID");
    expect(document.designDirections).toBeUndefined();
  });

  it("rejects a decision taken against different content", () => {
    const document = createDocument();
    expect(() => applyCommand(document, commandFor(directionRecord({ contentFingerprint: "stale" })))).toThrow(
      "DESIGN_DIRECTION_STALE",
    );
    expect(document.designDirections).toBeUndefined();
  });

  it("keeps the most recent twenty decisions", () => {
    const document = createDocument();
    const ids: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const record = directionRecord();
      ids.push(record.id);
      applyCommand(document, commandFor(record));
    }
    expect(document.designDirections).toHaveLength(20);
    expect(document.designDirections?.[0]?.id).toBe(ids[1]);
    expect(document.designDirections?.at(-1)?.id).toBe(ids[20]);
  });

  it("undoes the record together with the design as one transaction", () => {
    const document = createDocument();
    useEditorStore.setState({
      document,
      activeSlideId: document.slides[0]!.id,
      selectedElementIds: [],
      undoStack: [],
      redoStack: [],
    });
    useEditorStore.getState().execute(commandFor(directionRecord()));
    expect(useEditorStore.getState().document.designDirections).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().document.designDirections).toBeUndefined();
  });
});
