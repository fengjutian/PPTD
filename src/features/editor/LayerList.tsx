import { memo } from "react";
import { BarChart3, Circle, Image as ImageIcon, Lock, Minus, Square, Table2, Type } from "lucide-react";
import type { ElementId, Slide, SlideElement } from "../../core/document-model";
import { ICON_LABELS } from "./icon-options";

function elementLabel(element: SlideElement): string {
  if (element.type === "text") return element.text.trim().slice(0, 14) || "文本";
  if (element.type === "image") return element.altText.trim().slice(0, 14) || "图片";
  if (element.type === "chart") return "图表";
  if (element.type === "table") return "表格";
  if (element.type === "line") return "线条";
  if (element.type === "icon") return ICON_LABELS[element.name];
  return element.shape === "ellipse" ? "椭圆" : "矩形";
}

function ElementIcon({ element }: { element: SlideElement }) {
  if (element.type === "text") return <Type />;
  if (element.type === "image") return <ImageIcon />;
  if (element.type === "chart") return <BarChart3 />;
  if (element.type === "table") return <Table2 />;
  if (element.type === "line") return <Minus />;
  if (element.type === "icon") return <Circle />;
  return element.shape === "ellipse" ? <Circle /> : <Square />;
}

export interface LayerListProps {
  slide: Slide;
  /** 选中的对象，可以有多个。 */
  selectedElementIds: readonly ElementId[];
  onSelect: (elementId: ElementId) => void;
  /** 增减一个对象的选中状态。 */
  onToggle: (elementId: ElementId) => void;
}

/**
 * Layer list of the current page, topmost element first. It only reports the
 * selection; every other change still goes through a document command.
 */
export const LayerList = memo(function LayerList({ slide, selectedElementIds, onSelect, onToggle }: LayerListProps) {
  const ordered = [...slide.elements].reverse();
  return (
    <div className="layer-list">
      {ordered.length === 0 && <p className="layer-empty">当前页没有对象</p>}
      {ordered.map((element) => {
        const selected = selectedElementIds.includes(element.id);
        return (
          <button
            type="button"
            key={element.id}
            className={`layer-row ${selected ? "active" : ""}`}
            aria-current={selected ? "true" : undefined}
            onClick={(event) => {
              // Ctrl、Cmd 或 Shift 点选是增减选中，普通点击是只选这一个。
              if (event.ctrlKey || event.metaKey || event.shiftKey) onToggle(element.id);
              else onSelect(element.id);
            }}
          >
            <ElementIcon element={element} />
            <span className="layer-name">{elementLabel(element)}</span>
            {element.locked && <Lock className="layer-lock" />}
          </button>
        );
      })}
    </div>
  );
});
