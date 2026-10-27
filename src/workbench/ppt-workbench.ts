import type { PageCoordinateSystem } from "../core/layout/geometry/coordinate-system";
import type { PresentationDocument } from "../core/document-model";
import {
  callDocumentWorkbench,
  createDocumentWorkbench,
  DOCUMENT_WORKBENCH_TOOLS,
  prepareDocumentWorkbenchCommit,
  type DocumentWorkbench,
  type DocumentWorkbenchToolName,
} from "./document/document-workbench";
import type { Revisions } from "../core/document-model";
import {
  callLayoutWorkbench,
  createLayoutWorkbench,
  LAYOUT_WORKBENCH_TOOLS,
  type LayoutWorkbench,
  type LayoutWorkbenchToolName,
} from "./layout/layout-workbench";
import type { WorkbenchCallResult, WorkbenchToolDefinition } from "./contracts";
import {
  callLayoutTreeWorkbench,
  createLayoutTreeWorkbench,
  LAYOUT_TREE_TOOLS,
  type LayoutTreeToolName,
  type LayoutTreeWorkbench,
} from "./layout-tree";

export type PptWorkbenchToolName = `layout.${LayoutWorkbenchToolName}` | LayoutTreeToolName | DocumentWorkbenchToolName;

/**
 * AI-facing PPT operation state. It deliberately contains no writable document
 * aggregate: every future editing capability must be added as a bounded tool
 * domain and translated to validated domain commands before commit.
 */
export interface PptWorkbench {
  readonly protocolVersion: 1;
  readonly layout: LayoutWorkbench;
  readonly document?: DocumentWorkbench;
  readonly layoutTree?: LayoutTreeWorkbench;
}

export const PPT_WORKBENCH_TOOLS: readonly WorkbenchToolDefinition<PptWorkbenchToolName>[] = [
  ...LAYOUT_WORKBENCH_TOOLS.map((tool) => ({
    ...tool,
    name: `layout.${tool.name}` as PptWorkbenchToolName,
  })),
  ...DOCUMENT_WORKBENCH_TOOLS,
  ...LAYOUT_TREE_TOOLS,
];

const pptWorkbenchToolNames = new Set<string>(PPT_WORKBENCH_TOOLS.map((tool) => tool.name));

export function createPptWorkbench(
  coordinateSystem: PageCoordinateSystem,
  document?: PresentationDocument,
): WorkbenchCallResult<PptWorkbench, Record<string, unknown>> {
  const result = createLayoutWorkbench(coordinateSystem);
  const workbench: PptWorkbench = {
    protocolVersion: 1,
    layout: result.workbench,
    ...(document ? { document: createDocumentWorkbench(document) } : {}),
    ...(document ? { layoutTree: createLayoutTreeWorkbench(document) } : {}),
  };
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
  if (!tool.startsWith("layout.")) {
    if (!workbench.document) {
      return {
        ok: false,
        workbench,
        issues: [{ code: "CONTEXT_UNAVAILABLE", paths: [tool], message: "工作台没有文档快照" }],
      };
    }
    const result = callDocumentWorkbench(
      workbench.document,
      workbench.layout,
      tool as DocumentWorkbenchToolName,
      input,
    );
    const next: PptWorkbench = { ...workbench, document: result.workbench };
    return result.ok
      ? { ok: true, workbench: next, value: result.value }
      : { ok: false, workbench: next, issues: result.issues };
  }
  if (LAYOUT_TREE_TOOLS.some((candidate) => candidate.name === tool)) {
    if (!workbench.layoutTree) {
      return {
        ok: false,
        workbench,
        issues: [{ code: "CONTEXT_UNAVAILABLE", paths: [tool], message: "工作台没有页面布局树上下文" }],
      };
    }
    const result = callLayoutTreeWorkbench(workbench.layoutTree, tool as LayoutTreeToolName, input);
    const next: PptWorkbench = { ...workbench, layoutTree: result.workbench };
    return result.ok
      ? { ok: true, workbench: next, value: result.value }
      : { ok: false, workbench: next, issues: result.issues };
  }
  const layoutTool = tool.slice("layout.".length) as LayoutWorkbenchToolName;
  const result = callLayoutWorkbench(workbench.layout, layoutTool, input);
  const next: PptWorkbench = { ...workbench, layout: result.workbench };
  return result.ok
    ? { ok: true, workbench: next, value: result.value }
    : { ok: false, workbench: next, issues: result.issues };
}

export function preparePptWorkbenchCommit(workbench: PptWorkbench, currentRevisions: Revisions) {
  if (!workbench.document) {
    return { ok: false as const, code: "CONTEXT_UNAVAILABLE" as const };
  }
  return prepareDocumentWorkbenchCommit(workbench.document, currentRevisions);
}
