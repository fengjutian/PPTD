import type { SlideContent } from "./types";

/**
 * FNV-1a 64-bit hash over the semantic content fields. It is deliberately
 * synchronous so commands can maintain the hash without an async transaction.
 * Review status is excluded: approving or re-reviewing content does not change
 * the content identity that a design task must pin.
 */
export function hashSlideContent(content: Pick<SlideContent, "title" | "body" | "speakerNotes">): string {
  const value = JSON.stringify([content.title, content.body, content.speakerNotes]);
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
