import type { Patch } from "immer";

/**
 * 撤销历史的一项，带上入栈时算好的体积。
 *
 * 体积只算一次：撤销栈最多 100 项，每次编辑都重新遍历全部 patch 值没有
 * 必要；图片操作还会把同一份 base64 反复估算。
 */
export interface HistoryEntry {
  forward: Patch[];
  inverse: Patch[];
  /** 估算体积，单位是 UTF-16 码元。图片 base64 是 ASCII，数值即字节数。 */
  bytes: number;
}

/** 估算 patch 里大字符串的总长度。图片 base64 是唯一会达到 MB 级的部分。 */
function estimateValueBytes(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateValueBytes(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + estimateValueBytes(item), 0);
  }
  return 0;
}

/**
 * 估算一条 patch 的体积。
 *
 * `add` 和 `replace` 都可能携带图片 base64：新建图片走 `add`，替换背景图
 * 或替换元素走 `replace`。只统计 `add` 会让后者绕过撤销栈的字节预算。
 */
export function estimatePatchBytes(patch: Patch): number {
  if (patch.op === "remove") return 0;
  return estimateValueBytes(patch.value);
}

export function estimatePatchesBytes(patches: readonly Patch[]): number {
  return patches.reduce((sum, patch) => sum + estimatePatchBytes(patch), 0);
}

/** 创建一条撤销记录，同时算出正反两个方向的体积。 */
export function createHistoryEntry(forward: Patch[], inverse: Patch[]): HistoryEntry {
  return {
    forward,
    inverse,
    bytes: estimatePatchesBytes(forward) + estimatePatchesBytes(inverse),
  };
}

/**
 * 把新记录压入栈，并按条数和字节预算裁剪最旧的记录。
 *
 * 最新一项永远保留：预算再小也不能出现“刚做的操作无法撤销”。
 */
export function trimHistory(
  stack: readonly HistoryEntry[],
  entry: HistoryEntry,
  limit: number,
  byteBudget: number,
): HistoryEntry[] {
  let next = [...stack, entry].slice(-limit);
  let total = next.reduce((sum, item) => sum + item.bytes, 0);
  while (total > byteBudget && next.length > 1) {
    total -= next[0]!.bytes;
    next = next.slice(1);
  }
  return next;
}
