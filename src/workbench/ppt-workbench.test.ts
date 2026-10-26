import { describe, expect, it } from "vitest";
import { layoutRect, type PageCoordinateSystem } from "../core/layout/geometry/coordinate-system";
import { callPptWorkbench, createPptWorkbench, PPT_WORKBENCH_TOOLS } from "./ppt-workbench";

const coordinateSystem: PageCoordinateSystem = {
  coordinateSpace: "normalized-1000",
  page: layoutRect(0, 0, 1000, 1000),
  safe: layoutRect(100, 80, 840, 820),
  title: layoutRect(220, 80, 720, 120),
  content: layoutRect(220, 270, 720, 580),
  footer: layoutRect(220, 930, 720, 30),
  rail: layoutRect(180, 80, 4, 820),
};

describe("PPT workbench", () => {
  it("presents namespaced tools as the AI-to-PPT boundary", () => {
    expect(PPT_WORKBENCH_TOOLS.map((tool) => tool.name)).toEqual([
      "layout.regions",
      "layout.inspect",
      "layout.inset",
      "layout.columns",
      "layout.rows",
      "layout.stack",
      "layout.validate",
    ]);

    const created = createPptWorkbench(coordinateSystem);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = callPptWorkbench(created.workbench, "layout.columns", {
      id: "metrics",
      source: "content",
      count: 4,
      gap: "md",
    });
    expect(result).toMatchObject({
      ok: true,
      workbench: { protocolVersion: 1 },
      value: { "metrics[0]": { x: 220, width: 162 } },
    });
  });
});
