import { DEFAULT_THEME_PRESET_ID, findThemePreset } from "./theme-presets";

/**
 * The preset a topic suggests when the user did not name one.
 *
 * This is a heuristic, not a design decision: it only covers the cases where
 * the subject clearly belongs to one visual family, and otherwise leaves the
 * default preset alone. A template always wins over this hint.
 */
export function inferThemePresetId(topic: string): string {
  const text = topic.toLowerCase();
  if (/教学|课件|语文|文学|古文|诗词|教材|课堂|语文课/.test(text)) return "paper-ink";
  if (/汇报|方案|尽调|战略|咨询|调研|路演|report|proposal|strategy/.test(text)) return "consulting-navy";
  if (/讲座|展陈|展览|叙事|故事|旅行|人文|沙龙/.test(text)) return "warm-paper";
  return DEFAULT_THEME_PRESET_ID;
}

/** Whether an id names a preset that actually exists. */
export function isKnownThemePreset(id: string): boolean {
  return findThemePreset(id) !== undefined;
}
