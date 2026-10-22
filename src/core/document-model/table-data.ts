import type { Slide, TableElement } from "./types";

/**
 * Table data of a slide.
 *
 * A native table holds no cells of its own. The header and the rows are read
 * back from the reviewed table block of the page, the same way a chart reads
 * its numbers from the reviewed metric blocks. Editing the content therefore
 * changes the grid, and the grid cannot show a cell the content does not carry.
 */

export interface ResolvedTableData {
  header: string[];
  rows: string[][];
}

/**
 * Grid limits enforced by the document schema. They are exported so the review
 * screen can stop a writer from building a table the project file cannot store,
 * instead of failing validation at save or export time.
 */
export const TABLE_MAX_COLUMNS = 8;
export const TABLE_MAX_ROWS = 30;

/** Whether a reviewed table block fits what the document model can persist. */
export function tableFitsDocumentLimits(header: readonly string[], rows: readonly (readonly string[])[]): boolean {
  return (
    header.length <= TABLE_MAX_COLUMNS &&
    rows.length <= TABLE_MAX_ROWS &&
    rows.every((row) => row.length <= TABLE_MAX_COLUMNS)
  );
}

/**
 * Reads the cells of a table from the content block it points at. Returns
 * undefined when the block is gone, is not a table, carries an empty header or
 * has no rows: a table without cells is not a table.
 */
export function resolveTableData(slide: Slide, element: TableElement): ResolvedTableData | undefined {
  const blocks = slide.content.blocks ?? [];
  const block = blocks.find((candidate) => candidate.id === element.contentBlockId);
  if (!block || block.type !== "table-data") return undefined;
  if (block.header.length === 0 || block.rows.length === 0) return undefined;
  return { header: [...block.header], rows: block.rows.map((row) => [...row]) };
}

/** A cell that reads as a number, a percentage or a grouped number. */
const NUMERIC_CELL = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

/**
 * Whether a column is a number column.
 *
 * A table that right-aligns its numbers is easier to scan than one where every
 * cell is left-aligned. The decision is made per column from the reviewed
 * cells, so a column of labels stays left and a column of figures lines up on
 * the decimal side; the table style itself carries no per-column flags.
 */
export function tableColumnAlignsRight(rows: readonly (readonly string[])[], column: number): boolean {
  const values = rows.map((row) => (row[column] ?? "").trim()).filter((value) => value.length > 0);
  if (values.length === 0) return false;
  const numeric = values.filter((value) => NUMERIC_CELL.test(value)).length;
  return numeric >= Math.ceil(values.length * 0.6);
}
