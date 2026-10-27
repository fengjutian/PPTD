export interface ImageFocalPoint {
  x: number;
  y: number;
}

/** Finds the centre of visually informative pixels in a small RGBA raster. */
export function saliencyFocalPoint(data: Uint8ClampedArray, width: number, height: number): ImageFocalPoint {
  if (width < 2 || height < 2 || data.length < width * height * 4) return { x: 0.5, y: 0.5 };
  let weightedX = 0;
  let weightedY = 0;
  let total = 0;
  const luminance = (offset: number) => data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      const horizontal = Math.abs(luminance(offset + 4) - luminance(offset - 4));
      const vertical = Math.abs(luminance(offset + width * 4) - luminance(offset - width * 4));
      const maximum = Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!);
      const minimum = Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!);
      const saturation = maximum - minimum;
      // Edge structure carries subject shape; saturation gives colourful focal
      // objects a small vote without pulling the crop towards a flat backdrop.
      const weight = horizontal + vertical + saturation * 0.25;
      weightedX += ((x + 0.5) / width) * weight;
      weightedY += ((y + 0.5) / height) * weight;
      total += weight;
    }
  }
  if (total < 1) return { x: 0.5, y: 0.5 };
  return {
    x: Math.max(0.08, Math.min(0.92, weightedX / total)),
    y: Math.max(0.08, Math.min(0.92, weightedY / total)),
  };
}

/** Browser adapter; failures preserve the safe centred crop. */
export async function detectImageFocalPoint(dataUrl: string): Promise<ImageFocalPoint> {
  if (typeof Image === "undefined" || typeof document === "undefined") return { x: 0.5, y: 0.5 };
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { x: 0.5, y: 0.5 };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return saliencyFocalPoint(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  } catch {
    return { x: 0.5, y: 0.5 };
  }
}
