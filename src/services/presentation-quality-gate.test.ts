import { describe, expect, it } from "vitest";
import { applyCommand, type AiSlideDesign } from "../core/commands/commands";
import { createDocument } from "../core/document-model";
import { validatePresentationVisualQuality } from "./presentation-quality-gate";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({ layout: "title-body", background: "#FFFFFF", accent: "#0EA58C", titleColor: "#111827", bodyColor: "#293241", safeRegion: { x: 0.08, y: 0.12, width: 0.84, height: 0.72 }, ...overrides });

describe("presentation visual quality gate", () => {
  it("rejects text that overlaps a visual obstacle", () => {
    const document = createDocument();
    const current = design({ obstacleRegions: [{ x: 0.05, y: 0.1, width: 0.45, height: 0.2 }] });
    applyCommand(document, { type: "apply-ai-designed-draft", title: "quality", slides: [{ title: "Title", body: "Body", speakerNotes: "" }], designs: [design()] });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.some((issue) => issue.issue === "obstacle-overlap")).toBe(true);
  });

  it("rejects low contrast text", () => {
    const document = createDocument();
    const current = design({ background: "#FFFFFF", titleColor: "#FFFFFF", bodyColor: "#FFFFFF" });
    applyCommand(document, { type: "apply-ai-designed-draft", title: "quality", slides: [{ title: "Title", body: "Body", speakerNotes: "" }], designs: [current] });
    // The command layer keeps generated text readable on its own; the gate has to
    // catch text that became unreadable afterwards.
    document.slides[0]!.elements.forEach((element) => {
      if (element.type === "text") element.style = { ...element.style, color: "#FFFFFF" };
    });
    expect(validatePresentationVisualQuality(document, [current]).issues.some((issue) => issue.issue === "low-contrast")).toBe(true);
  });

  it("judges text against the card that carries it instead of the page color", () => {
    const document = createDocument();
    const current = design({ layout: "cards", background: "#101010", titleColor: "#FFFFFF", bodyColor: "#111111" });
    applyCommand(document, { type: "apply-ai-designed-draft", title: "quality", slides: [{ title: "Title", body: "1. One\n2. Two", speakerNotes: "" }], designs: [current] });
    const report = validatePresentationVisualQuality(document, [current]);
    // The card labels sit on white cards, so they stay readable even though the
    // page color behind them is dark.
    expect(report.issues.some((issue) => issue.issue === "low-contrast")).toBe(false);
  });

  it("keeps generated title and body outside the supplied obstacle regions", () => {
    const document = createDocument();
    const current = design({ obstacleRegions: [{ x: 0, y: 0, width: 0.42, height: 0.32 }], elementRepairs: [{ action: "move", target: "title", frame: { x: 0.08, y: 0.12, width: 0.84, height: 0.12 } }, { action: "resize", target: "body", frame: { x: 0.08, y: 0.30, width: 0.84, height: 0.50 } }] });
    applyCommand(document, { type: "apply-ai-designed-draft", title: "quality", slides: [{ title: "Title", body: "Body", speakerNotes: "" }], designs: [current] });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.filter((issue) => issue.issue === "obstacle-overlap")).toEqual([]);
  });
});
