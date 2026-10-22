import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import { applyCommand, commandDomain, type ChangeDomain, type DocumentCommand } from "../core/commands";
import { createDocument, refreshContentHashes, type ElementId, type PresentationDocument, type SlideId } from "../core/document-model";

enablePatches();

const HISTORY_LIMIT = 100;
// 撤销栈的字节预算。图片 add/delete 的 patch 携带 base64，一个 10 MB 图片的
// patch 就超过整个文本编辑历史；限制总量，避免大量图片操作让撤销栈无限膨胀。
// 超过预算时只丢弃最旧的条目，正常操作的撤销语义不变。
const HISTORY_BYTE_BUDGET = 64 * 1024 * 1024;

interface HistoryEntry {
  forward: Patch[];
  inverse: Patch[];
}

/** 估算 patch 里大字符串的总长度。图片 base64 是唯一会达到 MB 级的部分。 */
function estimateValueBytes(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateValueBytes(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + estimateValueBytes(item), 0);
  }
  return 0;
}

function estimatePatchBytes(patch: Patch): number {
  if (patch.op !== "add" || patch.value === undefined) return 0;
  return estimateValueBytes(patch.value);
}

function estimateEntryBytes(entry: HistoryEntry): number {
  return entry.forward.reduce((sum, patch) => sum + estimatePatchBytes(patch), 0)
    + entry.inverse.reduce((sum, patch) => sum + estimatePatchBytes(patch), 0);
}

interface EditorState {
  document: PresentationDocument;
  activeSlideId: SlideId;
  selectedElementId: ElementId | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  execute: (command: DocumentCommand) => void;
  replaceDocument: (document: PresentationDocument, change?: ChangeDomain) => void;
  selectSlide: (slideId: SlideId) => void;
  selectElement: (elementId: ElementId | null) => void;
  undo: () => void;
  redo: () => void;
  newDocument: () => void;
  loadDocument: (document: PresentationDocument) => void;
}

const initial = createDocument();
const pushHistory = (stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] => {
  let next = [...stack, entry].slice(-HISTORY_LIMIT);
  let total = next.reduce((sum, item) => sum + estimateEntryBytes(item), 0);
  while (total > HISTORY_BYTE_BUDGET && next.length > 1) {
    total -= estimateEntryBytes(next[0]!);
    next = next.slice(1);
  }
  return next;
};

export const useEditorStore = create<EditorState>((set) => ({
  document: initial,
  activeSlideId: initial.slides[0]!.id,
  selectedElementId: null,
  undoStack: [],
  redoStack: [],

  execute: (command) => set((state) => {
    const domain = commandDomain(command, state.document);
    if (!domain) return state;
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
    let selectedElementId: ElementId | null = state.selectedElementId;
    if (command.type === "add-text" || command.type === "add-shape" || command.type === "add-image") {
      selectedElementId = document.slides.find((slide) => slide.id === command.slideId)!.elements.at(-1)!.id;
    }
    if (command.type === "duplicate-element") {
      const slide = document.slides.find((item) => item.id === command.slideId)!;
      const sourceIndex = state.document.slides.find((item) => item.id === command.slideId)!.elements.findIndex((item) => item.id === command.elementId);
      selectedElementId = slide.elements[sourceIndex + 1]!.id;
    }
    if (command.type === "set-element-lock") selectedElementId = command.elementId;
    if (command.type === "delete-element" && selectedElementId === command.elementId) selectedElementId = null;
    if (command.type === "add-slide" || command.type === "duplicate-slide" || command.type === "delete-slide" || command.type === "move-slide" || command.type === "apply-ai-draft" || command.type === "apply-ai-designed-draft") selectedElementId = null;
    if (selectedElementId && !document.slides.some((slide) => slide.elements.some((element) => element.id === selectedElementId))) selectedElementId = null;
    return { ...state, document, activeSlideId, selectedElementId, undoStack: pushHistory(state.undoStack, { forward, inverse }), redoStack: [] };
  }),

  replaceDocument: (document, change = "both") => set((state) => {
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
      selectedElementId: null,
      undoStack: pushHistory(state.undoStack, { forward, inverse }),
      redoStack: [],
    };
  }),

  selectSlide: (activeSlideId) => set({ activeSlideId, selectedElementId: null }),
  selectElement: (selectedElementId) => set({ selectedElementId }),

  undo: () => set((state) => {
    const entry = state.undoStack.at(-1);
    if (!entry) return state;
    const document = applyPatches(state.document, entry.inverse);
    return { ...state, document, activeSlideId: document.slides.some((s) => s.id === state.activeSlideId) ? state.activeSlideId : document.slides[0]!.id, undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, entry], selectedElementId: null };
  }),

  redo: () => set((state) => {
    const entry = state.redoStack.at(-1);
    if (!entry) return state;
    const document = applyPatches(state.document, entry.forward);
    return { ...state, document, activeSlideId: document.slides.some((s) => s.id === state.activeSlideId) ? state.activeSlideId : document.slides[0]!.id, undoStack: pushHistory(state.undoStack, entry), redoStack: state.redoStack.slice(0, -1), selectedElementId: null };
  }),
  newDocument: () => set(() => {
    const document = createDocument();
    return { document, activeSlideId: document.slides[0]!.id, selectedElementId: null, undoStack: [], redoStack: [] };
  }),
  loadDocument: (document) => set(() => {
    refreshContentHashes(document);
    return { document, activeSlideId: document.slides[0]!.id, selectedElementId: null, undoStack: [], redoStack: [] };
  }),
}));
