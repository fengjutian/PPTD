/**
 * 标题质量规则。
 *
 * AI 写的标题有两个稳定的失败模式：
 *
 * 1. **模板化**：标题变成栏目的名字（"现状""背景与挑战""目标分析"），
 *    或者变成一个空泛的壳（"如何提升效率""数字化转型的意义"）。
 *    这种标题不携带任何结论，看起来像大纲被抄了下来。
 * 2. **句式雷同**：每一页都用同一个句法骨架（"A与B""A、B与C"），
 *    逐页读下来像同一句话换了词，整册因此显得廉价。
 *
 * 词表本身是一份共享资产（`assets/content-lexicon.json`），前端据此检测，
 * 后端据此写生成提示。两边读同一份文件，规则才不会各写一套然后慢慢漂移。
 */

import lexicon from "../../../assets/content-lexicon.json";

/** 词表里的栏目名：它们是表格的列头，不是结论。 */
const COLUMN_NAMES: readonly string[] = lexicon.titleRules.columnNames;
/** 跟在栏目名后面的后缀："现状分析"仍然是栏目名。 */
const COLUMN_SUFFIXES: readonly string[] = lexicon.titleRules.columnSuffixes;
/** 疑问式开头：标题要下判断，不能提问。 */
const BANNED_LEAD_PHRASES: readonly string[] = lexicon.titleRules.bannedLeadPhrases;
/** 空泛的结尾："…的意义"没有告诉读者任何事。 */
const EMPTY_TAIL_PHRASES: readonly string[] = lexicon.titleRules.emptyTailPhrases;
/** 连接词：标题被它们切成几段，段数与连接词一起构成句式指纹。 */
const CONNECTORS: readonly string[] = lexicon.titleRules.connectors;
/** 多页标题共用同一句式时，页数达到这个值就提示。 */
const REPEATED_PATTERN_THRESHOLD: number = lexicon.titleRules.repeatedPatternThreshold;

/** 标题的问题分类。 */
export type TitleIssueKind =
  | "column-name"
  | "column-composition"
  | "question-lead"
  | "empty-tail";

/** 一条标题问题的中文说明，用于审核界面。 */
const ISSUE_LABELS: Record<TitleIssueKind, string> = {
  "column-name": "标题是栏目名",
  "column-composition": "标题由栏目名拼成",
  "question-lead": "标题是疑问句",
  "empty-tail": "标题结尾空泛",
};

/** 一个标题的判定结果。 */
export interface TitleAnalysis {
  /** 标题原文。 */
  title: string;
  /** 命中的问题，空数组表示标题没有模板化问题。 */
  issues: TitleIssueKind[];
  /** 命中的问题说明。 */
  labels: string[];
  /**
   * 句式指纹。
   *
   * 只有被连接词切成多段的标题才有指纹：单段标题之间没有可比的结构，
   * 拿它们互相比较只会得到"都是一句话"这种没有意义的结论。
   */
  skeleton?: string;
}

/** 连接词按长度降序排列，"以及"必须先于"及"被切开。 */
const SORTED_CONNECTORS: readonly string[] = [...CONNECTORS].sort((left, right) => right.length - left.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONNECTOR_PATTERN = new RegExp(`(${SORTED_CONNECTORS.map(escapeRegExp).join("|")})`, "g");

/**
 * 把标题按连接词切开。
 *
 * 返回两段结果：内容段和用到的连接词。段与段的顺序保持原样，
 * 因为 "A、B与C" 和 "A与B、C" 是不同的句式。
 */
function splitByConnectors(title: string): { segments: string[]; connectors: string[] } {
  const segments: string[] = [];
  const connectors: string[] = [];
  for (const part of title.split(CONNECTOR_PATTERN)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (SORTED_CONNECTORS.includes(trimmed)) connectors.push(trimmed);
    else segments.push(trimmed);
  }
  return { segments, connectors };
}

/**
 * 去掉标题两端的空白和句末标点。
 *
 * 标点先规范化：半角逗号夹在中文中间时，它不是连接词，是模型没写完的活儿。
 * 不规范化就直接拿它切段，会把几页本来结构不同的标题判成"共用同一句法骨架"。
 */
function normalize(title: string): string {
  return normalizeChinesePunctuation(title.trim()).replace(/[。.!！?？；;]+$/u, "");
}

/** 标题是不是某个栏目名，或者"栏目名 + 后缀"。 */
function isColumnName(title: string): boolean {
  if (COLUMN_NAMES.includes(title)) return true;
  return COLUMN_SUFFIXES.some((suffix) => title.endsWith(suffix) && COLUMN_NAMES.includes(title.slice(0, -suffix.length)));
}

/**
 * 判定一个标题。
 *
 * 规则按"离结论的距离"排序：栏目名最致命，其次是用栏目名拼出来的
 * 组合，再是疑问句和空泛结尾。
 */
export function analyzeTitle(title: string): TitleAnalysis {
  const normalized = normalize(title);
  const issues: TitleIssueKind[] = [];
  const { segments, connectors } = splitByConnectors(normalized);

  if (isColumnName(normalized)) {
    issues.push("column-name");
  } else if (segments.length >= 2 && segments.every((segment) => COLUMN_NAMES.includes(segment))) {
    // "现状与挑战""背景、现状与对策"：每一段都是栏目名，整句是目录不是结论。
    issues.push("column-composition");
  }
  if (BANNED_LEAD_PHRASES.some((phrase) => normalized.startsWith(phrase))) {
    issues.push("question-lead");
  }
  if (EMPTY_TAIL_PHRASES.some((phrase) => normalized.endsWith(phrase))) {
    issues.push("empty-tail");
  }
  return {
    title,
    issues,
    labels: issues.map((issue) => ISSUE_LABELS[issue]),
    skeleton: connectors.length > 0 ? `${segments.length}|${connectors.join("+")}` : undefined,
  };
}

/** 一组标题共用同一个句式骨架。 */
export interface RepeatedTitlePattern {
  /** 句式指纹。 */
  skeleton: string;
  /** 使用这个句式的页面索引，按页序。 */
  indexes: number[];
}

/**
 * 找出多页共用同一个句式骨架的标题。
 *
 * 指纹只记录段数和连接词，不记录内容：这样 "现状与挑战" 和 "机遇与风险"
 * 会被认成同一种句式，正是要提示的那种重复。
 */
export function findRepeatedTitlePatterns(titles: readonly string[]): RepeatedTitlePattern[] {
  const groups = new Map<string, number[]>();
  titles.forEach((title, index) => {
    const skeleton = analyzeTitle(title).skeleton;
    if (!skeleton) return;
    groups.set(skeleton, [...(groups.get(skeleton) ?? []), index]);
  });
  return [...groups.entries()]
    .filter(([, indexes]) => indexes.length >= REPEATED_PATTERN_THRESHOLD)
    .map(([skeleton, indexes]) => ({ skeleton, indexes }));
}

/** 把句式指纹翻成人能读的说明。 */
export function describeTitleSkeleton(skeleton: string): string {
  const [count, connectors] = skeleton.split("|");
  const parts = count ? Number(count) : 0;
  const names = (connectors ?? "").split("+").filter(Boolean);
  if (names.length === 0) return `${parts} 段`;
  return `${parts} 段，用「${names.join("」「")}」连接`;
}
