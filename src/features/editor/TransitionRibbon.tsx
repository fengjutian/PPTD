import type { DocumentCommand } from "../../core/commands";
import type { SlideId, SlideTransition } from "../../core/document-model";

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
 * The compact page-transition picker of the “动画” ribbon.
 *
 * It is the same command and the same values as the page inspector; the ribbon
 * only removes a trip to the inspector for the two settings users change most.
 */
export function TransitionRibbon({
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
    <div className="ribbon-transition-tools" role="group" aria-label="页面切换">
      <div className="ribbon-transition-row">
        <label>
          <span>切换</span>
          <select
            aria-label="页面切换效果"
            value={kind}
            onChange={(event) =>
              commitTransition(slideId, { kind: event.target.value as typeof kind, speed, direction }, onCommand)
            }
          >
            {TRANSITION_KINDS.map((option) => (
              <option key={option} value={option}>
                {TRANSITION_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind !== "none" && (
        <div className="ribbon-transition-row">
          <label>
            <span>速度</span>
            <select
              aria-label="页面切换速度"
              value={speed}
              onChange={(event) =>
                commitTransition(slideId, { kind, speed: event.target.value as typeof speed, direction }, onCommand)
              }
            >
              {TRANSITION_SPEEDS.map((option) => (
                <option key={option} value={option}>
                  {TRANSITION_SPEED_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          {transitionHasDirection(kind) && (
            <label>
              <span>方向</span>
              <select
                aria-label="页面切换方向"
                value={direction}
                onChange={(event) =>
                  commitTransition(
                    slideId,
                    { kind, speed, direction: event.target.value as typeof direction },
                    onCommand,
                  )
                }
              >
                {TRANSITION_DIRECTIONS.map((option) => (
                  <option key={option} value={option}>
                    {TRANSITION_DIRECTION_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
