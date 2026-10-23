export type EditorShortcut =
  | "undo"
  | "redo"
  | "duplicate-element"
  | "copy-element"
  | "cut-element"
  | "paste-element"
  | "delete-element"
  | "nudge-left"
  | "nudge-right"
  | "nudge-up"
  | "nudge-down"
  | "layer-forward"
  | "layer-backward"
  | "toggle-bold"
  | "toggle-italic"
  | "toggle-underline"
  | "font-increase"
  | "font-decrease"
  | "copy-format"
  | "apply-format"
  | "find"
  | "select-all";

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
  if (tagName === "input" || tagName === "textarea" || tagName === "select" || input.targetIsContentEditable)
    return null;

  const modifier = input.ctrlKey || input.metaKey;
  const key = input.key.toLowerCase();
  if (modifier && key === "f") return "find";
  if (modifier && key === "a") return "select-all";
  if (modifier && key === "z") return input.shiftKey ? "redo" : "undo";
  if (modifier && key === "y") return "redo";
  if (modifier && key === "d") return "duplicate-element";
  // Format painter and font size use Shift, so they are resolved before the
  // plain clipboard shortcuts they would otherwise shadow.
  if (modifier && input.shiftKey && key === "c") return "copy-format";
  if (modifier && input.shiftKey && key === "v") return "apply-format";
  // Keyboard layouts disagree on what Shift+period reports; both spellings mean
  // "the > key" to the user.
  if (modifier && input.shiftKey && (key === ">" || key === ".")) return "font-increase";
  if (modifier && input.shiftKey && (key === "<" || key === ",")) return "font-decrease";
  if (modifier && key === "b") return "toggle-bold";
  if (modifier && key === "i") return "toggle-italic";
  if (modifier && key === "u") return "toggle-underline";
  if (modifier && key === "c") return "copy-element";
  if (modifier && key === "x") return "cut-element";
  if (modifier && key === "v") return "paste-element";
  if (modifier && key === "]") return "layer-forward";
  if (modifier && key === "[") return "layer-backward";
  if (!modifier && (key === "delete" || key === "backspace")) return "delete-element";
  if (!modifier && key === "arrowleft") return "nudge-left";
  if (!modifier && key === "arrowright") return "nudge-right";
  if (!modifier && key === "arrowup") return "nudge-up";
  if (!modifier && key === "arrowdown") return "nudge-down";
  return null;
}
