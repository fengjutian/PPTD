import type { ElementId, Emu, RectEmu, Slide } from "../../document-model";
import { layoutRectToEmu, layoutRect } from "../geometry/coordinate-system";
import { compileLayoutTree } from "./compiler";
import type {
  LayoutBinding,
  LayoutContainerNode,
  LayoutDefinition,
  LayoutNode,
  LayoutNodeOverride,
  LayoutSize,
  LayoutTreeDraft,
} from "./types";

export type LayoutEditablePatch = Omit<LayoutNodeOverride, "nodeId">;

export function createStarterLayoutDefinition(name = "标题与正文"): LayoutDefinition {
  const id = crypto.randomUUID();
  return {
    id,
    name,
    layoutSchemaVersion: 1,
    tree: {
      coordinateSpace: "normalized-1000",
      registryVersion: 1,
      root: {
        id: crypto.randomUUID(),
        type: "canvas",
        width: { mode: "fixed", value: 1000 },
        height: { mode: "fixed", value: 1000 },
        layoutState: "managed",
        padding: "lg",
        gap: "md",
        children: [
          {
            id: crypto.randomUUID(),
            type: "slot",
            role: "title",
            contentRef: "title",
            width: { mode: "fill" },
            height: { mode: "fraction", weight: 1 },
            layoutState: "managed",
          },
          {
            id: crypto.randomUUID(),
            type: "slot",
            role: "body",
            contentRef: "body",
            width: { mode: "fill" },
            height: { mode: "fraction", weight: 4 },
            layoutState: "managed",
          },
        ],
      },
    },
  };
}

function mapNode(node: LayoutNode, nodeId: string, mapper: (node: LayoutNode) => LayoutNode): LayoutNode {
  const current = node.id === nodeId ? mapper(node) : node;
  if (current.type === "slot") return current;
  return { ...current, children: current.children.map((child) => mapNode(child, nodeId, mapper)) };
}

export function updateLayoutNode(tree: LayoutTreeDraft, nodeId: string, patch: LayoutEditablePatch): LayoutTreeDraft {
  let found = false;
  const root = mapNode(tree.root, nodeId, (node) => {
    found = true;
    const base = {
      ...node,
      ...(patch.width ? { width: patch.width } : {}),
      ...(patch.height ? { height: patch.height } : {}),
      ...(patch.layoutState ? { layoutState: patch.layoutState } : {}),
    };
    if (base.type === "slot") return base;
    return {
      ...base,
      ...(patch.gap ? { gap: patch.gap } : {}),
      ...(patch.padding ? { padding: patch.padding } : {}),
      ...(base.type === "grid" && patch.columns ? { columns: patch.columns } : {}),
    };
  });
  if (!found || root.type !== "canvas") throw new Error("INVALID_NODE_REFERENCE");
  return { ...tree, root: { ...root, type: "canvas" } };
}

function removeNode(node: LayoutContainerNode, nodeId: string): { parent: LayoutContainerNode; removed?: LayoutNode } {
  let removed: LayoutNode | undefined;
  const children = node.children.flatMap((child): LayoutNode[] => {
    if (child.id === nodeId) {
      removed = child;
      return [];
    }
    if (child.type === "slot") return [child];
    const nested = removeNode(child, nodeId);
    if (nested.removed) removed = nested.removed;
    return [nested.parent];
  });
  return { parent: { ...node, children }, ...(removed ? { removed } : {}) };
}

function insertNode(
  node: LayoutContainerNode,
  parentId: string,
  index: number,
  child: LayoutNode,
): LayoutContainerNode {
  if (node.id === parentId) {
    const children = [...node.children];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, child);
    return { ...node, children };
  }
  return {
    ...node,
    children: node.children.map((candidate) =>
      candidate.type === "slot" ? candidate : insertNode(candidate, parentId, index, child),
    ),
  };
}

export function moveLayoutNode(
  tree: LayoutTreeDraft,
  nodeId: string,
  parentId: string,
  index: number,
): LayoutTreeDraft {
  if (nodeId === tree.root.id || nodeId === parentId) throw new Error("INVALID_NODE_REFERENCE");
  const removed = removeNode(tree.root, nodeId);
  if (!removed.removed) throw new Error("INVALID_NODE_REFERENCE");
  const root = insertNode(removed.parent, parentId, index, removed.removed);
  return { ...tree, root: { ...root, type: "canvas" } };
}

export function applyLayoutOverrides(
  tree: LayoutTreeDraft,
  overrides: readonly LayoutNodeOverride[] = [],
): LayoutTreeDraft {
  return overrides.reduce((current, override) => updateLayoutNode(current, override.nodeId, override), tree);
}

export function detachedOverride(binding: LayoutBinding, nodeId: string): LayoutBinding {
  const overrides = (binding.overrides ?? []).filter((item) => item.nodeId !== nodeId);
  return { ...binding, overrides: [...overrides, { nodeId, layoutState: "detached" }] };
}

export interface LayoutFramePlan {
  readonly frames: Array<{ elementId: ElementId; frame: RectEmu }>;
  readonly unboundSlotIds: string[];
}

export function compileLayoutFramePlan(
  definition: LayoutDefinition,
  binding: LayoutBinding,
  slide: Slide,
  page: { width: Emu; height: Emu },
): LayoutFramePlan {
  const tree = applyLayoutOverrides(definition.tree, binding.overrides);
  const result = compileLayoutTree(tree, layoutRect(0, 0, 1000, 1000));
  if (!result.ok) throw new Error(result.issues[0]?.code ?? "INVALID_LAYOUT_TREE");
  const detachedSlots = new Set<string>();
  const collectDetached = (node: LayoutNode, inherited = false): void => {
    const detached = inherited || node.layoutState === "detached";
    if (node.type === "slot") {
      if (detached) detachedSlots.add(node.id);
      return;
    }
    node.children.forEach((child) => collectDetached(child, detached));
  };
  collectDetached(tree.root);
  const frames: Array<{ elementId: ElementId; frame: RectEmu }> = [];
  const unboundSlotIds: string[] = [];
  for (const [slotId, rect] of result.compiled.slots) {
    if (detachedSlots.has(slotId)) continue;
    const elementId = binding.slotBindings[slotId] as ElementId | undefined;
    if (!elementId) {
      unboundSlotIds.push(slotId);
      continue;
    }
    const element = slide.elements.find((candidate) => candidate.id === elementId);
    if (!element || element.locked) continue;
    frames.push({ elementId, frame: layoutRectToEmu(rect, page) });
  }
  return { frames, unboundSlotIds };
}

export function fraction(weight: number): LayoutSize {
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) throw new Error("INVALID_LAYOUT_SIZE");
  return { mode: "fraction", weight };
}
