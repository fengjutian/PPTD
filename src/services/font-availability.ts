/**
 * 系统字体安装探测。
 *
 * `document.fonts.check()` 只认识通过 @font-face 声明的字体，对普通系统字体
 * 恒返回 true，无法区分「本机已安装」和「不存在」。
 *
 * 这里改用画布测宽：把候选字体分别挂在 monospace / sans-serif / serif 三个
 * 兜底后面渲染同一段字符。候选字体存在时三次渲染都是该字体，宽度一致；
 * 不存在时落到三个不同兜底，宽度通常不同。测试字符只含拉丁字母、数字和
 * 常见符号，中日韩字体也覆盖这些字形，不会出现逐字回退造成的误判。
 */

const PROBE_TEXT = "mmmMWil@0123";
const PROBE_SIZE = "72px";
const FALLBACKS = ["monospace", "sans-serif", "serif"] as const;

function getContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas").getContext("2d");
}

function measureWidth(font: string): number | undefined {
  const context = getContext();
  if (!context) return undefined;
  context.font = font;
  return context.measureText(PROBE_TEXT).width;
}

/** 字体族名未安装时返回 false；无法测量（如非浏览器环境）时返回 true，避免误报。 */
export function isFontInstalled(fontFamily: string): boolean {
  const quoted = `"${fontFamily.replace(/"/g, '\\"')}"`;
  const widths = FALLBACKS.map((fallback) => measureWidth(`${PROBE_SIZE} ${quoted}, ${fallback}`));
  if (widths.some((width) => width === undefined)) return true;
  return widths[0] === widths[1] && widths[1] === widths[2];
}
