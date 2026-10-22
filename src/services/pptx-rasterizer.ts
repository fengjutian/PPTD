import { invoke } from "@tauri-apps/api/core";

/** 单张评审图的上限。超过这个体积的图对评审没有额外价值，只会让请求变慢。 */
const MAX_REVIEW_IMAGE_BYTES = 6 * 1024 * 1024;
/** 评审图的最大页数。与后端的限制一致，多出来的页直接放弃。 */
const MAX_REVIEW_SLIDES = 40;

/** 一份文稿的真实渲染结果。 */
export interface RasterizedDeck {
  /** 每页的 JPEG data URL，顺序与文稿一致。 */
  slides: string[];
  /** 同一批图片的解码结果。拼缩略图墙时不必再解一次。 */
  images: HTMLImageElement[];
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
 * "unavailable" 表示这条路走不通：本机没有 PowerPoint、渲染超时、图片解不开。
 * 这不是生成的失败：调用方据此降级到画布预览渲染，评审照常进行。
 */
export async function rasterizePptxForReview(bytes: Uint8Array): Promise<RasterizeOutcome> {
  if (bytes.length === 0) return { status: "unavailable", reason: "REVIEW_RASTER_EMPTY" };
  try {
    // 文稿太大，不能当成 JSON 数组传。原始请求体直接送字节，和导出用的是同一条路。
    const images = await invoke<string[]>("rasterize_pptx_for_review", bytes);
    if (!Array.isArray(images) || images.length === 0) return { status: "unavailable", reason: "REVIEW_RASTER_EMPTY" };
    const slides: string[] = [];
    const decoded: HTMLImageElement[] = [];
    for (const source of images.slice(0, MAX_REVIEW_SLIDES)) {
      const image = await loadImage(source);
      const jpeg = await toJpeg(image, 0.85);
      if (jpeg.length > MAX_REVIEW_IMAGE_BYTES * 1.4)
        return { status: "unavailable", reason: "REVIEW_RASTER_IMAGE_TOO_LARGE" };
      slides.push(jpeg);
      decoded.push(image);
    }
    return { status: "ok", deck: { slides, images: decoded } };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
