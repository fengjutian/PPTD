export type EditorShortcut = "undo" | "redo" | "duplicate-element" | "delete-element";

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
  if (!modifier && (key === "delete" || key === "backspace")) return "delete-element";
  return null;
}
