import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const narrativeStrategySchema = z.enum(["management-report", "proposal", "retrospective", "training", "product-launch", "fundraising", "general"]);
export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("bullet-list"), items: z.array(z.string().min(1).max(500)).min(1).max(12) }),
  z.object({ type: z.literal("quote"), text: z.string().min(1).max(2000), attribution: z.string().max(300).optional() }),
  z.object({ type: z.literal("metric"), label: z.string().min(1).max(300), value: z.string().min(1).max(100) }),
  z.object({ type: z.literal("timeline"), items: z.array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(500) })).min(1).max(10) }),
  z.object({ type: z.literal("comparison"), leftLabel: z.string().min(1).max(100), rightLabel: z.string().min(1).max(100), leftItems: z.array(z.string().min(1).max(500)).max(8), rightItems: z.array(z.string().min(1).max(500)).max(8) }),
]);
const slidePlanSchema = z.object({
  purpose: z.string().min(1).max(300),
  conclusion: z.string().min(1).max(300),
  visualIntent: z.enum(["hero", "quote", "timeline", "comparison", "process", "data-chart", "image-story", "summary", "structured-text"]),
  density: z.enum(["low", "medium", "high"]),
});
const legacySlidePlan = { purpose: "传达本页已审核内容", conclusion: "以本页标题和正文为准", visualIntent: "structured-text" as const, density: "medium" as const };
export const aiDraftSchema = z.object({
  title: z.string().min(1).max(200),
  presentationBrief: z.object({ objective: z.string().min(1).max(500), audience: z.string().min(1).max(300), scenario: z.string().min(1).max(300), expectedAction: z.string().min(1).max(500), coreConclusion: z.string().min(1).max(500), narrativeStrategy: narrativeStrategySchema, assumptions: z.array(z.string().max(500)).max(10) }).default({ objective: "清晰传达演示主题", audience: "未指定受众", scenario: "通用演示", expectedAction: "理解演示内容", coreConclusion: "以演示文稿标题和逐页内容为准", narrativeStrategy: "general", assumptions: ["该草稿来自旧版本，尚未补充完整演示简报"] }),
  slides: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().max(4000), speakerNotes: z.string().max(4000), plan: slidePlanSchema.default(legacySlidePlan), blocks: z.array(contentBlockSchema).max(20).default([]) })).min(1).max(20),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export const slideBriefSchema = z.object({
  slideIndex: z.number().int().min(0).max(19),
  purpose: z.string().min(1).max(300),
  conclusion: z.string().min(1).max(300),
  visualIntent: z.enum(["hero", "quote", "timeline", "comparison", "process", "data-chart", "image-story", "summary", "structured-text"]),
  density: z.enum(["low", "medium", "high"]),
});
export const slideBriefsSchema = z.object({ briefs: z.array(slideBriefSchema).min(1).max(20) });
export type SlideBrief = z.infer<typeof slideBriefSchema>;

export function briefsFromDraft(draft: AiDraft): SlideBrief[] {
  return draft.slides.map((slide, slideIndex) => ({ slideIndex, ...slide.plan }));
}
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

export function describeAiError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("AI_PROVIDER_BUSY")) return "AI 服务当前繁忙，系统已自动重试，请稍后再次生成";
  if (detail.includes("AI_PROVIDER_HTTP_ERROR:401") || detail.includes("AI_PROVIDER_HTTP_ERROR:403") || detail.includes("MINIMAX_API_KEY_MISSING")) return "AI 服务凭据无效或未配置，请在设置中检查 API Key";
  if (detail.includes("AI_PROVIDER_HTTP_ERROR:429")) return "AI 请求过于频繁，请稍后再试";
  if (detail.includes("timed out") || detail.includes("REQUEST_FAILED")) return "AI 服务连接超时，请检查网络后重试";
  if (detail.includes("JSON_INVALID") || detail.includes("RESPONSE_INVALID") || detail.includes("ZodError")) return "AI 返回的数据格式不符合要求，请重新生成";
  return detail;
}

export async function generatePresentationDraft(topic: string, slideCount: number): Promise<AiDraft> {
  const model = localStorage.getItem("pptd:minimax-model") || "MiniMax-M3";
  const raw = await invoke<unknown>("generate_presentation", { request: { topic, slideCount, model } });
  const draft = aiDraftSchema.parse(raw);
  if (draft.slides.length !== slideCount) throw new Error("AI_SLIDE_COUNT_MISMATCH");
  return draft;
}

export async function generateSlideBriefs(draft: AiDraft): Promise<SlideBrief[]> {
  const model = localStorage.getItem("pptd:minimax-model") || "MiniMax-M3";
  const raw = await invoke<unknown>("generate_slide_briefs", { request: { draft, model } });
  const result = slideBriefsSchema.parse(raw);
  if (result.briefs.length !== draft.slides.length || result.briefs.some((brief, index) => brief.slideIndex !== index)) throw new Error("AI_BRIEF_SLIDE_MISMATCH");
  return result.briefs;
}

export async function generatePresentationDesign(draft: AiDraft, briefs: SlideBrief[], template: DesignTemplateContext): Promise<AiPresentationDesign> {
  const model = localStorage.getItem("pptd:minimax-model") || "MiniMax-M3";
  const raw = await invoke<unknown>("generate_presentation_design", { request: { draft, briefs, template, model } });
  const design = aiPresentationDesignSchema.parse(raw);
  if (design.slides.length !== draft.slides.length) throw new Error("AI_DESIGN_SLIDE_COUNT_MISMATCH");
  return {
    slides: design.slides.map((slide, index, slides) => {
      const content = draft.slides[index]!;
      const brief = briefs[index]!;
      const pointCount = content.body.split(/\n+|(?=\d+[.、]\s*)/).filter((value) => value.trim()).length;
      let layout = slide.layout;
      const intentLayout = {
        hero: "cover",
        quote: "quote",
        timeline: "cards",
        comparison: "split",
        process: "cards",
        "data-chart": "title-body",
        "image-story": "split",
        summary: "summary",
        "structured-text": "title-body",
      } as const;
      layout = intentLayout[brief.visualIntent];
      if (index === 0) layout = "cover";
      else if (layout === "cover") layout = "section";
      if (brief.density === "high" && layout === "quote") layout = "title-body";
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
