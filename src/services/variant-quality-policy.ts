export interface VariantQualityDecision {
  /** Deterministic checks such as overflow, overlap and contrast. */
  deterministicPassed: boolean;
  /** Candidate-level composition and asset requirements. */
  aestheticPassed: boolean;
}

/**
 * Layout audits are diagnostics for the gallery, not a delivery gate.
 *
 * A candidate is discarded only when a deterministic safety check or the
 * candidate aesthetic contract fails. Audit findings such as `text-orphan`
 * remain visible on the card so the user can compare imperfect alternatives
 * instead of receiving an empty gallery.
 */
export function variantCanEnterGallery(decision: VariantQualityDecision): boolean {
  return decision.deterministicPassed && decision.aestheticPassed;
}
