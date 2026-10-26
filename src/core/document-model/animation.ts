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
 * All nine editor effects have a verified DrawingML node. Objects whose native
 * animation is not verified (notably charts) can still be skipped by the
 * exporter and are counted in the export report.
 */
export const NATIVE_ANIMATION_EFFECTS: readonly AnimationEffect[] = [
  "appear",
  "fade",
  "fly-in",
  "float-in",
  "split",
  "wipe",
  "zoom",
  "pulse",
  "disappear",
];

export function animationExportsNatively(effect: AnimationEffect): boolean {
  return NATIVE_ANIMATION_EFFECTS.includes(effect);
}
