import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  slides: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000) })).min(1).max(20),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export const MINIMAX_MODELS = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"] as const;

export async function generateWithMiniMax(topic: string, slideCount: number): Promise<AiDraft> {
  const model = localStorage.getItem("pptd:minimax-model") || "MiniMax-M3";
  const raw = await invoke<unknown>("generate_presentation", { request: { topic, slideCount, model } });
  const draft = aiDraftSchema.parse(raw);
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  return draft;
}

export const minimaxKeyConfigured = () => invoke<boolean>("minimax_api_key_configured");
export const saveMiniMaxKey = (apiKey: string) => invoke<void>("save_minimax_api_key", { apiKey });
export const deleteMiniMaxKey = () => invoke<void>("delete_minimax_api_key");
export const testMiniMaxConnection = (model: string) => invoke<string>("test_minimax_connection", { model });
