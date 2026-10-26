import type { PresentationDocument, Slide, SlideElement } from "./types";

/**
 * Whether an object is part of the visible page.
 *
 * Hiding is editor-side state, so the absence of the flag means visible: a
 * document written before the flag existed keeps showing every object.
 */
export function isElementVisible(element: SlideElement): boolean {
  return element.hidden !== true;
}

/** The elements a canvas, thumbnail or export has to draw. */
export function visibleElements(slide: Slide): SlideElement[] {
  return slide.elements.filter(isElementVisible);
}

/**
 * A snapshot of the deck without hidden objects.
 *
 * The exporter works from this copy so every pass — pictures, gradients,
 * animations, verification and provenance — sees the same object set. Groups
 * keep only complete visible membership and animations only visible targets,
 * otherwise the package would point at shapes that are not there.
 */
export function withoutHiddenElements(document: PresentationDocument): PresentationDocument {
  if (!document.slides.some((slide) => slide.elements.some((element) => !isElementVisible(element)))) {
    return document;
  }
  return {
    ...document,
    slides: document.slides.map((slide) => {
      if (slide.elements.every(isElementVisible)) return slide;
      const elements = visibleElements(slide);
      const visibleIds = new Set(elements.map((element) => element.id));
      const groups = slide.groups?.filter((group) => group.elementIds.every((id) => visibleIds.has(id)));
      const animations = slide.animations?.filter((animation) => visibleIds.has(animation.elementId));
      return {
        ...slide,
        elements,
        ...(groups && groups.length > 0 ? { groups } : {}),
        ...(animations && animations.length > 0 ? { animations } : {}),
      };
    }),
  };
}

/** How many objects one page hides, for the export report. */
export function hiddenElementCount(slide: Slide): number {
  return slide.elements.filter((element) => !isElementVisible(element)).length;
}
