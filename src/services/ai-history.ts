import { z } from "zod";
import { aiDraftSchema, type AiDraft } from "./ai-service";

const storageKey = "pptd:ai-draft-history";
const historyEntrySchema = z.object({
  id: z.string().uuid(),
  topic: z.string().max(4000),
  slideCount: z.number().int().min(1).max(20),
  updatedAt: z.string().datetime(),
  draft: aiDraftSchema,
});
const historySchema = z.array(historyEntrySchema).max(20);

export type AiHistoryEntry = z.infer<typeof historyEntrySchema>;

export function loadAiHistory(): AiHistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    return historySchema.parse(JSON.parse(raw)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveAiHistory(entry: { id: string; topic: string; slideCount: number; draft: AiDraft }): AiHistoryEntry[] {
  const next: AiHistoryEntry = { ...entry, updatedAt: new Date().toISOString() };
  const history = [next, ...loadAiHistory().filter((item) => item.id !== entry.id)].slice(0, 20);
  localStorage.setItem(storageKey, JSON.stringify(history));
  return history;
}
