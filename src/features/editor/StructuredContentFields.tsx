import { useEffect, useRef, useState } from "react";
import type { DocumentCommand } from "../../core/commands";
import type { SlideId } from "../../core/document-model";
import { TextField } from "./inspector-fields";

/** One reviewed metric as shown by the chart it feeds. */
export interface MetricFieldValue {
  blockId: string;
  label: string;
  value: string;
}

/**
 * The numbers behind a native chart.
 *
 * A chart carries no data of its own; it reads the metric blocks of the page.
 * Without these fields the only way to change a chart would be to regenerate
 * the page, which would throw away the design. Each field commits one content
 * command, so a chart edit is also a review event.
 */
export function MetricFields({
  slideId,
  metrics,
  disabled,
  onCommand,
}: {
  slideId: SlideId;
  metrics: MetricFieldValue[];
  disabled?: boolean;
  onCommand: (command: DocumentCommand) => void;
}) {
  return (
    <div className="metric-fields">
      {metrics.map((metric, index) => (
        <div className="metric-field-row" key={metric.blockId}>
          <TextField
            label={`指标 ${index + 1} 名称`}
            value={metric.label}
            maxLength={1_000}
            disabled={disabled}
            onCommit={(label) =>
              onCommand({ type: "set-metric", slideId, blockId: metric.blockId, field: "label", value: label })
            }
          />
          <TextField
            label={`指标 ${index + 1} 数值`}
            value={metric.value}
            maxLength={1_000}
            disabled={disabled}
            onCommit={(value) =>
              onCommand({ type: "set-metric", slideId, blockId: metric.blockId, field: "value", value })
            }
          />
        </div>
      ))}
      <p className="field-help">图表的类别和数值来自本页内容；修改后会标记本页待确认。</p>
    </div>
  );
}

/**
 * One cell of the table grid.
 *
 * It keeps the typed copy locally until the user leaves the cell, so typing a
 * long cell does not create one undo step per character. Escape puts the old
 * value back.
 */
function CellInput({
  value,
  label,
  header = false,
  disabled,
  onCommit,
}: {
  value: string;
  label: string;
  header?: boolean;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const latest = useRef(draft);

  useEffect(() => {
    if (dirty) return;
    latest.current = value;
    setDraft(value);
  }, [value, dirty]);

  return (
    <input
      className={`table-cell-input${header ? " header" : ""}`}
      value={draft}
      aria-label={label}
      maxLength={header ? 200 : 500}
      disabled={disabled}
      onChange={(event) => {
        latest.current = event.target.value;
        setDraft(event.target.value);
        setDirty(true);
      }}
      onBlur={() => {
        setDirty(false);
        if (latest.current !== value) onCommit(latest.current);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          latest.current = value;
          setDraft(value);
          setDirty(false);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * The cells of the table block the selected table points at.
 *
 * The table element has no cell storage: it reads this block. Editing a cell
 * here therefore changes the reviewed content, the canvas and the exported
 * PowerPoint table in one step.
 */
export function TableDataFields({
  slideId,
  blockId,
  header,
  rows,
  disabled,
  onCommand,
}: {
  slideId: SlideId;
  blockId: string;
  header: string[];
  rows: string[][];
  disabled?: boolean;
  onCommand: (command: DocumentCommand) => void;
}) {
  return (
    <details className="table-data-fields">
      <summary>
        编辑表格数据（{rows.length + 1} 行 × {header.length} 列）
      </summary>
      <div className="table-grid" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(0, 1fr))` }}>
        {header.map((cell, column) => (
          <CellInput
            key={`header-${column}`}
            value={cell}
            label={`表头第 ${column + 1} 列`}
            header
            disabled={disabled}
            onCommit={(value) =>
              onCommand({
                type: "set-table-cell",
                slideId,
                blockId,
                cell: { section: "header", column },
                value,
              })
            }
          />
        ))}
        {rows.map((row, rowIndex) =>
          header.map((_, column) => (
            <CellInput
              key={`${rowIndex}-${column}`}
              value={row[column] ?? ""}
              label={`第 ${rowIndex + 1} 行第 ${column + 1} 列`}
              disabled={disabled}
              onCommit={(value) =>
                onCommand({
                  type: "set-table-cell",
                  slideId,
                  blockId,
                  cell: { section: "body", row: rowIndex, column },
                  value,
                })
              }
            />
          )),
        )}
      </div>
      <p className="field-help">修改单元格会更新本页内容，导出后仍是可编辑的表格。</p>
    </details>
  );
}
