import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import { applyCommand, commandDomain, type ChangeDomain, type DocumentCommand } from "../core/commands";
import { createDocument, refreshContentHashes, type ElementId, type PresentationDocument, type SlideId } from "../core/document-model";

enablePatches();

const HISTORY_LIMIT = 100;

interface HistoryEntry {
  forward: Patch[];
  inverse: Patch[];
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
const pushHistory = (stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] => [...stack, entry].slice(-HISTORY_LIMIT);

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
