import { BUILTIN_ICONS, type BuiltinIconName } from "../../core/document-model";
import { IconGlyph } from "./IconView";

const ICON_NAMES = Object.keys(BUILTIN_ICONS) as BuiltinIconName[];

/** Chinese names of the icon set, used by the picker and the layer list. */
export const ICON_LABELS: Record<BuiltinIconName, string> = {
  book: "书",
  mountain: "山",
  water: "水",
  sun: "日",
  moon: "月",
  target: "目标",
  chart: "数据",
  users: "团队",
  bulb: "启发",
  flag: "里程碑",
  heart: "情感",
  leaf: "自然",
};

export interface IconPickerProps {
  onPick: (name: BuiltinIconName) => void;
  onClose: () => void;
}

/**
 * A small palette of the built-in icons.
 *
 * The dialog is deliberately a grid of drawings, not a search field: the set
 * is small enough to scan, and seeing the line weight is the point.
 */
export function IconPicker({ onPick, onClose }: IconPickerProps) {
  return (
    <div
      className="upload-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog icon-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="icon-picker-title"
      >
        <div className="upload-dialog-heading">
          <div>
            <h2 id="icon-picker-title">插入图标</h2>
            <p>线性图标会随强调色渲染，并作为可缩放图片导出。</p>
          </div>
          <button type="button" aria-label="关闭图标选择" onClick={onClose}>
            ×
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: "10px",
            padding: "8px 0 4px",
          }}
        >
          {ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={ICON_LABELS[name]}
              title={ICON_LABELS[name]}
              onClick={() => onPick(name)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                padding: "10px 6px",
                border: "1px solid rgba(120,130,140,0.35)",
                borderRadius: "10px",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              <span style={{ width: "26px", height: "26px", color: "#d35230" }}>
                <IconGlyph name={name} color="currentColor" />
              </span>
              <small style={{ fontSize: "11px", opacity: 0.72 }}>{ICON_LABELS[name]}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
