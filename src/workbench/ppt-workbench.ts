import type { PageCoordinateSystem } from "../core/layout/geometry/coordinate-system";
import {
  callLayoutWorkbench,
  createLayoutWorkbench,
  LAYOUT_WORKBENCH_TOOLS,
  type LayoutWorkbench,
  type LayoutWorkbenchToolName,
} from "./layout/layout-workbench";
import type { WorkbenchCallResult, WorkbenchToolDefinition } from "./contracts";

export type PptWorkbenchToolName = `layout.${LayoutWorkbenchToolName}`;

/**
 * AI-facing PPT operation state. It deliberately contains no writable document
 * aggregate: every future editing capability must be added as a bounded tool
 * domain and translated to validated domain commands before commit.
 */
export interface PptWorkbench {
  readonly protocolVersion: 1;
  readonly layout: LayoutWorkbench;
}

export const PPT_WORKBENCH_TOOLS: readonly WorkbenchToolDefinition<PptWorkbenchToolName>[] =
  LAYOUT_WORKBENCH_TOOLS.map((tool) => ({
    ...tool,
    name: `layout.${tool.name}` as PptWorkbenchToolName,
  }));

const pptWorkbenchToolNames = new Set<string>(PPT_WORKBENCH_TOOLS.map((tool) => tool.name));

export function createPptWorkbench(
  coordinateSystem: PageCoordinateSystem,
): WorkbenchCallResult<PptWorkbench, Record<string, unknown>> {
  const result = createLayoutWorkbench(coordinateSystem);
  const workbench: PptWorkbench = { protocolVersion: 1, layout: result.workbench };
  return result.ok
    ? { ok: true, workbench, value: result.value as Record<string, unknown> }
    : { ok: false, workbench, issues: result.issues };
}

export function callPptWorkbench(
  workbench: PptWorkbench,
  tool: string,
  input: unknown,
): WorkbenchCallResult<PptWorkbench> {
  if (!pptWorkbenchToolNames.has(tool)) {
    return {
      ok: false,
      workbench,
      issues: [{ code: "UNSUPPORTED_TOOL", paths: [tool], message: "Workbench 工具未注册" }],
    };
  }
  const layoutTool = tool.slice("layout.".length) as LayoutWorkbenchToolName;
  const result = callLayoutWorkbench(workbench.layout, layoutTool, input);
  const next: PptWorkbench = { ...workbench, layout: result.workbench };
  return result.ok
    ? { ok: true, workbench: next, value: result.value }
    : { ok: false, workbench: next, issues: result.issues };
}
