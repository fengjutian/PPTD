/**
 * 论证形式的检查。
 *
 * 生成稿最常见的失败不是句子不通，而是每一页都写成同样的几条并列短句：
 * 讲变化的页面没有"前"和"后"，讲对比的页面没有两侧，读者读完只知道
 * "作者认为如此"，不知道凭什么。内容块本来已经能表达这些形式
 * （comparison / timeline / process / metric），问题出在生成端默认用
 * bullet-list 把所有页面压成同一个形状。
 *
 * 检测和提示共用 `assets/content-lexicon.json` 里的同一份词表：提示要求模型
 * 按形式选块，这里在审核页把没做到的地方说出来。两边各写一套规则，规则迟早
 * 会漂移。
 */

import lexicon from "../../../assets/content-lexicon.json";

/** 论证形式。 */
export type ArgumentForm = "change" | "comparison" | "sequence" | "metric" | "list" | "judgment";

/** 一页要用到的证据形状。 */
export interface ArgumentInput {
  title: string;
  /** 已经去掉列表符号的要点，按页面顺序。 */
  items: readonly string[];
  hasComparison: boolean;
  hasTimeline: boolean;
  hasProcess: boolean;
}

/** 一条论证问题。 */
export interface ArgumentIssue {
  kind: "change-as-list" | "no-concrete-evidence";
  severity: "info" | "warning";
  message: string;
}

const CHANGE_FORM = lexicon.argumentRules.forms.find((form) => form.id === "change");
/** 判断"这一页在讲变化"的词，来自共享词表。 */
const CHANGE_MARKERS: readonly string[] = CHANGE_FORM?.markers ?? [];
/** 只有程度、没有事实的词。 */
const VAGUE_INTENSIFIERS: readonly string[] = lexicon.argumentRules.vagueIntensifiers;

/**
 * Whether a point carries something a reader could check.
 *
 * A number, a unit, a per-cent sign, a year, or a quoted source. "近年" is a
 * time word but not a time: it does not let a reader place the claim, so it
 * does not count. The rule is deliberately narrow — a lint that accepts
 * "明显提升" as evidence would bless exactly the copy it exists to catch.
 */
export function hasConcreteEvidence(point: string): boolean {
  return (
    /\d/.test(point) ||
    /[%％]/.test(point) ||
    /《[^》]+》/.test(point) ||
    /(?:19|20)\d{2}\s*年/.test(point) ||
    /(?:亿元|亿|万元|万|倍)/.test(point) ||
    /(?:据|来源|引自|出自)[^，。；]{1,20}/.test(point)
  );
}

/** The markers of the argument form a page is actually written in. */
export function matchChangeMarkers(text: string): string[] {
  return CHANGE_MARKERS.filter((marker) => text.includes(marker));
}

/**
 * The argument problems of a page.
 *
 * Both notes are advisory. The page still exports; what the writer gets is a
 * sentence that names the gap, not a page silently rewritten under them.
 */
export function assessArgument(input: ArgumentInput): ArgumentIssue[] {
  const items = input.items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (items.length < 3) return [];
  const issues: ArgumentIssue[] = [];
  const structured = input.hasComparison || input.hasTimeline || input.hasProcess;
  const hitPages = [input.title, ...items]
    .map((text) => matchChangeMarkers(text))
    .filter((markers) => markers.length > 0);
  // One item that happens to contain "逐步" is a turn of phrase. Two or more
  // (or the title plus one) is the page arguing that something has changed.
  if (!structured && hitPages.length >= 2) {
    const markers = [...new Set(hitPages.flat())].slice(0, 3).join("、");
    issues.push({
      kind: "change-as-list",
      severity: "warning",
      message: `这一页在讲变化（${markers}），却写成了 ${items.length} 条并列要点；改成前后两栏对比或时间线，读者才看得到变化发生在哪里`,
    });
  }
  if (items.every((item) => !hasConcreteEvidence(item))) {
    const vague = items.filter((item) => VAGUE_INTENSIFIERS.some((word) => item.includes(word))).length;
    issues.push({
      kind: "no-concrete-evidence",
      severity: "info",
      message:
        vague > 0
          ? `要点里没有可核对的数字、时间或出处，其中 ${vague} 条只有"明显/逐步"这类程度词；补上数据，或把判断写清楚`
          : "要点里没有可核对的数字、时间或出处；如果手里没有数据，把判断本身写清楚，不要用程度词代替结论",
    });
  }
  return issues;
}
