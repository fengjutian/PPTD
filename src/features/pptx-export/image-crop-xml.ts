import { strFromU8, strToU8 } from "fflate";
import type { ImageCrop } from "../../core/document-model";
import { cropSourceRect } from "../../core/rendering/image-crop";

/**
 * A crop of a picture is stored in the slide XML as a source rectangle, the
 * same way PowerPoint stores it. PptxGenJS has no API for an arbitrary crop,
 * so the rectangle is written into the part that describes the picture.
 *
 * The pictures of a slide appear in the XML in the order they were added, so
 * the crops are applied in that order as well.
 */
export function patchPictureCrops(xml: string, crops: readonly (ImageCrop | undefined)[]): string {
  if (crops.length === 0) return xml;
  let index = 0;
  return xml.replace(/<p:pic\b[\s\S]*?<\/p:pic>/g, (picture) => {
    const crop = crops[index];
    index += 1;
    const rect = crop ? cropSourceRect(crop) : undefined;
    if (!rect) return picture;
    const source = `<a:srcRect l="${rect.l}" t="${rect.t}" r="${rect.r}" b="${rect.b}"/>`;
    return picture.replace(/<a:stretch>/, `${source}<a:stretch>`);
  });
}

/**
 * Writes the crops of every slide into the package. A slide without a crop is
 * left untouched, so a failure here can never cost a deck its pictures.
 */
export function patchImageCrops(
  entries: Record<string, Uint8Array>,
  cropsBySlide: readonly (readonly (ImageCrop | undefined)[])[],
): number {
  let patched = 0;
  cropsBySlide.forEach((crops, slideIndex) => {
    if (crops.length === 0) return;
    const part = `ppt/slides/slide${slideIndex + 1}.xml`;
    const content = entries[part];
    if (!content) return;
    const xml = strFromU8(content);
    const next = patchPictureCrops(xml, crops);
    if (next === xml) return;
    entries[part] = strToU8(next);
    patched += 1;
  });
  return patched;
}
