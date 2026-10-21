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
