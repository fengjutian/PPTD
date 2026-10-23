import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Lock,
  LockOpen,
  RotateCw,
} from "lucide-react";
import type { DocumentCommand } from "../../core/commands";
import type { ElementId, SlideElement, SlideId } from "../../core/document-model";

type HorizontalTarget = "left" | "center" | "right";
type VerticalTarget = "top" | "middle" | "bottom";

interface ArrangeToolbarProps {
  slideId: SlideId;
  /** The selected objects, locked ones included. */
  selected: SlideElement[];
  execute: (command: DocumentCommand) => void;
}

/**
 * The alignment, distribution, rotation and lock controls of the “排列” ribbon.
 *
 * A single object aligns to the page; a multi selection aligns to its own
 * bounding box, which is what “align left” means when several objects are
 * picked. Distribute needs at least three objects, rotation is one-object only
 * (rotating a group about its centre would also move every frame), and lock is
 * a batch command so it stays one undo step.
 */
export function ArrangeToolbar({ slideId, selected, execute }: ArrangeToolbarProps) {
  const editable = selected.filter((element) => !element.locked);
  const single = selected.length === 1 ? selected[0] : undefined;
  const elementIds = selected.map((element) => element.id) as ElementId[];
  const lockedAll = selected.length > 0 && selected.every((element) => element.locked);
  const relative = selected.length > 1 ? "相对所选对象" : "相对页面";
  // Aligning one object to itself is a no-op that would still add an undo
  // entry; a single object aligns to the page instead.
  const canAlign = single ? !single.locked : editable.length >= 2;

  const align = (horizontal?: HorizontalTarget, vertical?: VerticalTarget) => {
    if (editable.length === 0) return;
    if (single) {
      execute({
        type: "align-element",
        slideId,
        elementId: single.id,
        align: horizontal ?? vertical!,
      });
      return;
    }
    execute({
      type: "align-elements",
      slideId,
      elementIds: editable.map((element) => element.id),
      align: { ...(horizontal ? { horizontal } : {}), ...(vertical ? { vertical } : {}) },
    });
  };

  const rotate = () => {
    if (!single || single.locked) return;
    execute({
      type: "transform-element",
      slideId,
      elementId: single.id,
      frame: single.frame,
      rotationMilliDegree: (single.rotationMilliDegree + 90_000) % 360_000,
    });
  };

  const toggleLock = () => {
    if (selected.length === 0) return;
    execute({ type: "set-elements-lock", slideId, elementIds, locked: !lockedAll });
  };

  const alignButton = (label: string, icon: React.ReactNode, onClick: () => void, disabled: boolean) => (
    <button
      type="button"
      aria-label={`${label}（${relative}）`}
      title={`${label}（${relative}）`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className="arrange-extra-tools" role="group" aria-label="对齐、分布、旋转与锁定">
      <div className="arrange-icon-group" role="group" aria-label="对齐">
        {alignButton("左对齐", <AlignStartVertical />, () => align("left"), !canAlign)}
        {alignButton("水平居中", <AlignCenterVertical />, () => align("center"), !canAlign)}
        {alignButton("右对齐", <AlignEndVertical />, () => align("right"), !canAlign)}
        {alignButton("顶端对齐", <AlignStartHorizontal />, () => align(undefined, "top"), !canAlign)}
        {alignButton("垂直居中", <AlignCenterHorizontal />, () => align(undefined, "middle"), !canAlign)}
        {alignButton("底端对齐", <AlignEndHorizontal />, () => align(undefined, "bottom"), !canAlign)}
      </div>
      <div className="arrange-icon-group" role="group" aria-label="分布">
        <button
          type="button"
          aria-label="水平等距分布"
          title="水平等距分布（至少三个对象）"
          disabled={editable.length < 3}
          onClick={() => execute({ type: "distribute-elements", slideId, elementIds, axis: "horizontal" })}
        >
          <AlignHorizontalDistributeCenter />
        </button>
        <button
          type="button"
          aria-label="垂直等距分布"
          title="垂直等距分布（至少三个对象）"
          disabled={editable.length < 3}
          onClick={() => execute({ type: "distribute-elements", slideId, elementIds, axis: "vertical" })}
        >
          <AlignVerticalDistributeCenter />
        </button>
      </div>
      <button
        type="button"
        className="arrange-single-action"
        aria-label="顺时针旋转 90 度"
        title={single ? "顺时针旋转 90 度" : "旋转一次只作用于一个对象"}
        disabled={!single || single.locked}
        onClick={rotate}
      >
        <RotateCw />
      </button>
      <button
        type="button"
        className="arrange-single-action"
        aria-label={lockedAll ? "解锁所选对象" : "锁定所选对象"}
        title={lockedAll ? "解锁所选对象" : "锁定所选对象"}
        disabled={selected.length === 0}
        onClick={toggleLock}
      >
        {lockedAll ? <LockOpen /> : <Lock />}
      </button>
    </div>
  );
}
