import { afterEach, describe, expect, it } from "vitest";
import { isFontInstalled } from "./font-availability";

/**
 * 画布替身：按字体串里的候选字体族名决定渲染宽度，
 * 命中候选字体时三种兜底渲染一致（宽度相同），未命中时各自兜底宽度不同。
 */
function stubCanvas(available: Record<string, boolean>): void {
  const widths: Record<string, number> = { monospace: 10, "sans-serif": 20, serif: 30 };
  const context = {
    font: "",
    measureText(text: string) {
      const candidate = /"([^"]+)"/.exec(context.font)?.[1] ?? "";
      const fallback = /,\s*([a-z-]+)$/.exec(context.font)?.[1] ?? "monospace";
      const hit = candidate !== "" && available[candidate] === true;
      const base = hit ? 100 : (widths[fallback] ?? 10);
      return { width: base * text.length };
    },
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ getContext: () => context }),
  };
}

describe("系统字体安装探测", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("候选字体命中时三种兜底渲染一致，判定为已安装", () => {
    stubCanvas({ "Source Han Serif SC": true });
    expect(isFontInstalled("Source Han Serif SC")).toBe(true);
  });

  it("候选字体未命中时落到不同兜底，判定为未安装", () => {
    stubCanvas({ "Source Han Serif SC": true });
    expect(isFontInstalled("No Such Font")).toBe(false);
  });

  it("没有 document 时返回 true，避免误报为未安装", () => {
    expect(isFontInstalled("Source Han Serif SC")).toBe(true);
  });
});
