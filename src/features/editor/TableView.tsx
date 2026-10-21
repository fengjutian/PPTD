import { EMU_PER_INCH, resolveTableData, type Slide, type TableElement } from "../../core/document-model";

/**
 * The canvas view of a native table.
 *
 * The export writes a real table object, so the canvas shows the same header
 * and the same cells as the exported table. The cells are read from the
 * reviewed table block of the page, never from a copy inside the element, so
 * the canvas cannot show a cell the content does not carry.
 */
export function TableView({ element, slide, scale, compact = false }: { element: TableElement; slide: Slide; scale: number; compact?: boolean }) {
  const resolved = resolveTableData(slide, element);
  const fontSize = Math.max(4, element.style.fontSizePt * scale * EMU_PER_INCH / 72);
  if (!resolved) {
    return <div className="table-view table-missing" style={{ fontSize, color: element.style.bodyTextColor }}>表格数据缺失</div>;
  }
  return (
    <table className={`table-view${compact ? " compact" : ""}`} style={{ fontFamily: element.style.fontFamily, fontSize, borderColor: element.style.borderColor }}>
      <thead>
        <tr>
          {resolved.header.map((cell, index) => (
            <th key={`${cell}-${index}`} style={{ background: element.style.headerFill, color: element.style.headerTextColor, borderColor: element.style.borderColor }}>{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {resolved.rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => (
              <td
                key={`${cell}-${cellIndex}`}
                style={{
                  color: element.style.bodyTextColor,
                  borderColor: element.style.borderColor,
                  fontWeight: element.style.firstColumnBold && cellIndex === 0 ? 700 : 400,
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
