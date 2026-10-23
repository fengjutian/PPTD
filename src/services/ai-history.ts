import { z } from "zod";
import { presentationDocumentSchema, type PresentationDocument } from "../core/document-model";
import { sanitizeDraftForSave } from "./ai-draft-content";
import { aiDraftSchema, type AiDraft } from "./ai-service";
import { loadStoredAiHistory, saveStoredAiHistory } from "./app-database";

const storedDraftSchema = aiDraftSchema.extend({
  generatedPresentation: presentationDocumentSchema.optional(),
});

const storedHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  topic: z.string().max(4000),
  slideCount: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  draft: storedDraftSchema,
});
const historyEntrySchema = storedHistoryEntrySchema.transform(({ draft, ...entry }) => ({
  ...entry,
  draft: aiDraftSchema.parse(draft),
  presentation: draft.generatedPresentation as PresentationDocument | undefined,
}));
export type AiHistoryEntry = z.infer<typeof historyEntrySchema>;

const parseHistory = (entries: unknown[]): AiHistoryEntry[] =>
  entries
    .flatMap((entry) => {
      const parsed = historyEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20);

export async function loadAiHistory(): Promise<AiHistoryEntry[]> {
  return parseHistory(await loadStoredAiHistory());
}

export async function saveAiHistory(entry: {
  id: string;
  topic: string;
  slideCount: number;
  draft: AiDraft;
}): Promise<AiHistoryEntry[]> {
  // A draft is saved while it is still being reviewed, so partially emptied
  // fields are normal here. Sanitizing keeps the next load from dropping the
  // whole entry because the storage schema requires present fields.
  const existing = parseHistory(await loadStoredAiHistory()).find((item) => item.id === entry.id);
  const next = {
    ...entry,
    draft: {
      ...sanitizeDraftForSave(entry.draft),
      ...(existing?.presentation ? { generatedPresentation: existing.presentation } : {}),
    },
    updatedAt: new Date().toISOString(),
  };
  return parseHistory(await saveStoredAiHistory(next));
}

export async function saveAiPresentation(id: string, presentation: PresentationDocument): Promise<AiHistoryEntry[]> {
  const entries = parseHistory(await loadStoredAiHistory());
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) throw new Error("AI_HISTORY_ENTRY_NOT_FOUND");
  return parseHistory(
    await saveStoredAiHistory({
      id: existing.id,
      topic: existing.topic,
      slideCount: existing.slideCount,
      updatedAt: new Date().toISOString(),
      draft: {
        ...sanitizeDraftForSave(existing.draft),
        generatedPresentation: presentationDocumentSchema.parse(presentation),
      },
    }),
  );
}
