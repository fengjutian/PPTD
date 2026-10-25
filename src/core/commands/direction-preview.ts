/**
 * Two-page previews for a design direction.
 *
 * The preview must use the same command path as the final application: a second
 * renderer would promise a page the real pipeline cannot draw. Each preview page
 * therefore gets its own one-page document and the real deck's page index, so
 * the footer, page number and section label are the ones the user will see.
 *
 * The real document is never touched. The caller renders the returned documents
 * and discards them.
 */

import { applyCommand, type AiSlideDraft, type DocumentCommand } from "./commands";
import { toAiBlocks } from "./command-helpers";
import type { AiSlideDesign } from "./template-layouts";
import { createDocument, type PresentationDocument, type Slide } from "../document-model";
import type { DeckConcept } from "../design/deck-concept";

type DesignedDraftCommand = Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>;

/**
 * Everything the final application carries except the per-page fields. Passing
 * the same base keeps the theme, fonts and template decorations identical; a
 * preview built from a different base would compare two different designs.
 */
export type DirectionPreviewCommandBase = Omit<
  DesignedDraftCommand,
  "type" | "title" | "slides" | "designs" | "designConcept" | "pageContext" | "pageSize"
>;

export interface DirectionPreviewInput {
  /** The real deck. Read-only. */
  document: PresentationDocument;
  concept: DeckConcept;
  /** Real page indexes, in the order the previews should be shown. */
  pageIndexes: readonly number[];
  /** Designs aligned with `pageIndexes`. */
  designs: readonly AiSlideDesign[];
  /** Theme/template context of the final application. */
  commandBase?: DirectionPreviewCommandBase;
  /** Defaults to the deck title. */
  title?: string;
}

export interface DirectionPreviewPage {
  /** The page index in the real deck. */
  index: number;
  /** A one-page document that can be rendered and thrown away. */
  document: PresentationDocument;
}

export function buildDirectionPreviewPages(input: DirectionPreviewInput): DirectionPreviewPage[] {
  if (input.pageIndexes.length === 0 || input.pageIndexes.length !== input.designs.length) {
    throw new Error("DIRECTION_PREVIEW_MISMATCH");
  }
  const total = input.document.slides.length;
  return input.pageIndexes.map((index, position) => {
    const slide = input.document.slides[index];
    if (!slide) throw new Error("DIRECTION_PREVIEW_PAGE_MISSING");
    const design = input.designs[position];
    if (!design) throw new Error("DIRECTION_PREVIEW_MISMATCH");
    const draft = draftOf(slide);
    const temp = createDocument();
    temp.title = input.title ?? input.document.title;
    temp.pageSize = { ...input.document.pageSize };
    const sectionLabel = sectionLabelAt(input.document, index);
    const assets = input.commandBase?.visualAssets
      ?.filter((asset) => asset.slideIndex === index)
      .map((asset) => ({ ...asset, slideIndex: 0 }));
    // The base may carry assets for the whole deck; only this page's asset is
    // relevant, and it becomes index 0 in the one-page document.
    const base = { ...input.commandBase };
    delete base.visualAssets;
    const command: DesignedDraftCommand = {
      ...base,
      type: "apply-ai-designed-draft",
      title: temp.title,
      slides: [draft],
      designs: [design],
      designConcept: input.concept,
      pageSize: { ...input.document.pageSize },
      pageContext: { index, total, ...(sectionLabel ? { sectionLabel } : {}) },
      ...(assets && assets.length > 0 ? { visualAssets: assets } : {}),
    };
    applyCommand(temp, command);
    return { index, document: temp };
  });
}

function draftOf(slide: Slide): AiSlideDraft {
  const blocks = toAiBlocks(slide.content.blocks);
  return {
    title: slide.content.title,
    body: slide.content.body,
    speakerNotes: slide.content.speakerNotes,
    ...(blocks ? { blocks } : {}),
  };
}

/**
 * The nearest section title above this page, used by the footer. The one-page
 * preview cannot see the pages before it, so the label is carried in explicitly
 * the same way a single-page relayout does.
 */
function sectionLabelAt(document: PresentationDocument, index: number): string | undefined {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const slide = document.slides[cursor];
    if (!slide) continue;
    const layout = document.layouts?.find((candidate) => candidate.id === slide.layoutId)?.name ?? "";
    if (/(章节|section|过渡|分隔)/u.test(layout)) return slide.content.title.trim() || undefined;
  }
  return undefined;
}
