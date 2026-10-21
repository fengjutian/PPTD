import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import { applyCommand, commandDomain, type DocumentCommand } from "../core/commands";
import { createDocument, type ElementId, type PresentationDocument, type SlideId } from "../core/document-model";

enablePatches();

interface HistoryEntry { forward: Patch[]; inverse: Patch[] }

interface EditorState {
  document: PresentationDocument;
  activeSlideId: SlideId;
  selectedElementId: ElementId | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  execute: (command: DocumentCommand) => void;
  selectSlide: (slideId: SlideId) => void;
  selectElement: (elementId: ElementId | null) => void;
  undo: () => void;
  redo: () => void;
  newDocument: () => void;
  loadDocument: (document: PresentationDocument) => void;
}

const initial = createDocument();

export const useEditorStore = create<EditorState>((set) => ({
  document: initial,
  activeSlideId: initial.slides[0]!.id,
  selectedElementId: null,
  undoStack: [],
  redoStack: [],

  execute: (command) => set((state) => {
    const domain = commandDomain(command);
    if (!domain) return state;
    const [document, forward, inverse] = produceWithPatches(state.document, (draft) => {
      applyCommand(draft, command);
      draft.revisions.document += 1;
      if (domain === "content" || domain === "both") draft.revisions.content += 1;
      if (domain === "design" || domain === "both") draft.revisions.design += 1;
    });
    const activeSlideId = command.type === "add-slide" ? document.slides.at(-1)!.id : state.activeSlideId;
    return { ...state, document, activeSlideId, selectedElementId: null, undoStack: [...state.undoStack, { forward, inverse }], redoStack: [] };
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
    return { ...state, document, undoStack: [...state.undoStack, entry], redoStack: state.redoStack.slice(0, -1), selectedElementId: null };
  }),
  newDocument: () => set(() => {
    const document = createDocument();
    return { document, activeSlideId: document.slides[0]!.id, selectedElementId: null, undoStack: [], redoStack: [] };
  }),
  loadDocument: (document) => set(() => ({ document, activeSlideId: document.slides[0]!.id, selectedElementId: null, undoStack: [], redoStack: [] })),
}));
