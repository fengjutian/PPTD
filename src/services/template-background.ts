import { contentRegionOf, titleRegionOf, type AiTemplateRegion } from "../core/commands/template-layouts";
import { relativeLuminance, type BackgroundRange } from "../core/rendering/contrast";

export interface TemplateBackgroundProbe {
  /** Luminance range of the artwork under the title placeholder. */
  title?: BackgroundRange;
  /** Luminance range of the artwork under the content placeholder. */
  body?: BackgroundRange;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("TEMPLATE_BACKGROUND_IMAGE_FAILED"));
    image.src = source;
  });
}

/**
 * The same nine points the rendered-pixel inspector samples, so the ink that
 * is accepted while generating is also accepted by the gate that inspects the
 * exported page.
 */
const SAMPLE_X = [0.15, 0.5, 0.85];
const SAMPLE_Y = [0.2, 0.5, 0.8];

/**
 * Measures how bright the rendered template artwork is underneath the
 * placeholders. The template states which ink it wants, but only the rendered
 * pixels reveal whether that ink is readable on the artwork as it will be
 * exported.
 *
 * The measurement is a range, not an average: an average hides the patch that
 * actually carries the text, and the generator and the pixel gate then
 * disagree about the same page.
 */
export async function probeTemplateBackground(dataUrl: string, regions: AiTemplateRegion[]): Promise<TemplateBackgroundProbe> {
  const image = await loadImage(dataUrl);
  const width = 240;
  const height = Math.max(1, Math.round((width * image.height) / image.width));
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return {};
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const measure = (frame: { x: number; y: number; width: number; height: number }): BackgroundRange | undefined => {
    const startX = Math.max(0, Math.floor(frame.x * width));
    const startY = Math.max(0, Math.floor(frame.y * height));
    const endX = Math.min(width, Math.ceil((frame.x + frame.width) * width));
    const endY = Math.min(height, Math.ceil((frame.y + frame.height) * height));
    if (endX <= startX || endY <= startY) return undefined;
    const luminances: number[] = [];
    for (const yFactor of SAMPLE_Y) {
      for (const xFactor of SAMPLE_X) {
        const sampleX = Math.min(endX - 1, Math.max(startX, Math.floor(startX + (endX - startX) * xFactor)));
        const sampleY = Math.min(endY - 1, Math.max(startY, Math.floor(startY + (endY - startY) * yFactor)));
        const offset = (sampleY * width + sampleX) * 4;
        luminances.push(relativeLuminance([pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]));
      }
    }
    // The inspector keeps the third worst of nine samples, so the generator
    // uses the same quantile and both sides reach the same verdict.
    const sorted = [...luminances].sort((left, right) => left - right);
    const quantile = Math.floor(sorted.length * 0.25);
    return { darkest: sorted[quantile]!, lightest: sorted[sorted.length - 1 - quantile]! };
  };
  const title = titleRegionOf(regions)?.frame;
  const body = contentRegionOf(regions)?.frame;
  return { title: title ? measure(title) : undefined, body: body ? measure(body) : undefined };
}
