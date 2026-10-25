import { DEFAULT_THEME_PRESET_ID, findThemePreset } from "./theme-presets";

/**
 * One recognizable subject family and the preset that owns it.
 *
 * The table is exported because the recommendation is not only "which preset
 * comes first" anymore: the batch picker scores every family and has to explain
 * itself ("题材匹配「财务与投资」"). Two copies of the regex list would drift, so
 * inference and ranking read the same rows.
 */
export interface ThemePresetRule {
  presetId: string;
  pattern: RegExp;
  /** What the rule recognizes, in the words the picker shows to the user. */
  label: string;
}

/**
 * Order is the product decision: the first match wins, so the more specific
 * families sit above the broader ones (a "论文答辩" is academic, not teaching).
 */
export const THEME_PRESET_RULES: readonly ThemePresetRule[] = [
  { presetId: "blue-white-porcelain", pattern: /青花|瓷器|陶瓷|瓷文化|博物馆|文物/, label: "传统文化与器物" },
  { presetId: "academic-indigo", pattern: /学术|论文|答辩|课题|科研|文献|学报/, label: "学术与研究" },
  { presetId: "paper-ink", pattern: /教学|课件|语文|文学|古文|诗词|教材|课堂|阅读|写作/, label: "课程与教学" },
  {
    presetId: "consulting-navy",
    pattern: /汇报|方案|尽调|战略|咨询|调研|路演|report|proposal|strategy/,
    label: "经营汇报与提案",
  },
  { presetId: "finance-gold", pattern: /金融|投资|年报|财务|融资|基金|银行/, label: "财务与投资" },
  { presetId: "medical-teal", pattern: /医疗|健康|科普|医院|医生|药品/, label: "医疗与健康" },
  { presetId: "gov-red", pattern: /政务|党建|政府|公共事务|政策/, label: "公共事务" },
  { presetId: "legal-burgundy", pattern: /法律|法务|合规|审计|风控|律师|法规|诉讼/, label: "法律与合规" },
  { presetId: "tech-blue", pattern: /科技|产品|技术|互联网|人工智能|ai|发布会/, label: "科技与产品" },
  { presetId: "fashion-rose", pattern: /时尚|美妆|服饰|彩妆|护肤|时装|穿搭/, label: "时尚与消费" },
  { presetId: "creative-orange", pattern: /创意|品牌|活动|提案|营销/, label: "创意与营销" },
  { presetId: "education-green", pattern: /教育|培训|校园|课程|学习/, label: "教育与培训" },
  { presetId: "industrial-steel", pattern: /制造|工业|汽车|工程|供应链|物流|产线|机械/, label: "制造与供应链" },
  { presetId: "architecture-stone", pattern: /建筑|地产|室内|景观|城市更新|空间设计/, label: "建筑与空间" },
  { presetId: "minimal-gray", pattern: /极简|作品集|画册|摄影集|艺术展|美术馆/, label: "作品与展览" },
  { presetId: "warm-paper", pattern: /讲座|展陈|展览|叙事|故事|旅行|人文|沙龙/, label: "人文叙事" },
];

/**
 * The preset a topic suggests when the user did not name one.
 *
 * This is a heuristic, not a design decision: it only covers the cases where
 * the subject clearly belongs to one visual family, and otherwise leaves the
 * default preset alone. A template always wins over this hint.
 */
export function inferThemePresetId(topic: string): string {
  const text = topic.toLowerCase();
  return THEME_PRESET_RULES.find((rule) => rule.pattern.test(text))?.presetId ?? DEFAULT_THEME_PRESET_ID;
}

/** Whether an id names a preset that actually exists. */
export function isKnownThemePreset(id: string): boolean {
  return findThemePreset(id) !== undefined;
}
