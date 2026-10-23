import type {
  ContentBlock,
  ElementId,
  PresentationDocument,
  Slide,
  SlideElement,
  SlideId,
  TextElement,
} from "../document-model";

type MetricBlock = Extract<ContentBlock, { type: "metric" }>;
type TableBlock = Extract<ContentBlock, { type: "table-data" }>;

/** A cell address inside a reviewed table block. */
export type TableCellAddress = { section: "header"; column: number } | { section: "body"; row: number; column: number };

interface MatchBase {
  /** Page index, or -1 for the document title. */
  slideIndex: number;
  /** The whole copy of the target, used for the result snippet. */
  text: string;
  /** Offset of the match in `text`, in UTF-16 code units. */
  start: number;
  end: number;
}

export interface TextElementMatch extends MatchBase {
  kind: "text";
  slideId: SlideId;
  elementId: ElementId;
}

export interface TableCellMatch extends MatchBase {
  kind: "table-cell";
  slideId: SlideId;
  /** The table element that renders the block, so a result can select it. */
  elementId: ElementId;
  blockId: string;
  cell: TableCellAddress;
}

export interface MetricMatch extends MatchBase {
  kind: "metric";
  slideId: SlideId;
  /** The chart element that renders the metric, so a result can select it. */
  elementId: ElementId;
  blockId: string;
  field: "label" | "value";
}

export interface SpeakerNotesMatch extends MatchBase {
  kind: "speaker-notes";
  slideId: SlideId;
}

export interface DocumentTitleMatch extends MatchBase {
  kind: "document-title";
}

/**
 * One occurrence of the query anywhere the deck shows reviewed or speaker
 * copy.
 *
 * The target kinds are distinct because they write through different rules:
 * text elements go through `edit-text`, table cells through `set-table-cell`,
 * chart labels through `set-metric`, and notes through `set-speaker-notes`.
 * A single match type would hide that difference from the replacement command.
 */
export type TextMatch = TextElementMatch | TableCellMatch | MetricMatch | SpeakerNotesMatch | DocumentTitleMatch;

export interface TextSearchOptions {
  matchCase?: boolean;
}

/**
 * A full-copy edit of one target, ready for the batch replace command.
 *
 * `kind` is required on the text variant as well: the command must know
 * whether the copy is an element's text, a table cell or a speaker note before
 * it writes anything.
 */
export type TextReplaceEdit =
  | { kind: "text"; slideId: SlideId; elementId: ElementId; text: string }
  | {
      kind: "table-cell";
      slideId: SlideId;
      elementId: ElementId;
      blockId: string;
      cell: TableCellAddress;
      text: string;
    }
  | {
      kind: "metric";
      slideId: SlideId;
      elementId: ElementId;
      blockId: string;
      field: "label" | "value";
      text: string;
    }
  | { kind: "speaker-notes"; slideId: SlideId; text: string }
  | { kind: "document-title"; text: string };

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

function metricBlock(slide: Slide, blockId: string): MetricBlock | undefined {
  return slide.content.blocks?.find(
    (candidate): candidate is MetricBlock => candidate.id === blockId && candidate.type === "metric",
  );
}

function tableBlock(slide: Slide, blockId: string): TableBlock | undefined {
  return slide.content.blocks?.find(
    (candidate): candidate is TableBlock => candidate.id === blockId && candidate.type === "table-data",
  );
}

function slideById(document: PresentationDocument, slideId: SlideId): Slide | undefined {
  return document.slides.find((slide) => slide.id === slideId);
}

function elementById(document: PresentationDocument, slideId: SlideId, elementId: ElementId): SlideElement | undefined {
  return slideById(document, slideId)?.elements.find((element) => element.id === elementId);
}

/** The stable identity of a match, used to group occurrences per target. */
export function matchKey(match: TextMatch): string {
  switch (match.kind) {
    case "text":
      return `text:${match.slideId}:${match.elementId}`;
    case "table-cell":
      return `table:${match.slideId}:${match.blockId}:${cellKey(match.cell)}`;
    case "metric":
      return `metric:${match.slideId}:${match.blockId}:${match.field}`;
    case "speaker-notes":
      return `notes:${match.slideId}`;
    case "document-title":
      return "document-title";
  }
}

function cellKey(cell: TableCellAddress): string {
  return cell.section === "header" ? `header:${cell.column}` : `body:${cell.row}:${cell.column}`;
}

/** The stable identity of an edit, used to count what "replace all" changed. */
export function editKey(edit: TextReplaceEdit): string {
  switch (edit.kind) {
    case "text":
      return `text:${edit.slideId}:${edit.elementId}`;
    case "table-cell":
      return `table:${edit.slideId}:${edit.blockId}:${cellKey(edit.cell)}`;
    case "metric":
      return `metric:${edit.slideId}:${edit.blockId}:${edit.field}`;
    case "speaker-notes":
      return `notes:${edit.slideId}`;
    case "document-title":
      return "document-title";
  }
}

/** Turns a match into a full-copy edit after the caller has computed the new text. */
export function toReplaceEdit(match: TextMatch, text: string): TextReplaceEdit {
  switch (match.kind) {
    case "text":
      return { kind: "text", slideId: match.slideId, elementId: match.elementId, text };
    case "table-cell":
      return {
        kind: "table-cell",
        slideId: match.slideId,
        elementId: match.elementId,
        blockId: match.blockId,
        cell: match.cell,
        text,
      };
    case "metric":
      return {
        kind: "metric",
        slideId: match.slideId,
        elementId: match.elementId,
        blockId: match.blockId,
        field: match.field,
        text,
      };
    case "speaker-notes":
      return { kind: "speaker-notes", slideId: match.slideId, text };
    case "document-title":
      return { kind: "document-title", text };
  }
}

/**
 * Whether the target of this match refuses edits.
 *
 * A locked object can still be found: the user asked where a word appears, and
 * hiding the result would be a lie. Replacement skips it and says so, the same
 * way a locked text box is skipped.
 */
export function matchIsLocked(document: PresentationDocument, match: TextMatch): boolean {
  if (match.kind === "speaker-notes" || match.kind === "document-title") return false;
  return elementById(document, match.slideId, match.elementId)?.locked ?? false;
}

/**
 * The fields of a match before its offsets are known.
 *
 * The index signature is deliberate: the seed carries the target-specific
 * fields of one union member, and spelling every member here would duplicate
 * the union instead of deriving from it.
 */
type MatchSeed = {
  kind: TextMatch["kind"];
  slideIndex: number;
  text: string;
  [key: string]: unknown;
};

function pushMatches(matches: TextMatch[], pattern: RegExp, seed: MatchSeed): void {
  for (const occurrence of seed.text.matchAll(pattern)) {
    const start = occurrence.index ?? 0;
    matches.push({ ...seed, start, end: start + occurrence[0].length } as TextMatch);
  }
}

/**
 * Finds the query in every place the deck shows copy: text elements, table
 * cells, chart labels and values, speaker notes and the document title.
 *
 * The result is ordered by page, then by the order the targets appear on the
 * page. A metric field rendered by a text card is reported once, through the
 * card, so "replace all" cannot write the same field twice. The same rule
 * applies to a table block shared by two table elements.
 */
export function findTextMatches(
  document: PresentationDocument,
  query: string,
  options: TextSearchOptions = {},
): TextMatch[] {
  const pattern = patternOf(query, options.matchCase ?? false);
  if (!pattern) return [];
  const matches: TextMatch[] = [];

  if (document.title) {
    pushMatches(matches, pattern, { kind: "document-title", slideIndex: -1, text: document.title });
  }

  document.slides.forEach((slide, slideIndex) => {
    if (slide.content.speakerNotes) {
      pushMatches(matches, pattern, {
        kind: "speaker-notes",
        slideIndex,
        slideId: slide.id,
        text: slide.content.speakerNotes,
      });
    }

    // A metric shown by a card is already searchable through that card's text.
    // Reporting the block as well would make one replacement look like two.
    const coveredMetrics = new Set<string>();
    for (const element of slide.elements) {
      if (element.type === "text" && element.contentBlockRef) {
        coveredMetrics.add(`${element.contentBlockRef.blockId}:${element.contentBlockRef.field}`);
      }
    }

    const seenTableCells = new Set<string>();
    const seenMetrics = new Set<string>();

    for (const element of slide.elements) {
      if (element.type === "text" && element.text) {
        pushMatches(matches, pattern, {
          kind: "text",
          slideIndex,
          slideId: slide.id,
          elementId: element.id,
          text: element.text,
        });
        continue;
      }

      if (element.type === "table") {
        const block = tableBlock(slide, element.contentBlockId);
        if (!block) continue;
        const cells = [
          ...block.header.map((text, column) => ({
            cell: { section: "header" as const, column },
            text,
          })),
          ...block.rows.flatMap((row, rowIndex) =>
            block.header.map((_, column) => ({
              cell: { section: "body" as const, row: rowIndex, column },
              text: row[column] ?? "",
            })),
          ),
        ];
        for (const { cell, text } of cells) {
          if (!text) continue;
          const key = `${element.contentBlockId}:${cellKey(cell)}`;
          if (seenTableCells.has(key)) continue;
          seenTableCells.add(key);
          pushMatches(matches, pattern, {
            kind: "table-cell",
            slideIndex,
            slideId: slide.id,
            elementId: element.id,
            blockId: element.contentBlockId,
            cell,
            text,
          });
        }
        continue;
      }

      if (element.type === "chart") {
        for (const blockId of element.contentBlockIds) {
          const block = metricBlock(slide, blockId);
          if (!block) continue;
          for (const field of ["label", "value"] as const) {
            const key = `${blockId}:${field}`;
            if (coveredMetrics.has(key) || seenMetrics.has(key)) continue;
            seenMetrics.add(key);
            const text = block[field];
            if (!text) continue;
            pushMatches(matches, pattern, {
              kind: "metric",
              slideIndex,
              slideId: slide.id,
              elementId: element.id,
              blockId,
              field,
              text,
            });
          }
        }
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
 * The edit is computed per target, not per match: replacing the first match
 * would shift the offsets of the later ones, and sending one edit per match
 * would write the same target several times. Targets whose copy does not
 * change are dropped, so the command does not touch them or bump revisions for
 * nothing. Locked objects are skipped here and reported by the UI.
 */
export function buildReplaceAllEdits(
  document: PresentationDocument,
  query: string,
  replacement: string,
  options: TextSearchOptions = {},
): TextReplaceEdit[] {
  const edits: TextReplaceEdit[] = [];
  const seen = new Set<string>();
  for (const match of findTextMatches(document, query, options)) {
    const key = matchKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    if (matchIsLocked(document, match)) continue;
    const next = replaceAllOccurrences(match.text, query, replacement, options);
    if (next !== match.text) edits.push(toReplaceEdit(match, next));
  }
  return edits;
}

/** The text element a match points at, when it still exists and is still text. */
export function matchElement(document: PresentationDocument, match: TextMatch): TextElement | undefined {
  if (match.kind !== "text") return undefined;
  const element = elementById(document, match.slideId, match.elementId);
  return element?.type === "text" ? element : undefined;
}
