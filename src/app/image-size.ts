/**
 * Reads the pixel size of a picture so it can be placed with its own
 * proportions. A picture that cannot be decoded is placed in the default box.
 */
export async function readImageSize(dataUrl: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return undefined;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return undefined;
  }
}
