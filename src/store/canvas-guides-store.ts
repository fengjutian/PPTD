import { create } from "zustand";
import type { Emu, SlideId } from "../core/document-model";
import { DEFAULT_GRID_SIZE } from "../core/rendering/snap";

/**
 * 画布辅助元素的状态：网格开关和参考线。
 *
 * 这些东西只属于编辑过程，不进入文档模型——它们不改变内容哈希，不产生
 * 撤销项，导出时也不写进 PPTX。把它们放进文档会让"改一次视图"变成
 * "改一次文稿"。
 */
export type GuideAxis = "x" | "y";

export interface CanvasGuide {
  id: string;
  /** x 方向的线是竖线，y 方向的线是横线。 */
  axis: GuideAxis;
  /** 页面坐标，EMU。 */
  position: Emu;
}

interface CanvasGuidesState {
  /** 每页的参考线。切换页面时各自独立。 */
  guidesBySlide: Record<string, CanvasGuide[]>;
  /** 是否画出网格。 */
  gridEnabled: boolean;
  /** 网格线是否参与吸附。 */
  gridSnapEnabled: boolean;
  /** 吸附总开关。 */
  snapEnabled: boolean;
  gridSize: Emu;
  /** 拖拽过程中命中的吸附线，页面坐标。用于画布上的提示线。 */
  activeSnapX?: number;
  activeSnapY?: number;
  toggleGrid: () => void;
  toggleGridSnap: () => void;
  toggleSnap: () => void;
  setGridSize: (size: Emu) => void;
  setActiveSnap: (position: { x?: number; y?: number }) => void;
  addGuide: (slideId: SlideId, axis: GuideAxis, position: Emu) => void;
  moveGuide: (slideId: SlideId, guideId: string, position: Emu) => void;
  removeGuide: (slideId: SlideId, guideId: string) => void;
  clearGuides: (slideId: SlideId) => void;
}

let guideCounter = 0;
const nextGuideId = (): string => {
  guideCounter += 1;
  return `guide-${guideCounter}`;
};

export const useCanvasGuidesStore = create<CanvasGuidesState>((set) => ({
  guidesBySlide: {},
  gridEnabled: true,
  gridSnapEnabled: false,
  snapEnabled: true,
  gridSize: DEFAULT_GRID_SIZE,
  activeSnapX: undefined,
  activeSnapY: undefined,

  toggleGrid: () => set((state) => ({ gridEnabled: !state.gridEnabled })),
  toggleGridSnap: () => set((state) => ({ gridSnapEnabled: !state.gridSnapEnabled })),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setGridSize: (gridSize) => set({ gridSize }),
  // 拖拽时每移动一个像素都会调用一次，值没变就不必通知订阅者。
  setActiveSnap: ({ x, y }) => set((state) => (
    state.activeSnapX === x && state.activeSnapY === y ? state : { activeSnapX: x, activeSnapY: y }
  )),

  addGuide: (slideId, axis, position) => set((state) => ({
    guidesBySlide: {
      ...state.guidesBySlide,
      [slideId]: [...(state.guidesBySlide[slideId] ?? []), { id: nextGuideId(), axis, position }],
    },
  })),

  moveGuide: (slideId, guideId, position) => set((state) => ({
    guidesBySlide: {
      ...state.guidesBySlide,
      [slideId]: (state.guidesBySlide[slideId] ?? []).map((guide) => (guide.id === guideId ? { ...guide, position } : guide)),
    },
  })),

  removeGuide: (slideId, guideId) => set((state) => ({
    guidesBySlide: {
      ...state.guidesBySlide,
      [slideId]: (state.guidesBySlide[slideId] ?? []).filter((guide) => guide.id !== guideId),
    },
  })),

  clearGuides: (slideId) => set((state) => ({
    guidesBySlide: { ...state.guidesBySlide, [slideId]: [] },
  })),
}));
