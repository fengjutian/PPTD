import { memo } from "react";
import { BarChart3, Circle, Image as ImageIcon, Lock, Square, Table2, Type } from "lucide-react";
import type { ElementId, Slide, SlideElement } from "../../core/document-model";

function elementLabel(element: SlideElement): string {
  if (element.type === "text") return element.text.trim().slice(0, 14) || "文本";
  if (element.type === "image") return element.altText.trim().slice(0, 14) || "图片";
  if (element.type === "chart") return "图表";
  if (element.type === "table") return "表格";
  return element.shape === "ellipse" ? "椭圆" : "矩形";
}

function ElementIcon({ element }: { element: SlideElement }) {
  if (element.type === "text") return <Type />;
  if (element.type === "image") return <ImageIcon />;
  if (element.type === "chart") return <BarChart3 />;
  if (element.type === "table") return <Table2 />;
  return element.shape === "ellipse" ? <Circle /> : <Square />;
}

export interface LayerListProps {
  slide: Slide;
  selectedElementId: ElementId | null;
  onSelect: (elementId: ElementId) => void;
}

/**
 * Layer list of the current page, topmost element first. It only reports the
 * selection; every other change still goes through a document command.
 */
export const LayerList = memo(function LayerList({ slide, selectedElementId, onSelect }: LayerListProps) {
  const ordered = [...slide.elements].reverse();
  return (
    <div className="layer-list">
      {ordered.length === 0 && <p className="layer-empty">当前页没有对象</p>}
      {ordered.map((element) => (
        <button
          type="button"
          key={element.id}
          className={`layer-row ${element.id === selectedElementId ? "active" : ""}`}
          aria-current={element.id === selectedElementId ? "true" : undefined}
          onClick={() => onSelect(element.id)}
        >
          <ElementIcon element={element} />
          <span className="layer-name">{elementLabel(element)}</span>
          {element.locked && <Lock className="layer-lock" />}
        </button>
      ))}
    </div>
  );
});
