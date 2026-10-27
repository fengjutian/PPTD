import type { PixelImage } from "../../src/core/rendering/png";

export interface ContactSheetOptions {
  columns: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  background?: readonly [number, number, number, number];
}

function paint(image: PixelImage, color: readonly [number, number, number, number]): void {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = color[3];
  }
}

/**
 * Builds a deterministic overview from equally important slide renders.
 *
 * Nearest-neighbour sampling is intentional: the baseline watches composition,
 * not a platform-specific image resampler. Every input page gets the same tile
 * size and order, so a missing, duplicated or reordered page changes the sheet.
 */
export function createContactSheet(slides: readonly PixelImage[], options: ContactSheetOptions): PixelImage {
  if (slides.length === 0) throw new Error("CONTACT_SHEET_EMPTY");
  if (options.columns < 1 || options.tileWidth < 1 || options.tileHeight < 1 || options.gap < 0)
    throw new Error("CONTACT_SHEET_OPTIONS_INVALID");

  const rows = Math.ceil(slides.length / options.columns);
  const width = options.columns * options.tileWidth + (options.columns + 1) * options.gap;
  const height = rows * options.tileHeight + (rows + 1) * options.gap;
  const sheet: PixelImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  paint(sheet, options.background ?? [245, 247, 250, 255]);

  slides.forEach((slide, index) => {
    const column = index % options.columns;
    const row = Math.floor(index / options.columns);
    const left = options.gap + column * (options.tileWidth + options.gap);
    const top = options.gap + row * (options.tileHeight + options.gap);
    for (let y = 0; y < options.tileHeight; y += 1) {
      const sourceY = Math.min(slide.height - 1, Math.floor((y * slide.height) / options.tileHeight));
      for (let x = 0; x < options.tileWidth; x += 1) {
        const sourceX = Math.min(slide.width - 1, Math.floor((x * slide.width) / options.tileWidth));
        const source = (sourceY * slide.width + sourceX) * 4;
        const target = ((top + y) * width + left + x) * 4;
        sheet.data[target] = slide.data[source];
        sheet.data[target + 1] = slide.data[source + 1];
        sheet.data[target + 2] = slide.data[source + 2];
        sheet.data[target + 3] = slide.data[source + 3];
      }
    }
  });
  return sheet;
}
