import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  slides: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000) })).min(1).max(20),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;

export async function generateWithMiniMax(topic: string, slideCount: number): Promise<AiDraft> {
  const raw = await invoke<unknown>("generate_presentation", { request: { topic, slideCount } });
  const draft = aiDraftSchema.parse(raw);
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  return draft;
}
