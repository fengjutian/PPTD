/**
 * 日志时间的显示格式。
 *
 * 单独放在一个文件里：组件文件只导出组件，Fast Refresh 才不会因为多一个
 * 非组件导出而整页重载。时间解析不了就原样返回，不吞掉原始值。
 */
export function formatLogTime(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}
