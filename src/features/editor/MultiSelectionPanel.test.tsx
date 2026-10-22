import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emu, inches, type ElementId, type SlideId } from "../../core/document-model";
import { MultiSelectionPanel } from "./MultiSelectionPanel";

const SLIDE_ID = "slide-1" as SlideId;

function bounds(x: number, y: number, width: number, height: number) {
  return { x: emu(x), y: emu(y), width: emu(width), height: emu(height) };
}

describe("multi selection panel", () => {
  it("shows how many objects are selected and where the group sits", () => {
    const markup = renderToStaticMarkup(
      <MultiSelectionPanel
        slideId={SLIDE_ID}
        elementIds={["a" as ElementId, "b" as ElementId]}
        bounds={bounds(inches(1), inches(2), inches(4), inches(3))}
        unit="inch"
        onCommand={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(markup).toContain("已选 2 个");
    // 整组范围显示的是外接框，不是某一个对象的属性。
    expect(markup).toContain("整组范围");
    expect(markup).toContain("删除这 2 个对象");
  });

  it("keeps the distribute buttons disabled until three objects are selected", () => {
    const two = renderToStaticMarkup(
      <MultiSelectionPanel
        slideId={SLIDE_ID}
        elementIds={["a" as ElementId, "b" as ElementId]}
        bounds={bounds(inches(1), inches(2), inches(4), inches(3))}
        unit="inch"
        onCommand={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(two).toContain("disabled");

    const three = renderToStaticMarkup(
      <MultiSelectionPanel
        slideId={SLIDE_ID}
        elementIds={["a" as ElementId, "b" as ElementId, "c" as ElementId]}
        bounds={bounds(inches(1), inches(2), inches(4), inches(3))}
        unit="inch"
        onCommand={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(three).not.toContain("disabled");
  });

  it("says that alignment is relative to the group, not to the page", () => {
    const markup = renderToStaticMarkup(
      <MultiSelectionPanel
        slideId={SLIDE_ID}
        elementIds={["a" as ElementId, "b" as ElementId]}
        bounds={bounds(inches(1), inches(2), inches(4), inches(3))}
        unit="inch"
        onCommand={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(markup).toContain("相对这一组");
  });
});
