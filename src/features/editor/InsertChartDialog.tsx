import { useState } from "react";
import { ChartBar, ChartColumn, ChartLine, ChartPie, X } from "lucide-react";
import type { ChartKind } from "../../core/document-model";

const CHART_KINDS: ReadonlyArray<{ kind: ChartKind; label: string; hint: string; Icon: typeof ChartBar }> = [
  { kind: "column", label: "柱状图", hint: "比较不同类别", Icon: ChartColumn },
  { kind: "bar", label: "条形图", hint: "类别名称较长时更清楚", Icon: ChartBar },
  { kind: "line", label: "折线图", hint: "看趋势和变化", Icon: ChartLine },
  { kind: "pie", label: "饼图", hint: "看占比构成", Icon: ChartPie },
];

interface InsertChartDialogProps {
  onClose: () => void;
  onInsert: (kind: ChartKind) => void;
}

/**
 * The chart-kind dialog.
 *
 * A chart reads the page's reviewed metric blocks. Inserting one therefore also
 * inserts three placeholder metrics, which the inspector can rename and change
 * immediately; this dialog only chooses the kind, not the data shape.
 */
export function InsertChartDialog({ onClose, onInsert }: InsertChartDialogProps) {
  const [kind, setKind] = useState<ChartKind>("column");

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
        aria-labelledby="insert-chart-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <ChartColumn />
            <div>
              <h2 id="insert-chart-title">插入图表</h2>
              <p>图表读取本页内容块中的指标；导出后仍是可编辑的原生图表。</p>
            </div>
          </div>
          <button type="button" aria-label="关闭插入图表" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="insert-chart-kinds" role="group" aria-label="图表类型">
          {CHART_KINDS.map(({ kind: value, label, hint, Icon }) => (
            <button
              key={value}
              type="button"
              className={kind === value ? "active" : undefined}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              <Icon />
              <strong>{label}</strong>
              <span>{hint}</span>
            </button>
          ))}
        </div>
        <p className="insert-data-hint">会插入 3 项示例数据，插入后可在属性面板修改指标名称和数值。</p>
        <div className="upload-dialog-actions">
          <button type="button" className="secondary-action" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary-action" onClick={() => onInsert(kind)}>
            插入图表
          </button>
        </div>
      </section>
    </div>
  );
}
