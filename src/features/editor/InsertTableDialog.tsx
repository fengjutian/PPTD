import { useState } from "react";
import { Table2, X } from "lucide-react";
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "../../core/document-model";

interface InsertTableDialogProps {
  onClose: () => void;
  onInsert: (columns: number, rows: number) => void;
}

/**
 * The table-size dialog.
 *
 * The table element itself carries no cells: it reads a reviewed table block,
 * so the size has to be chosen here. After insertion the block's cells are
 * editable in the inspector; changing the grid size later would be a content
 * migration, so the choice is made once, up front.
 */
export function InsertTableDialog({ onClose, onInsert }: InsertTableDialogProps) {
  const [columns, setColumns] = useState(3);
  const [rows, setRows] = useState(3);
  const valid =
    Number.isInteger(columns) &&
    columns >= 2 &&
    columns <= TABLE_MAX_COLUMNS &&
    Number.isInteger(rows) &&
    rows >= 1 &&
    rows <= TABLE_MAX_ROWS;

  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog insert-data-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="insert-table-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <Table2 />
            <div>
              <h2 id="insert-table-title">插入表格</h2>
              <p>表格数据会作为可审核内容块保存，导出后仍是可编辑的 PowerPoint 表格。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭插入表格" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="insert-data-fields">
          <label>
            <span>列数</span>
            <input
              type="number"
              min={2}
              max={TABLE_MAX_COLUMNS}
              value={columns}
              onChange={(event) => setColumns(Number(event.target.value))}
            />
          </label>
          <label>
            <span>数据行数</span>
            <input
              type="number"
              min={1}
              max={TABLE_MAX_ROWS}
              value={rows}
              onChange={(event) => setRows(Number(event.target.value))}
            />
          </label>
        </div>
        <div
          className="insert-table-preview"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(columns || 1, TABLE_MAX_COLUMNS))}, 1fr)` }}
          aria-hidden="true"
        >
          {Array.from({ length: Math.max(1, Math.min(columns || 1, TABLE_MAX_COLUMNS)) }, (_, index) => (
            <span key={`header-${index}`} className="header">
              列 {index + 1}
            </span>
          ))}
          {Array.from(
            {
              length:
                Math.max(1, Math.min(rows || 1, TABLE_MAX_ROWS)) *
                Math.max(1, Math.min(columns || 1, TABLE_MAX_COLUMNS)),
            },
            (_, index) => (
              <span key={`cell-${index}`} />
            ),
          )}
        </div>
        <p className="insert-data-hint">
          {valid
            ? `${rows + 1} 行 × ${columns} 列（含表头）；插入后可在属性面板编辑单元格。`
            : `列数需在 2–${TABLE_MAX_COLUMNS} 之间，数据行数需在 1–${TABLE_MAX_ROWS} 之间。`}
        </p>
        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary-action" disabled={!valid} onClick={() => onInsert(columns, rows)}>
            插入表格
          </button>
        </div>
      </section>
    </div>
  );
}
