import type { AiComposition } from "./design-intent";

/**
 * The visual story a page tells, independent from the boxes used to draw it.
 *
 * A layout answers "where does copy go". A narrative answers "how should the
 * audience understand this page". Keeping the latter semantic lets the model
 * make an art-direction decision without giving it unsafe free coordinates.
 */
export type AiVisualNarrative =
  "statement" | "evidence" | "comparison" | "chronology" | "framework" | "quotation" | "scene";

export function narrativeComposition(narrative: AiVisualNarrative): AiComposition {
  switch (narrative) {
    case "evidence":
    case "framework":
      return "grid";
    case "comparison":
    case "chronology":
      return "columns";
    case "quotation":
      return "editorial";
    case "statement":
    case "scene":
      return "stacked";
  }
}
