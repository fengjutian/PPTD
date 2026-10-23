/**
 * The built-in icon set.
 *
 * Icons are line drawings on a 24×24 grid, stroked with the accent colour of
 * the page. They are deliberately few and generic: a page may replace a
 * numbered badge with an icon only when the copy names something one of these
 * drawings can say honestly. The list is part of the document model, so an
 * icon that is saved today keeps its shape after a reload.
 */
export type BuiltinIconName =
  "book" | "mountain" | "water" | "sun" | "moon" | "target" | "chart" | "users" | "bulb" | "flag" | "heart" | "leaf";

export interface IconDefinition {
  /** Stroked sub-paths on a 24×24 grid. */
  paths: readonly string[];
  circles?: readonly { cx: number; cy: number; r: number }[];
}

export const BUILTIN_ICONS: Record<BuiltinIconName, IconDefinition> = {
  book: {
    paths: ["M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z", "M4 20.5V5.5", "M8 7h8", "M8 11h6"],
  },
  mountain: { paths: ["M3 19l6-10 4 6 3-4 5 8z"] },
  water: {
    paths: ["M3 11c2-2 4-2 6 0s4 2 6 0 4-2 6 0", "M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0"],
  },
  sun: {
    paths: [
      "M12 2v2",
      "M12 20v2",
      "M2 12h2",
      "M20 12h2",
      "M4.9 4.9l1.4 1.4",
      "M17.7 17.7l1.4 1.4",
      "M19.1 4.9l-1.4 1.4",
      "M6.3 17.7l-1.4 1.4",
    ],
    circles: [{ cx: 12, cy: 12, r: 4 }],
  },
  moon: { paths: ["M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"] },
  target: {
    paths: ["M12 12h.01"],
    circles: [
      { cx: 12, cy: 12, r: 8 },
      { cx: 12, cy: 12, r: 4 },
    ],
  },
  chart: { paths: ["M4 20h16", "M7 20v-6", "M12 20V8", "M17 20v-9"] },
  users: {
    paths: ["M3 20a6 6 0 0 1 12 0", "M16 6a3 3 0 0 1 0 6", "M17 20a5 5 0 0 0-3-4.6"],
    circles: [{ cx: 9, cy: 8, r: 3 }],
  },
  bulb: {
    paths: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2.1h5.2c0-.9.3-1.6.9-2.1A6 6 0 0 0 12 3z"],
  },
  flag: { paths: ["M5 21V4", "M5 4h11l-1.5 3L16 10H5"] },
  heart: { paths: ["M12 20s-7-4.3-7-9a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 4.7-7 9-7 9z"] },
  leaf: { paths: ["M5 19C5 10 12 4 20 4c0 8-6 15-15 15z", "M5 19c2-4 5-7 9-9"] },
};

/** The SVG document of an icon, sized by the caller through the frame. */
export function iconSvgMarkup(name: BuiltinIconName, color: string, strokeWidth = 2): string {
  const definition = BUILTIN_ICONS[name];
  const circles = (definition.circles ?? [])
    .map((circle) => `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}"/>`)
    .join("");
  const paths = definition.paths.map((path) => `<path d="${path}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${circles}${paths}</svg>`
  );
}

/**
 * The icon a piece of copy suggests, if any.
 *
 * Only explicit nouns match. A blanket match on single characters ("人" inside
 * "知人论世") would put a team icon on a page about reading a text, which is
 * worse than keeping the number.
 */
export function iconForText(text: string): BuiltinIconName | undefined {
  const rules: Array<{ icon: BuiltinIconName; pattern: RegExp }> = [
    { icon: "target", pattern: /目标|定位|战略|愿景/ },
    { icon: "chart", pattern: /数据|增长|指标|统计|营收|利润/ },
    { icon: "users", pattern: /团队|用户|读者|受众|人群|组织/ },
    { icon: "book", pattern: /文本|阅读|文献|典籍|书目|书籍/ },
    { icon: "bulb", pattern: /启示|思路|创意|想法|方法/ },
    { icon: "flag", pattern: /里程碑|阶段|进程|规划/ },
    { icon: "heart", pattern: /情感|情怀|心声/ },
    { icon: "mountain", pattern: /山|峰|岳/ },
    { icon: "water", pattern: /湖|江|河|海|水/ },
    { icon: "sun", pattern: /阳光|日光|朝阳/ },
    { icon: "moon", pattern: /月夜|月光|夜晚/ },
    { icon: "leaf", pattern: /自然|生态|草木|叶/ },
  ];
  return rules.find((rule) => rule.pattern.test(text))?.icon;
}
