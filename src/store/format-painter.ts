import { create } from "zustand";
import type { TextElementStyle } from "../core/document-model";

/**
 * The text format held by the format painter.
 *
 * It is a UI tool, not a document property: copying a format changes no
 * revision and leaves no undo entry. Only pasting it onto a text creates one
 * command. `locked` turns a single click into "keep the brush until Esc", the
 * same behaviour as the double-clicked format painter in PowerPoint.
 */
interface FormatPainterState {
  style?: Partial<TextElementStyle>;
  locked: boolean;
  copy: (style: Partial<TextElementStyle>, locked?: boolean) => void;
  consume: () => void;
  cancel: () => void;
}

export const useFormatPainterStore = create<FormatPainterState>((set) => ({
  style: undefined,
  locked: false,
  copy: (style, locked = false) => set({ style, locked }),
  // A locked brush survives an application; a single-use brush goes away.
  consume: () => set((state) => (state.locked ? state : { style: undefined, locked: false })),
  cancel: () => set({ style: undefined, locked: false }),
}));
