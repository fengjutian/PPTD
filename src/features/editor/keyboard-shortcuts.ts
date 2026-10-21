export type EditorShortcut = "undo" | "redo" | "duplicate-element" | "delete-element" | "nudge-left" | "nudge-right" | "nudge-up" | "nudge-down" | "layer-forward" | "layer-backward";

export interface ShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  targetTagName?: string;
  targetIsContentEditable?: boolean;
}

export function resolveEditorShortcut(input: ShortcutInput): EditorShortcut | null {
  const tagName = input.targetTagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select" || input.targetIsContentEditable) return null;

  const modifier = input.ctrlKey || input.metaKey;
  const key = input.key.toLowerCase();
  if (modifier && key === "z") return input.shiftKey ? "redo" : "undo";
  if (modifier && key === "y") return "redo";
  if (modifier && key === "d") return "duplicate-element";
  if (modifier && key === "]") return "layer-forward";
  if (modifier && key === "[") return "layer-backward";
  if (!modifier && (key === "delete" || key === "backspace")) return "delete-element";
  if (!modifier && key === "arrowleft") return "nudge-left";
  if (!modifier && key === "arrowright") return "nudge-right";
  if (!modifier && key === "arrowup") return "nudge-up";
  if (!modifier && key === "arrowdown") return "nudge-down";
  return null;
}
