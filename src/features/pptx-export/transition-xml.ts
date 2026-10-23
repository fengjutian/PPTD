import { strFromU8, strToU8 } from "fflate";
import type { Slide, SlideTransition, SlideTransitionDirection } from "../../core/document-model";

/**
 * Native slide transitions.
 *
 * PptxGenJS has no transition API, so the element is written into the slide
 * part after the package is generated. The shape of the XML is fixed by
 * ECMA-376: `<p:transition>` sits after `<p:clrMapOvr>` and before
 * `<p:timing>`, and the child element names the effect.
 */

/** The attribute spelling of a direction in `p:push` and `p:wipe`. */
function side(direction: SlideTransitionDirection): string {
  if (direction === "right") return "r";
  if (direction === "up") return "u";
  if (direction === "down") return "d";
  return "l";
}

/** PowerPoint's speed attribute uses `med`, not `medium`. */
function speed(value: SlideTransition["speed"]): string {
  return value === "medium" ? "med" : value;
}

/** The slide XML for one transition. */
export function transitionXml(transition: SlideTransition): string {
  const spd = speed(transition.speed);
  const direction = transition.direction ?? "left";
  if (transition.kind === "fade") {
    return `<p:transition spd="${spd}"><p:fade/></p:transition>`;
  }
  if (transition.kind === "push") {
    return `<p:transition spd="${spd}"><p:push dir="${side(direction)}"/></p:transition>`;
  }
  if (transition.kind === "wipe") {
    return `<p:transition spd="${spd}"><p:wipe dir="${side(direction)}"/></p:transition>`;
  }
  // A horizontal split opens top/bottom, a vertical split opens left/right;
  // "out" starts at the center, "in" starts at the edges.
  const orient = direction === "left" || direction === "right" ? "vert" : "horz";
  const splitDirection = direction === "left" || direction === "up" ? "out" : "in";
  return `<p:transition spd="${spd}"><p:split orient="${orient}" dir="${splitDirection}"/></p:transition>`;
}

/**
 * Inserts (or replaces) the transition element in one slide part.
 *
 * The replacement branch makes the patch idempotent: running it on a package
 * that already has a transition must not append a second one, which PowerPoint
 * would reject.
 */
export function applyTransitionToSlideXml(xml: string, transition: SlideTransition): string {
  const element = transitionXml(transition);
  const existing = /<p:transition[\s\S]*?<\/p:transition>/.exec(xml);
  if (existing) return xml.replace(existing[0], element);

  const afterClrMap = /<p:clrMapOvr>[\s\S]*?<\/p:clrMapOvr>/;
  if (afterClrMap.test(xml)) {
    return xml.replace(afterClrMap, (match) => `${match}${element}`);
  }
  const selfClosingClrMap = /<p:clrMapOvr\s*\/>/;
  if (selfClosingClrMap.test(xml)) {
    return xml.replace(selfClosingClrMap, (match) => `${match}${element}`);
  }
  return xml.replace("</p:sld>", `${element}</p:sld>`);
}

/**
 * Writes every slide's transition into the matching slide part.
 *
 * PptxGenJS adds slide parts in document order, so slide N is `slideN.xml`.
 * A missing part is skipped rather than guessed at; the caller reports only the
 * transitions that were actually written.
 */
export function patchSlideTransitions(entries: Record<string, Uint8Array>, slides: readonly Slide[]): number {
  let applied = 0;
  slides.forEach((slide, index) => {
    if (!slide.transition) return;
    const part = `ppt/slides/slide${index + 1}.xml`;
    const data = entries[part];
    if (!data) return;
    const xml = strFromU8(data);
    const patched = applyTransitionToSlideXml(xml, slide.transition);
    if (patched === xml) return;
    entries[part] = strToU8(patched);
    applied += 1;
  });
  return applied;
}
