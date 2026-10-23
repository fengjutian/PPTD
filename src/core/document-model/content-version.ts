import type { ContentVersion, ContentVersionSlide, PresentationDocument } from "./types";

/** The cap keeps a long editing session from turning the project file into a log. */
export const MAX_CONTENT_VERSIONS = 30;

/**
 * A semantic copy of the reviewed content of every page.
 *
 * Only content fields are copied. Elements, styles, backgrounds and review
 * status stay out: moving a card or approving a page must not look like a new
 * content version.
 */
export function contentVersionSlides(document: PresentationDocument): ContentVersionSlide[] {
  return document.slides.map((slide) => ({
    slideId: slide.id,
    title: slide.content.title,
    body: slide.content.body,
    ...(slide.content.blocks ? { blocks: structuredClone(slide.content.blocks) } : {}),
    speakerNotes: slide.content.speakerNotes,
  }));
}

/**
 * The canonical text of a snapshot, used to skip duplicate versions.
 *
 * Block IDs are removed on purpose. Applying a design over the same reviewed
 * copy creates new block IDs; that is a design transaction, not a content edit.
 */
export function contentSignature(slides: readonly ContentVersionSlide[]): string {
  return JSON.stringify(
    slides.map((slide) => ({
      title: slide.title,
      body: slide.body,
      blocks:
        slide.blocks?.map((block) => {
          const { id: _id, ...rest } = block;
          return rest;
        }) ?? [],
      speakerNotes: slide.speakerNotes,
    })),
  );
}

export interface ContentVersionRevisions {
  documentRevision: number;
  contentRevision: number;
}

/**
 * Appends a confirmed snapshot unless the latest one already carries the same
 * content.
 *
 * It is called inside the content commands that are the confirmation act
 * (approving a page and applying a reviewed draft). The default revision labels
 * assume the caller is inside a transaction that is about to bump both counters;
 * callers that already know the final numbers can pass them explicitly.
 */
export function captureContentVersion(
  document: PresentationDocument,
  revisions: ContentVersionRevisions = {
    documentRevision: document.revisions.document + 1,
    contentRevision: document.revisions.content + 1,
  },
): boolean {
  const slides = contentVersionSlides(document);
  const versions = document.contentVersions ?? [];
  const latest = versions.at(-1);
  if (latest && contentSignature(latest.slides) === contentSignature(slides)) return false;

  const version: ContentVersion = {
    id: crypto.randomUUID(),
    documentRevision: revisions.documentRevision,
    contentRevision: revisions.contentRevision,
    slides,
  };
  document.contentVersions = [...versions, version].slice(-MAX_CONTENT_VERSIONS);
  return true;
}
