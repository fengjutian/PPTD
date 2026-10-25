/**
 * The safe area a deck-level surface strategy asks for.
 *
 * Before this existed, every generated page used one hard-coded margin. A
 * direction could claim "full-bleed" but the page still had the editorial
 * margin, so two directions differed only in colour. The margin now belongs to
 * the surface, and a template or a reviewed safe region still wins over it.
 */

import type { SurfaceStrategy } from "./deck-concept";

export interface SurfaceSafeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The margins the renderer used before surfaces existed, kept byte-identical. */
export const DEFAULT_SAFE_REGION: SurfaceSafeRegion = { x: 0.07, y: 0.12, width: 0.86, height: 0.75 };

const PROFILES: Readonly<Record<SurfaceStrategy, SurfaceSafeRegion>> = {
  flat: DEFAULT_SAFE_REGION,
  rules: DEFAULT_SAFE_REGION,
  panels: { x: 0.08, y: 0.12, width: 0.84, height: 0.75 },
  // Full-bleed spends the page edge: the title moves up and the content widens.
  // The bottom keeps a little more room than the top for the footer band.
  "full-bleed": { x: 0.04, y: 0.075, width: 0.92, height: 0.855 },
  // A column surface is the opposite bet: a measured, centred text column with
  // wide side margins. The title axis moves inward with it, so the page reads as
  // a printed essay rather than an editorial slide.
  column: { x: 0.17, y: 0.1, width: 0.66, height: 0.8 },
  // A rail surface keeps the copy off the left edge. The command layer draws the
  // vertical rail at the inner edge of this profile; the margin is the skeleton.
  rail: { x: 0.22, y: 0.085, width: 0.72, height: 0.845 },
};

export function surfaceSafeRegion(surface: SurfaceStrategy): SurfaceSafeRegion {
  return { ...(PROFILES[surface] ?? DEFAULT_SAFE_REGION) };
}

/**
 * A full-bleed surface does not draw the accent rule under the title: the rule
 * is the visual signature of the editorial direction, and keeping it would make
 * the two directions share the same header ornament.
 */
export function surfaceShowsRule(surface: SurfaceStrategy): boolean {
  return surface !== "full-bleed";
}
