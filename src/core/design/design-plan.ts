import type { RecipeId } from "./deck-concept";

/**
 * The semantic plan the design agent writes for one page.
 *
 * The model chooses the argument, the composition family, the focal object and
 * whether the template may be used as-is. It never writes a coordinate: the
 * compiler turns this plan into geometry, so every page still lands on the same
 * title axis, grid and safe area.
 */
export type DesignRole = "cover" | "section" | "claim" | "comparison" | "process" | "timeline" | "quote" | "summary";

/** A layout family, not a finished recipe. */
export type DesignPrimitive = "split" | "stack" | "grid" | "rail" | "overlay" | "band";

export type DesignDensity = "sparse" | "normal" | "dense";

/**
 * "use" fills the template placeholders; "takeover" keeps the header, Logo and
 * footer but replaces the body artwork with a clean content surface; "ignore"
 * reserves the escape hatch for a future preset-only page.
 */
export type TemplatePolicy = "use" | "takeover" | "ignore";

export interface PageDesignPlan {
  role: DesignRole;
  composition: {
    primitive: DesignPrimitive;
    /** Main/side split ratio for a split composition. */
    ratio?: number;
    align?: "left" | "center";
  };
  density: DesignDensity;
  templatePolicy: TemplatePolicy;
  /** Optional concrete recipe. When absent the compiler picks one from the role and facts. */
  recipe?: RecipeId;
  focal?: {
    kind: "title" | "number" | "image" | "chart" | "none";
    blockId?: string;
    brief?: string;
  };
  /**
   * Character ranges in reviewed blocks that should carry emphasis. The
   * compiler may render these as bold runs; it must not change the text.
   */
  emphasis?: Array<{ blockId: string; start: number; end: number }>;
}
