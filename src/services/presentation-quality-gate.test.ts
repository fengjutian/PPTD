import { describe, expect, it } from "vitest";
import { applyCommand, type AiSlideDesign } from "../core/commands/commands";
import { createDocument } from "../core/document-model";
import { validatePresentationVisualQuality } from "./presentation-quality-gate";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#0EA58C",
  titleColor: "#111827",
  bodyColor: "#293241",
  safeRegion: { x: 0.08, y: 0.12, width: 0.84, height: 0.72 },
  ...overrides,
});

describe("presentation visual quality gate", () => {
  it("rejects text that overlaps a visual obstacle", () => {
    const document = createDocument();
    const current = design({ obstacleRegions: [{ x: 0.05, y: 0.1, width: 0.45, height: 0.2 }] });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "quality",
      slides: [{ title: "Title", body: "Body", speakerNotes: "" }],
      designs: [design()],
    });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.some((issue) => issue.issue === "obstacle-overlap")).toBe(true);
  });

  it("rejects low contrast text", () => {
    const document = createDocument();
    const current = design({ background: "#FFFFFF", titleColor: "#FFFFFF", bodyColor: "#FFFFFF" });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "quality",
      slides: [{ title: "Title", body: "Body", speakerNotes: "" }],
      designs: [current],
    });
    // The command layer keeps generated text readable on its own; the gate has to
    // catch text that became unreadable afterwards.
    document.slides[0]!.elements.forEach((element) => {
      if (element.type === "text") element.style = { ...element.style, color: "#FFFFFF" };
    });
    expect(
      validatePresentationVisualQuality(document, [current]).issues.some((issue) => issue.issue === "low-contrast"),
    ).toBe(true);
  });

  it("judges text against the card that carries it instead of the page color", () => {
    const document = createDocument();
    const current = design({ layout: "cards", background: "#101010", titleColor: "#FFFFFF", bodyColor: "#111111" });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "quality",
      slides: [{ title: "Title", body: "1. One\n2. Two", speakerNotes: "" }],
      designs: [current],
    });
    const report = validatePresentationVisualQuality(document, [current]);
    // The card labels sit on white cards, so they stay readable even though the
    // page color behind them is dark.
    expect(report.issues.some((issue) => issue.issue === "low-contrast")).toBe(false);
  });

  it("keeps generated title and body outside the supplied obstacle regions", () => {
    const document = createDocument();
    const current = design({
      obstacleRegions: [{ x: 0, y: 0, width: 0.42, height: 0.32 }],
      elementRepairs: [
        { action: "move", target: "title", frame: { x: 0.08, y: 0.12, width: 0.84, height: 0.12 } },
        { action: "resize", target: "body", frame: { x: 0.08, y: 0.3, width: 0.84, height: 0.5 } },
      ],
    });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "quality",
      slides: [{ title: "Title", body: "Body", speakerNotes: "" }],
      designs: [current],
    });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.filter((issue) => issue.issue === "obstacle-overlap")).toEqual([]);
  });

  it("rejects a split page whose columns stop in the upper half", () => {
    const document = createDocument();
    const longItem =
      "这是一段用于验证双栏版式的较长正文，它需要在两列中保持完整，并且不能越过页面安全区域，同时保留足够的上下文信息";
    const current = design({ layout: "split" });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "双栏",
      slides: [
        { title: "双栏", body: `1. ${longItem}\n2. ${longItem}\n3. ${longItem}\n4. ${longItem}`, speakerNotes: "" },
      ],
      designs: [current],
    });
    const columns = document.slides[0]!.elements.filter(
      (element): element is Extract<typeof element, { type: "text" }> =>
        element.type === "text" &&
        element.frame.width >= document.pageSize.width * 0.18 &&
        element.frame.width <= document.pageSize.width * 0.45 &&
        element.frame.height >= document.pageSize.height * 0.08,
    );
    expect(columns).toHaveLength(2);
    // Simulate legacy or manually shortened copy: the column frames are still
    // tall, but the painted text no longer reaches the lower part of the page.
    columns.forEach((element, index) => {
      element.text = `短句${index + 1}`;
    });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.some((issue) => issue.issue === "underfilled-columns")).toBe(true);
  });

  it("accepts a split page whose columns carry enough copy", () => {
    const document = createDocument();
    const longItem =
      "这是一段用于验证双栏版式的较长正文，它需要在两列中保持完整，并且不能越过页面安全区域，同时保留足够的上下文信息";
    const current = design({ layout: "split" });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "双栏",
      slides: [
        { title: "双栏", body: `1. ${longItem}\n2. ${longItem}\n3. ${longItem}\n4. ${longItem}`, speakerNotes: "" },
      ],
      designs: [current],
    });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.some((issue) => issue.issue === "underfilled-columns")).toBe(false);
  });

  it("does not mistake an editorial split page for two sparse columns", () => {
    const document = createDocument();
    const current = design({ layout: "split" });
    applyCommand(document, {
      type: "apply-ai-designed-draft",
      title: "要点",
      slides: [{ title: "要点", body: "1. 第一项\n2. 第二项\n3. 第三项\n4. 第四项\n5. 第五项", speakerNotes: "" }],
      designs: [current],
    });
    const report = validatePresentationVisualQuality(document, [current]);
    expect(report.issues.some((issue) => issue.issue === "underfilled-columns")).toBe(false);
  });
});
