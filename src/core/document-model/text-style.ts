import type { DocumentTheme, TextContentRole, TextElementStyle } from "./types";

/**
 * The sizes the size buttons step through.
 *
 * The ladder is the one Office uses, so a deck edited here keeps the familiar
 * 10/10.5/12/14… rhythm instead of landing on arbitrary values. A size that is
 * already off the ladder steps to the next rung in the requested direction.
 */
export const TEXT_SIZE_LADDER = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 120,
] as const;

export const MIN_TEXT_SIZE_PT = 4;
export const MAX_TEXT_SIZE_PT = 400;

/** The next rung of the ladder, or the current size when there is none. */
export function nextTextSize(current: number, direction: "up" | "down"): number {
  const epsilon = 0.001;
  if (direction === "up") {
    const next = TEXT_SIZE_LADDER.find((size) => size > current + epsilon);
    return next ?? current;
  }
  const previous = [...TEXT_SIZE_LADDER].reverse().find((size) => size < current - epsilon);
  return previous ?? current;
}

/**
 * The style “clear formatting” restores.
 *
 * The theme owns the type scale, so a cleared run keeps the deck's own body (or
 * title) size, font and colour instead of jumping to a hard-coded default. A
 * deck without a theme falls back to the same values the document factory uses.
 */
export function clearedTextStyle(role: TextContentRole | undefined, theme?: DocumentTheme): TextElementStyle {
  const isTitle = role === "title";
  const token = theme?.textStyles?.[isTitle ? "title" : "body"];
  const fontFamily = (isTitle ? theme?.majorFont : theme?.minorFont) ?? "Microsoft YaHei";
  const primaryText = theme?.colors.find((color) => color.name === "primaryText")?.value;
  return {
    fontFamily,
    fontSizePt: token?.fontSizePt ?? (isTitle ? 28 : 18),
    color: token?.color ?? primaryText ?? "#17181c",
    bold: token?.bold ?? isTitle,
    align: "left",
    ...(token?.lineHeight === undefined ? {} : { lineHeight: token.lineHeight }),
    ...(token?.letterSpacingPt === undefined ? {} : { letterSpacingPt: token.letterSpacingPt }),
    italic: false,
    strikethrough: false,
    verticalAlign: "top",
    bullet: "none",
    indentLevel: 0,
  };
}
