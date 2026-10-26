import type { LayoutRect, PageCoordinateSystem } from "./coordinate-system";
import { insetLayoutRect, layoutColumns, layoutRows, stackLayout, type LayoutSpacingToken } from "./layout-functions";
import { validateLayoutSiblings, type LayoutIssue } from "./layout-validator";

export type LayoutRegionName = "page" | "safe" | "title" | "content" | "footer" | "rail" | "image";

export type LayoutOperation =
  | { id: string; op: "inset"; source: string; padding: LayoutSpacingToken }
  | { id: string; op: "columns"; source: string; count: number; gap: LayoutSpacingToken }
  | { id: string; op: "rows"; source: string; count: number; gap: LayoutSpacingToken }
  | {
      id: string;
      op: "stack";
      source: string;
      count: number;
      gap: LayoutSpacingToken;
      distribution?: "start" | "center" | "space-between";
    };

export interface AiLayoutProgram {
  coordinateSpace: "normalized-1000";
  operations: LayoutOperation[];
}

export type LayoutProgramResult =
  { ok: true; slots: ReadonlyMap<string, LayoutRect> } | { ok: false; issues: LayoutIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAiLayoutProgram(value: unknown): AiLayoutProgram | undefined {
  if (!isRecord(value) || value.coordinateSpace !== "normalized-1000" || !Array.isArray(value.operations)) return;
  const operations: LayoutOperation[] = [];
  for (const candidate of value.operations) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.source !== "string") return;
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(candidate.id)) return;
    if (
      !(["xs", "sm", "md", "lg", "xl"] as const).includes(candidate.gap as LayoutSpacingToken) &&
      candidate.op !== "inset"
    )
      return;
    if (candidate.op === "inset") {
      if (!(["xs", "sm", "md", "lg", "xl"] as const).includes(candidate.padding as LayoutSpacingToken)) return;
      operations.push({
        id: candidate.id,
        op: "inset",
        source: candidate.source,
        padding: candidate.padding as LayoutSpacingToken,
      });
    } else if (candidate.op === "columns" || candidate.op === "rows") {
      if (!Number.isInteger(candidate.count)) return;
      operations.push({
        id: candidate.id,
        op: candidate.op,
        source: candidate.source,
        count: candidate.count as number,
        gap: candidate.gap as LayoutSpacingToken,
      });
    } else if (candidate.op === "stack") {
      if (!Number.isInteger(candidate.count)) return;
      if (
        candidate.distribution !== undefined &&
        !["start", "center", "space-between"].includes(candidate.distribution as string)
      )
        return;
      operations.push({
        id: candidate.id,
        op: "stack",
        source: candidate.source,
        count: candidate.count as number,
        gap: candidate.gap as LayoutSpacingToken,
        ...(candidate.distribution
          ? { distribution: candidate.distribution as "start" | "center" | "space-between" }
          : {}),
      });
    } else return;
  }
  return { coordinateSpace: "normalized-1000", operations };
}

export function compileLayoutProgram(program: AiLayoutProgram, system: PageCoordinateSystem): LayoutProgramResult {
  const slots = new Map<string, LayoutRect>();
  for (const name of ["page", "safe", "title", "content", "footer", "rail", "image"] as const) {
    const rect = system[name];
    if (rect) slots.set(name, rect);
  }
  const issues: LayoutIssue[] = [];
  for (const operation of program.operations) {
    if (slots.has(operation.id)) {
      issues.push({ code: "INVALID_REFERENCE", paths: [operation.id], message: "布局操作 ID 重复或覆盖了保留区域" });
      continue;
    }
    const source = slots.get(operation.source);
    if (!source) {
      issues.push({ code: "INVALID_REFERENCE", paths: [operation.source], message: "布局操作引用了不存在的区域" });
      continue;
    }
    try {
      const generated =
        operation.op === "inset"
          ? [insetLayoutRect(source, operation.padding)]
          : operation.op === "columns"
            ? layoutColumns(source, operation.count, operation.gap)
            : operation.op === "rows"
              ? layoutRows(source, operation.count, operation.gap)
              : stackLayout(source, operation.count, operation.gap, operation.distribution);
      const entries = generated.map((rect, index) => ({
        path: generated.length === 1 ? operation.id : `${operation.id}[${index}]`,
        rect,
      }));
      issues.push(...validateLayoutSiblings(source, entries));
      for (const entry of entries) slots.set(entry.path, entry.rect);
      if (generated.length === 1) slots.set(operation.id, generated[0]!);
    } catch (error) {
      issues.push({
        code:
          error instanceof Error && error.message === "INSUFFICIENT_CAPACITY"
            ? "INSUFFICIENT_CAPACITY"
            : "INVALID_GEOMETRY",
        paths: [operation.id],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, slots };
}
