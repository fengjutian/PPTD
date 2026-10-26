import type { DocumentCommand } from "../../core/commands";
import type { SlideId, SlideTransition } from "../../core/document-model";
import { SelectField } from "./inspector-fields";

import {
  commitTransition,
  TRANSITION_DIRECTION_LABELS,
  TRANSITION_DIRECTIONS,
  TRANSITION_KIND_LABELS,
  TRANSITION_KINDS,
  TRANSITION_SPEED_LABELS,
  TRANSITION_SPEEDS,
  transitionHasDirection,
  transitionState,
} from "./transition-options";

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
  const { kind, speed, direction } = transitionState(transition);

  return (
    <div className="transition-controls">
      <SelectField
        label="切换效果"
        value={kind}
        options={TRANSITION_KINDS}
        optionLabels={TRANSITION_KIND_LABELS}
        onCommit={(value) =>
          commitTransition(slideId, { kind: value as typeof kind, speed, direction }, onCommand)
        }
      />
      {kind !== "none" && (
        <SelectField
          label="速度"
          value={speed}
          options={TRANSITION_SPEEDS}
          optionLabels={TRANSITION_SPEED_LABELS}
          onCommit={(value) =>
            commitTransition(slideId, { kind, speed: value as typeof speed, direction }, onCommand)
          }
        />
      )}
      {transitionHasDirection(kind) && (
        <SelectField
          label="方向"
          value={direction}
          options={TRANSITION_DIRECTIONS}
          optionLabels={TRANSITION_DIRECTION_LABELS}
          onCommit={(value) =>
            commitTransition(slideId, { kind, speed, direction: value as typeof direction }, onCommand)
          }
        />
      )}
      <p className="field-help">切换会写入 PPTX 原生 transition，放映时由 PowerPoint 执行。</p>
    </div>
  );
}
