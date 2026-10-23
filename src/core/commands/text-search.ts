import type { ElementId, PresentationDocument, SlideId, TextElement } from "../document-model";

/** One occurrence of the query in a text element. */
export interface TextMatch {
  slideId: SlideId;
  slideIndex: number;
  elementId: ElementId;
  /** The whole copy of the element, used for the result snippet. */
  text: string;
  /** Offset of the match in `text`, in UTF-16 code units. */
  start: number;
  end: number;
}

export interface TextSearchOptions {
  matchCase?: boolean;
}

/** A full-text edit of one element, ready for the batch replace command. */
export interface TextReplaceEdit {
  slideId: SlideId;
  elementId: ElementId;
  text: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternOf(query: string, matchCase: boolean): RegExp | undefined {
  if (!query) return undefined;
  try {
    return new RegExp(escapeRegExp(query), matchCase ? "g" : "gi");
  } catch {
    return undefined;
  }
}

/**
 * Finds the query in the copy of every text element, across all slides.
 *
 * Only text elements are searched. Table cells, chart labels and speaker notes
 * are different places with different editing rules, so a match in one of them
 * would point at something the replace command cannot safely write. The result
 * is ordered by page, then element, then occurrence.
 */
export function findTextMatches(
  document: PresentationDocument,
  query: string,
  options: TextSearchOptions = {},
): TextMatch[] {
  const pattern = patternOf(query, options.matchCase ?? false);
  if (!pattern) return [];
  const matches: TextMatch[] = [];
  document.slides.forEach((slide, slideIndex) => {
    for (const element of slide.elements) {
      if (element.type !== "text" || !element.text) continue;
      for (const match of element.text.matchAll(pattern)) {
        const start = match.index ?? 0;
        matches.push({
          slideId: slide.id,
          slideIndex,
          elementId: element.id,
          text: element.text,
          start,
          end: start + match[0].length,
        });
      }
    }
  });
  return matches;
}

/** Replaces every occurrence of the query in one copy. */
export function replaceAllOccurrences(
  text: string,
  query: string,
  replacement: string,
  options: TextSearchOptions = {},
): string {
  const pattern = patternOf(query, options.matchCase ?? false);
  if (!pattern) return text;
  // A callback keeps `$&` and `$1` in the replacement literal instead of
  // letting the regular expression engine interpret them.
  return text.replace(pattern, () => replacement);
}

/** Replaces the occurrence at `[start, end)`, leaving the rest of the copy alone. */
export function replaceOccurrence(text: string, start: number, end: number, replacement: string): string {
  if (start < 0 || end < start || end > text.length) return text;
  return text.slice(0, start) + replacement + text.slice(end);
}

/**
 * Builds the full-copy edits for “replace all”.
 *
 * The edit is computed per element, not per match: replacing the first match
 * would shift the offsets of the later ones, and sending one edit per match
 * would write the same element several times. Elements whose copy does not
 * change are dropped, so the command does not touch them or bump revisions for
 * nothing.
 */
export function buildReplaceAllEdits(
  document: PresentationDocument,
  query: string,
  replacement: string,
  options: TextSearchOptions = {},
): TextReplaceEdit[] {
  const edits: TextReplaceEdit[] = [];
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      if (element.type !== "text") continue;
      // A locked object can be found, but not rewritten: replacing it would
      // bypass the lock. The UI reports the count of what it actually changed.
      if (element.locked) continue;
      const next = replaceAllOccurrences(element.text, query, replacement, options);
      if (next !== element.text) edits.push({ slideId: slide.id, elementId: element.id, text: next });
    }
  }
  return edits;
}

/** The element a match points at, when it still exists and is still text. */
export function matchElement(document: PresentationDocument, match: TextMatch): TextElement | undefined {
  const slide = document.slides.find((candidate) => candidate.id === match.slideId);
  const element = slide?.elements.find((candidate) => candidate.id === match.elementId);
  return element?.type === "text" ? element : undefined;
}
