import { invoke } from "@tauri-apps/api/core";

/** 单张评审图的上限。超过这个体积的图对评审没有额外价值，只会让请求变慢。 */
const MAX_REVIEW_IMAGE_BYTES = 6 * 1024 * 1024;
/** 评审图的最大页数。与后端的限制一致，多出来的页直接放弃。 */
const MAX_REVIEW_SLIDES = 40;

/** 一页真实渲染结果。 */
export interface RasterizedPage {
  /** 页面索引，0 起算，与文档的 slides 数组一致。 */
  index: number;
  /** JPEG data URL。 */
  slide: string;
  /** 同一张图的解码结果。拼缩略图墙时不必再解一次。 */
  image: HTMLImageElement;
}

/** 一份文稿的真实渲染结果，可能只包含发生变化的部分页面。 */
export interface RasterizedDeck {
  pages: RasterizedPage[];
}

/** 真实渲染走不通时的结果。 */
export type RasterizeOutcome = { status: "ok"; deck: RasterizedDeck } | { status: "unavailable"; reason: string };

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("REVIEW_RASTER_IMAGE_DECODE_FAILED"));
    image.src = dataUrl;
  });
}

/**
 * PowerPoint 渲染出来的是 PNG，评审协议要的是 JPEG。
 *
 * PNG 直接走 base64 体积大得多，而评审只需要看清画面。转换顺带把三通道以上的
 * 图片压成评审模型读得懂的格式。
 */
async function toJpeg(image: HTMLImageElement, quality: number): Promise<string> {
  const canvas = window.document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("REVIEW_RASTER_CONTEXT_UNAVAILABLE");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Renders an exported deck into one image per slide.
 *
 * `slideIndexes` 是 0 起算的页索引。传入后只渲染这些页，未变化的页由调用方
 * 复用上一轮的结果；不传时渲染全部页面。返回的 `index` 始终是原始页索引，
 * 调用方不必自己重新对齐。
 *
 * "unavailable" 表示这条路走不通：本机没有 PowerPoint、渲染超时、图片解不开。
 * 这不是生成的失败：调用方据此降级到画布预览渲染，评审照常进行。
 */
export async function rasterizePptxForReview(bytes: Uint8Array, slideIndexes?: number[]): Promise<RasterizeOutcome> {
  if (bytes.length === 0) return { status: "unavailable", reason: "REVIEW_RASTER_EMPTY" };
  const requested = slideIndexes
    ? [...new Set(slideIndexes)]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < MAX_REVIEW_SLIDES)
        .sort((left, right) => left - right)
    : undefined;
  if (requested && requested.length === 0) return { status: "unavailable", reason: "REVIEW_RASTER_INDEX_INVALID" };
  try {
    // 文稿太大，不能当成 JSON 数组传。原始请求体直接送字节，和导出用的是同一条路。
    // 页子集走请求头，避免把二进制和页索引混在同一个请求体里。
    const rendered = requested
      ? await invoke<Array<{ index: number; image: string }>>("rasterize_pptx_for_review", bytes, {
          headers: { "x-pptd-slide-indexes": requested.map((index) => index + 1).join(",") },
        })
      : await invoke<Array<{ index: number; image: string }>>("rasterize_pptx_for_review", bytes);
    if (!Array.isArray(rendered) || rendered.length === 0)
      return { status: "unavailable", reason: "REVIEW_RASTER_EMPTY" };
    const pages: RasterizedPage[] = [];
    for (const page of rendered) {
      if (!Number.isInteger(page.index) || page.index < 1 || page.index > MAX_REVIEW_SLIDES) {
        return { status: "unavailable", reason: "REVIEW_RASTER_INDEX_INVALID" };
      }
      const index = page.index - 1;
      if (pages.some((existing) => existing.index === index)) continue;
      const image = await loadImage(page.image);
      const jpeg = await toJpeg(image, 0.85);
      if (jpeg.length > MAX_REVIEW_IMAGE_BYTES * 1.4)
        return { status: "unavailable", reason: "REVIEW_RASTER_IMAGE_TOO_LARGE" };
      pages.push({ index, slide: jpeg, image });
    }
    // 请求了变化页却少了一页，说明这次渲染不完整。宁可降级到画布预览，
    // 也不能拿上一轮的旧图冒充新画面。
    if (requested && requested.some((index) => !pages.some((page) => page.index === index)))
      return { status: "unavailable", reason: "REVIEW_RASTER_INCOMPLETE" };
    return { status: "ok", deck: { pages } };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
