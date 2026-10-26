import type { ReactNode } from "react";

export function ToolButton({
  label,
  caption,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  caption?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Set for a control that stays on, such as the visible left panel. */
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className="tool-button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      <span>{caption ?? label}</span>
    </button>
  );
}
