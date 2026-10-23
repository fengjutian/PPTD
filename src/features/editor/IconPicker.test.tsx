import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_ICONS } from "../../core/document-model";
import { IconPicker } from "./IconPicker";
import { ICON_LABELS } from "./icon-options";

describe("icon picker", () => {
  it("offers every built-in icon once", () => {
    const markup = renderToStaticMarkup(<IconPicker onClose={() => undefined} onPick={() => undefined} />);
    const names = Object.keys(BUILTIN_ICONS);
    expect((markup.match(/aria-label="/g) ?? []).length).toBe(names.length + 1);
    for (const name of names) {
      expect(markup).toContain(`aria-label="${ICON_LABELS[name as keyof typeof ICON_LABELS]}"`);
    }
  });

  it("draws an svg for each icon instead of a text placeholder", () => {
    const markup = renderToStaticMarkup(<IconPicker onClose={() => undefined} onPick={() => undefined} />);
    expect((markup.match(/<svg/g) ?? []).length).toBe(Object.keys(BUILTIN_ICONS).length);
  });
});
