import type { AnimationEffect, AnimationPhase } from "./types";

/**
 * The phase an effect belongs to.
 *
 * The user picks an effect, not a phase: “pulse” is always an emphasis and
 * “disappear” is always an exit. Deriving the phase keeps the two fields from
 * disagreeing and lets the editor group the effect list without a second
 * choice.
 */
export function phaseForEffect(effect: AnimationEffect): AnimationPhase {
  if (effect === "pulse") return "emphasis";
  if (effect === "disappear") return "exit";
  return "entrance";
}

export const ENTRANCE_EFFECTS: readonly AnimationEffect[] = [
  "appear",
  "fade",
  "fly-in",
  "float-in",
  "split",
  "wipe",
  "zoom",
];

export const EMPHASIS_EFFECTS: readonly AnimationEffect[] = ["pulse"];
export const EXIT_EFFECTS: readonly AnimationEffect[] = ["disappear"];

/**
 * Effects the exporter can write as a native PowerPoint timing node.
 *
 * The list is deliberately smaller than the editor's effect list. A native
 * node has to match the DrawingML timing schema exactly; the remaining effects
 * (split, float-in, pulse, disappear) stay previewable and persist in the
 * project, but the export report says they were not written. Claiming a
 * conversion we have not verified would be worse than an honest warning.
 */
export const NATIVE_ANIMATION_EFFECTS: readonly AnimationEffect[] = ["appear", "fade", "fly-in", "wipe", "zoom"];

export function animationExportsNatively(effect: AnimationEffect): boolean {
  return NATIVE_ANIMATION_EFFECTS.includes(effect);
}
