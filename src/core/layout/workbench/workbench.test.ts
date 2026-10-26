import { describe, expect, it } from "vitest";
import { layoutRect, type PageCoordinateSystem } from "./coordinate-system";
import { callLayoutWorkbench, createLayoutWorkbench, LAYOUT_WORKBENCH_TOOLS } from "./workbench";

const system: PageCoordinateSystem = {
  coordinateSpace: "normalized-1000",
  page: layoutRect(0, 0, 1000, 1000),
  safe: layoutRect(100, 80, 840, 820),
  title: layoutRect(220, 80, 720, 120),
  content: layoutRect(220, 270, 720, 580),
  footer: layoutRect(220, 930, 720, 30),
  rail: layoutRect(180, 80, 4, 820),
};

describe("AI layout workbench", () => {
  it("exposes bounded tools and lets an AI build and inspect a layout incrementally", () => {
    expect(LAYOUT_WORKBENCH_TOOLS.map((tool) => tool.name)).toEqual([
      "regions",
      "inspect",
      "inset",
      "columns",
      "rows",
      "stack",
      "validate",
    ]);
    const created = createLayoutWorkbench(system);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const columns = callLayoutWorkbench(created.workbench, "columns", {
      id: "metrics",
      source: "content",
      count: 4,
      gap: "md",
    });
    expect(columns.ok).toBe(true);
    if (!columns.ok) return;
    expect(columns.value).toMatchObject({ "metrics[0]": { x: 220, width: 162 }, "metrics[3]": { x: 778, width: 162 } });
    expect(callLayoutWorkbench(columns.workbench, "inspect", { source: "metrics[2]" })).toMatchObject({
      ok: true,
      value: { x: 592, y: 270, width: 162, height: 580 },
    });
    expect(callLayoutWorkbench(columns.workbench, "validate", {})).toMatchObject({ ok: true, value: { valid: true } });
  });

  it("keeps the previous workbench unchanged when a tool call fails", () => {
    const created = createLayoutWorkbench(system);
    if (!created.ok) throw new Error("workbench failed");
    const failed = callLayoutWorkbench(created.workbench, "columns", {
      id: "bad",
      source: "missing",
      count: 4,
      gap: "md",
    });
    expect(failed).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "INVALID_REFERENCE" })] });
    expect(failed.workbench.program.operations).toEqual([]);
    expect(failed.workbench.slots.has("content")).toBe(true);
  });
});
