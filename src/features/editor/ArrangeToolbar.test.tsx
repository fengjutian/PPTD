import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCommand } from "../../core/commands";
import { createDocument, type SlideElement, type SlideId } from "../../core/document-model";
import { ArrangeToolbar } from "./ArrangeToolbar";

const SLIDE_ID = "slide-1" as SlideId;

function elements(count: number, locked = false): SlideElement[] {
  const document = createDocument();
  const slide = document.slides[0]!;
  while (slide.elements.length < count) applyCommand(document, { type: "add-text", slideId: slide.id });
  return slide.elements.slice(0, count).map((element) => ({ ...element, locked }));
}

function tag(markup: string, label: string): string {
  return markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
}

describe("arrange toolbar", () => {
  it("disables everything without a selection", () => {
    const markup = renderToStaticMarkup(<ArrangeToolbar slideId={SLIDE_ID} selected={[]} execute={() => undefined} />);
    expect(tag(markup, "左对齐（相对页面）")).toContain("disabled");
    expect(tag(markup, "水平等距分布")).toContain("disabled");
    expect(tag(markup, "顺时针旋转 90 度")).toContain("disabled");
    expect(tag(markup, "锁定所选对象")).toContain("disabled");
  });

  it("aligns a multi selection relative to itself and waits for a third object to distribute", () => {
    const markup = renderToStaticMarkup(
      <ArrangeToolbar slideId={SLIDE_ID} selected={elements(2)} execute={() => undefined} />,
    );
    expect(tag(markup, "左对齐（相对所选对象）")).not.toContain("disabled");
    expect(tag(markup, "水平等距分布")).toContain("disabled");
    expect(tag(markup, "顺时针旋转 90 度")).toContain("disabled");

    const three = renderToStaticMarkup(
      <ArrangeToolbar slideId={SLIDE_ID} selected={elements(3)} execute={() => undefined} />,
    );
    expect(tag(three, "水平等距分布")).not.toContain("disabled");
  });

  it("offers one-object rotation and unlock for a locked selection", () => {
    const markup = renderToStaticMarkup(
      <ArrangeToolbar slideId={SLIDE_ID} selected={elements(1, true)} execute={() => undefined} />,
    );
    expect(tag(markup, "顺时针旋转 90 度")).toContain("disabled");
    expect(tag(markup, "左对齐（相对页面）")).toContain("disabled");
    expect(tag(markup, "解锁所选对象")).not.toContain("disabled");
  });

  it("does not align one editable object against itself", () => {
    const [editable, locked] = elements(2);
    const markup = renderToStaticMarkup(
      <ArrangeToolbar
        slideId={SLIDE_ID}
        selected={[
          { ...editable!, locked: false },
          { ...locked!, locked: true },
        ]}
        execute={() => undefined}
      />,
    );
    expect(tag(markup, "左对齐（相对所选对象）")).toContain("disabled");
    expect(tag(markup, "锁定所选对象")).not.toContain("disabled");
  });

  it("groups a free selection and offers ungroup for a grouped one", () => {
    const free = elements(2);
    const freeMarkup = renderToStaticMarkup(
      <ArrangeToolbar slideId={SLIDE_ID} selected={free} execute={() => undefined} />,
    );
    expect(tag(freeMarkup, "组合所选对象")).not.toContain("disabled");
    expect(tag(freeMarkup, "取消组合")).toContain("disabled");

    const grouped = elements(2);
    const groupedMarkup = renderToStaticMarkup(
      <ArrangeToolbar
        slideId={SLIDE_ID}
        selected={grouped}
        groups={[{ id: "group-1", elementIds: grouped.map((element) => element.id) }]}
        execute={() => undefined}
      />,
    );
    expect(tag(groupedMarkup, "组合所选对象")).toContain("disabled");
    expect(tag(groupedMarkup, "取消组合")).not.toContain("disabled");
  });

  it("needs at least two objects to group", () => {
    const markup = renderToStaticMarkup(
      <ArrangeToolbar slideId={SLIDE_ID} selected={elements(1)} execute={() => undefined} />,
    );
    expect(tag(markup, "组合所选对象")).toContain("disabled");
  });
});
