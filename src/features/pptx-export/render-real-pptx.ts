import type { PresentationDocument } from "../../core/document-model";
import { resolveDocumentImages } from "../../services/image-url-service";
import {
  composeContactSheet,
  composeContactSheetFromDataUrls,
  type PresentationRender,
} from "../../services/presentation-renderer";
import { rasterizePptxForReview } from "../../services/pptx-rasterizer";
import { buildPptxInWorker } from "./export-worker-client";

/** 增量渲染的输入：只重画变化页，其余页复用上一轮。 */
export interface RealRenderOptions {
  /** 0 起算的变化页索引；缺省表示全部页。 */
  slideIndexes?: number[];
  /** 上一轮完整画面的 data URL，用于拼回整册和缩略图墙。 */
  previousSlides?: string[];
}

/**
 * Renders the exported deck the way the user will see it.
 *
 * The canvas renderer is an approximation of the deck: PowerPoint wraps text
 * on its own, its font metrics differ slightly from the estimate, and charts
 * and tables are drawn by PowerPoint itself. A review model that looks at the
 * canvas is reviewing something the user will never see.
 *
 * Every iteration still builds the whole PPTX, because the file has to be a
 * complete deck; only the page rasterization is incremental. Pages that did
 * not change reuse the previous pictures, and the contact sheet is rebuilt
 * from the merged set so the model never sees a stale overview.
 *
 * The real render needs PowerPoint, so it may not be available. Returning
 * undefined is the signal for the caller to fall back to the canvas preview;
 * it is not a failure of the generation.
 */
export async function renderRealPptxForReview(
  document: PresentationDocument,
  options: RealRenderOptions = {},
): Promise<PresentationRender> {
  // The export worker has no IPC, so asset references have to be resolved on
  // the main thread before the document is handed over.
  const resolved = await resolveDocumentImages(document);
  // The preflight is deliberately empty: this file exists only to be rendered,
  // and the problems the review is looking for are exactly the ones the
  // preflight would refuse to export.
  const task = buildPptxInWorker(resolved, []);
  const { bytes } = await task.promise;
  const outcome = await rasterizePptxForReview(bytes, options.slideIndexes);
  if (outcome.status !== "ok") throw new Error(`REVIEW_RASTER_UNAVAILABLE:${outcome.reason}`);

  const slides = [...(options.previousSlides ?? [])];
  for (const page of outcome.deck.pages) slides[page.index] = page.slide;
  if (slides.length !== document.slides.length || slides.some((slide) => !slide))
    throw new Error("REVIEW_RASTER_UNAVAILABLE:REVIEW_RASTER_INCOMPLETE");

  // A full render already decoded every page; reuse those decodes instead of
  // decoding the whole deck a second time just to build the contact sheet.
  const contactSheet =
    options.previousSlides === undefined && options.slideIndexes === undefined
      ? composeContactSheet(
          outcome.deck.pages.map((page) => page.image),
          document.pageSize,
        )
      : await composeContactSheetFromDataUrls(slides, document.pageSize);
  if (!contactSheet) throw new Error("REVIEW_RASTER_CONTACT_SHEET_FAILED");
  return { slides, contactSheet };
}
