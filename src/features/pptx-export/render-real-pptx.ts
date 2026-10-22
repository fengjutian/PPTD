import type { PresentationDocument } from "../../core/document-model";
import { resolveDocumentImages } from "../../services/image-url-service";
import { composeContactSheet, type PresentationRender } from "../../services/presentation-renderer";
import { rasterizePptxForReview } from "../../services/pptx-rasterizer";
import { buildPptxInWorker } from "./export-worker-client";

/**
 * Renders the exported deck the way the user will see it.
 *
 * The canvas renderer is an approximation of the deck: PowerPoint wraps text
 * on its own, its font metrics differ slightly from the estimate, and charts
 * and tables are drawn by PowerPoint itself. A review model that looks at the
 * canvas is reviewing something the user will never see.
 *
 * The real render needs PowerPoint, so it may not be available. Returning
 * undefined is the signal for the caller to fall back to the canvas preview;
 * it is not a failure of the generation.
 */
export async function renderRealPptxForReview(document: PresentationDocument): Promise<PresentationRender> {
  // The export worker has no IPC, so asset references have to be resolved on
  // the main thread before the document is handed over.
  const resolved = await resolveDocumentImages(document);
  // The preflight is deliberately empty: this file exists only to be rendered,
  // and the problems the review is looking for are exactly the ones the
  // preflight would refuse to export.
  const task = buildPptxInWorker(resolved, []);
  const { bytes } = await task.promise;
  const outcome = await rasterizePptxForReview(bytes);
  if (outcome.status !== "ok") throw new Error(`REVIEW_RASTER_UNAVAILABLE:${outcome.reason}`);
  const contactSheet = composeContactSheet(outcome.deck.images, document.pageSize);
  if (!contactSheet) throw new Error("REVIEW_RASTER_CONTACT_SHEET_FAILED");
  return { slides: outcome.deck.slides, contactSheet };
}
