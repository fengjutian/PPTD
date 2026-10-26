import { describe, expect, it } from "vitest";
import { layoutRect, type PageCoordinateSystem } from "../../core/layout/geometry/coordinate-system";
import { compileLayoutProgram, parseAiLayoutProgram } from "./layout-program";
import { layoutRectsOverlap } from "../../core/layout/geometry/layout-validator";

const system: PageCoordinateSystem = {
  coordinateSpace: "normalized-1000",
  page: layoutRect(0, 0, 1000, 1000),
  safe: layoutRect(100, 80, 840, 820),
  title: layoutRect(220, 80, 720, 120),
  content: layoutRect(220, 270, 720, 580),
  footer: layoutRect(220, 930, 720, 30),
  rail: layoutRect(180, 80, 4, 820),
};

describe("AI layout program", () => {
  it("parses and compiles four equal content columns without overlap", () => {
    const program = parseAiLayoutProgram({
      coordinateSpace: "normalized-1000",
      operations: [{ id: "metrics", op: "columns", source: "content", count: 4, gap: "md" }],
    });
    expect(program).toBeDefined();
    const result = compileLayoutProgram(program!, system);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const columns = [0, 1, 2, 3].map((index) => result.slots.get(`metrics[${index}]`)!);
    expect(columns.map((column) => column.width)).toEqual([162, 162, 162, 162]);
    expect(columns.every((column, index) => index === 0 || !layoutRectsOverlap(columns[index - 1]!, column))).toBe(
      true,
    );
    expect(columns[0]!.x).toBe(system.content.x);
    expect(columns[3]!.x + columns[3]!.width).toBe(system.content.x + system.content.width);
  });

  it("rejects invalid input and reports missing references", () => {
    expect(parseAiLayoutProgram({ coordinateSpace: "pixels", operations: [] })).toBeUndefined();
    const program = parseAiLayoutProgram({
      coordinateSpace: "normalized-1000",
      operations: [{ id: "cards", op: "rows", source: "missing", count: 3, gap: "sm" }],
    })!;
    expect(compileLayoutProgram(program, system)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "INVALID_REFERENCE", paths: ["missing"] })],
    });
  });

  it("rejects layouts whose requested slots cannot fit", () => {
    const program = parseAiLayoutProgram({
      coordinateSpace: "normalized-1000",
      operations: [{ id: "too-many", op: "columns", source: "title", count: 12, gap: "xl" }],
    })!;
    expect(compileLayoutProgram(program, system)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "INSUFFICIENT_CAPACITY", paths: ["too-many"] })],
    });
  });
});
