import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type ElementId, type SlideElement } from "../../core/document-model";
import { InspectorPanel, InspectorPanelView } from "./InspectorPanel";

function renderView(element: SlideElement, slideId = "slide-1" as never): string {
  return renderToStaticMarkup(
    <InspectorPanelView element={element} slideId={slideId} elementIndex={0} elementCount={2} onCommand={() => undefined} />,
  );
}

function textElement(): SlideElement {
  return createDocument().slides[0]!.elements[0]!;
}

function shapeElement(shape: "rectangle" | "ellipse"): SlideElement {
  return {
    id: "11111111-1111-4111-8111-111111111111" as ElementId,
    type: "shape",
    shape,
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    style: { fill: "#d35230", stroke: "#7f2f1d", strokeWidthPt: 1.5, radiusPt: 12 },
  };
}

function imageElement(): SlideElement {
  return {
    id: "33333333-3333-4333-8333-333333333333" as ElementId,
    type: "image",
    frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
    rotationMilliDegree: 0,
    locked: false,
    source: { kind: "embedded", dataUrl: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
    altText: "架构示意图",
  };
}

describe("inspector panel", () => {
  it("shows the empty state when nothing is selected", () => {
    expect(renderToStaticMarkup(<InspectorPanel />)).toContain("选择画布中的对象");
  });

  it("labels the alignment buttons with their real meaning instead of a truncated first character", () => {
    const markup = renderView(textElement());
    for (const label of ["左对齐", "水平居中", "右对齐", "顶对齐", "垂直居中", "底对齐"]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    // The old panel truncated every label to its first character, which rendered
    // "水平居中" as a button reading "水" and "垂直居中" as "垂".
    expect(markup).not.toContain(">水</button>");
    expect(markup).not.toContain(">垂</button>");
  });

  it("exposes text styling that the exporter writes into the PPTX", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("文字外观");
    expect(markup).toContain("字号");
    expect(markup).toContain("颜色");
    expect(markup).toContain("加粗");
    expect(markup).toContain('value="28.0"');
    expect(markup).toContain('value="#17181c"');
  });

  it("exposes shape styling including fill, stroke and corner radius", () => {
    const markup = renderView(shapeElement("rectangle"));
    expect(markup).toContain("形状外观");
    expect(markup).toContain("填充");
    expect(markup).toContain("描边");
    expect(markup).toContain("圆角");
    expect(markup).toContain("#d35230");
  });

  it("hides the corner radius of an ellipse that cannot use it", () => {
    const markup = renderView(shapeElement("ellipse"));
    expect(markup).toContain("形状外观");
    expect(markup).not.toContain("圆角");
  });

  it("exposes the image alternative text that the exporter writes into the PPTX", () => {
    const markup = renderView(imageElement());
    expect(markup).toContain("替代文本");
    expect(markup).toContain("架构示意图");
  });

  it("keeps the geometry section and the layer actions", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("位置与尺寸");
    expect(markup).toContain("对齐（相对页面）");
    expect(markup).toContain("上移一层");
    expect(markup).toContain("下移一层");
    expect(markup).toContain("锁定");
  });

  it("disables every editing control for a locked element", () => {
    const element = { ...textElement(), locked: true };
    const markup = renderView(element);
    expect(markup).toContain("解锁");
    expect(markup).not.toContain(">锁定<");
  });
});
