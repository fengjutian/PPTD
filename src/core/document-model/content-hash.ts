import type { SlideContent } from "./types";

/**
 * FNV-1a 64-bit hash over the semantic content fields. It is deliberately
 * synchronous so commands can maintain the hash without an async transaction.
 * Review status is excluded: approving or re-reviewing content does not change
 * the content identity that a design task must pin.
 */
export function hashSlideContent(content: Pick<SlideContent, "title" | "body" | "speakerNotes" | "blocks">): string {
  return hashString(JSON.stringify([content.title, content.body, content.speakerNotes, content.blocks ?? []]));
}

/** FNV-1a 64-bit over an arbitrary string; the same hash the content uses. */
export function hashString(value: string): string {
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function refreshContentHashes(document: { slides: Array<{ content: SlideContent }> }): void {
  for (const slide of document.slides) {
    slide.content.contentHash = hashSlideContent(slide.content);
  }
}

/**
 * One string that pins the reviewed content of every page, in order.
 *
 * The direction record and the visual review both need to know whether the
 * content they were produced from is still the current one. Pages are hashed
 * individually so a single edit does not invalidate unrelated page previews.
 */
export function documentContentFingerprint(document: { slides: Array<{ content: SlideContent }> }): string {
  return JSON.stringify(document.slides.map((slide) => hashSlideContent(slide.content)));
}
