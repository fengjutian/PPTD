import { breakAtoms, type MeasurableAtom } from "./cjk-linebreak";
import { measureCharacterEm } from "./text-fit";

/**
 * The grid a native table needs, measured the way the renderers draw it.
 *
 * A table element stores no row heights and no column widths: the exporter hands
 * PowerPoint the frame, the font and a uniform row height, and PowerPoint **grows
 * a row** when its cells need more lines. The preview used to cut every cell at
 * twelve characters instead, and the audit did not look at tables at all, so a
 * table could push past its frame in the file while every surface reported the
 * page as fine.
 *
 * This module answers one question for all of them: given the frame, the font
 * and the reviewed cells, how tall does the table actually become?
 */

/** The leading used inside a cell when the style does not set one. */
const CELL_LINE_HEIGHT = 1.2;
/** The smallest height a row keeps even with an empty cell, in multiples of the font size. */
const MIN_ROW_HEIGHT_RATIO = 1.45;
/** Cell padding when the style does not set one; the exporter uses the same default. */
export const DEFAULT_CELL_PADDING_PT = 4;

export interface TableCellLayout {
  /** The cell as written: the text is wrapped, never cut. */
  text: string;
  /** The wrapped lines, in reading order. */
  lines: string[];
  /** The height the cell needs: its lines plus the padding above and below. */
  heightPt: number;
}

export interface TableRowLayout {
  /** True for the header row, which the exporter sets in bold. */
  header: boolean;
  cells: TableCellLayout[];
  heightPt: number;
}

export interface TableGeometry {
  columnWidthPt: number;
  fontSizePt: number;
  /** The width of a cell's text area: the column minus the padding on both sides. */
  textWidthPt: number;
  rows: TableRowLayout[];
  /** The height the whole table needs, header included. */
  neededHeightPt: number;
}

export interface TableGeometryInput {
  header: readonly string[];
  rows: readonly (readonly string[])[];
  frameWidthPt: number;
  fontSizePt: number;
  fontFamily: string;
  cellPaddingPt?: number;
  bold?: boolean;
}

/** The lines one cell breaks into at a given width. */
function cellLines(text: string, widthPt: number, fontSizePt: number, fontFamily: string, bold: boolean): string[] {
  const limit = Math.max(0.5, widthPt / Math.max(0.5, fontSizePt));
  return text.split("\n").flatMap((paragraph) => {
    if (paragraph.length === 0) return [""];
    const atoms: MeasurableAtom<string>[] = [...paragraph].map((character) => ({
      value: character,
      text: character,
      width: measureCharacterEm(character, fontSizePt, bold ? { bold: true } : undefined, fontFamily),
    }));
    return breakAtoms(atoms, limit).map((line) => line.map((atom) => atom.value).join(""));
  });
}

/** The grid a table needs at its frame width. */
export function tableGeometry(input: TableGeometryInput): TableGeometry {
  const columnCount = Math.max(1, input.header.length);
  const padding = input.cellPaddingPt ?? DEFAULT_CELL_PADDING_PT;
  const columnWidthPt = input.frameWidthPt / columnCount;
  const textWidthPt = Math.max(1, columnWidthPt - padding * 2);
  const minimumRowPt = input.fontSizePt * MIN_ROW_HEIGHT_RATIO;
  const measureRow = (cells: readonly string[], header: boolean): TableRowLayout => {
    const measured = Array.from({ length: columnCount }, (_, index) => {
      const text = cells[index] ?? "";
      const bold = header || input.bold === true;
      const lines = cellLines(text, textWidthPt, input.fontSizePt, input.fontFamily, bold);
      return {
        text,
        lines,
        heightPt: lines.length * input.fontSizePt * CELL_LINE_HEIGHT + padding * 2,
      };
    });
    return {
      header,
      cells: measured,
      heightPt: Math.max(minimumRowPt, ...measured.map((cell) => cell.heightPt)),
    };
  };
  const rows: TableRowLayout[] = [measureRow(input.header, true)];
  for (const row of input.rows) rows.push(measureRow(row, false));
  return {
    columnWidthPt,
    fontSizePt: input.fontSizePt,
    textWidthPt,
    rows,
    neededHeightPt: rows.reduce((sum, row) => sum + row.heightPt, 0),
  };
}
