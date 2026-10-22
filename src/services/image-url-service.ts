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
 *
 * A reference that cannot be read yet resolves to `undefined` instead of the
 * reference itself: an `asset://` string is not something a browser can load,
 * and handing it to an `<img>` makes the page show the broken image icon.
 */

let currentProjectPath: string | undefined;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const pathListeners = new Set<() => void>();
/**
 * The references the backend could not read.
 *
 * A picture that is gone has to be visible as such. A page that quietly drops
 * the picture looks like a page the author designed that way, and nobody
 * notices that the template artwork is missing until the deck is exported.
 */
const failures = new Set<string>();
const failureListeners = new Set<() => void>();

export function isAssetReference(source: string): boolean {
  return source.startsWith("asset://");
}

/**
 * The project the current session is editing. Changing it clears the cache,
 * because the same hash in another project may point at different bytes (the
 * hash is content-addressed, so it should not, but a project boundary is the
 * safe place to reset the map).
 *
 * Listeners are told about the change, because a document can be rendered
 * before the path is known: the recovery flow reads the snapshot and the path
 * of its asset directory in two separate calls, so a picture that was drawn
 * too early has to be resolved again.
 */
export function setImageProjectPath(path: string | undefined): void {
  if (path === currentProjectPath) return;
  currentProjectPath = path;
  cache.clear();
  inFlight.clear();
  // Another project may hold the very same picture, so a failure of the old
  // one is not a failure of the new one.
  if (failures.size > 0) {
    failures.clear();
    notifyImageFailures();
  }
  for (const listener of [...pathListeners]) listener();
}

/**
 * The references that could not be read from the current project.
 */
export function failedImageReferences(): readonly string[] {
  return [...failures];
}

/**
 * Is this reference known to be unreadable? A reference that was never tried
 * is not a failure, it is simply unknown.
 */
export function isFailedImageReference(reference: string): boolean {
  return failures.has(reference);
}

/**
 * Watches the load failures. The returned function stops the watch.
 */
export function subscribeImageFailures(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/** 告诉所有订阅者失败集合变了。集合没变时不通知，避免渲染来回抖。 */
function notifyImageFailures(): void {
  for (const listener of [...failureListeners]) listener();
}

/**
 * Watches the project path. The returned function stops the watch.
 */
export function subscribeImageProjectPath(listener: () => void): () => void {
  pathListeners.add(listener);
  return () => {
    pathListeners.delete(listener);
  };
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

/**
 * Resolves a picture source (inline data URL or asset reference) to a data URL.
 *
 * Returns `undefined` while the reference cannot be read yet, which happens
 * when the project path is not known. The caller keeps its placeholder and
 * resolves the picture again once the path arrives.
 *
 * A read that fails is recorded before the error is passed on. A picture that
 * is quietly dropped looks exactly like a page the author designed that way,
 * and the template artwork is the one thing nobody notices is missing until the
 * deck is exported. The error itself is still thrown: the export has to stop
 * rather than write a picture it could not read.
 */
export async function resolveImageUrl(source: string): Promise<string | undefined> {
  if (!isAssetReference(source)) return source;
  const cached = cache.get(source);
  if (cached) return cached;
  // Several pictures of a document share the same artwork, so one read serves
  // all of them instead of asking the backend once per picture.
  const reading = inFlight.get(source);
  if (reading) return reading;
  if (!currentProjectPath) return undefined;
  const path = currentProjectPath;
  const request = invoke<string>("read_image_asset", {
    projectPath: path,
    reference: source,
  }).then((dataUrl) => {
    // A read that started before the project changed belongs to the old
    // project, so its bytes must not be kept for the new one.
    if (path === currentProjectPath) cache.set(source, dataUrl);
    inFlight.delete(source);
    // 读回来一次就不再是缺失，之前记下的失败要让位给成功。
    if (failures.delete(source)) notifyImageFailures();
    return dataUrl;
  }, (error: unknown) => {
    inFlight.delete(source);
    if (!failures.has(source)) {
      failures.add(source);
      notifyImageFailures();
    }
    throw error;
  });
  inFlight.set(source, request);
  return request;
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
        const dataUrl = await resolveImageUrl(element.source.dataUrl);
        // Exporting a reference the backend cannot read would put a broken
        // picture into the deck, so the export stops with a readable message.
        if (!dataUrl) throw new Error("IMAGE_ASSET_UNAVAILABLE: 图片资源尚未就绪，请先保存项目后重试");
        elements.push({ ...element, source: { ...element.source, dataUrl } });
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
