import { invoke } from "@tauri-apps/api/core";
import type { PresentationDocument } from "../core/document-model";

/**
 * Resolves a picture source to a displayable data URL.
 *
 * After the desktop backend started storing pictures as content-addressed
 * `asset://` references, the document no longer inlines every image at open
 * time. This service loads a reference lazily on first render and caches the
 * data URL, so a picture is read from disk once per session instead of being
 * decoded into base64 for every slide.
 */

let currentProjectPath: string | undefined;
const cache = new Map<string, string>();

export function isAssetReference(source: string): boolean {
  return source.startsWith("asset://");
}

/**
 * The project the current session is editing. Changing it clears the cache,
 * because the same hash in another project may point at different bytes (the
 * hash is content-addressed, so it should not, but a project boundary is the
 * safe place to reset the map).
 */
export function setImageProjectPath(path: string | undefined): void {
  if (path !== currentProjectPath) {
    currentProjectPath = path;
    cache.clear();
  }
}

/**
 * The project the current pictures are read from. The backend needs it to
 * carry the pictures over when a document is written somewhere else.
 */
export function getImageProjectPath(): string | undefined {
  return currentProjectPath;
}

/** Synchronous cache lookup for the first render; undefined means "still loading". */
export function peekImageUrl(reference: string): string | undefined {
  return cache.get(reference);
}

/** Resolves a picture source (inline data URL or asset reference) to a data URL. */
export async function resolveImageUrl(source: string): Promise<string> {
  if (!isAssetReference(source)) return source;
  const cached = cache.get(source);
  if (cached) return cached;
  if (!currentProjectPath) return source;
  const dataUrl = await invoke<string>("read_image_asset", {
    projectPath: currentProjectPath,
    reference: source,
  });
  cache.set(source, dataUrl);
  return dataUrl;
}

/**
 * Returns a copy of the document whose picture sources are all inline data
 * URLs. The export worker has no IPC, so asset references must be resolved on
 * the main thread before the document is handed over.
 */
export async function resolveDocumentImages(document: PresentationDocument): Promise<PresentationDocument> {
  let changed = false;
  const slides = [];
  for (const slide of document.slides) {
    let slideChanged = false;
    const elements = [];
    for (const element of slide.elements) {
      if (element.type === "image" && isAssetReference(element.source.dataUrl)) {
        elements.push({ ...element, source: { ...element.source, dataUrl: await resolveImageUrl(element.source.dataUrl) } });
        slideChanged = true;
      } else {
        elements.push(element);
      }
    }
    if (slideChanged) changed = true;
    slides.push(slideChanged ? { ...slide, elements } : slide);
  }
  return changed ? { ...document, slides } : document;
}
