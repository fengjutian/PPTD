import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parsePresentationDocument, type PresentationDocument } from "../core/document-model";

const projectFilter = [{ name: "PPTD 项目", extensions: ["pptd"] }];
const pptxFilter = [{ name: "PowerPoint 模板", extensions: ["pptx"] }];

export const isDesktopRuntime = () => isTauri();
export interface TemplateRecord { id: string; name: string; size: number; importedAt: number }
export interface TemplateRegion { role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }
export interface TemplateDecoration { shape: "rectangle" | "ellipse"; x: number; y: number; width: number; height: number; fill: string }
export interface TemplateLayoutSummary { index: number; name: string; backgroundColor: string | null; decorations: TemplateDecoration[]; regions: TemplateRegion[] }
export interface TemplateAnalysis { slideCount: number; slideWidthEmu: number | null; slideHeightEmu: number | null; masterCount: number; layoutCount: number; themeCount: number; themeColors: Array<{ name: string; value: string }>; majorFont: string | null; minorFont: string | null; defaultBackgroundColor: string | null; defaultDecorations: TemplateDecoration[]; slides: Array<{ index: number; title: string; textCount: number; imageCount: number; shapeCount: number; layout: string | null; backgroundColor: string | null; decorations: TemplateDecoration[]; regions: TemplateRegion[] }>; layouts: TemplateLayoutSummary[]; warnings: string[] }

export async function chooseProjectToOpen(): Promise<{ path: string; document: PresentationDocument } | null> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  const path = await open({ multiple: false, directory: false, filters: projectFilter });
  if (!path) return null;
  const raw = await invoke<unknown>("open_project", { path });
  return { path, document: parsePresentationDocument(raw) as PresentationDocument };
}

export async function choosePptxTemplate(): Promise<{ path: string; name: string } | null> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  const path = await open({ multiple: false, directory: false, filters: pptxFilter });
  if (!path) return null;
  return { path, name: path.split(/[\\/]/).at(-1) || "template.pptx" };
}

export const importPptxTemplate = (sourcePath: string) => invoke<TemplateRecord>("import_pptx_template", { sourcePath });
export const listPptxTemplates = () => invoke<TemplateRecord[]>("list_pptx_templates");
export const getPptxTemplatePreview = (templateId: string) => invoke<string | null>("get_pptx_template_preview", { templateId });
export const renderPptxTemplateLayouts = (templateId: string) => invoke<Array<{ layoutIndex: number; dataUrl: string }>>("render_pptx_template_layouts", { templateId });
export const analyzePptxTemplate = (templateId: string) => invoke<TemplateAnalysis>("analyze_pptx_template", { templateId });

export async function saveProject(document: PresentationDocument, currentPath?: string): Promise<string | null> {
  if (!isTauri()) {
    localStorage.setItem("pptd:browser-draft", JSON.stringify(document));
    return "浏览器草稿";
  }
  const path = currentPath ?? await save({ filters: projectFilter, defaultPath: `${safeFileName(document.title)}.pptd` });
  if (!path) return null;
  await invoke("save_project", { path, document });
  return path;
}

const browserRecoveryKey = "pptd:recovery";

export async function saveRecovery(document: PresentationDocument): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(browserRecoveryKey, JSON.stringify(document));
    return;
  }
  await invoke("save_recovery", { document });
}

export async function loadRecovery(): Promise<PresentationDocument | null> {
  const raw: unknown = isTauri()
    ? await invoke("load_recovery")
    : localStorage.getItem(browserRecoveryKey);
  if (raw === null) return null;
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return parsePresentationDocument(value) as PresentationDocument;
}

export async function clearRecovery(): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(browserRecoveryKey);
    return;
  }
  await invoke("clear_recovery");
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return normalized || "未命名演示文稿";
}

export async function choosePptxPath(title: string): Promise<string | null> {
  if (!isTauri()) return null;
  return save({ filters: [{ name: "PowerPoint 演示文稿", extensions: ["pptx"] }], defaultPath: `${safeFileName(title)}.pptx` });
}

export async function writePptx(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_pptx", { path, bytes: Array.from(bytes) });
}
