import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  Copy,
  Eye,
  EyeOff,
  Group,
  Lock,
  LockOpen,
  Pencil,
  SendToBack,
  Trash2,
  Ungroup,
} from "lucide-react";

import type { DocumentCommand } from "../../core/commands";
import type { ElementId, Slide } from "../../core/document-model";

import { blockMoveIndex, layerMenuState, type LayerMoveTarget } from "./layer-order";

export interface LayerContextMenuProps {
  slide: Slide;
  /** The row the menu was opened on. */
  elementId: ElementId;
  /** The selection at the moment the menu opened; it defines the moved block. */
  selectedElementIds: readonly ElementId[];
  x: number;
  y: number;
  onClose: () => void;
  /** Starts the inline name editor on this row. */
  onRename: (elementId: ElementId) => void;
  /** Each entry is one command, so one undo entry. */
  onCommand: (command: DocumentCommand) => void;
}

/**
 * The right-click menu of one layer row.
 *
 * It offers the z-order moves, copy, lock, group and delete that otherwise live
 * in different panels. A multi-selection or a group is treated as one block, so
 * every entry still produces exactly one command.
 */
export function LayerContextMenu({
  slide,
  elementId,
  selectedElementIds,
  x,
  y,
  onClose,
  onRename,
  onCommand,
}: LayerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = layerMenuState(slide, elementId, selectedElementIds);

  const run = (command: DocumentCommand) => {
    onCommand(command);
    onClose();
  };

  const move = (target: LayerMoveTarget) => {
    const toIndex = blockMoveIndex(slide.elements, state.blockIds, target);
    if (toIndex === null) return;
    run({ type: "reorder-elements", slideId: slide.id, elementIds: state.blockIds, toIndex });
  };

  useEffect(() => {
    const menu = menuRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menu?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (items.length === 0) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // The row keeps the keyboard focus after the menu closes; the command may
      // have removed it, in which case the call is simply a no-op.
      previousFocus?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div
        className="layer-menu-backdrop"
        aria-hidden="true"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="layer-menu"
        role="menu"
        aria-label="图层操作"
        ref={menuRef}
        style={{ left: x, top: y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" role="menuitem" disabled={!state.canMove.front} onClick={() => move("front")}>
          <BringToFront />
          <span>置于顶层</span>
        </button>
        <button type="button" role="menuitem" disabled={!state.canMove.up} onClick={() => move("up")}>
          <ArrowUp />
          <span>上移一层</span>
        </button>
        <button type="button" role="menuitem" disabled={!state.canMove.down} onClick={() => move("down")}>
          <ArrowDown />
          <span>下移一层</span>
        </button>
        <button type="button" role="menuitem" disabled={!state.canMove.back} onClick={() => move("back")}>
          <SendToBack />
          <span>置于底层</span>
        </button>

        <div className="layer-menu-separator" role="separator" />

        <button
          type="button"
          role="menuitem"
          disabled={state.allLocked}
          onClick={() => run({ type: "duplicate-elements", slideId: slide.id, elementIds: state.blockIds })}
        >
          <Copy />
          <span>复制</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            run({
              type: "set-elements-lock",
              slideId: slide.id,
              elementIds: state.blockIds,
              locked: !state.allLocked,
            })
          }
        >
          {state.allLocked ? <LockOpen /> : <Lock />}
          <span>{state.allLocked ? "解锁" : "锁定"}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!state.canGroup}
          onClick={() => run({ type: "group-elements", slideId: slide.id, elementIds: [...selectedElementIds] })}
        >
          <Group />
          <span>组合</span>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!state.canUngroup}
          onClick={() => {
            if (!state.groupId) return;
            run({ type: "ungroup-elements", slideId: slide.id, groupId: state.groupId });
          }}
        >
          <Ungroup />
          <span>取消组合</span>
        </button>

        <div className="layer-menu-separator" role="separator" />

        <button
          type="button"
          role="menuitem"
          className="danger"
          disabled={state.deletableIds.length === 0}
          onClick={() => run({ type: "delete-elements", slideId: slide.id, elementIds: state.deletableIds })}
        >
          <Trash2 />
          <span>删除</span>
        </button>
      </div>
    </>
  );
}
