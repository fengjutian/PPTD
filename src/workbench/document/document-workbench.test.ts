import { describe, expect, it } from "vitest";
import { applyCommand } from "../../core/commands";
import { createDocument } from "../../core/document-model";
import { layoutRect, type PageCoordinateSystem } from "../../core/layout/geometry/coordinate-system";
import {
  callPptWorkbench,
  createPptWorkbench,
  PPT_WORKBENCH_TOOLS,
  preparePptWorkbenchCommit,
} from "../ppt-workbench";

const coordinateSystem: PageCoordinateSystem = {
  coordinateSpace: "normalized-1000",
  page: layoutRect(0, 0, 1000, 1000),
  safe: layoutRect(100, 80, 840, 820),
  title: layoutRect(220, 80, 720, 120),
  content: layoutRect(220, 270, 720, 580),
  footer: layoutRect(220, 930, 720, 30),
};

describe("document workbench tools", () => {
  it("exposes inspection and design-plan tools without mutating the document", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    applyCommand(document, { type: "add-shape", slideId: slide.id, shape: "rectangle" });
    const text = slide.elements.at(-2)!;
    const shape = slide.elements.at(-1)!;
    const originalFrame = { ...text.frame };
    const originalRevisions = { ...document.revisions };

    expect(PPT_WORKBENCH_TOOLS.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "document.inspect",
      "slide.list",
      "slide.inspect",
      "element.inspect",
      "element.place",
      "element.align",
      "element.distribute",
      "element.lock",
      "element.reorder",
      "element.text_style",
      "plan.inspect",
      "plan.clear",
    ]));

    const created = createPptWorkbench(coordinateSystem, document);
    if (!created.ok) throw new Error("workbench failed");
    const columns = callPptWorkbench(created.workbench, "layout.columns", {
      id: "cards",
      source: "content",
      count: 2,
      gap: "md",
    });
    if (!columns.ok) throw new Error("layout failed");
    const placed = callPptWorkbench(columns.workbench, "element.place", {
      slideId: slide.id,
      elementId: text.id,
      slot: "cards[0]",
    });
    if (!placed.ok) throw new Error("place failed");
    const aligned = callPptWorkbench(placed.workbench, "element.align", {
      slideId: slide.id,
      elementIds: [text.id, shape.id],
      horizontal: "left",
    });
    if (!aligned.ok) throw new Error("align failed");
    const styled = callPptWorkbench(aligned.workbench, "element.text_style", {
      slideId: slide.id,
      elementId: text.id,
      fontSizePt: 28,
      color: "#24589A",
      bold: true,
    });
    if (!styled.ok) throw new Error("style failed");
    const plan = callPptWorkbench(styled.workbench, "plan.inspect", {});

    expect(plan).toMatchObject({
      ok: true,
      value: {
        baseRevisions: originalRevisions,
        commands: [
          { type: "transform-element", elementId: text.id },
          { type: "align-elements", elementIds: [text.id, shape.id] },
          { type: "set-text-style", elementId: text.id, style: { fontSizePt: 28, color: "#24589A", bold: true } },
        ],
      },
    });
    expect(document.revisions).toEqual(originalRevisions);
    expect(text.frame).toEqual(originalFrame);
    expect(preparePptWorkbenchCommit(styled.workbench, originalRevisions)).toMatchObject({
      ok: true,
      commands: [{ type: "transform-element" }, { type: "align-elements" }, { type: "set-text-style" }],
    });
    expect(preparePptWorkbenchCommit(styled.workbench, { ...originalRevisions, content: originalRevisions.content + 1 })).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
    });
  });

  it("rejects missing objects, locked objects and invalid distribution", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    applyCommand(document, { type: "add-text", slideId: slide.id });
    const text = slide.elements.at(-1)!;
    applyCommand(document, { type: "set-element-lock", slideId: slide.id, elementId: text.id, locked: true });
    const created = createPptWorkbench(coordinateSystem, document);
    if (!created.ok) throw new Error("workbench failed");

    expect(callPptWorkbench(created.workbench, "element.place", {
      slideId: slide.id,
      elementId: text.id,
      slot: "content",
    })).toMatchObject({ ok: false, issues: [{ code: "ELEMENT_LOCKED" }] });
    expect(callPptWorkbench(created.workbench, "element.inspect", {
      slideId: slide.id,
      elementId: "missing",
    })).toMatchObject({ ok: false, issues: [{ code: "ELEMENT_NOT_FOUND" }] });
    expect(callPptWorkbench(created.workbench, "element.distribute", {
      slideId: slide.id,
      elementIds: [text.id],
      axis: "horizontal",
    })).toMatchObject({ ok: false, issues: [{ code: "ELEMENT_LOCKED" }] });
  });

  it("requires a document snapshot for document tools", () => {
    const created = createPptWorkbench(coordinateSystem);
    if (!created.ok) throw new Error("workbench failed");
    expect(callPptWorkbench(created.workbench, "slide.list", {})).toMatchObject({
      ok: false,
      issues: [{ code: "CONTEXT_UNAVAILABLE" }],
    });
  });
});
