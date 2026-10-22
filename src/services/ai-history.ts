import { z } from "zod";
import { sanitizeDraftForSave } from "./ai-draft-content";
import { aiDraftSchema, type AiDraft } from "./ai-service";
import { loadStoredAiHistory, saveStoredAiHistory } from "./app-database";

const historyEntrySchema = z.object({
  id: z.string().uuid(),
  topic: z.string().max(4000),
  slideCount: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  draft: aiDraftSchema,
});
const historySchema = z.array(historyEntrySchema).max(20);

export type AiHistoryEntry = z.infer<typeof historyEntrySchema>;

const parseHistory = (entries: unknown[]): AiHistoryEntry[] =>
  historySchema
    .parse(entries.filter((entry) => historyEntrySchema.safeParse(entry).success))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export async function loadAiHistory(): Promise<AiHistoryEntry[]> {
  return parseHistory(await loadStoredAiHistory());
}

export async function saveAiHistory(entry: { id: string; topic: string; slideCount: number; draft: AiDraft }): Promise<AiHistoryEntry[]> {
  // A draft is saved while it is still being reviewed, so partially emptied
  // fields are normal here. Sanitizing keeps the next load from dropping the
  // whole entry because the storage schema requires present fields.
  const next: AiHistoryEntry = { ...entry, draft: sanitizeDraftForSave(entry.draft), updatedAt: new Date().toISOString() };
  return parseHistory(await saveStoredAiHistory(next));
}
