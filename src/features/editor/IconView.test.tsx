import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emu, type ElementId, type IconElement } from "../../core/document-model";
import { IconView } from "./IconView";

function iconElement(): IconElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "icon",
    name: "target",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    style: { color: "#2F6B5F", strokeWidth: 2 },
  };
}

describe("icon view", () => {
  it("draws the paths of the named icon with the element colour", () => {
    const markup = renderToStaticMarkup(<IconView element={iconElement()} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain('stroke="#2F6B5F"');
    expect((markup.match(/<circle/g) ?? []).length).toBe(2);
    expect((markup.match(/<path/g) ?? []).length).toBe(1);
  });

  it("keeps the icon inside the frame of its element", () => {
    const markup = renderToStaticMarkup(<IconView element={iconElement()} />);
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain("width:100%");
    expect(markup).toContain("height:100%");
  });
});
