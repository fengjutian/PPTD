import type { AnimationEffect, AnimationPhase } from "../../core/document-model";

export interface AnimationEffectOption {
  effect: AnimationEffect;
  label: string;
  phase: AnimationPhase;
  /** Default duration for a newly added animation, in milliseconds. */
  durationMs: number;
}

/** Every effect the editor can add, grouped by phase in this order. */
export const ANIMATION_EFFECT_OPTIONS: readonly AnimationEffectOption[] = [
  { effect: "appear", label: "出现", phase: "entrance", durationMs: 300 },
  { effect: "fade", label: "淡化", phase: "entrance", durationMs: 600 },
  { effect: "fly-in", label: "飞入", phase: "entrance", durationMs: 600 },
  { effect: "float-in", label: "浮入", phase: "entrance", durationMs: 600 },
  { effect: "split", label: "劈裂", phase: "entrance", durationMs: 600 },
  { effect: "wipe", label: "擦除", phase: "entrance", durationMs: 600 },
  { effect: "zoom", label: "缩放", phase: "entrance", durationMs: 600 },
  { effect: "pulse", label: "强调脉冲", phase: "emphasis", durationMs: 700 },
  { effect: "disappear", label: "消失", phase: "exit", durationMs: 500 },
];

export const ANIMATION_EFFECT_LABELS: Readonly<Record<AnimationEffect, string>> = Object.fromEntries(
  ANIMATION_EFFECT_OPTIONS.map((option) => [option.effect, option.label]),
) as Record<AnimationEffect, string>;

export const ANIMATION_PHASE_LABELS: Readonly<Record<AnimationPhase, string>> = {
  entrance: "进入",
  emphasis: "强调",
  exit: "退出",
};
