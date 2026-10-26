import { describe, expect, it, vi } from "vitest";
import { layoutRect, type PageCoordinateSystem } from "../core/layout/geometry/coordinate-system";
import { runPptWorkbenchLoop } from "./orchestrator";
import { createPptWorkbench, PPT_WORKBENCH_TOOLS } from "./ppt-workbench";

const system: PageCoordinateSystem = {
  coordinateSpace: "normalized-1000",
  page: layoutRect(0, 0, 1000, 1000),
  safe: layoutRect(80, 60, 840, 860),
  title: layoutRect(100, 80, 800, 120),
  content: layoutRect(100, 260, 800, 600),
  footer: layoutRect(100, 930, 800, 40),
};

describe("PPT workbench orchestration", () => {
  it("executes model tool calls until the model returns a final result", async () => {
    const created = createPptWorkbench(system);
    if (!created.ok) throw new Error("workbench failed");
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ kind: "tool-call", name: "layout.columns", input: { id: "grid", source: "content", count: 4, gap: "md" } })
      .mockResolvedValueOnce({ kind: "tool-call", name: "layout.validate", input: {} })
      .mockResolvedValueOnce({ kind: "final", output: { slides: [] } });

    const result = await runPptWorkbenchLoop({
      workbench: created.workbench,
      tools: PPT_WORKBENCH_TOOLS,
      transport,
    });

    expect(transport).toHaveBeenCalledTimes(3);
    expect(result.transcript).toHaveLength(2);
    expect(result.workbench.layout.slots.has("grid[3]")).toBe(true);
    expect(result.output).toEqual({ slides: [] });
  });

  it("stops a model that never produces a final result", async () => {
    const created = createPptWorkbench(system);
    if (!created.ok) throw new Error("workbench failed");
    await expect(
      runPptWorkbenchLoop({
        workbench: created.workbench,
        tools: PPT_WORKBENCH_TOOLS,
        maxTurns: 2,
        transport: async () => ({ kind: "tool-call", name: "layout.regions", input: {} }),
      }),
    ).rejects.toThrow("AI_WORKBENCH_TURN_LIMIT_EXCEEDED");
  });
});
