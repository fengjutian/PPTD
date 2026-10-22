import { describe, expect, it } from "vitest";
import { createHistoryEntry, estimatePatchBytes, trimHistory, type HistoryEntry } from "./history-budget";

const entry = (bytes: number): HistoryEntry => ({ forward: [], inverse: [], bytes });

describe("撤销栈体积核算", () => {
  it("把 add 和 replace 里的大字符串都算进去", () => {
    const payload = "A".repeat(1024);
    expect(estimatePatchBytes({ op: "add", path: ["a"], value: payload })).toBe(1024);
    // 替换背景图走 replace；漏掉它会让字节预算失效。
    expect(estimatePatchBytes({ op: "replace", path: ["a"], value: payload })).toBe(1024);
    expect(estimatePatchBytes({ op: "remove", path: ["a"] })).toBe(0);
  });

  it("同时统计正反两个方向的体积", () => {
    const created = createHistoryEntry(
      [{ op: "add", path: ["a"], value: "12345" }],
      [{ op: "replace", path: ["a"], value: "123" }],
    );
    expect(created.bytes).toBe(8);
  });

  it("按条数保留最新的记录", () => {
    expect(trimHistory([entry(1), entry(1)], entry(1), 2, 100).map((item) => item.bytes)).toEqual([1, 1]);
  });

  it("超出字节预算时从最旧的记录开始丢弃", () => {
    const trimmed = trimHistory([entry(10), entry(20)], entry(30), 100, 55);
    expect(trimmed.map((item) => item.bytes)).toEqual([20, 30]);
  });

  it("即使最新一项自己就超预算也保留它", () => {
    const trimmed = trimHistory([entry(10)], entry(999), 100, 50);
    expect(trimmed.map((item) => item.bytes)).toEqual([999]);
  });
});
