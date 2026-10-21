import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  slides: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000) })).min(1).max(20),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
const normalizedFrameSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) });
const textDesignSchema = z.object({ frame: normalizedFrameSchema, fontSizePt: z.number().min(8).max(72), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), bold: z.boolean(), align: z.enum(["left", "center", "right"]) });
export const aiPresentationDesignSchema = z.object({
  slides: z.array(z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    title: textDesignSchema,
    body: textDesignSchema,
    accents: z.array(z.object({ frame: normalizedFrameSchema, shape: z.enum(["rectangle", "ellipse"]), fill: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(6),
  })).min(1).max(20),
});
export type AiPresentationDesign = z.infer<typeof aiPresentationDesignSchema>;
export interface DesignTemplateContext { slideWidthEmu: number | null; slideHeightEmu: number | null; themeColors: Array<{ name: string; value: string }>; majorFont: string | null; minorFont: string | null; slides: Array<{ index: number; title: string; textCount: number; imageCount: number; shapeCount: number; layout: string | null }> }
export const MINIMAX_MODELS = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"] as const;

export async function generateWithMiniMax(topic: string, slideCount: number): Promise<AiDraft> {
  const model = localStorage.getItem("pptd:minimax-model") || "MiniMax-M3";
  const raw = await invoke<unknown>("generate_presentation", { request: { topic, slideCount, model } });
  const draft = aiDraftSchema.parse(raw);
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  return draft;
}

export async function generateDesignWithMiniMax(draft: AiDraft, template: DesignTemplateContext): Promise<AiPresentationDesign> {
  const model = localStorage.getItem("pptd:minimax-model") || "MiniMax-M3";
  const raw = await invoke<unknown>("generate_presentation_design", { request: { draft, template, model } });
  const design = aiPresentationDesignSchema.parse(raw);
  if (design.slides.length !== draft.slides.length) throw new Error("AI_DESIGN_SLIDE_COUNT_MISMATCH");
  return design;
}

export const minimaxKeyConfigured = () => invoke<boolean>("minimax_api_key_configured");
export const saveMiniMaxKey = (apiKey: string) => invoke<void>("save_minimax_api_key", { apiKey });
export const deleteMiniMaxKey = () => invoke<void>("delete_minimax_api_key");
export const testMiniMaxConnection = (model: string) => invoke<string>("test_minimax_connection", { model });
