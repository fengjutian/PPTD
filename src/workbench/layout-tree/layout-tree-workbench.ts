import type { PresentationDocument, Revisions } from "../../core/document-model";
import { layoutRect } from "../../core/layout/geometry/coordinate-system";
import {
  compileLayoutTree,
  createStarterLayoutDefinition,
  moveLayoutNode,
  parseLayoutTreeDraft,
  updateLayoutNode,
  type LayoutDefinition,
  type LayoutNode,
  type LayoutTreeDraft,
} from "../../core/layout/tree";
import type { WorkbenchCallResult, WorkbenchToolDefinition } from "../contracts";

export type LayoutTreeToolName =
  | "layout.suggest"
  | "layout.node.add"
  | "layout.node.update"
  | "layout.node.move"
  | "layout.node.remove"
  | "layout.slot.bind"
  | "layout.compile"
  | "layout.preview"
  | "layout.plan.inspect"
  | "layout.plan.clear";

export interface LayoutProposal {
  readonly id: string;
  readonly slideId: string;
  readonly goal: string;
  readonly baseline: Revisions;
  readonly definition: LayoutDefinition;
  readonly slotBindings: Readonly<Record<string, string>>;
  readonly changedNodeIds: readonly string[];
  readonly decisionReasons: readonly string[];
  readonly unresolvedIssues: readonly string[];
  readonly replayDigest: string;
}

export interface LayoutTreeWorkbench {
  readonly slideId: string;
  readonly baseline: Revisions;
  readonly draftRevision: number;
  readonly definition: LayoutDefinition;
  readonly slotBindings: Readonly<Record<string, string>>;
  readonly changedNodeIds: readonly string[];
  readonly callResults: Readonly<Record<string, unknown>>;
  readonly goal: string;
}

const mutationFields = {
  callId: { type: "string", minLength: 1, maxLength: 100 },
  draftRevision: { type: "integer", minimum: 0 },
} as const;

export const LAYOUT_TREE_TOOLS: readonly WorkbenchToolDefinition<LayoutTreeToolName>[] = [
  { name: "layout.suggest", description: "返回与页面内容兼容的布局骨架候选，不修改草稿。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "layout.node.add", description: "向容器新增受支持的布局节点。", inputSchema: { type: "object", properties: { ...mutationFields, parentId: { type: "string" }, node: { type: "object" }, index: { type: "integer", minimum: 0 } }, required: ["callId", "draftRevision", "parentId", "node"], additionalProperties: false } },
  { name: "layout.node.update", description: "更新节点白名单属性。", inputSchema: { type: "object", properties: { ...mutationFields, nodeId: { type: "string" }, patch: { type: "object" } }, required: ["callId", "draftRevision", "nodeId", "patch"], additionalProperties: false } },
  { name: "layout.node.move", description: "在同一页面树内移动节点。", inputSchema: { type: "object", properties: { ...mutationFields, nodeId: { type: "string" }, parentId: { type: "string" }, index: { type: "integer", minimum: 0 } }, required: ["callId", "draftRevision", "nodeId", "parentId", "index"], additionalProperties: false } },
  { name: "layout.node.remove", description: "删除未绑定的布局节点。", inputSchema: { type: "object", properties: { ...mutationFields, nodeId: { type: "string" } }, required: ["callId", "draftRevision", "nodeId"], additionalProperties: false } },
  { name: "layout.slot.bind", description: "把现有页面元素绑定到兼容槽位。", inputSchema: { type: "object", properties: { ...mutationFields, slotId: { type: "string" }, elementId: { type: "string" } }, required: ["callId", "draftRevision", "slotId", "elementId"], additionalProperties: false } },
  { name: "layout.compile", description: "编译当前布局草稿并返回诊断。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "layout.preview", description: "返回当前布局差异的受控预演摘要。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "layout.plan.inspect", description: "生成待确认的布局提案。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "layout.plan.clear", description: "清空草稿变更并恢复基线。", inputSchema: { type: "object", properties: mutationFields, required: ["callId", "draftRevision"], additionalProperties: false } },
];

function recordResult(workbench: LayoutTreeWorkbench, callId: string, value: unknown, next: LayoutTreeWorkbench) {
  return { ...next, callResults: { ...workbench.callResults, [callId]: value } };
}

function mutationInput(workbench: LayoutTreeWorkbench, value: unknown): { callId: string; draftRevision: number; input: Record<string, unknown> } | WorkbenchCallResult<LayoutTreeWorkbench> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return failure(workbench, "INVALID_TOOL_INPUT", "input");
  const input = value as Record<string, unknown>;
  if (typeof input.callId !== "string" || !Number.isInteger(input.draftRevision)) return failure(workbench, "INVALID_TOOL_INPUT", "input");
  if (Object.hasOwn(workbench.callResults, input.callId)) return { ok: true, workbench, value: workbench.callResults[input.callId] };
  if (input.draftRevision !== workbench.draftRevision) return failure(workbench, "DRAFT_REVISION_CONFLICT", "draftRevision");
  return { callId: input.callId, draftRevision: input.draftRevision as number, input };
}

function failure(workbench: LayoutTreeWorkbench, code: string, path: string): WorkbenchCallResult<LayoutTreeWorkbench> {
  return { ok: false, workbench, issues: [{ code, paths: [path], message: code }] };
}

function mapChildren(node: LayoutNode, parentId: string, mapper: (children: readonly LayoutNode[]) => readonly LayoutNode[]): LayoutNode {
  if (node.type === "slot") return node;
  if (node.id === parentId) return { ...node, children: mapper(node.children) };
  return { ...node, children: node.children.map((child) => mapChildren(child, parentId, mapper)) };
}

function removeFromTree(tree: LayoutTreeDraft, nodeId: string): LayoutTreeDraft {
  const root = mapChildren(tree.root, tree.root.id, (children) => children);
  const remove = (node: LayoutNode): LayoutNode => node.type === "slot" ? node : { ...node, children: node.children.filter((child) => child.id !== nodeId).map(remove) };
  return { ...tree, root: remove(root) as LayoutTreeDraft["root"] };
}

export function createLayoutTreeWorkbench(document: PresentationDocument, slideId = document.slides[0]!.id): LayoutTreeWorkbench {
  const slide = document.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error("SLIDE_NOT_FOUND");
  const existing = document.layoutDefinitions?.find((candidate) => candidate.id === slide.layoutBinding?.definitionId);
  const definition = structuredClone(existing ?? createStarterLayoutDefinition());
  return { slideId, baseline: { ...document.revisions }, draftRevision: 0, definition, slotBindings: { ...(slide.layoutBinding?.slotBindings ?? {}) }, changedNodeIds: [], callResults: {}, goal: "改善页面结构与可读性" };
}

export function callLayoutTreeWorkbench(workbench: LayoutTreeWorkbench, tool: LayoutTreeToolName, value: unknown): WorkbenchCallResult<LayoutTreeWorkbench> {
  if (tool === "layout.suggest") return { ok: true, workbench, value: [{ id: "title-body", label: "标题与正文", compatible: true }, { id: "two-column", label: "双栏", compatible: true }] };
  if (tool === "layout.compile") {
    const result = compileLayoutTree(workbench.definition.tree, layoutRect(0, 0, 1000, 1000));
    return result.ok ? { ok: true, workbench, value: { slots: [...result.compiled.slots], issues: [] } } : { ok: false, workbench, issues: result.issues };
  }
  if (tool === "layout.preview") return { ok: true, workbench, value: { changedNodeIds: workbench.changedNodeIds, slotBindings: workbench.slotBindings, requiresConfirmation: true } };
  if (tool === "layout.plan.inspect") {
    const compiled = compileLayoutTree(workbench.definition.tree, layoutRect(0, 0, 1000, 1000));
    const proposal: LayoutProposal = { id: crypto.randomUUID(), slideId: workbench.slideId, goal: workbench.goal, baseline: workbench.baseline, definition: structuredClone(workbench.definition), slotBindings: { ...workbench.slotBindings }, changedNodeIds: [...workbench.changedNodeIds], decisionReasons: ["使用声明式布局树保持槽位比例与间距"], unresolvedIssues: compiled.ok ? [] : compiled.issues.map((issue) => issue.code), replayDigest: `${workbench.baseline.document}:${workbench.draftRevision}:1` };
    return { ok: true, workbench, value: proposal };
  }
  const parsed = mutationInput(workbench, value);
  if ("ok" in parsed) return parsed;
  try {
    let tree = workbench.definition.tree;
    let bindings = workbench.slotBindings;
    let changedNodeId = typeof parsed.input.nodeId === "string" ? parsed.input.nodeId : undefined;
    if (tool === "layout.node.update") tree = updateLayoutNode(tree, String(parsed.input.nodeId), parsed.input.patch as never);
    else if (tool === "layout.node.move") tree = moveLayoutNode(tree, String(parsed.input.nodeId), String(parsed.input.parentId), Number(parsed.input.index));
    else if (tool === "layout.node.remove") {
      const id = String(parsed.input.nodeId);
      if (bindings[id]) return failure(workbench, "SLOT_STILL_BOUND", id);
      tree = removeFromTree(tree, id);
    } else if (tool === "layout.node.add") {
      const node = parsed.input.node as LayoutNode;
      changedNodeId = node?.id;
      tree = { ...tree, root: mapChildren(tree.root, String(parsed.input.parentId), (children) => { const next = [...children]; next.splice(Number(parsed.input.index ?? next.length), 0, node); return next; }) as LayoutTreeDraft["root"] };
    } else if (tool === "layout.slot.bind") {
      changedNodeId = String(parsed.input.slotId);
      bindings = { ...bindings, [String(parsed.input.slotId)]: String(parsed.input.elementId) };
    } else if (tool === "layout.plan.clear") {
      const cleared = { ...workbench, draftRevision: workbench.draftRevision + 1, changedNodeIds: [], slotBindings: {}, definition: createStarterLayoutDefinition() };
      const result = { cleared: true, draftRevision: cleared.draftRevision };
      return { ok: true, workbench: recordResult(workbench, parsed.callId, result, cleared), value: result };
    }
    if (!parseLayoutTreeDraft(tree).ok) return failure(workbench, "INVALID_LAYOUT_TREE", changedNodeId ?? "tree");
    const next = { ...workbench, draftRevision: workbench.draftRevision + 1, definition: { ...workbench.definition, tree }, slotBindings: bindings, changedNodeIds: changedNodeId ? [...new Set([...workbench.changedNodeIds, changedNodeId])] : workbench.changedNodeIds };
    const result = { draftRevision: next.draftRevision, changedNodeId };
    return { ok: true, workbench: recordResult(workbench, parsed.callId, result, next), value: result };
  } catch (error) {
    return failure(workbench, error instanceof Error ? error.message : "INVALID_LAYOUT_TREE", tool);
  }
}

export function proposalRevisionMatches(proposal: LayoutProposal, revisions: Revisions): boolean {
  return proposal.baseline.document === revisions.document && proposal.baseline.content === revisions.content && proposal.baseline.design === revisions.design;
}
