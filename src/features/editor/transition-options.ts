import type { DocumentCommand } from "../../core/commands";
import type { SlideId, SlideTransition, SlideTransitionDirection, SlideTransitionKind, SlideTransitionSpeed } from "../../core/document-model";

export const TRANSITION_KINDS = ["none", "fade", "push", "wipe", "split"] as const;
export const TRANSITION_KIND_LABELS: Record<string, string> = {
  none: "无",
  fade: "淡入淡出",
  push: "推进",
  wipe: "擦除",
  split: "分割",
};
export const TRANSITION_SPEEDS = ["fast", "medium", "slow"] as const;
export const TRANSITION_SPEED_LABELS: Record<string, string> = {
  fast: "快速",
  medium: "中速",
  slow: "慢速",
};
export const TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;
export const TRANSITION_DIRECTION_LABELS: Record<string, string> = {
  left: "左",
  right: "右",
  up: "上",
  down: "下",
};

/** Kinds that need a direction; fade is the only directionless transition. */
export function transitionHasDirection(kind: SlideTransitionKind | "none"): boolean {
  return kind === "push" || kind === "wipe" || kind === "split";
}

/**
 * Writes one transition command. `none` removes the transition, so the page
 * goes back to the PowerPoint default without leaving an empty object behind.
 */
export function commitTransition(
  slideId: SlideId,
  next: {
    kind: SlideTransitionKind | "none";
    speed: SlideTransitionSpeed;
    direction: SlideTransitionDirection;
  },
  onCommand: (command: DocumentCommand) => void,
): void {
  if (next.kind === "none") {
    onCommand({ type: "set-slide-transition", slideId, transition: null });
    return;
  }
  onCommand({
    type: "set-slide-transition",
    slideId,
    transition: {
      kind: next.kind,
      speed: next.speed,
      ...(transitionHasDirection(next.kind) ? { direction: next.direction } : {}),
    },
  });
}

export function transitionState(transition?: SlideTransition): {
  kind: SlideTransitionKind | "none";
  speed: SlideTransitionSpeed;
  direction: SlideTransitionDirection;
} {
  return {
    kind: transition?.kind ?? "none",
    speed: transition?.speed ?? "medium",
    direction: transition?.direction ?? "left",
  };
}
