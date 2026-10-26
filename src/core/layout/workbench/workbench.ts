import type { LayoutRect, PageCoordinateSystem } from "./coordinate-system";
import {
  compileLayoutProgram,
  parseAiLayoutProgram,
  type AiLayoutProgram,
  type LayoutOperation,
  type LayoutProgramResult,
} from "./layout-program";
import { validatePageCoordinateSystem, type LayoutIssue } from "./layout-validator";

export type LayoutWorkbenchToolName = "regions" | "inspect" | "inset" | "columns" | "rows" | "stack" | "validate";

export interface LayoutWorkbenchToolDefinition {
  name: LayoutWorkbenchToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LayoutWorkbench {
  readonly coordinateSpace: "normalized-1000";
  readonly system: PageCoordinateSystem;
  readonly program: AiLayoutProgram;
  readonly slots: ReadonlyMap<string, LayoutRect>;
}

export type LayoutWorkbenchCallResult =
  | { ok: true; workbench: LayoutWorkbench; value: unknown }
  | { ok: false; workbench: LayoutWorkbench; issues: LayoutIssue[] };

const spacingSchema = { type: "string", enum: ["xs", "sm", "md", "lg", "xl"] } as const;

export const LAYOUT_WORKBENCH_TOOLS: readonly LayoutWorkbenchToolDefinition[] = [
  {
    name: "regions",
    description: "列出当前页面可用的语义区域和已创建槽位。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "inspect",
    description: "读取一个语义区域或槽位的 normalized-1000 矩形。",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" } },
      required: ["source"],
      additionalProperties: false,
    },
  },
  {
    name: "inset",
    description: "在来源区域内缩，生成一个新槽位。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, source: { type: "string" }, padding: spacingSchema },
      required: ["id", "source", "padding"],
      additionalProperties: false,
    },
  },
  ...(["columns", "rows"] as const).map((name) => ({
    name,
    description: name === "columns" ? "把来源区域分成等宽列。" : "把来源区域分成等高行。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        count: { type: "integer", minimum: 1, maximum: 12 },
        gap: spacingSchema,
      },
      required: ["id", "source", "count", "gap"],
      additionalProperties: false,
    },
  })),
  {
    name: "stack",
    description: "在来源区域内生成纵向堆叠槽位。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        count: { type: "integer", minimum: 1, maximum: 12 },
        gap: spacingSchema,
        distribution: { type: "string", enum: ["start", "center", "space-between"] },
      },
      required: ["id", "source", "count", "gap"],
      additionalProperties: false,
    },
  },
  {
    name: "validate",
    description: "检查页面坐标轴、边界、引用与当前布局程序。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function snapshot(slots: ReadonlyMap<string, LayoutRect>): Record<string, LayoutRect> {
  return Object.fromEntries([...slots.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function fromCompiled(
  system: PageCoordinateSystem,
  program: AiLayoutProgram,
  compiled: LayoutProgramResult,
): LayoutWorkbenchCallResult {
  if (!compiled.ok) {
    const current = compileLayoutProgram(
      { coordinateSpace: "normalized-1000", operations: program.operations.slice(0, -1) },
      system,
    );
    return {
      ok: false,
      workbench: {
        coordinateSpace: "normalized-1000",
        system,
        program: { coordinateSpace: "normalized-1000", operations: program.operations.slice(0, -1) },
        slots: current.ok ? current.slots : new Map(),
      },
      issues: compiled.issues,
    };
  }
  const workbench: LayoutWorkbench = { coordinateSpace: "normalized-1000", system, program, slots: compiled.slots };
  const created = program.operations.at(-1)?.id;
  return {
    ok: true,
    workbench,
    value: created
      ? Object.fromEntries(
          [...compiled.slots.entries()].filter(([path]) => path === created || path.startsWith(`${created}[`)),
        )
      : snapshot(compiled.slots),
  };
}

export function createLayoutWorkbench(system: PageCoordinateSystem): LayoutWorkbenchCallResult {
  const issues = validatePageCoordinateSystem(system);
  const program: AiLayoutProgram = { coordinateSpace: "normalized-1000", operations: [] };
  const compiled = compileLayoutProgram(program, system);
  if (issues.length > 0 || !compiled.ok) {
    return {
      ok: false,
      workbench: {
        coordinateSpace: "normalized-1000",
        system,
        program,
        slots: compiled.ok ? compiled.slots : new Map(),
      },
      issues: [...issues, ...(!compiled.ok ? compiled.issues : [])],
    };
  }
  return {
    ok: true,
    workbench: { coordinateSpace: "normalized-1000", system, program, slots: compiled.slots },
    value: snapshot(compiled.slots),
  };
}

export function callLayoutWorkbench(
  workbench: LayoutWorkbench,
  tool: LayoutWorkbenchToolName,
  input: unknown,
): LayoutWorkbenchCallResult {
  if (tool === "regions") return { ok: true, workbench, value: snapshot(workbench.slots) };
  if (tool === "validate") {
    const issues = validatePageCoordinateSystem(workbench.system);
    return issues.length > 0 ? { ok: false, workbench, issues } : { ok: true, workbench, value: { valid: true } };
  }
  if (tool === "inspect") {
    const source =
      typeof input === "object" && input !== null && "source" in input
        ? (input as { source?: unknown }).source
        : undefined;
    const rect = typeof source === "string" ? workbench.slots.get(source) : undefined;
    return rect
      ? { ok: true, workbench, value: rect }
      : {
          ok: false,
          workbench,
          issues: [{ code: "INVALID_REFERENCE", paths: [String(source ?? "")], message: "槽位不存在" }],
        };
  }
  const parsed = parseAiLayoutProgram({
    coordinateSpace: "normalized-1000",
    operations: [{ ...(input as object), op: tool }],
  });
  if (!parsed) {
    return {
      ok: false,
      workbench,
      issues: [{ code: "INVALID_GEOMETRY", paths: [tool], message: "工具参数不符合布局协议" }],
    };
  }
  const operation = parsed.operations[0] as LayoutOperation;
  const program: AiLayoutProgram = {
    coordinateSpace: "normalized-1000",
    operations: [...workbench.program.operations, operation],
  };
  return fromCompiled(workbench.system, program, compileLayoutProgram(program, workbench.system));
}
