import { describe, expect, it } from "vitest";
import { resolveEditorShortcut, type ShortcutInput } from "./keyboard-shortcuts";

const shortcut = (overrides: Partial<ShortcutInput>): EditorShortcutResult =>
  resolveEditorShortcut({
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });

type EditorShortcutResult = ReturnType<typeof resolveEditorShortcut>;

describe("editor keyboard shortcuts", () => {
  it("maps Windows and macOS history shortcuts", () => {
    expect(shortcut({ key: "z", ctrlKey: true })).toBe("undo");
    expect(shortcut({ key: "Z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(shortcut({ key: "y", ctrlKey: true })).toBe("redo");
  });

  it("maps selected element actions", () => {
    expect(shortcut({ key: "d", ctrlKey: true })).toBe("duplicate-element");
    expect(shortcut({ key: "c", ctrlKey: true })).toBe("copy-element");
    expect(shortcut({ key: "v", ctrlKey: true })).toBe("paste-element");
    expect(shortcut({ key: "Delete" })).toBe("delete-element");
    expect(shortcut({ key: "Backspace" })).toBe("delete-element");
    expect(shortcut({ key: "ArrowLeft" })).toBe("nudge-left");
    expect(shortcut({ key: "ArrowRight" })).toBe("nudge-right");
    expect(shortcut({ key: "ArrowUp" })).toBe("nudge-up");
    expect(shortcut({ key: "ArrowDown" })).toBe("nudge-down");
    expect(shortcut({ key: "]", ctrlKey: true })).toBe("layer-forward");
    expect(shortcut({ key: "[", ctrlKey: true })).toBe("layer-backward");
  });

  it("maps the text format shortcuts without shadowing the clipboard", () => {
    expect(shortcut({ key: "b", ctrlKey: true })).toBe("toggle-bold");
    expect(shortcut({ key: "i", ctrlKey: true })).toBe("toggle-italic");
    expect(shortcut({ key: "u", ctrlKey: true })).toBe("toggle-underline");
    expect(shortcut({ key: ">", ctrlKey: true, shiftKey: true })).toBe("font-increase");
    expect(shortcut({ key: ".", ctrlKey: true, shiftKey: true })).toBe("font-increase");
    expect(shortcut({ key: "<", ctrlKey: true, shiftKey: true })).toBe("font-decrease");
    expect(shortcut({ key: ",", ctrlKey: true, shiftKey: true })).toBe("font-decrease");
    expect(shortcut({ key: "c", ctrlKey: true, shiftKey: true })).toBe("copy-format");
    expect(shortcut({ key: "v", ctrlKey: true, shiftKey: true })).toBe("apply-format");
    // Without Shift the clipboard still wins.
    expect(shortcut({ key: "c", ctrlKey: true })).toBe("copy-element");
    expect(shortcut({ key: "v", ctrlKey: true })).toBe("paste-element");
  });

  it("does not intercept editable controls", () => {
    expect(shortcut({ key: "z", ctrlKey: true, targetTagName: "textarea" })).toBeNull();
    expect(shortcut({ key: "Delete", targetTagName: "input" })).toBeNull();
    expect(shortcut({ key: "d", ctrlKey: true, targetIsContentEditable: true })).toBeNull();
  });
});
