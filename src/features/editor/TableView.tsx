import { useMemo } from "react";
import {
  EMU_PER_INCH,
  resolveTableData,
  tableColumnAlignsRight,
  type Slide,
  type TableElement,
  type TableMerge,
} from "../../core/document-model";

/**
 * The canvas view of a native table.
 *
 * The export writes a real table object, so the canvas shows the same header
 * and the same cells as the exported table. The cells are read from the
 * reviewed table block of the page, never from a copy inside the element, so
 * the canvas cannot show a cell the content does not carry.
 */
export function TableView({
  element,
  slide,
  scale,
  compact = false,
}: {
  element: TableElement;
  slide: Slide;
  scale: number;
  compact?: boolean;
}) {
  const resolved = useMemo(() => resolveTableData(slide, element), [slide, element]);
  const unit = (scale * EMU_PER_INCH) / 72;
  const fontSize = Math.max(4, element.style.fontSizePt * unit);
  const padding = (element.style.cellPaddingPt ?? 4) * unit;
  const borderWidth = (element.style.borderWidthPt ?? 0.75) * unit;
  if (!resolved) {
    return (
      <div className="table-view table-missing" style={{ fontSize, color: element.style.bodyTextColor }}>
        表格数据缺失
      </div>
    );
  }
  const headerBold = element.style.headerBold ?? true;
  // A merged region is drawn by its top-left cell; the covered cells are
  // skipped so the browser does not create phantom columns.
  const starts = new Map<string, TableMerge>();
  const covered = new Set<string>();
  for (const merge of resolved.merges) {
    starts.set(`${merge.section}:${merge.row}:${merge.column}`, merge);
    for (let row = merge.row; row < merge.row + merge.rowSpan; row += 1) {
      for (let column = merge.column; column < merge.column + merge.columnSpan; column += 1) {
        if (row === merge.row && column === merge.column) continue;
        covered.add(`${merge.section}:${row}:${column}`);
      }
    }
  }
  return (
    <table
      className={`table-view${compact ? " compact" : ""}`}
      style={{ fontFamily: element.style.fontFamily, fontSize, borderColor: element.style.borderColor }}
    >
      <thead>
        <tr>
          {resolved.header.map((cell, index) => {
            if (covered.has(`header:0:${index}`)) return null;
            const merge = starts.get(`header:0:${index}`);
            return (
              <th
                key={`${cell}-${index}`}
                rowSpan={merge?.rowSpan}
                colSpan={merge?.columnSpan}
                style={{
                  background: element.style.headerFill,
                  color: element.style.headerTextColor,
                  borderColor: element.style.borderColor,
                  borderWidth,
                  padding,
                  fontWeight: headerBold ? 700 : 400,
                  textAlign: tableColumnAlignsRight(resolved.rows, index) ? "right" : "left",
                }}
              >
                {cell}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {resolved.rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => {
              if (covered.has(`body:${rowIndex}:${cellIndex}`)) return null;
              const merge = starts.get(`body:${rowIndex}:${cellIndex}`);
              return (
                <td
                  key={`${cell}-${cellIndex}`}
                  rowSpan={merge?.rowSpan}
                  colSpan={merge?.columnSpan}
                  style={{
                    color: element.style.bodyTextColor,
                    borderColor: element.style.borderColor,
                    borderWidth,
                    padding,
                    background: rowIndex % 2 === 1 ? element.style.bandingFill : undefined,
                    fontWeight: element.style.firstColumnBold && cellIndex === 0 ? 700 : 400,
                    textAlign: tableColumnAlignsRight(resolved.rows, cellIndex) ? "right" : "left",
                  }}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
