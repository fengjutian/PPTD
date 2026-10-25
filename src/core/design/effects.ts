import type { ShapeShadowToken } from "../document-model";

/**
 * The shadow levels, as measurements rather than as opinions.
 *
 * The recipe says "this is a raised card"; this table says how far that is in
 * points. The canvas turns it into a CSS shadow and the exporter into
 * `a:outerShdw`, so the preview and the exported page cannot drift — the same
 * reason `design-tokens` keeps type sizes in one place.
 *
 * The values were checked against a real PowerPoint render (see ADR 0102): three
 * levels that a person can tell apart at slide size, and none of them strong
 * enough to read as a border.
 */
export interface ShadowSpec {
  /** Blur radius, points. */
  blurPt: number;
  /** Offset along the light direction, points. */
  distancePt: number;
  /** 0–1, applied to the shadow colour. */
  opacity: number;
  /** Degrees, 45 = light from the top-left, the same on canvas and in PowerPoint. */
  angleDeg: number;
}

export const SHADOW_TOKENS: Readonly<Record<ShapeShadowToken, ShadowSpec>> = {
  card: { blurPt: 6, distancePt: 2, opacity: 0.18, angleDeg: 45 },
  raised: { blurPt: 14, distancePt: 4, opacity: 0.26, angleDeg: 45 },
  emphasis: { blurPt: 26, distancePt: 8, opacity: 0.34, angleDeg: 45 },
};

/** The token's spec, or undefined for a shape that sits flat on the page. */
export function shadowSpec(token: ShapeShadowToken | undefined): ShadowSpec | undefined {
  return token ? SHADOW_TOKENS[token] : undefined;
}
