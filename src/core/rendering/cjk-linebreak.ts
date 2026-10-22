/**
 * Chinese line breaking.
 *
 * The editor, the visual review and the exported file all have to break a
 * paragraph at the same places. Otherwise a page that fits in the review
 * overflows in PowerPoint, and the quality gate predicts a line count the
 * renderer never produces.
 *
 * The rules are the ones Chinese typography uses:
 *
 * - A line may not start with closing punctuation. The punctuation hangs into
 *   the right margin instead, which is what PowerPoint does with "允许标点溢出
 *   边界" turned on.
 * - A line may not end with opening punctuation. The punctuation moves down to
 *   the next line together with the pair it belongs to.
 * - A Latin word or number is not split across two lines.
 *
 * The module is pure: it takes the width of a single character and returns
 * the lines. It never measures anything itself, so the core stays free of the
 * browser and the desktop runtime.
 */

/** A piece of text with the width it takes, in em of the font size. */
export interface TextAtom {
  /** The character this atom carries. */
  readonly text: string;
  /** The advance width of the character, in em of the font size. */
  readonly widthEm: number;
}

/** Punctuation that may not start a line. */
const NO_LINE_START = new Set([..."，。、；：？！）］｝〕〉》」』】〗〙〛”’·…—～%‰℃∶,.;:?!)]}»"]);

/** Punctuation that may not end a line. */
const NO_LINE_END = new Set([..."（［｛〔〈《「『【〖〘〚“‘([{«"]);

/** How many characters may hang past the right margin. */
const MAX_HANGING = 2;

/** A Latin word, a number or a part of one. */
function isWordCharacter(text: string): boolean {
  return /^[A-Za-z0-9.\-]$/.test(text);
}

/**
 * The lines a paragraph breaks into.
 *
 * The atoms are returned in the order they were given, so a caller that keeps
 * a style per atom can map the lines back onto its own data.
 */
export function breakAtoms(atoms: readonly TextAtom[], widthEm: number): TextAtom[][] {
  const lines: TextAtom[][] = [];
  if (atoms.length === 0) return lines;
  const limit = Math.max(0.01, widthEm);
  let index = 0;
  while (index < atoms.length) {
    let width = 0;
    let end = index;
    while (end < atoms.length && width + atoms[end]!.widthEm <= limit) {
      width += atoms[end]!.widthEm;
      end += 1;
    }
    // A single character wider than the line still has to be shown, so it
    // overflows on a line of its own.
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
      if (breakAt > index && atoms[breakAt]!.text === atoms[breakAt + 1]!.text) breakAt -= 1;
    }
    // A Latin word is not split across two lines.
    if (breakAt > index && isWordCharacter(atoms[breakAt]!.text) && isWordCharacter(atoms[breakAt - 1]!.text)) {
      let start = breakAt;
      while (start > index && isWordCharacter(atoms[start - 1]!.text)) start -= 1;
      const wordWidth = atoms.slice(start, breakAt).reduce((sum, atom) => sum + atom.widthEm, 0);
      if (wordWidth <= limit) breakAt = start;
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
    const atoms = [...paragraph].map((character) => ({ text: character, widthEm: options.widthOf(character) }));
    if (atoms.length === 0) {
      lines.push("");
      continue;
    }
    for (const line of breakAtoms(atoms, options.widthEm)) lines.push(line.map((atom) => atom.text).join(""));
  }
  return lines;
}
