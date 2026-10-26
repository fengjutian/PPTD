import { describe, expect, it } from "vitest";
import { layoutCapabilities } from "./template-layouts";

const region = (role: "title" | "body" | "image") => ({
  role,
  frame: { x: 0, y: 0, width: 0.2, height: 0.2 },
});

describe("layout capabilities", () => {
  it("reads a title and content layout", () => {
    expect(layoutCapabilities([region("title"), region("body")])).toEqual({
      hasTitle: true,
      hasBody: true,
      hasImage: false,
      columns: 1,
      free: false,
    });
  });

  it("counts two body placeholders as two columns", () => {
    expect(layoutCapabilities([region("title"), region("body"), region("body")]).columns).toBe(2);
  });

  it("calls a layout without a body placeholder free", () => {
    // A cover or a section divider: it may ignore the grid, so the fit check
    // never measures it.
    expect(layoutCapabilities([region("title")])).toMatchObject({ free: true, hasBody: false });
    expect(layoutCapabilities([])).toMatchObject({ free: true, hasTitle: false });
  });

  it("notices the picture placeholder that a content layout usually lacks", () => {
    expect(layoutCapabilities([region("title"), region("body"), region("image")]).hasImage).toBe(true);
  });
});
