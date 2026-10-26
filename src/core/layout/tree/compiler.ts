import { layoutRect, type LayoutRect } from "../geometry/coordinate-system";
import { LAYOUT_SPACING } from "../geometry/layout-functions";
import { containsLayoutRect, layoutRectsOverlap } from "../geometry/layout-validator";
import { parseLayoutTreeDraft } from "./schema";
import type {
  CompiledLayoutTree,
  LayoutContainerNode,
  LayoutMeasurement,
  LayoutNode,
  LayoutSize,
  LayoutTreeDraft,
  LayoutTreeIssue,
  MeasurementSnapshot,
} from "./types";

export type CompileLayoutTreeResult =
  | { readonly ok: true; readonly compiled: CompiledLayoutTree }
  | { readonly ok: false; readonly issues: readonly LayoutTreeIssue[] };

interface AxisAllocation {
  readonly offset: number;
  readonly size: number;
}

function resolveContentSize(size: Extract<LayoutSize, { mode: "content" }>, measured: number): number {
  return Math.max(size.min ?? 1, Math.min(size.max ?? 1000, measured));
}

function allocateAxis(
  sizes: readonly LayoutSize[],
  available: number,
  gap: number,
  measurements: readonly (LayoutMeasurement | undefined)[],
  dimension: "width" | "height",
): AxisAllocation[] | undefined {
  const usable = available - gap * Math.max(0, sizes.length - 1);
  if (usable <= 0) return;
  const fixed = sizes.map((size, index) => {
    if (size.mode === "fixed") return size.value;
    if (size.mode === "content") {
      const measurement = measurements[index];
      return measurement ? resolveContentSize(size, measurement[dimension]) : undefined;
    }
    return 0;
  });
  if (fixed.some((value, index) => sizes[index]?.mode === "content" && value === undefined)) return;
  const used = fixed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const remaining = usable - used;
  const weights = sizes.map((size) => (size.mode === "fraction" ? size.weight : size.mode === "fill" ? 1 : 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (remaining < 0 || (weightTotal === 0 && remaining !== 0)) return;
  let remainder = remaining;
  let remainingWeight = weightTotal;
  let cursor = 0;
  return sizes.map((size, index) => {
    let resolved = fixed[index] ?? 0;
    const weight = weights[index] ?? 0;
    if ((size.mode === "fraction" || size.mode === "fill") && remainingWeight > 0) {
      resolved = Math.floor((remainder * weight) / remainingWeight);
      remainder -= resolved;
      remainingWeight -= weight;
    }
    const result = { offset: cursor, size: resolved };
    cursor += resolved + gap;
    return result;
  });
}

function measuredFor(node: LayoutNode, snapshot?: MeasurementSnapshot): LayoutMeasurement | undefined {
  return snapshot?.measurements[node.id];
}

function inset(rect: LayoutRect, token?: LayoutContainerNode["padding"]): LayoutRect | undefined {
  const padding = token ? LAYOUT_SPACING[token] : 0;
  if (rect.width <= padding * 2 || rect.height <= padding * 2) return;
  return layoutRect(rect.x + padding, rect.y + padding, rect.width - padding * 2, rect.height - padding * 2);
}

export function compileLayoutTree(
  input: unknown,
  pageRect: LayoutRect,
  measurementSnapshot?: MeasurementSnapshot,
): CompileLayoutTreeResult {
  const parsed = parseLayoutTreeDraft(input);
  if (!parsed.ok) return parsed;
  const issues: LayoutTreeIssue[] = [];
  const nodeRects = new Map<string, LayoutRect>();
  const slots = new Map<string, LayoutRect>();

  const fail = (code: LayoutTreeIssue["code"], node: LayoutNode, message: string) => {
    issues.push({ code, paths: [node.id], message });
  };

  const place = (node: LayoutNode, rect: LayoutRect): void => {
    nodeRects.set(node.id, rect);
    if (node.type === "slot") {
      slots.set(node.id, rect);
      return;
    }
    if (node.children.length === 0) return;
    const content = inset(rect, node.padding);
    if (!content) {
      fail("INSUFFICIENT_CAPACITY", node, "容器内边距超过可用空间");
      return;
    }
    const gap = node.gap ? LAYOUT_SPACING[node.gap] : 0;
    const measurements = node.children.map((child) => measuredFor(child, measurementSnapshot));
    let childRects: LayoutRect[] = [];

    if (node.type === "row") {
      const main = allocateAxis(node.children.map((child) => child.width), content.width, gap, measurements, "width");
      if (!main) {
        fail(measurements.some((value, index) => node.children[index]?.width.mode === "content" && !value) ? "MEASURE_UNAVAILABLE" : "INSUFFICIENT_CAPACITY", node, "横向容器无法分配子节点宽度");
        return;
      }
      childRects = main.map((value) => layoutRect(content.x + value.offset, content.y, value.size, content.height));
    } else if (node.type === "grid") {
      const columns = node.columns ?? 1;
      const rows = Math.ceil(node.children.length / columns);
      const columnSizes = Array.from({ length: columns }, () => ({ mode: "fill" as const }));
      const rowSizes = Array.from({ length: rows }, () => ({ mode: "fill" as const }));
      const columnAllocations = allocateAxis(columnSizes, content.width, gap, [], "width");
      const rowAllocations = allocateAxis(rowSizes, content.height, gap, [], "height");
      if (!columnAllocations || !rowAllocations) {
        fail("INSUFFICIENT_CAPACITY", node, "网格无法容纳当前行列");
        return;
      }
      childRects = node.children.map((_, index) => {
        const column = columnAllocations[index % columns]!;
        const row = rowAllocations[Math.floor(index / columns)]!;
        return layoutRect(content.x + column.offset, content.y + row.offset, column.size, row.size);
      });
    } else {
      const main = allocateAxis(node.children.map((child) => child.height), content.height, gap, measurements, "height");
      if (!main) {
        fail(measurements.some((value, index) => node.children[index]?.height.mode === "content" && !value) ? "MEASURE_UNAVAILABLE" : "INSUFFICIENT_CAPACITY", node, "纵向容器无法分配子节点高度");
        return;
      }
      childRects = main.map((value) => layoutRect(content.x, content.y + value.offset, content.width, value.size));
    }

    for (let left = 0; left < childRects.length; left += 1) {
      const childRect = childRects[left]!;
      if (!containsLayoutRect(content, childRect)) fail("OUT_OF_BOUNDS", node.children[left]!, "子节点超出容器");
      for (let right = left + 1; right < childRects.length; right += 1) {
        if (layoutRectsOverlap(childRect, childRects[right]!)) {
          issues.push({ code: "OVERLAP", paths: [node.children[left]!.id, node.children[right]!.id], message: "布局子节点发生重叠" });
        }
      }
      place(node.children[left]!, childRect);
    }
  };

  place(parsed.tree.root, pageRect);
  if (issues.length > 0) return { ok: false, issues };
  const compiled: CompiledLayoutTree = { normalized: parsed.tree, slots, nodeRects, issues: [] };
  return { ok: true, compiled };
}

export function isLayoutTreeDraft(value: unknown): value is LayoutTreeDraft {
  return parseLayoutTreeDraft(value).ok;
}

