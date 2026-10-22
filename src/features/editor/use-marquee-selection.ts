import { useCallback, useRef, useState } from "react";
import type { ElementId, RectEmu } from "../../core/document-model";
import { framesInSelection } from "../../core/commands/arrange";

export interface MarqueeBand {
  /** 选框在页面坐标里的位置。 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarqueeOptions {
  /** 每一 EMU 对应多少屏幕像素。 */
  scale: number;
  /** 页面上可选的对象。 */
  elements: readonly { id: ElementId; frame: RectEmu }[];
  /** 选框结束后报告选中的对象。 */
  onSelect: (ids: ElementId[]) => void;
  /** 点了一下空白处，没有拖出选框。 */
  onClear: () => void;
}

/** 拖动距离小于这个值（屏幕像素）就当作"点了一下"，不是框选。 */
const CLICK_THRESHOLD_PX = 3;

/**
 * 画布上的框选。
 *
 * 在空白处按住拖动，画出一个选框，框住的对象都被选中。这是多选最主要的
 * 入口：比逐个 Ctrl 加选快得多。
 */
export function useMarqueeSelection({ scale, elements, onSelect, onClear }: MarqueeOptions) {
  const [band, setBand] = useState<MarqueeBand | null>(null);
  const drag = useRef<{
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // 只有主键才框选；右键和中键留给别的用途。
      if (event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const originX = (event.clientX - rect.left) / scale;
      const originY = (event.clientY - rect.top) / scale;
      drag.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX,
        originY,
        lastX: originX,
        lastY: originY,
        moved: false,
      };

      const move = (moveEvent: PointerEvent) => {
        const current = drag.current;
        if (!current) return;
        const dx = moveEvent.clientX - current.startClientX;
        const dy = moveEvent.clientY - current.startClientY;
        if (!current.moved && Math.hypot(dx, dy) < CLICK_THRESHOLD_PX) return;
        current.moved = true;
        const x = (moveEvent.clientX - rect.left) / scale;
        const y = (moveEvent.clientY - rect.top) / scale;
        current.lastX = x;
        current.lastY = y;
        setBand({
          x: Math.min(current.originX, x),
          y: Math.min(current.originY, y),
          width: Math.abs(x - current.originX),
          height: Math.abs(y - current.originY),
        });
      };

      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        const current = drag.current;
        drag.current = null;
        setBand(null);
        if (!current) return;
        if (!current.moved) {
          onClear();
          return;
        }
        // 选框以按下点为起点、以松开点为终点，两点构成矩形。
        const selection: RectEmu = {
          x: Math.min(current.originX, current.lastX) as RectEmu["x"],
          y: Math.min(current.originY, current.lastY) as RectEmu["y"],
          width: Math.abs(current.lastX - current.originX) as RectEmu["width"],
          height: Math.abs(current.lastY - current.originY) as RectEmu["height"],
        };
        onSelect(framesInSelection(elements, selection));
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [scale, elements, onSelect, onClear],
  );

  return { band, onPointerDown };
}
