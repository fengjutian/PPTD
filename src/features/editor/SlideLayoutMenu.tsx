import { useEffect, useRef, useState } from "react";
import { Check, LayoutTemplate } from "lucide-react";

import type { SlideLayoutOption } from "../../core/commands";

import { RibbonCompactButton } from "./RibbonGroup";

/**
 * PowerPoint-style layout picker of the Slides group.
 *
 * A layout is more than a label: applying one rebuilds the page composition
 * from the target layout's persisted capabilities. Options that would hide
 * reviewed copy or cannot carry the page's blocks stay visible with the reason
 * they are unavailable, so the limitation is explained instead of silently
 * producing a different page.
 */
export function SlideLayoutMenu({
  options,
  onApply,
}: {
  options: SlideLayoutOption[];
  onApply: (layoutId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.current);
  const hasAlternative = options.some((option) => !option.current && !option.issue);

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

  // A menu with only the layout already in use would be a placeholder command.
  if (!hasAlternative) return null;

  const choose = (layoutId: string) => {
    setOpen(false);
    onApply(layoutId);
  };

  return (
    <div className="ribbon-menu" ref={root}>
      <RibbonCompactButton
        label={current ? `当前版式：${current.layout.name || "未命名版式"}；更改版式` : "更改当前页版式"}
        caption="版式"
        pressed={open}
        hasPopup
        expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <LayoutTemplate />
      </RibbonCompactButton>
      {open && (
        <div
          className="ribbon-menu-popover layout-menu-popover"
          role="menu"
          aria-label="更改当前页版式"
        >
          {options.map((option) => (
            <button
              key={option.layout.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.current}
              className="layout-option"
              disabled={option.current || Boolean(option.issue)}
              title={option.issue ?? option.layout.name}
              onClick={() => choose(option.layout.id)}
            >
              <span className="layout-option-check" aria-hidden="true">
                {option.current ? <Check /> : null}
              </span>
              <span className="layout-option-copy">
                <span>{option.layout.name || "未命名版式"}</span>
                {option.issue && <small>{option.issue}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
