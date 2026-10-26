import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type ElementId, type Slide, type SlideElement } from "../../core/document-model";
import { LayerList } from "./LayerList";

const FRAME = { x: emu(0), y: emu(0), width: emu(100), height: emu(100) };

function slideWith(elements: SlideElement[]): Slide {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.elements = elements;
  return slide;
}

function renderList(slide: Slide, selectedElementIds: ElementId[] = []): string {
  return renderToStaticMarkup(
    <LayerList
      slide={slide}
      selectedElementIds={selectedElementIds}
      onSelect={() => undefined}
      onToggle={() => undefined}
      onSelectMany={() => undefined}
      onCommand={() => undefined}
    />,
  );
}

function textElement(id: string, text: string, locked = false): SlideElement {
  return {
    id: id as ElementId,
    type: "text",
    frame: FRAME,
    rotationMilliDegree: 0,
    locked,
    text,
    style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#17181c", bold: false, align: "left" },
  };
}

describe("layer list", () => {
  it("lists the topmost element first", () => {
    const slide = slideWith([textElement("a", "底层"), textElement("b", "顶层")]);
    const markup = renderList(slide);
    expect(markup.indexOf("顶层")).toBeLessThan(markup.indexOf("底层"));
  });

  it("marks the selected layer and shows a lock on locked layers", () => {
    const slide = slideWith([textElement("a", "普通"), textElement("b", "锁定", true)]);
    const markup = renderList(slide, ["a" as ElementId]);
    expect(markup).toContain("layer-row active");
    expect(markup).toContain("layer-lock");
  });

  it("tells the user when the page has no objects", () => {
    const markup = renderList(slideWith([]));
    expect(markup).toContain("当前页没有对象");
  });

  it("labels every element kind so the list stays readable", () => {
    const slide = slideWith([
      textElement("a", ""),
      {
        id: "b" as ElementId,
        type: "shape",
        shape: "ellipse",
        frame: FRAME,
        rotationMilliDegree: 0,
        locked: false,
        style: { fill: "#000000", stroke: "#000000", strokeWidthPt: 0, radiusPt: 0 },
      },
      {
        id: "c" as ElementId,
        type: "image",
        frame: FRAME,
        rotationMilliDegree: 0,
        locked: false,
        source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
        altText: "",
      },
      {
        id: "d" as ElementId,
        type: "table",
        contentBlockId: "e" as never,
        frame: FRAME,
        rotationMilliDegree: 0,
        locked: false,
        style: {
          fontFamily: "Microsoft YaHei",
          fontSizePt: 14,
          headerFill: "#3366CC",
          headerTextColor: "#FFFFFF",
          bodyTextColor: "#17181c",
          borderColor: "#E2E7EC",
          firstColumnBold: true,
        },
      },
    ]);
    const markup = renderList(slide);
    expect(markup).toContain("文本");
    expect(markup).toContain("椭圆");
    expect(markup).toContain("图片");
    expect(markup).toContain("表格");
  });

  it("counts the objects and the current selection", () => {
    const slide = slideWith([textElement("a", "一"), textElement("b", "二")]);
    expect(renderList(slide)).toContain("2 个对象");
    expect(renderList(slide, ["a" as ElementId])).toContain("已选 1 / 2");
  });

  it("shows a group badge and marks the other members when one is selected", () => {
    const slide = slideWith([textElement("a", "成员一"), textElement("b", "成员二")]);
    slide.groups = [{ id: "g", elementIds: ["a" as ElementId, "b" as ElementId] }];
    const markup = renderList(slide, ["a" as ElementId]);
    expect(markup).toContain("layer-badge-group");
    expect(markup).toContain("group-mate");
    expect(markup).toContain("与另外 1 个对象同组");
  });

  it("marks objects that carry an animation", () => {
    const slide = slideWith([textElement("a", "飞入")]);
    slide.animations = [
      {
        id: "animation-1",
        elementId: "a" as ElementId,
        effect: "fly-in",
        phase: "entrance",
        start: "on-click",
        durationMs: 500,
        delayMs: 0,
        direction: "left",
      },
    ];
    expect(renderList(slide)).toContain("有动画");
  });

  it("offers quick actions and disables delete on a locked layer", () => {
    const slide = slideWith([textElement("a", "可以删除"), textElement("b", "不能删除", true)]);
    const markup = renderList(slide, ["a" as ElementId]);
    expect(markup).toContain('aria-label="锁定"');
    expect(markup).toContain('aria-label="复制"');
    expect(markup).toContain('aria-label="删除"');
    expect(markup.match(/aria-label="删除"[^>]*disabled/g) ?? []).toHaveLength(1);
    expect(markup).toContain("layer-hint");
  });

  it("offers a search field and documents the layer keyboard shortcut", () => {
    const markup = renderList(slideWith([textElement("a", "标题")]));
    expect(markup).toContain('aria-label="搜索图层"');
    expect(markup).toContain("Alt+↑↓");
  });

  it("shows a custom layer name and marks a hidden row with a show action", () => {
    const slide = slideWith([textElement("a", "原名")]);
    slide.elements[0]!.name = "背景底图";
    slide.elements[0]!.hidden = true;
    const markup = renderList(slide);
    expect(markup).toContain("背景底图");
    expect(markup).toContain("is-hidden");
    expect(markup).toContain('aria-label="显示图层"');
    expect(markup).toContain("已隐藏");
    expect(renderList(slideWith([textElement("b", "可见")]))).toContain('aria-label="隐藏图层"');
  });
});
