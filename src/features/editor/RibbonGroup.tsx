import type { ReactNode } from "react";

/**
 * One labelled command group of the ribbon.
 *
 * The visible label sits below the controls, the same place PowerPoint puts its
 * group names. The section carries the accessible name so keyboard and screen
 * reader users get the grouping too; the visible text is hidden from the
 * accessibility tree to avoid reading the name twice.
 */
export function RibbonGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `ribbon-group ${className}` : "ribbon-group"} aria-label={label}>
      <div className="ribbon-group-body">{children}</div>
      <span className="ribbon-group-label" aria-hidden="true">
        {label}
      </span>
    </section>
  );
}

/**
 * A narrow ribbon command with an icon and a short caption.
 *
 * The 48px tool buttons are reserved for primary actions. Compact buttons keep
 * the same 48px group height but need roughly two thirds of the width, which is
 * what lets the Home tab keep all six PowerPoint groups visible.
 */
export function RibbonCompactButton({
  label,
  caption,
  onClick,
  disabled,
  pressed,
  children,
  onDoubleClick,
  hasPopup,
  expanded,
}: {
  label: string;
  caption: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  onDoubleClick?: () => void;
  hasPopup?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="ribbon-compact-button"
      aria-label={label}
      aria-pressed={pressed}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
      <span>{caption}</span>
    </button>
  );
}
