import { useEffect, useRef, useState } from "react";
import { Layers, MousePointer2, X } from "lucide-react";

import { RibbonCompactButton } from "./RibbonGroup";

/**
 * PowerPoint-style “Select” menu of the Editing group.
 *
 * Selecting all and clearing a selection are view operations, so they only touch
 * the editor store. The pane entry is the same visible left panel the View tab
 * toggles; no duplicate selection state is introduced.
 */
export function SelectionMenu({
  canSelectAll,
  hasSelection,
  selectionPaneOpen,
  onSelectAll,
  onClearSelection,
  onOpenSelectionPane,
}: {
  canSelectAll: boolean;
  hasSelection: boolean;
  selectionPaneOpen: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenSelectionPane: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="ribbon-menu" ref={root}>
      <RibbonCompactButton
        label="选择"
        caption="选择"
        pressed={open || selectionPaneOpen}
        hasPopup
        expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MousePointer2 />
      </RibbonCompactButton>
      {open && (
        <div className="ribbon-menu-popover" role="menu" aria-label="选择">
          <button type="button" role="menuitem" disabled={!canSelectAll} onClick={() => run(onSelectAll)}>
            <MousePointer2 />
            <span>全选本页对象</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={selectionPaneOpen}
            onClick={() => run(onOpenSelectionPane)}
          >
            <Layers />
            <span>选择窗格</span>
          </button>
          <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(onClearSelection)}>
            <X />
            <span>取消选择</span>
          </button>
        </div>
      )}
    </div>
  );
}
