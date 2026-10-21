import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parsePresentationDocument, type PresentationDocument } from "../core/document-model";

const projectFilter = [{ name: "PPTD 项目", extensions: ["pptd"] }];
const pptxFilter = [{ name: "PowerPoint 模板", extensions: ["pptx"] }];

export const isDesktopRuntime = () => isTauri();
export interface TemplateRecord { id: string; name: string; size: number; importedAt: number }
export interface TemplateRegion { role: "title" | "body" | "image"; x: number; y: number; width: number; height: number; textColor: string | null; fontSizePt: number | null }
export interface TemplateDecoration { shape: "rectangle" | "ellipse"; x: number; y: number; width: number; height: number; fill: string }
export interface TemplateLayoutSummary { index: number; name: string; backgroundColor: string | null; decorations: TemplateDecoration[]; regions: TemplateRegion[] }
export interface TemplateAnalysis { slideCount: number; slideWidthEmu: number | null; slideHeightEmu: number | null; masterCount: number; layoutCount: number; themeCount: number; themeColors: Array<{ name: string; value: string }>; majorFont: string | null; minorFont: string | null; defaultBackgroundColor: string | null; defaultDecorations: TemplateDecoration[]; slides: Array<{ index: number; title: string; textCount: number; imageCount: number; shapeCount: number; layout: string | null; backgroundColor: string | null; decorations: TemplateDecoration[]; regions: TemplateRegion[] }>; layouts: TemplateLayoutSummary[]; warnings: string[] }

export async function chooseProjectToOpen(): Promise<{ path: string; document: PresentationDocument; modifiedAt: number } | null> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  const path = await open({ multiple: false, directory: false, filters: projectFilter });
  if (!path) return null;
  const raw = await invoke<unknown>("open_project", { path });
  return { path, document: parsePresentationDocument(raw) as PresentationDocument, modifiedAt: await projectModifiedAt(path) };
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
export const renderPptxTemplateLayouts = (templateId: string) => invoke<Array<{ layoutIndex: number; layoutName: string; dataUrl: string }>>("render_pptx_template_layouts", { templateId });
export const analyzePptxTemplate = (templateId: string) => invoke<TemplateAnalysis>("analyze_pptx_template", { templateId });

export const projectModifiedAt = (path: string) => invoke<number>("project_modified_at", { path });

export async function saveProject(document: PresentationDocument, currentPath?: string): Promise<{ path: string; modifiedAt: number | null } | null> {
  if (!isTauri()) {
    localStorage.setItem("pptd:browser-draft", JSON.stringify(document));
    return { path: "浏览器草稿", modifiedAt: null };
  }
  const path = currentPath ?? await save({ filters: projectFilter, defaultPath: `${safeFileName(document.title)}.pptd` });
  if (!path) return null;
  await invoke("save_project", { path, document });
  return { path, modifiedAt: await projectModifiedAt(path) };
}

const browserRecoveryKey = "pptd:recovery";
let recoveryQueue: Promise<void> = Promise.resolve();

const enqueueRecovery = (task: () => Promise<void>): Promise<void> => {
  recoveryQueue = recoveryQueue.catch(() => undefined).then(task);
  return recoveryQueue;
};

export function saveRecovery(document: PresentationDocument): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(browserRecoveryKey, JSON.stringify(document));
    return Promise.resolve();
  }
  return enqueueRecovery(() => invoke("save_recovery", { document }));
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
  await enqueueRecovery(() => invoke("clear_recovery"));
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
  const encoded = new TextEncoder().encode(path);
  let binary = "";
  for (const byte of encoded) binary += String.fromCharCode(byte);
  await invoke("write_pptx_raw", bytes, { headers: { "x-pptd-path": btoa(binary) } });
}
