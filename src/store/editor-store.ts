import { applyPatches, enablePatches, produceWithPatches } from "immer";
import { create } from "zustand";
import { applyCommand, commandDomain, type ChangeDomain, type DocumentCommand } from "../core/commands";
import {
  createDocument,
  refreshContentHashes,
  type ElementId,
  type PresentationDocument,
  type SlideId,
} from "../core/document-model";
import { createHistoryEntry, trimHistory, type HistoryEntry } from "./history-budget";

enablePatches();

const HISTORY_LIMIT = 100;
// 撤销栈的字节预算。图片 add/delete 的 patch 携带 base64，一个 10 MB 图片的
// patch 就超过整个文本编辑历史；限制总量，避免大量图片操作让撤销栈无限膨胀。
// 超过预算时只丢弃最旧的条目，正常操作的撤销语义不变。
const HISTORY_BYTE_BUDGET = 64 * 1024 * 1024;

interface EditorState {
  document: PresentationDocument;
  activeSlideId: SlideId;
  /**
   * 选中的对象。
   *
   * 多选是这个数组，不是一个可选的 id：只选一个时数组里只有一个元素。
   * 选中状态不进入文档，所以它不改变 revision，也不进撤销栈。
   */
  selectedElementIds: ElementId[];
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  execute: (command: DocumentCommand) => void;
  replaceDocument: (document: PresentationDocument, change?: ChangeDomain) => void;
  selectSlide: (slideId: SlideId) => void;
  /** 只选这一个对象，替换当前选择。 */
  selectElement: (elementId: ElementId | null) => void;
  /** 增减一个对象的选中状态（Ctrl 或 Shift 点击）。 */
  toggleElement: (elementId: ElementId) => void;
  /** 直接设定选中的一组对象（框选）。 */
  selectElements: (elementIds: ElementId[]) => void;
  undo: () => void;
  redo: () => void;
  newDocument: () => void;
  loadDocument: (document: PresentationDocument) => void;
}

const initial = createDocument();
const pushHistory = (stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] =>
  trimHistory(stack, entry, HISTORY_LIMIT, HISTORY_BYTE_BUDGET);

/**
 * 丢掉已经不在文档里的选中项。
 *
 * 删除、重排、换页都会让旧选择失效。选择状态必须跟着文档走，否则属性面板
 * 会显示一个已经不存在的对象。
 */
function pruneSelection(selected: ElementId[], document: PresentationDocument): ElementId[] {
  if (selected.length === 0) return selected;
  const alive = new Set(document.slides.flatMap((slide) => slide.elements.map((element) => element.id)));
  const next = selected.filter((id) => alive.has(id));
  return next.length === selected.length ? selected : next;
}

export const useEditorStore = create<EditorState>((set) => ({
  document: initial,
  activeSlideId: initial.slides[0]!.id,
  selectedElementIds: [],
  undoStack: [],
  redoStack: [],

  execute: (command) =>
    set((state) => {
      const domain = commandDomain(command, state.document);
      if (!domain) return state;
      // A group copy whose sources are all locked copies nothing. It must not
      // bump a revision or leave an undo entry that cannot change the document.
      if (command.type === "duplicate-elements") {
        const slide = state.document.slides.find((item) => item.id === command.slideId);
        const copyable = command.elementIds.some((id) => {
          const element = slide?.elements.find((item) => item.id === id);
          return element !== undefined && !element.locked;
        });
        if (!copyable) return state;
      }
      const [document, forward, inverse] = produceWithPatches(state.document, (draft) => {
        applyCommand(draft, command);
        draft.revisions.document += 1;
        if (domain === "content" || domain === "both") draft.revisions.content += 1;
        if (domain === "design" || domain === "both") draft.revisions.design += 1;
        refreshContentHashes(draft);
      });
      let activeSlideId = state.activeSlideId;
      if (command.type === "add-slide") activeSlideId = document.slides.at(-1)!.id;
      if (command.type === "duplicate-slide") {
        const sourceIndex = state.document.slides.findIndex((slide) => slide.id === command.slideId);
        activeSlideId = document.slides[sourceIndex + 1]!.id;
      }
      if (!document.slides.some((slide) => slide.id === activeSlideId)) {
        const previousIndex = state.document.slides.findIndex((slide) => slide.id === state.activeSlideId);
        activeSlideId = document.slides[Math.min(previousIndex, document.slides.length - 1)]!.id;
      }
      // Design edits on the selected element must not drop the selection, otherwise
      // handles disappear after a drag and repeated keyboard nudges stop working.
      let selectedElementIds = state.selectedElementIds;
      if (command.type === "add-text" || command.type === "add-shape" || command.type === "add-image" || command.type === "add-line") {
        selectedElementIds = [document.slides.find((slide) => slide.id === command.slideId)!.elements.at(-1)!.id];
      }
      if (command.type === "duplicate-element") {
        const slide = document.slides.find((item) => item.id === command.slideId)!;
        const sourceIndex = state.document.slides
          .find((item) => item.id === command.slideId)!
          .elements.findIndex((item) => item.id === command.elementId);
        selectedElementIds = [slide.elements[sourceIndex + 1]!.id];
      }
      if (command.type === "duplicate-elements") {
        // 复制整组后选中这一组副本：用户能立刻看出复制出了什么。按插入前后
        // 的 id 差集选，而不是按 elementIds 的数量切片——锁定元素会被命令
        // 跳过，数量切片会把后面未复制的元素也选进来。
        const before = new Set(
          state.document.slides.find((item) => item.id === command.slideId)?.elements.map((item) => item.id) ?? [],
        );
        const slide = document.slides.find((item) => item.id === command.slideId)!;
        const copies = slide.elements.filter((item) => !before.has(item.id)).map((item) => item.id);
        if (copies.length > 0) selectedElementIds = copies;
      }
      if (command.type === "set-element-lock") selectedElementIds = [command.elementId];
      if (command.type === "delete-element")
        selectedElementIds = selectedElementIds.filter((id) => id !== command.elementId);
      // `delete-elements` may leave locked objects in place, so the selection is
      // pruned against the resulting document (below) rather than dropped by id.
      if (
        command.type === "add-slide" ||
        command.type === "duplicate-slide" ||
        command.type === "delete-slide" ||
        command.type === "move-slide" ||
        command.type === "apply-ai-draft" ||
        command.type === "apply-ai-designed-draft"
      )
        selectedElementIds = [];
      selectedElementIds = pruneSelection(selectedElementIds, document);
      return {
        ...state,
        document,
        activeSlideId,
        selectedElementIds,
        undoStack: pushHistory(state.undoStack, createHistoryEntry(forward, inverse)),
        redoStack: [],
      };
    }),

  replaceDocument: (document, change = "both") =>
    set((state) => {
      const [nextDocument, forward, inverse] = produceWithPatches(state.document, (draft) => {
        draft.id = document.id;
        draft.schemaVersion = document.schemaVersion;
        draft.title = document.title;
        draft.pageSize = { ...document.pageSize };
        draft.slides = structuredClone(document.slides);
        // The template binding belongs to the document, not to a single page. A
        // page carries a reference to a layout, so dropping the layout registry
        // here would leave every reference dangling: the saved file could no
        // longer be read back and the exporter would lose the slide master.
        if (document.theme) draft.theme = structuredClone(document.theme);
        else delete draft.theme;
        if (document.layouts) draft.layouts = structuredClone(document.layouts);
        else delete draft.layouts;
        refreshContentHashes(draft);
        draft.revisions = {
          document: draft.revisions.document + 1,
          content: draft.revisions.content + (change === "content" || change === "both" ? 1 : 0),
          design: draft.revisions.design + (change === "design" || change === "both" ? 1 : 0),
        };
      });
      return {
        ...state,
        document: nextDocument,
        activeSlideId: nextDocument.slides[0]!.id,
        selectedElementIds: [],
        undoStack: pushHistory(state.undoStack, createHistoryEntry(forward, inverse)),
        redoStack: [],
      };
    }),

  selectSlide: (activeSlideId) => set({ activeSlideId, selectedElementIds: [] }),
  selectElement: (elementId) => set({ selectedElementIds: elementId ? [elementId] : [] }),
  toggleElement: (elementId) =>
    set((state) => ({
      selectedElementIds: state.selectedElementIds.includes(elementId)
        ? state.selectedElementIds.filter((id) => id !== elementId)
        : [...state.selectedElementIds, elementId],
    })),
  selectElements: (elementIds) => set({ selectedElementIds: [...new Set(elementIds)] }),

  undo: () =>
    set((state) => {
      const entry = state.undoStack.at(-1);
      if (!entry) return state;
      const document = applyPatches(state.document, entry.inverse);
      return {
        ...state,
        document,
        activeSlideId: document.slides.some((s) => s.id === state.activeSlideId)
          ? state.activeSlideId
          : document.slides[0]!.id,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, entry],
        selectedElementIds: [],
      };
    }),

  redo: () =>
    set((state) => {
      const entry = state.redoStack.at(-1);
      if (!entry) return state;
      const document = applyPatches(state.document, entry.forward);
      return {
        ...state,
        document,
        activeSlideId: document.slides.some((s) => s.id === state.activeSlideId)
          ? state.activeSlideId
          : document.slides[0]!.id,
        undoStack: pushHistory(state.undoStack, entry),
        redoStack: state.redoStack.slice(0, -1),
        selectedElementIds: [],
      };
    }),
  newDocument: () =>
    set(() => {
      const document = createDocument();
      return { document, activeSlideId: document.slides[0]!.id, selectedElementIds: [], undoStack: [], redoStack: [] };
    }),
  loadDocument: (document) =>
    set(() => {
      refreshContentHashes(document);
      return { document, activeSlideId: document.slides[0]!.id, selectedElementIds: [], undoStack: [], redoStack: [] };
    }),
}));
