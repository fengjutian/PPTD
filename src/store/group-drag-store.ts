import { create } from "zustand";
import type { ElementId, Emu } from "../core/document-model";

/**
 * 拖动一组对象时的临时状态。
 *
 * 这是一次拖拽的过程状态，不是文稿的一部分：它不进文档、不进撤销栈，
 * 拖完就没了。放在独立的 store 里，是因为每个对象都要读它——被拖着走的
 * 那些对象得跟着动，而它们的渲染和拖拽手柄在不同的组件里。
 */
export interface GroupDrag {
  /** 一起移动的对象。 */
  ids: ElementId[];
  /** 握着鼠标的那个对象。它自己用拖拽预览，其余对象用这里的偏移量。 */
  leaderId: ElementId;
  /** 整组的位移，页面坐标。 */
  dx: Emu;
  dy: Emu;
}

interface GroupDragState {
  groupDrag: GroupDrag | null;
  beginGroupDrag: (ids: ElementId[], leaderId: ElementId) => void;
  updateGroupDrag: (dx: Emu, dy: Emu) => void;
  endGroupDrag: () => void;
}

export const useGroupDragStore = create<GroupDragState>((set) => ({
  groupDrag: null,

  beginGroupDrag: (ids, leaderId) => set({ groupDrag: { ids, leaderId, dx: 0 as Emu, dy: 0 as Emu } }),
  updateGroupDrag: (dx, dy) => set((state) => (state.groupDrag ? { groupDrag: { ...state.groupDrag, dx, dy } } : state)),
  endGroupDrag: () => set({ groupDrag: null }),
}));
