import { z } from "zod";
import { parsePresentationDocument, type PresentationDocument } from "../core/document-model";
import { sanitizeDraftForSave } from "./ai-draft-content";
import { aiDraftSchema, type AiDraft } from "./ai-service";
import { loadStoredAiHistory, saveStoredAiHistory, type StoredAiHistoryEntry } from "./app-database";

const storedDraftSchema = aiDraftSchema.extend({
  // 生成后的文稿会长期留在历史里，可能停留在旧 schema 版本。这里保存原值、
  // 逐条迁移；若直接用当前版本的 Schema 校验，schema 一升级每条老记录都会
  // 整体失败，parseHistory 再把它们静默丢掉，用户看到的就是“草稿全没了”。
  generatedPresentation: z.unknown().optional(),
});

const storedHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  topic: z.string().max(4000),
  slideCount: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  draft: storedDraftSchema,
});
const historyEntrySchema = storedHistoryEntrySchema.transform(({ draft, ...entry }) => {
  const { generatedPresentation, ...content } = draft;
  return {
    ...entry,
    draft: aiDraftSchema.parse(content),
    presentation: migratePresentation(generatedPresentation),
  };
});
export type AiHistoryEntry = z.infer<typeof historyEntrySchema>;

function migratePresentation(value: unknown): PresentationDocument | undefined {
  if (value === undefined) return undefined;
  try {
    return parsePresentationDocument(value);
  } catch {
    // 文稿读不出来时草稿正文仍然可用，条目照常保留，不连正文一起丢。
    return undefined;
  }
}

const parseHistory = (entries: unknown[]): AiHistoryEntry[] =>
  entries
    .flatMap((entry) => {
      const parsed = historyEntrySchema.safeParse(entry);
      if (!parsed.success) {
        // 静默丢弃会让“历史为空”看起来像用户数据没了，至少留下可排查的痕迹。
        const id = (entry as { id?: unknown } | null)?.id;
        console.warn("AI_HISTORY_ENTRY_UNREADABLE", typeof id === "string" ? id : undefined);
        return [];
      }
      return [parsed.data];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20);

function storedPresentation(rows: StoredAiHistoryEntry[], id: string): unknown {
  const draft = rows.find((row) => row.id === id)?.draft;
  if (typeof draft !== "object" || draft === null || !("generatedPresentation" in draft)) return undefined;
  return (draft as { generatedPresentation?: unknown }).generatedPresentation;
}

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
  const rows = await loadStoredAiHistory();
  const existing = parseHistory(rows).find((item) => item.id === entry.id);
  // 优先沿用已迁移的文稿；本构建迁移不了时原样写回，否则编辑一次草稿就会
  // 把读不出的文稿覆盖成空，等于真的删掉用户数据。
  const presentation = existing?.presentation ?? storedPresentation(rows, entry.id);
  const next = {
    ...entry,
    draft: {
      ...sanitizeDraftForSave(entry.draft),
      ...(presentation !== undefined ? { generatedPresentation: presentation } : {}),
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
        generatedPresentation: parsePresentationDocument(presentation),
      },
    }),
  );
}
