import type { ReactNode } from "react";

export function ToolButton({
  label,
  caption,
  onClick,
  disabled,
  children,
}: {
  label: string;
  caption?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button className="tool-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
      <span>{caption ?? label}</span>
    </button>
  );
}
