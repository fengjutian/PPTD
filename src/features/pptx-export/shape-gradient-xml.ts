import { strFromU8, strToU8 } from "fflate";
import type { ShapeFillGradient, Slide } from "../../core/document-model";

/**
 * PptxGenJS can only write a solid shape fill. A native gradient is therefore
 * written into the slide part after the package is built, the same way the
 * template palette and the picture crops are patched.
 *
 * The shape keeps its `objectName`, so the patch can find the exact `<p:sp>`
 * without guessing at z-order, and a shape whose name is not found simply
 * keeps its solid fallback.
 */

function rgbHex(color: string): string {
  const value = color.replace("#", "").toUpperCase();
  if (value.length === 3) return [...value].map((character) => character.repeat(2)).join("");
  return value.slice(0, 6);
}

/** DrawingML for one linear gradient. Transparency is stored as alpha. */
export function shapeGradientXml(gradient: ShapeFillGradient): string {
  const stops = [...gradient.stops]
    .sort((first, second) => first.offset - second.offset)
    .map((stop) => {
      const alpha =
        stop.transparency === undefined
          ? ""
          : `<a:alpha val="${Math.round(Math.max(0, Math.min(1, 1 - stop.transparency / 100)) * 100_000)}"/>`;
      return `<a:gs pos="${Math.round(stop.offset * 100_000)}"><a:srgbClr val="${rgbHex(stop.color)}">${alpha}</a:srgbClr></a:gs>`;
    })
    .join("");
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(gradient.angleDeg * 60_000)}" scaled="0"/></a:gradFill>`;
}

/** Replaces the solid fill of the named shapes in one slide part. */
export function patchShapeGradientsInXml(
  xml: string,
  gradients: ReadonlyMap<string, string>,
): { xml: string; patched: number } {
  if (gradients.size === 0) return { xml, patched: 0 };
  let patched = 0;
  const next = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => {
    for (const [name, gradient] of gradients) {
      if (!shape.includes(`name="${name}"`)) continue;
      const withGradient = shape.replace(/<p:spPr\b[\s\S]*?<\/p:spPr>/, (properties) => {
        if (/<a:solidFill>[\s\S]*?<\/a:solidFill>/.test(properties)) {
          return properties.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, gradient);
        }
        return properties.replace(/(<a:prstGeom[\s\S]*?<\/a:prstGeom>)/, `$1${gradient}`);
      });
      if (withGradient === shape) return shape;
      patched += 1;
      return withGradient;
    }
    return shape;
  });
  return { xml: next, patched };
}

export interface ShapeGradientPatchResult {
  expected: number;
  patched: number;
}

export function patchShapeGradients(
  entries: Record<string, Uint8Array>,
  slides: readonly Slide[],
): ShapeGradientPatchResult {
  let expected = 0;
  let patched = 0;
  slides.forEach((slide, slideIndex) => {
    const gradients = new Map<string, string>();
    for (const element of slide.elements) {
      if (element.type !== "shape" || !element.style.fillGradient) continue;
      expected += 1;
      gradients.set(element.id, shapeGradientXml(element.style.fillGradient));
    }
    if (gradients.size === 0) return;
    const part = `ppt/slides/slide${slideIndex + 1}.xml`;
    const content = entries[part];
    if (!content) return;
    const xml = strFromU8(content);
    const result = patchShapeGradientsInXml(xml, gradients);
    if (result.patched === 0) return;
    entries[part] = strToU8(result.xml);
    patched += result.patched;
  });
  return { expected, patched };
}
