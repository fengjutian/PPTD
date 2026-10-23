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
  if (/青花|瓷器|陶瓷|瓷文化|博物馆|文物/.test(text)) return "blue-white-porcelain";
  if (/教学|课件|语文|文学|古文|诗词|教材|课堂|阅读|写作/.test(text)) return "paper-ink";
  if (/汇报|方案|尽调|战略|咨询|调研|路演|report|proposal|strategy/.test(text)) return "consulting-navy";
  if (/金融|投资|年报|财务|融资|基金|银行/.test(text)) return "finance-gold";
  if (/医疗|健康|科普|医院|医生|药品/.test(text)) return "medical-teal";
  if (/政务|党建|政府|公共事务|政策/.test(text)) return "gov-red";
  if (/科技|产品|技术|互联网|人工智能|ai|发布会/.test(text)) return "tech-blue";
  if (/创意|品牌|活动|提案|营销/.test(text)) return "creative-orange";
  if (/教育|培训|校园|课程|学习/.test(text)) return "education-green";
  if (/讲座|展陈|展览|叙事|故事|旅行|人文|沙龙/.test(text)) return "warm-paper";
  return DEFAULT_THEME_PRESET_ID;
}

/** Whether an id names a preset that actually exists. */
export function isKnownThemePreset(id: string): boolean {
  return findThemePreset(id) !== undefined;
}
