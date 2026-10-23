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
  return left.bold === right.bold && left.color === right.color && left.underline === right.underline;
}

function styleOf(run: TextRun): TextRunStyle {
  const style: TextRunStyle = {};
  if (run.bold !== undefined) style.bold = run.bold;
  if (run.color !== undefined) style.color = run.color;
  if (run.underline !== undefined) style.underline = run.underline;
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
