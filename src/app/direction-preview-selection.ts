import type { ConceptPresetId } from "../core/design/deck-concept";
import type { AiDraft } from "../services/ai-service";

/** Cover plus the page that best exposes one direction's unique skeleton. */
export function directionPreviewIndexes(draft: AiDraft, preset: ConceptPresetId): number[] {
  if (draft.slides.length <= 1) return [0];
  const candidates = draft.slides.map((slide, index) => ({ slide, index })).filter(({ index }) => index > 0);
  const index = (() => {
    if (preset === "documentary") {
      return candidates.find(({ slide }) => slide.plan?.visualAsset?.enabled)?.index;
    }
    if (preset === "instrument") {
      return candidates.find(({ slide }) =>
        (slide.blocks ?? []).some(
          (block) => block.type === "metric" || block.type === "chart" || block.type === "table-data",
        ),
      )?.index;
    }
    if (preset === "paper") {
      return [...candidates].sort((left, right) => right.slide.body.length - left.slide.body.length)[0]?.index;
    }
    return candidates.find(({ slide }) => {
      const items = slide.body.split(/\r?\n/u).filter((item) => item.trim().length > 0);
      return items.length >= 3 && items.length <= 6;
    })?.index;
  })();
  const contentFallback = candidates.find(({ slide }) => slide.body.trim().length >= 60)?.index;
  return [0, index ?? contentFallback ?? 1];
}
