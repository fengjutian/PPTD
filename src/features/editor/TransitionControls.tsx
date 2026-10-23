import type { DocumentCommand } from "../../core/commands";
import type {
  SlideId,
  SlideTransition,
  SlideTransitionDirection,
  SlideTransitionKind,
  SlideTransitionSpeed,
} from "../../core/document-model";
import { SelectField } from "./inspector-fields";

const KIND_OPTIONS = ["none", "fade", "push", "wipe", "split"] as const;
const KIND_LABELS: Record<string, string> = {
  none: "无",
  fade: "淡入淡出",
  push: "推进",
  wipe: "擦除",
  split: "分割",
};
const SPEED_OPTIONS = ["fast", "medium", "slow"] as const;
const SPEED_LABELS: Record<string, string> = { fast: "快速", medium: "中速", slow: "慢速" };
const DIRECTION_OPTIONS = ["left", "right", "up", "down"] as const;
const DIRECTION_LABELS: Record<string, string> = { left: "左", right: "右", up: "上", down: "下" };

/** Kinds that need a direction; fade is the only directionless transition. */
function isDirectional(kind: SlideTransitionKind | "none"): boolean {
  return kind === "push" || kind === "wipe" || kind === "split";
}

/**
 * Page-transition controls of the page inspector.
 *
 * A transition belongs to the page, not to an object, and is design state: it
 * must not touch the reviewed copy or its version. The choice writes one
 * command, so switching a transition and its speed is one undo step each.
 */
export function TransitionControls({
  slideId,
  transition,
  onCommand,
}: {
  slideId: SlideId;
  transition?: SlideTransition;
  onCommand: (command: DocumentCommand) => void;
}) {
  const kind = transition?.kind ?? "none";
  const speed: SlideTransitionSpeed = transition?.speed ?? "medium";
  const direction: SlideTransitionDirection = transition?.direction ?? "left";

  const commit = (next: {
    kind: SlideTransitionKind | "none";
    speed: SlideTransitionSpeed;
    direction: SlideTransitionDirection;
  }) => {
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
        ...(isDirectional(next.kind) ? { direction: next.direction } : {}),
      },
    });
  };

  return (
    <div className="transition-controls">
      <SelectField
        label="切换效果"
        value={kind}
        options={KIND_OPTIONS}
        optionLabels={KIND_LABELS}
        onCommit={(value) => commit({ kind: value as SlideTransitionKind | "none", speed, direction })}
      />
      {kind !== "none" && (
        <SelectField
          label="速度"
          value={speed}
          options={SPEED_OPTIONS}
          optionLabels={SPEED_LABELS}
          onCommit={(value) => commit({ kind, speed: value as SlideTransitionSpeed, direction })}
        />
      )}
      {isDirectional(kind) && (
        <SelectField
          label="方向"
          value={direction}
          options={DIRECTION_OPTIONS}
          optionLabels={DIRECTION_LABELS}
          onCommit={(value) => commit({ kind, speed, direction: value as SlideTransitionDirection })}
        />
      )}
      <p className="field-help">切换会写入 PPTX 原生 transition，放映时由 PowerPoint 执行。</p>
    </div>
  );
}
