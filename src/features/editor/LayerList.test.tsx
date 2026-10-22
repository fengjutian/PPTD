import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type ElementId, type SlideElement } from "../../core/document-model";
import { LayerList } from "./LayerList";

const FRAME = { x: emu(0), y: emu(0), width: emu(100), height: emu(100) };

function slideWith(elements: SlideElement[]) {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.elements = elements;
  return slide;
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
    const markup = renderToStaticMarkup(
      <LayerList slide={slide} selectedElementIds={[]} onSelect={() => undefined} onToggle={() => undefined} />,
    );
    expect(markup.indexOf("顶层")).toBeLessThan(markup.indexOf("底层"));
  });

  it("marks the selected layer and shows a lock on locked layers", () => {
    const slide = slideWith([textElement("a", "普通"), textElement("b", "锁定", true)]);
    const markup = renderToStaticMarkup(
      <LayerList
        slide={slide}
        selectedElementIds={["a" as ElementId]}
        onSelect={() => undefined}
        onToggle={() => undefined}
      />,
    );
    expect(markup).toContain("layer-row active");
    expect(markup).toContain("layer-lock");
  });

  it("tells the user when the page has no objects", () => {
    const markup = renderToStaticMarkup(
      <LayerList slide={slideWith([])} selectedElementIds={[]} onSelect={() => undefined} onToggle={() => undefined} />,
    );
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
    const markup = renderToStaticMarkup(
      <LayerList slide={slide} selectedElementIds={[]} onSelect={() => undefined} onToggle={() => undefined} />,
    );
    expect(markup).toContain("文本");
    expect(markup).toContain("椭圆");
    expect(markup).toContain("图片");
    expect(markup).toContain("表格");
  });
});
