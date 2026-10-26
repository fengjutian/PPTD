import { LAYOUT_CAPABILITIES, LAYOUT_REGISTRY_VERSION } from "./registry";
import type {
  LayoutContainerNode,
  LayoutNode,
  LayoutNodeType,
  LayoutSize,
  LayoutSlotNode,
  LayoutTreeDraft,
  LayoutTreeIssue,
} from "./types";

export const MAX_LAYOUT_TREE_DEPTH = 8;
export const MAX_LAYOUT_TREE_NODES = 100;

const spacingTokens = ["xs", "sm", "md", "lg", "xl"] as const;
const layoutStates = ["managed", "detached", "overlay"] as const;
const nodeTypes = ["canvas", "section", "row", "column", "grid", "slot"] as const;
const slotRoles = ["title", "body", "image", "chart", "table", "metric", "decoration"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ||
      /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
  );
}

function parseSize(value: unknown): LayoutSize | undefined {
  if (!isRecord(value) || typeof value.mode !== "string") return;
  if (value.mode === "fill") return { mode: "fill" };
  if (value.mode === "fixed" && Number.isInteger(value.value) && (value.value as number) > 0) {
    return { mode: "fixed", value: value.value as number };
  }
  if (value.mode === "fraction" && Number.isInteger(value.weight) && (value.weight as number) > 0) {
    return { mode: "fraction", weight: value.weight as number };
  }
  if (value.mode === "content") {
    const min = value.min;
    const max = value.max;
    if (min !== undefined && (!Number.isInteger(min) || (min as number) < 0)) return;
    if (max !== undefined && (!Number.isInteger(max) || (max as number) < 1)) return;
    if (typeof min === "number" && typeof max === "number" && min > max) return;
    return { mode: "content", ...(typeof min === "number" ? { min } : {}), ...(typeof max === "number" ? { max } : {}) };
  }
  return;
}

function issue(path: string, message: string, code: LayoutTreeIssue["code"] = "INVALID_LAYOUT_TREE"): LayoutTreeIssue {
  return { code, paths: [path], message };
}

export type ParseLayoutTreeResult =
  | { readonly ok: true; readonly tree: LayoutTreeDraft }
  | { readonly ok: false; readonly issues: readonly LayoutTreeIssue[] };

export function parseLayoutTreeDraft(value: unknown): ParseLayoutTreeResult {
  if (!isRecord(value) || value.coordinateSpace !== "normalized-1000" || value.registryVersion !== LAYOUT_REGISTRY_VERSION) {
    return { ok: false, issues: [issue("root", "布局树协议或注册表版本无效")] };
  }
  const seen = new Set<string>();
  let count = 0;

  const parseNode = (candidate: unknown, path: string, parent?: LayoutNodeType, depth = 0): LayoutNode | LayoutTreeIssue => {
    if (!isRecord(candidate)) return issue(path, "布局节点必须是对象");
    if (depth > MAX_LAYOUT_TREE_DEPTH) return issue(path, "布局树超过最大深度");
    count += 1;
    if (count > MAX_LAYOUT_TREE_NODES) return issue(path, "布局树超过最大节点数");
    if (!nodeTypes.includes(candidate.type as LayoutNodeType)) return issue(path, "布局节点类型未注册", "UNSUPPORTED_NODE_TYPE");
    const type = candidate.type as LayoutNodeType;
    if (!isStableId(candidate.id)) return issue(`${path}.id`, "布局节点必须使用稳定 UUID/ULID");
    if (seen.has(candidate.id)) return issue(`${path}.id`, "布局节点 ID 重复", "INVALID_NODE_REFERENCE");
    seen.add(candidate.id);
    if (!layoutStates.includes(candidate.layoutState as (typeof layoutStates)[number])) return issue(`${path}.layoutState`, "布局状态无效");
    const width = parseSize(candidate.width);
    const height = parseSize(candidate.height);
    if (!width || !height) return issue(path, "布局节点尺寸策略无效");
    const capability = LAYOUT_CAPABILITIES[type];
    if (parent && !capability.allowedParents.includes(parent)) return issue(path, `${type} 不能放入 ${parent}`);
    const base = { id: candidate.id, width, height, layoutState: candidate.layoutState as LayoutNode["layoutState"] };

    if (type === "slot") {
      if (!slotRoles.includes(candidate.role as (typeof slotRoles)[number])) return issue(`${path}.role`, "槽位角色无效");
      if (candidate.contentRef !== undefined && typeof candidate.contentRef !== "string") return issue(`${path}.contentRef`, "内容引用无效");
      if (candidate.fit !== undefined && !["contain", "cover", "stretch"].includes(candidate.fit as string)) return issue(`${path}.fit`, "适配策略无效");
      const slot: LayoutSlotNode = {
        ...base,
        type,
        role: candidate.role as LayoutSlotNode["role"],
        ...(typeof candidate.contentRef === "string" ? { contentRef: candidate.contentRef } : {}),
        ...(typeof candidate.fit === "string" ? { fit: candidate.fit as LayoutSlotNode["fit"] } : {}),
      };
      return slot;
    }

    if (!Array.isArray(candidate.children)) return issue(`${path}.children`, "容器必须提供子节点数组");
    if (candidate.gap !== undefined && !spacingTokens.includes(candidate.gap as (typeof spacingTokens)[number])) return issue(`${path}.gap`, "间距令牌无效");
    if (candidate.padding !== undefined && !spacingTokens.includes(candidate.padding as (typeof spacingTokens)[number])) return issue(`${path}.padding`, "内边距令牌无效");
    if (type === "grid" && (!Number.isInteger(candidate.columns) || (candidate.columns as number) < 1 || (candidate.columns as number) > 12)) {
      return issue(`${path}.columns`, "网格列数必须在 1 到 12 之间");
    }
    const children: LayoutNode[] = [];
    for (let index = 0; index < candidate.children.length; index += 1) {
      const child = parseNode(candidate.children[index], `${path}.children[${index}]`, type, depth + 1);
      if ("code" in child) return child;
      children.push(child);
    }
    const container: LayoutContainerNode = {
      ...base,
      type,
      children,
      ...(typeof candidate.gap === "string" ? { gap: candidate.gap as LayoutContainerNode["gap"] } : {}),
      ...(typeof candidate.padding === "string" ? { padding: candidate.padding as LayoutContainerNode["padding"] } : {}),
      ...(type === "grid" ? { columns: candidate.columns as number } : {}),
    };
    return container;
  };

  const root = parseNode(value.root, "root");
  if ("code" in root) return { ok: false, issues: [root] };
  if (root.type !== "canvas") return { ok: false, issues: [issue("root.type", "布局树根节点必须是 canvas")] };
  const canvasRoot: LayoutContainerNode & { readonly type: "canvas" } = { ...root, type: "canvas" };
  return {
    ok: true,
    tree: { coordinateSpace: "normalized-1000", registryVersion: LAYOUT_REGISTRY_VERSION, root: canvasRoot },
  };
}

