import { strFromU8, strToU8 } from "fflate";
import type { ImageCrop, ImageFrameShape } from "../../core/document-model";
import { cropSourceRect } from "../../core/rendering/image-crop";

/**
 * The picture part: crop and frame shape.
 *
 * Both are properties of the same `<p:pic>` element, and both are things
 * PptxGenJS cannot express — a crop is an `a:srcRect` inside the fill, and a
 * frame shape turns the picture into a shape that is *filled* by it. They share
 * one pass because a second pass over the same element would have to parse a
 * document the first pass had already rewritten.
 *
 * The pictures of a slide appear in the XML in the order they were added, so the
 * treatments are applied in that order (the same convention as before).
 */
export interface PictureTreatment {
  crop?: ImageCrop;
  frameShape?: ImageFrameShape;
}

const PRESET_GEOMETRY: Readonly<Record<ImageFrameShape, string>> = {
  roundRect: "roundRect",
  ellipse: "ellipse",
};

function srcRectXml(crop: ImageCrop | undefined): string {
  const rect = crop ? cropSourceRect(crop) : undefined;
  if (!rect) return "";
  return `<a:srcRect l="${rect.l}" t="${rect.t}" r="${rect.r}" b="${rect.b}"/>`;
}

/**
 * Rewrites one picture.
 *
 * Without a frame shape the picture stays a picture and only gains its crop.
 * With one it becomes a `p:sp`: a preset geometry filled by the image. The
 * rewrite carries the parts that are not visible in a screenshot and are
 * therefore easy to lose — the alternative text (`descr`) and the rotation and
 * flips of the transform (ADR 0102).
 */
function rewritePicture(picture: string, treatment: PictureTreatment): string {
  const source = srcRectXml(treatment.crop);
  if (!treatment.frameShape) {
    if (!source) return picture;
    return picture.replace(/<a:stretch>/, `${source}<a:stretch>`);
  }

  const embed = /r:embed="([^"]+)"/.exec(picture)?.[1];
  const offset = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(picture);
  const extent = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(picture);
  const id = /<p:cNvPr id="(\d+)"/.exec(picture)?.[1];
  const name = /name="([^"]*)"/.exec(picture)?.[1] ?? "Picture";
  const description = /descr="([^"]*)"/.exec(picture)?.[1];
  const transform = /<a:xfrm([^>]*)>/.exec(picture)?.[1]?.trim();
  if (!embed || !offset || !extent || !id) return picture;

  const xfrm = [
    `<a:xfrm${transform ? ` ${transform}` : ""}>`,
    `<a:off x="${offset[1]}" y="${offset[2]}"/>`,
    `<a:ext cx="${extent[1]}" cy="${extent[2]}"/>`,
    `</a:xfrm>`,
  ].join("");
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"${description ? ` descr="${description}"` : ""}/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm}` +
    `<a:prstGeom prst="${PRESET_GEOMETRY[treatment.frameShape]}"><a:avLst/></a:prstGeom>` +
    `<a:blipFill><a:blip r:embed="${embed}"/>${source}<a:stretch><a:fillRect/></a:stretch></a:blipFill>` +
    // The theme's default shape line would otherwise draw an outline that the
    // canvas does not have.
    `<a:ln><a:noFill/></a:ln>` +
    `</p:spPr></p:sp>`
  );
}

/** Applies the treatments of one slide in picture order. */
export function patchPictureFrames(xml: string, treatments: readonly (PictureTreatment | undefined)[]): string {
  if (treatments.length === 0) return xml;
  let index = 0;
  return xml.replace(/<p:pic\b[\s\S]*?<\/p:pic>/g, (picture) => {
    const treatment = treatments[index];
    index += 1;
    return treatment ? rewritePicture(picture, treatment) : picture;
  });
}

/**
 * Writes the picture treatments of every slide into the package. A slide with
 * nothing to treat is left untouched, so a failure here can never cost a deck
 * its pictures.
 */
export function patchImageFrames(
  entries: Record<string, Uint8Array>,
  treatmentsBySlide: readonly (readonly (PictureTreatment | undefined)[])[],
): number {
  let patched = 0;
  treatmentsBySlide.forEach((treatments, slideIndex) => {
    if (treatments.every((treatment) => treatment === undefined)) return;
    const part = `ppt/slides/slide${slideIndex + 1}.xml`;
    const content = entries[part];
    if (!content) return;
    const xml = strFromU8(content);
    const next = patchPictureFrames(xml, treatments);
    if (next === xml) return;
    entries[part] = strToU8(next);
    patched += 1;
  });
  return patched;
}
