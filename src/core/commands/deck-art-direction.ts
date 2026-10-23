import type { AiSlideDesign } from "./template-layouts";

/**
 * Applies deck-level cadence after per-page decisions have been made.
 *
 * The model chooses the story of each page. This pass only coordinates page
 * roles across the sequence: opening/section pages become visual beats while
 * ordinary content stays calm. It changes palette roles, never content or
 * coordinates.
 */
export function applyDeckArtDirection(slides: AiSlideDesign[]): AiSlideDesign[] {
  let colorBeat = 0;
  return slides.map((slide, index) => {
    const isBeat = index === 0 || slide.layout === "section" || slide.visualNarrative === "statement";
    const previous = slides[index - 1];
    const previousIsBeat =
      index > 0 && (index - 1 === 0 || previous?.layout === "section" || previous?.visualNarrative === "statement");
    // Never make two consecutive pages dark: a beat needs a quiet page after it.
    const dark = isBeat && !previousIsBeat;
    const beatBackground = (["accent-1", "accent-2", "accent-3"] as const)[colorBeat % 3]!;
    if (dark) colorBeat += 1;
    return {
      ...slide,
      emphasis: dark ? "title-dominant" : slide.emphasis,
      palette: {
        ...slide.palette,
        // Visual beats use a saturated theme colour instead of black. Cycling
        // the three accents gives chapters a richer rhythm without leaving the
        // selected theme's controlled palette.
        background: dark ? beatBackground : (slide.palette?.background ?? "surface"),
        title: dark ? "inverse" : (slide.palette?.title ?? "primary"),
        body: dark ? "inverse" : (slide.palette?.body ?? "secondary"),
        accent: slide.palette?.accent ?? "accent-1",
      },
    };
  });
}
