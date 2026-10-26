import type { TextElementStyle, TextRun } from "./types";

/**
 * Styled fragments of a text element.
 *
 * A run addresses a range of the text of the element instead of carrying its
 * own copy of the words. The copy therefore stays in the content and in one
 * place, and the exported fragment can never show characters the content does
 * not carry.
 */

/** The presentation of a fragment. An absent property inherits from the element. */
export interface TextRunStyle {
  bold?: boolean;
  color?: string;
  underline?: boolean;
  hyperlinkUrl?: string;
}

const TEXT_HYPERLINK_MAX_LENGTH = 2048;
const TEXT_HYPERLINK_PATTERN = /^(?:https?:\/\/[^\s\x00-\x1f]+|mailto:[^\s\x00-\x1f]+)$/i;

/**
 * The command and the editor share one URL rule. Keeping the check next to the
 * run model prevents the UI from accepting a destination the document rejects.
 */
export function isSafeTextHyperlinkUrl(url: string): boolean {
  return url.length <= TEXT_HYPERLINK_MAX_LENGTH && TEXT_HYPERLINK_PATTERN.test(url);
}

export interface TextFragment {
  text: string;
  style: TextRunStyle;
  /** Offset of the first character of the fragment in the text of the element. */
  start: number;
  /** Offset behind the last character of the fragment. */
  end: number;
}

function sameStyle(left: TextRunStyle | null, right: TextRunStyle | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.bold === right.bold &&
    left.color === right.color &&
    left.underline === right.underline &&
    left.hyperlinkUrl === right.hyperlinkUrl
  );
}

function styleOf(run: TextRun): TextRunStyle {
  const style: TextRunStyle = {};
  if (run.bold !== undefined) style.bold = run.bold;
  if (run.color !== undefined) style.color = run.color;
  if (run.underline !== undefined) style.underline = run.underline;
  if (run.hyperlinkUrl !== undefined) style.hyperlinkUrl = run.hyperlinkUrl;
  return style;
}

/** Merges the runs that touch each other and carry the same style. */
export function mergeTextRuns(runs: TextRun[]): TextRun[] {
  const sorted = [...runs].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TextRun[] = [];
  for (const run of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.end === run.start && sameStyle(styleOf(last), styleOf(run))) {
      last.end = run.end;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

/** Drops the runs that overlap the range, keeping the parts that stick out. */
export function subtractTextRange(runs: TextRun[] | undefined, start: number, end: number): TextRun[] {
  const kept: TextRun[] = [];
  for (const run of runs ?? []) {
    if (run.end <= start || run.start >= end) {
      kept.push({ ...run });
      continue;
    }
    if (run.start < start) kept.push({ ...run, end: start });
    if (run.end > end) kept.push({ ...run, start: end });
  }
  return kept;
}

/**
 * Applies a style to a range of the text. The runs that covered the range are
 * replaced by the new one, so the range ends up with exactly this style.
 */
export function applyTextRun(runs: TextRun[] | undefined, start: number, end: number, style: TextRunStyle): TextRun[] {
  const kept = subtractTextRange(runs, start, end);
  kept.push({ start, end, ...style });
  return mergeTextRuns(kept);
}

/**
 * Rebuilds the runs inside a range from the styles that already covered them.
 *
 * The `transform` sees the existing style of every piece, including the plain
 * gaps between runs. Returning an empty style drops the piece, which is how
 * clearing a link or an emphasis leaves no empty run behind. Runs outside the
 * range are copied untouched.
 */
function mapTextRange(
  runs: TextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
  transform: (style: TextRunStyle) => TextRunStyle,
): TextRun[] {
  const from = Math.max(0, Math.min(start, textLength));
  const to = Math.max(from, Math.min(end, textLength));
  if (to <= from) return (runs ?? []).map((run) => ({ ...run }));
  const outside = subtractTextRange(runs, from, to);
  const sorted = [...(runs ?? [])].sort((left, right) => left.start - right.start || left.end - right.end);
  const inside: TextRun[] = [];
  let cursor = from;
  const push = (rangeStart: number, rangeEnd: number, style: TextRunStyle) => {
    if (rangeEnd <= rangeStart) return;
    const next = transform(style);
    if (Object.keys(next).length === 0) return;
    inside.push({ start: rangeStart, end: rangeEnd, ...next });
  };
  for (const run of sorted) {
    if (run.end <= from) continue;
    if (run.start >= to) break;
    // A malformed overlap is clipped to the part that has not been rebuilt yet;
    // the later run wins, matching how the text is painted.
    const runStart = Math.max(run.start, cursor, from);
    const runEnd = Math.min(run.end, to);
    if (runEnd <= runStart) continue;
    if (runStart > cursor) push(cursor, runStart, {});
    push(runStart, runEnd, styleOf(run));
    cursor = runEnd;
  }
  if (cursor < to) push(cursor, to, {});
  return mergeTextRuns([...outside, ...inside]);
}

function withHyperlink(style: TextRunStyle, url: string | null): TextRunStyle {
  const next: TextRunStyle = { ...style };
  if (url) next.hyperlinkUrl = url;
  else delete next.hyperlinkUrl;
  return next;
}

/**
 * Sets or clears the hyperlink of every character while keeping the rest of
 * each run's style. Gaps between runs become linked (or plain) runs, so a link
 * set on the whole text box cannot silently drop bold or colour emphasis.
 */
export function setTextHyperlink(runs: TextRun[] | undefined, textLength: number, url: string | null): TextRun[] {
  return mapTextRange(runs, textLength, 0, textLength, (style) => withHyperlink(style, url));
}

/**
 * Sets or clears a link on one range only. Existing links and emphasis outside
 * the range stay as they are; inside it, each character keeps its own weight,
 * colour and underline.
 */
export function setTextHyperlinkRange(
  runs: TextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
  url: string | null,
): TextRun[] {
  return mapTextRange(runs, textLength, start, end, (style) => withHyperlink(style, url));
}

/**
 * Removes character emphasis from a range without removing a link. Emphasis
 * and links share `TextRun`, but clearing bold is not a request to unlink the
 * words.
 */
export function clearTextEmphasisRange(
  runs: TextRun[] | undefined,
  textLength: number,
  start: number,
  end: number,
): TextRun[] {
  return mapTextRange(runs, textLength, start, end, (style) => {
    const next: TextRunStyle = { ...style };
    delete next.bold;
    delete next.color;
    delete next.underline;
    return next;
  });
}

/** Whether any run still carries presentation that needs to be persisted. */
export function hasTextRunStyle(runs: TextRun[]): boolean {
  return runs.some(
    (run) =>
      run.bold !== undefined ||
      run.color !== undefined ||
      run.underline !== undefined ||
      run.hyperlinkUrl !== undefined,
  );
}

/**
 * Splits the text into the fragments the runs describe. The fragments cover the
 * whole text, and a fragment without a run inherits the style of the element.
 */
export function textFragments(text: string, runs: TextRun[] | undefined): TextFragment[] {
  const length = text.length;
  if (!runs || runs.length === 0) return [{ text, style: {}, start: 0, end: length }];
  const perCharacter: (TextRunStyle | null)[] = new Array(length).fill(null);
  for (const run of [...runs].sort((left, right) => left.start - right.start)) {
    const from = Math.max(0, run.start);
    const to = Math.min(length, run.end);
    const style = styleOf(run);
    for (let index = from; index < to; index += 1) perCharacter[index] = style;
  }
  const fragments: TextFragment[] = [];
  let current = "";
  let currentStart = 0;
  let currentStyle: TextRunStyle | null = null;
  for (let index = 0; index < length; index += 1) {
    const style = perCharacter[index] ?? null;
    if (index === 0) {
      currentStyle = style;
      currentStart = 0;
    } else if (!sameStyle(style, currentStyle)) {
      fragments.push({ text: current, style: currentStyle ?? {}, start: currentStart, end: index });
      current = "";
      currentStart = index;
      currentStyle = style;
    }
    current += text[index]!;
  }
  if (current) fragments.push({ text: current, style: currentStyle ?? {}, start: currentStart, end: length });
  return fragments;
}

/**
 * The style a fragment is drawn with: the run decides, the element is the
 * fallback for the properties the run does not mention.
 */
export function resolveFragmentStyle(
  element: TextElementStyle,
  style: TextRunStyle,
): { bold: boolean; color: string; underline: boolean } {
  return {
    bold: style.bold ?? element.bold,
    color: style.color ?? element.color,
    underline: style.underline ?? element.underline ?? false,
  };
}
