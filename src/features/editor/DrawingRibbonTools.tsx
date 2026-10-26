import { Move } from "lucide-react";

import type { DocumentCommand } from "../../core/commands";
import type { ShapeElement, SlideId, SlideElement } from "../../core/document-model";
import { normalizeHexColor } from "./inspector-color";
import { RibbonCompactButton } from "./RibbonGroup";
import { ShapePicker } from "./ShapePicker";

/**
 * Drawing commands of the Home tab.
 *
 * PowerPoint puts the common shapes, fill, outline and arrange entry in the
 * same group. The original Insert and Arrange tabs stay, so this is a second
 * entrance to the same commands rather than a parallel document model.
 */
export function DrawingRibbonTools({
  slideId,
  selected,
  onCommand,
  onOpenArrange,
}: {
  slideId: SlideId;
  selected: SlideElement[];
  onCommand: (command: DocumentCommand) => void;
  onOpenArrange: () => void;
}) {
  const shapes = selected.filter((element): element is ShapeElement => element.type === "shape" && !element.locked);
  const primary = shapes.at(-1);
  const disabled = !primary;
  const fillMixed = new Set(shapes.map((element) => element.style.fill.toUpperCase())).size > 1;
  const strokeMixed = new Set(shapes.map((element) => element.style.stroke.toUpperCase())).size > 1;
  const elementIds = shapes.map((element) => element.id);

  const apply = (style: { fill?: string; stroke?: string }) => {
    if (elementIds.length === 0) return;
    onCommand({ type: "set-shape-styles", slideId, elementIds, style });
  };

  return (
    <>
      <ShapePicker onPick={(shape) => onCommand({ type: "add-shape", slideId, shape })} />
      <div className="ribbon-shape-colors" role="group" aria-label="形状填充与轮廓">
        <label
          className="ribbon-color-control ribbon-shape-color"
          title={
            fillMixed
              ? "所选形状的填充不一致；选择颜色会把它们统一"
              : disabled
                ? "选择一个形状后可修改填充"
                : "形状填充"
          }
        >
          <span>填充</span>
          <input
            type="color"
            aria-label="形状填充"
            value={normalizeHexColor(primary?.style.fill ?? "#FFFFFF") ?? "#FFFFFF"}
            disabled={disabled}
            onChange={(event) => apply({ fill: event.target.value.toUpperCase() })}
          />
        </label>
        <label
          className="ribbon-color-control ribbon-shape-color"
          title={
            strokeMixed
              ? "所选形状的轮廓不一致；选择颜色会把它们统一"
              : disabled
                ? "选择一个形状后可修改轮廓"
                : "形状轮廓"
          }
        >
          <span>轮廓</span>
          <input
            type="color"
            aria-label="形状轮廓"
            value={normalizeHexColor(primary?.style.stroke ?? "#000000") ?? "#000000"}
            disabled={disabled}
            onChange={(event) => apply({ stroke: event.target.value.toUpperCase() })}
          />
        </label>
      </div>
      <RibbonCompactButton label="排列：对齐、分布、旋转、锁定和组合" caption="排列" onClick={onOpenArrange}>
        <Move />
      </RibbonCompactButton>
    </>
  );
}
