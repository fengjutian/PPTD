import { memo } from "react";
import { AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, Layers3, Trash2 } from "lucide-react";
import type { DocumentCommand } from "../../core/commands";
import type { ElementId, Emu, RectEmu, SlideId } from "../../core/document-model";
import { emuToUnit, unitLabel, type LengthUnit } from "./inspector-geometry";
import { AlignGrid, type AlignCell } from "./AlignGrid";

export interface MultiSelectionPanelProps {
  slideId: SlideId;
  /** 选中的对象。 */
  elementIds: readonly ElementId[];
  /** 选中的对象的外接框。 */
  bounds: RectEmu;
  unit: LengthUnit;
  onCommand: (command: DocumentCommand) => void;
  onDelete: () => void;
}

/**
 * 多选时的属性面板。
 *
 * 选了一个对象时面板显示那个对象的全部属性；选了多个时，这些属性大多
 * 各不相同，硬凑一个公共值反而会误导人。这里只显示这一组确定成立的信息：
 * 有几个对象、它们合起来占多大地方，以及对齐和分布。
 */
export const MultiSelectionPanel = memo(function MultiSelectionPanel({
  slideId,
  elementIds,
  bounds,
  unit,
  onCommand,
  onDelete,
}: MultiSelectionPanelProps) {
  const align = (cell: AlignCell) => {
    onCommand({
      type: "align-elements",
      slideId,
      elementIds: [...elementIds],
      align: cell.single
        ? cell.horizontal === "center"
          ? { vertical: cell.vertical }
          : { horizontal: cell.horizontal }
        : { horizontal: cell.horizontal, vertical: cell.vertical },
    });
  };

  return (
    <div className="property-form">
      <div className="inspector-title">
        <Layers3 size={18} />
        <span>属性</span>
        <span className="type-chip">已选 {elementIds.length} 个</span>
      </div>

      <section className="inspector-section">
        <h4>整组范围</h4>
        <div className="property-grid">
          <div className="field">
            <span className="field-label">X</span>
            <span className="field-value">
              {emuToUnit(bounds.x as Emu, unit).toFixed(2)} {unitLabel(unit)}
            </span>
          </div>
          <div className="field">
            <span className="field-label">Y</span>
            <span className="field-value">
              {emuToUnit(bounds.y as Emu, unit).toFixed(2)} {unitLabel(unit)}
            </span>
          </div>
          <div className="field">
            <span className="field-label">宽度</span>
            <span className="field-value">
              {emuToUnit(bounds.width as Emu, unit).toFixed(2)} {unitLabel(unit)}
            </span>
          </div>
          <div className="field">
            <span className="field-label">高度</span>
            <span className="field-value">
              {emuToUnit(bounds.height as Emu, unit).toFixed(2)} {unitLabel(unit)}
            </span>
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <h4>对齐（相对这一组）</h4>
        <AlignGrid onAlign={align} />
        <p className="field-help">按这一组对象的外接框对齐，不是按页面。</p>
      </section>

      <section className="inspector-section">
        <h4>分布</h4>
        <div className="field-row">
          <button
            type="button"
            className="toggle-button"
            disabled={elementIds.length < 3}
            title={elementIds.length < 3 ? "至少选三个对象才能分布" : "水平方向等距分布"}
            onClick={() =>
              onCommand({ type: "distribute-elements", slideId, elementIds: [...elementIds], axis: "horizontal" })
            }
          >
            <AlignHorizontalDistributeCenter />
            水平等距
          </button>
          <button
            type="button"
            className="toggle-button"
            disabled={elementIds.length < 3}
            title={elementIds.length < 3 ? "至少选三个对象才能分布" : "垂直方向等距分布"}
            onClick={() =>
              onCommand({ type: "distribute-elements", slideId, elementIds: [...elementIds], axis: "vertical" })
            }
          >
            <AlignVerticalDistributeCenter />
            垂直等距
          </button>
        </div>
      </section>

      <section className="inspector-section">
        <div className="field-row">
          <button type="button" className="toggle-button" onClick={onDelete}>
            <Trash2 />
            删除这 {elementIds.length} 个对象
          </button>
        </div>
      </section>
    </div>
  );
});
