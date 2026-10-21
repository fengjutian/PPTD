import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  slides: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000) })).min(1).max(20),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export const aiPresentationDesignSchema = z.object({
  slides: z.array(z.object({
    layout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    bodyColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })).min(1).max(20),
});
export type AiPresentationDesign = z.infer<typeof aiPresentationDesignSchema>;
export interface DesignTemplateContext { slideWidthEmu: number | null; slideHeightEmu: number | null; themeColors: Array<{ name: string; value: string }>; majorFont: string | null; minorFont: string | null; slides: Array<{ index: number; title: string; textCount: number; imageCount: number; shapeCount: number; layout: string | null; regions: Array<{ role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }> }>; layouts: Array<{ index: number; name: string; regions: Array<{ role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }> }> }
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
  return {
    slides: design.slides.map((slide, index, slides) => {
      const content = draft.slides[index]!;
      const pointCount = content.body.split(/\n+|(?=\d+[.、]\s*)/).filter((value) => value.trim()).length;
      let layout = slide.layout;
      if (index === 0) layout = "cover";
      else if (layout === "cover") layout = "section";
      if (layout === "cards" && (pointCount < 3 || content.body.length > 360)) layout = content.body.length > 180 ? "title-body" : "split";
      if (layout === "split" && pointCount < 2) layout = "title-body";
      if (index > 1 && layout === slides[index - 1]?.layout && ["cards", "split", "title-body"].includes(layout)) layout = layout === "title-body" ? "split" : "title-body";
      return { ...slide, layout };
    }),
  };
}

export const minimaxKeyConfigured = () => invoke<boolean>("minimax_api_key_configured");
export const saveMiniMaxKey = (apiKey: string) => invoke<void>("save_minimax_api_key", { apiKey });
export const deleteMiniMaxKey = () => invoke<void>("delete_minimax_api_key");
export const testMiniMaxConnection = (model: string) => invoke<string>("test_minimax_connection", { model });
