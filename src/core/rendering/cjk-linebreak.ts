/**
 * Chinese line breaking.
 *
 * The editor, the visual review and the exported file all have to break a
 * paragraph at the same places. Otherwise a page that fits in the review
 * overflows in PowerPoint, and the quality gate predicts a line count the
 * renderer never produces.
 *
 * The rules are the ones Chinese typography uses, and the ones PowerPoint
 * applies to Asian text:
 *
 * - A line may not start with closing punctuation. The punctuation hangs into
 *   the right margin instead, which is what "允许标点溢出边界" does.
 * - A line may not end with opening punctuation. The punctuation moves down to
 *   the next line together with the pair it belongs to.
 * - A Latin word or a number is not split across two lines.
 *
 * The module is pure: it takes the width of every atom and returns the lines.
 * It never measures anything itself, so the core stays free of the browser
 * and of the desktop runtime.
 */

/**
 * A piece of text with the width it takes.
 *
 * The width is in em of the font size in the core and in pixels in the
 * renderer. Only the ratio between the limit and the widths matters, so the
 * same rules serve both.
 */
export interface MeasurableAtom<T = string> {
  /** What the caller wants to keep with this piece of text. */
  readonly value: T;
  /** The character this atom carries. */
  readonly text: string;
  /** The advance width of the character. */
  readonly width: number;
}

/** Punctuation that may not start a line. */
const NO_LINE_START = new Set([..."，。、；：？！）］｝〕〉》」』】〗〙〛”’·…—～%‰℃∶,.;:?!)]}»"]);

/** Punctuation that may not end a line. */
const NO_LINE_END = new Set([..."（［｛〔〈《「『【〖〘〚“‘([{«"]);

/** How many characters may hang past the right margin. */
const MAX_HANGING = 2;

/** A Latin word, a number, or one part of them. */
function isWordCharacter(text: string): boolean {
  return /^[A-Za-z0-9.\-]$/.test(text);
}

/**
 * The lines a paragraph breaks into.
 *
 * The atoms come back in the order they went in, so a caller that keeps a
 * style per atom can map the lines onto its own data.
 */
export function breakAtoms<T>(atoms: readonly MeasurableAtom<T>[], limit: number): MeasurableAtom<T>[][] {
  const lines: MeasurableAtom<T>[][] = [];
  if (atoms.length === 0) return lines;
  const width = Math.max(0.01, limit);
  let index = 0;
  while (index < atoms.length) {
    let used = 0;
    let end = index;
    while (end < atoms.length && used + atoms[end]!.width <= width) {
      used += atoms[end]!.width;
      end += 1;
    }
    // A character wider than the line still has to be shown, so it overflows
    // on a line of its own.
    if (end === index) end = index + 1;
    if (end >= atoms.length) {
      lines.push(atoms.slice(index));
      break;
    }
    // A closing punctuation may not start a line: it hangs into the margin.
    if (NO_LINE_START.has(atoms[end]!.text)) {
      let hang = end;
      while (hang < atoms.length && hang - end < MAX_HANGING && NO_LINE_START.has(atoms[hang]!.text)) hang += 1;
      lines.push(atoms.slice(index, hang));
      index = hang;
      continue;
    }
    let breakAt = end;
    // An opening punctuation may not end a line: it moves down with its pair.
    if (breakAt > index && NO_LINE_END.has(atoms[breakAt - 1]!.text)) {
      breakAt -= 1;
      if (breakAt > index && atoms[breakAt]!.text === atoms[breakAt + 1]?.text) breakAt -= 1;
    }
    // A Latin word is not split across two lines when it fits on a line of
    // its own.
    if (breakAt > index && isWordCharacter(atoms[breakAt]!.text)) {
      let start = breakAt;
      while (start > index && isWordCharacter(atoms[start - 1]!.text)) start -= 1;
      let wordEnd = breakAt;
      while (wordEnd < atoms.length && isWordCharacter(atoms[wordEnd]!.text)) wordEnd += 1;
      const wordWidth = atoms.slice(start, wordEnd).reduce((sum, atom) => sum + atom.width, 0);
      if (wordWidth <= width) breakAt = start;
    }
    // The line always carries at least one character, or the loop never ends.
    if (breakAt <= index) breakAt = index + 1;
    lines.push(atoms.slice(index, breakAt));
    index = breakAt;
  }
  return lines;
}

/** The lines a text breaks into, with the width of a single character given. */
export function breakIntoLines(text: string, options: { widthEm: number; widthOf: (character: string) => number }): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const atoms = [...paragraph].map((character) => ({ value: character, text: character, width: options.widthOf(character) }));
    if (atoms.length === 0) {
      lines.push("");
      continue;
    }
    for (const line of breakAtoms(atoms, options.widthEm)) lines.push(line.map((atom) => atom.value).join(""));
  }
  return lines;
}
