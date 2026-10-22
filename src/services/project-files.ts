import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parsePresentationDocument, repairDanglingLayoutReferences, type PresentationDocument } from "../core/document-model";
import { resolveDocumentImages, getImageProjectPath } from "./image-url-service";

const projectFilter = [{ name: "PPTD 项目", extensions: ["pptd"] }];
const pptxFilter = [{ name: "PowerPoint 模板", extensions: ["pptx"] }];

export const isDesktopRuntime = () => isTauri();
export interface TemplateRecord { id: string; name: string; size: number; importedAt: number }
export interface TemplateRegion { role: "title" | "body" | "image"; x: number; y: number; width: number; height: number; textColor: string | null; fontSizePt: number | null }
export interface TemplateDecoration { shape: "rectangle" | "ellipse"; x: number; y: number; width: number; height: number; fill: string }
export interface TemplateLayoutSummary { index: number; name: string; backgroundColor: string | null; decorations: TemplateDecoration[]; regions: TemplateRegion[] }
export interface TemplateAnalysis { slideCount: number; slideWidthEmu: number | null; slideHeightEmu: number | null; masterCount: number; layoutCount: number; themeCount: number; themeColors: Array<{ name: string; value: string }>; majorFont: string | null; minorFont: string | null; defaultBackgroundColor: string | null; defaultDecorations: TemplateDecoration[]; slides: Array<{ index: number; title: string; textCount: number; imageCount: number; shapeCount: number; layout: string | null; backgroundColor: string | null; decorations: TemplateDecoration[]; regions: TemplateRegion[] }>; layouts: TemplateLayoutSummary[]; warnings: string[] }

export interface StoredDocument {
  document: PresentationDocument;
  /** How many page references had to be dropped to read the document. */
  removedLayoutReferences: number;
}

/**
 * Reads a stored document.
 *
 * A file written by an older build can reference a layout it does not declare.
 * The schema rejects such a document, and losing every page over one dangling
 * reference is worse than the reference itself, so the reference is dropped
 * and the rest of the document is kept.
 */
export function readStoredDocument(raw: unknown): StoredDocument {
  try {
    return { document: parsePresentationDocument(raw) as PresentationDocument, removedLayoutReferences: 0 };
  } catch (error) {
    const repair = repairDanglingLayoutReferences(raw);
    if (repair.removedLayoutReferences === 0) throw error;
    return {
      document: parsePresentationDocument(repair.document) as PresentationDocument,
      removedLayoutReferences: repair.removedLayoutReferences,
    };
  }
}

export async function chooseProjectToOpen(): Promise<{ path: string; document: PresentationDocument; modifiedAt: number; removedLayoutReferences: number } | null> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  const path = await open({ multiple: false, directory: false, filters: projectFilter });
  if (!path) return null;
  const raw = await invoke<unknown>("open_project", { path });
  const stored = readStoredDocument(raw);
  return { path, document: stored.document, modifiedAt: await projectModifiedAt(path), removedLayoutReferences: stored.removedLayoutReferences };
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

/**
 * What a save could not write down.
 *
 * The document is written either way: losing one picture is not a reason to
 * throw away the rest of the deck. But the gap has to be reported, because a
 * project that keeps an `asset://` reference with no file behind it comes back
 * as a blank page, and nothing else in the app would say so.
 */
export interface AssetReport { missingAssets: string[] }

export async function saveProject(document: PresentationDocument, currentPath?: string): Promise<{ path: string; modifiedAt: number | null; report: AssetReport } | null> {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
  const path = currentPath ?? await save({ filters: projectFilter, defaultPath: `${safeFileName(document.title)}.pptd` });
  if (!path) return null;
  // A document keeps its pictures as references into the asset directory of the
  // project they were saved to. Writing it to another path has to carry the
  // pictures over, otherwise the new project keeps the references and loses the
  // files behind them. The pictures are inlined here for the document that is
  // written out, and the source path is passed along so the backend can carry
  // whatever is still a reference.
  const payload = currentPath === path ? document : await resolveDocumentImages(document);
  const report = await invoke<AssetReport>("save_project", {
    path,
    document: payload,
    sourcePath: currentPath ?? getImageProjectPath() ?? null,
  });
  return { path, modifiedAt: await projectModifiedAt(path), report };
}

let recoveryQueue: Promise<AssetReport | undefined> = Promise.resolve();

const enqueueRecovery = <T,>(task: () => Promise<T>): Promise<T> => {
  const result = recoveryQueue.catch(() => undefined).then(task);
  recoveryQueue = result.then(() => undefined, () => undefined);
  return result;
};

export function saveRecovery(document: PresentationDocument, sourcePath?: string): Promise<AssetReport | undefined> {
  if (!isTauri()) return Promise.resolve(undefined);
  return enqueueRecovery(() => invoke<AssetReport>("save_recovery", { document, sourcePath: sourcePath ?? null }));
}

export async function loadRecovery(): Promise<StoredDocument | null> {
  if (!isTauri()) return null;
  const raw: unknown = await invoke("load_recovery");
  if (raw === null) return null;
  return readStoredDocument(raw);
}

/**
 * The file the recovery copy is written to. A restored document keeps its
 * pictures in the asset directory next to that file, so the front end needs
 * the path to read them.
 */
export const recoveryProjectPath = () => invoke<string | null>("recovery_project_path");

export async function clearRecovery(): Promise<void> {
  if (!isTauri()) return;
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
