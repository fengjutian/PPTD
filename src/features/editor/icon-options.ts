import { BUILTIN_ICONS, type BuiltinIconName } from "../../core/document-model";

export const ICON_NAMES = Object.keys(BUILTIN_ICONS) as BuiltinIconName[];

/** Chinese names of the icon set, shared by the picker, inspector and layer list. */
export const ICON_LABELS: Record<BuiltinIconName, string> = {
  book: "书",
  mountain: "山",
  water: "水",
  sun: "日",
  moon: "月",
  target: "目标",
  chart: "数据",
  users: "团队",
  bulb: "启发",
  flag: "里程碑",
  heart: "情感",
  leaf: "自然",
};
