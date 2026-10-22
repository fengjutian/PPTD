import { useMemo } from "react";
import type { SlideId } from "../../core/document-model";
import { buildSnapTargets, SNAP_THRESHOLD_PX, type SnapTarget } from "../../core/rendering/snap";
import { useCanvasGuidesStore } from "../../store/canvas-guides-store";

export interface SnapContext {
  /** 可吸附的目标，页面坐标。 */
  targets: { x: SnapTarget[]; y: SnapTarget[] };
  /** 吸附阈值，换算成页面坐标。 */
  threshold: number;
  /** 吸附是否打开。关闭时阈值取 0，任何距离都不会被吸附。 */
  enabled: boolean;
}

const EMPTY_GUIDES: readonly { axis: "x" | "y"; position: number }[] = [];

/**
 * 一页上所有的吸附目标。
 *
 * 目标由三部分组成：网格线、页面中线、用户摆的参考线。它们都活在
 * 编辑器这一层，不进文档模型，所以换一页的参考线不会影响文稿。
 *
 * 这个 hook 在画布层调用一次，目标算好后传给每个元素：目标集合对一页
 * 里的所有对象是同一份，没必要每个元素各算一遍。
 */
export function useSnapContext(slideId: SlideId, pageWidth: number, pageHeight: number, scale: number): SnapContext {
  const guides = useCanvasGuidesStore((state) => state.guidesBySlide[slideId]);
  const gridSnapEnabled = useCanvasGuidesStore((state) => state.gridSnapEnabled);
  const snapEnabled = useCanvasGuidesStore((state) => state.snapEnabled);
  const gridSize = useCanvasGuidesStore((state) => state.gridSize);

  const targets = useMemo(() => buildSnapTargets({
    gridSnapEnabled,
    gridSize,
    pageWidth,
    pageHeight,
    guides: guides ?? EMPTY_GUIDES,
  }), [gridSnapEnabled, gridSize, pageWidth, pageHeight, guides]);

  // 阈值是屏幕像素给出的，换算成页面坐标后缩放画布时手感不变。
  const threshold = scale > 0 ? SNAP_THRESHOLD_PX / scale : 0;
  return { targets, threshold, enabled: snapEnabled };
}
