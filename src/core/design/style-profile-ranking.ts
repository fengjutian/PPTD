import type { ThemeContentSignals } from "./theme-preset-ranking";
import { STYLE_PROFILES, type StyleProfileId } from "./style-profiles";

export interface StyleProfileChoice {
  profileId: StyleProfileId;
  score: number;
  reason: string;
}

const STYLE_SUBJECT_RULES: readonly { ids: readonly StyleProfileId[]; pattern: RegExp; label: string }[] = [
  { ids: ["government"], pattern: /政务|党建|政府|政策|公共事务/, label: "政务与公共表达" },
  { ids: ["industrial"], pattern: /制造|工业|工程|供应链|物流|机械|建筑/, label: "工程与制造" },
  { ids: ["academic"], pattern: /论文|答辩|科研|研究|文献|课题/, label: "学术研究" },
  { ids: ["hand-drawn"], pattern: /儿童|启蒙|科普|课堂|教学|课程/, label: "教学讲解" },
  { ids: ["futuristic", "glassmorphism", "3d-visual"], pattern: /AI|人工智能|科技|数字化|SaaS|互联网|软件|产品发布/i, label: "科技产品" },
  { ids: ["corporate", "infographic"], pattern: /经营|战略|咨询|汇报|年报|财务|投资|融资|数据/, label: "经营与数据" },
  { ids: ["editorial", "keynote"], pattern: /品牌|营销|发布|人物|故事|洞察|创意/, label: "品牌叙事" },
  { ids: ["zen", "luxury", "editorial"], pattern: /文化|文学|诗词|艺术|展览|生活方式/, label: "文化与审美" },
];

/** Stable recommendation: reviewed content chooses a style, never edits it. */
export function rankStyleProfiles(
  signals: ThemeContentSignals,
  preferredThemePresetId?: string,
): StyleProfileChoice[] {
  const text = `${signals.title} ${signals.bodyText ?? ""}`.slice(0, 2400);
  const structured = (signals.chartCount ?? 0) + (signals.tableCount ?? 0) + (signals.metricCount ?? 0);
  const pages = Math.max(1, signals.slideCount ?? 1);
  const averageCopy = (signals.bodyText?.length ?? 0) / pages;

  return STYLE_PROFILES.map((profile, index) => {
    let score = profile.themePresetId === preferredThemePresetId ? 50 : 0;
    const subject = STYLE_SUBJECT_RULES.find((rule) => rule.ids.includes(profile.id) && rule.pattern.test(text));
    if (subject) score += 24 - subject.ids.indexOf(profile.id) * 3;
    if (structured >= 3 && profile.density === "compact") score += 10;
    else if (structured > 0 && profile.preferredConcept === "instrument") score += 6;
    if (averageCopy > 140 && profile.density === "compact") score += 5;
    if (averageCopy > 0 && averageCopy < 60 && profile.density === "airy") score += 5;
    if ((signals.imageSlotCount ?? 0) >= 2 && profile.allowedConcepts.includes("documentary")) score += 5;

    const reasons: string[] = [];
    if (subject) reasons.push(`内容属于「${subject.label}」`);
    if (profile.themePresetId === preferredThemePresetId) reasons.push("与推荐主题的字体和色板一致");
    if (structured >= 3 && profile.density === "compact") reasons.push(`有 ${structured} 处数据内容，适合紧凑信息层级`);
    else if ((signals.imageSlotCount ?? 0) >= 2 && profile.allowedConcepts.includes("documentary")) {
      reasons.push("配图页较多，适合图像主导构图");
    } else if (averageCopy > 0 && averageCopy < 60 && profile.density === "airy") {
      reasons.push("页面文字较少，适合留白型表达");
    }
    if (reasons.length === 0) reasons.push("按主题适配和通用可读性匹配");
    return { profileId: profile.id, score, reason: reasons.join("；"), index };
  })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ profileId, score, reason }) => ({ profileId, score, reason }));
}
