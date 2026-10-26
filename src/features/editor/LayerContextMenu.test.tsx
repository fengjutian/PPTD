import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type ElementId, type ShapeElement, type Slide } from "../../core/document-model";
import { LayerContextMenu } from "./LayerContextMenu";

const noop = () => undefined;

function shape(id: string, locked = false): ShapeElement {
  return {
    id: id as ElementId,
    type: "shape",
    shape: "rectangle",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked,
    style: { fill: "#ffffff", stroke: "#000000", strokeWidthPt: 0, radiusPt: 0 },
  };
}

function slideWith(elements: ShapeElement[]): Slide {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.elements = elements;
  return slide;
}

function renderMenu(slide: Slide, elementId: string, selectedElementIds: string[]): string {
  return renderToStaticMarkup(
    <LayerContextMenu
      slide={slide}
      elementId={elementId as ElementId}
      selectedElementIds={selectedElementIds as ElementId[]}
      x={40}
      y={60}
      onClose={noop}
      onCommand={noop}
    />,
  );
}

/** The opening tag of the menu entry whose label is `label`. */
function itemTag(markup: string, label: string): string {
  const index = markup.indexOf(`<span>${label}</span>`);
  if (index < 0) throw new Error(`missing menu item: ${label}`);
  const start = markup.lastIndexOf("<button", index);
  const end = markup.indexOf(">", start);
  return markup.slice(start, end + 1);
}

function isDisabled(markup: string, label: string): boolean {
  return itemTag(markup, label).includes("disabled");
}

describe("layer context menu", () => {
  it("offers every layer action", () => {
    const slide = slideWith([shape("a"), shape("b")]);
    const markup = renderMenu(slide, "b", ["a", "b"]);
    for (const label of ["置于顶层", "上移一层", "下移一层", "置于底层", "复制", "锁定", "组合", "取消组合", "删除"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('role="menu"');
    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain('role="separator"');
  });

  it("disables the moves that would leave the page, based on the row position", () => {
    const slide = slideWith([shape("a"), shape("b")]);
    // b is the topmost row: it cannot go further up, but it can go down.
    const top = renderMenu(slide, "b", ["b"]);
    expect(isDisabled(top, "置于顶层")).toBe(true);
    expect(isDisabled(top, "上移一层")).toBe(true);
    expect(isDisabled(top, "下移一层")).toBe(false);
    expect(isDisabled(top, "置于底层")).toBe(false);
    // a is the bottom row: the mirror image.
    const bottom = renderMenu(slide, "a", ["a"]);
    expect(isDisabled(bottom, "置于底层")).toBe(true);
    expect(isDisabled(bottom, "下移一层")).toBe(true);
    expect(isDisabled(bottom, "上移一层")).toBe(false);
  });

  it("disables edit actions for a locked block and shows 解锁", () => {
    const slide = slideWith([shape("a", true), shape("b", true)]);
    const markup = renderMenu(slide, "b", ["a", "b"]);
    expect(markup).toContain("解锁");
    expect(isDisabled(markup, "复制")).toBe(true);
    expect(isDisabled(markup, "删除")).toBe(true);
    expect(isDisabled(markup, "解锁")).toBe(false);
    expect(isDisabled(markup, "置于顶层")).toBe(true);
  });

  it("offers 取消组合 only for an exactly selected group", () => {
    const slide = slideWith([shape("a"), shape("b")]);
    const plain = renderMenu(slide, "a", ["a", "b"]);
    expect(isDisabled(plain, "组合")).toBe(false);
    expect(isDisabled(plain, "取消组合")).toBe(true);

    slide.groups = [{ id: "group-1", elementIds: ["a" as ElementId, "b" as ElementId] }];
    const grouped = renderMenu(slide, "a", ["a", "b"]);
    expect(isDisabled(grouped, "组合")).toBe(true);
    expect(isDisabled(grouped, "取消组合")).toBe(false);
  });
});
