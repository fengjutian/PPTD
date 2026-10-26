import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type ElementId, type SlideElement } from "../../core/document-model";
import { InspectorPanel, InspectorPanelView, InspectorTitleBar } from "./InspectorPanel";
import type { LengthUnit } from "./inspector-geometry";

interface ViewOptions {
  unit?: LengthUnit;
  aspectLocked?: boolean;
  elementIndex?: number;
  elementCount?: number;
  palette?: readonly string[];
  speakerNotes?: string;
}

function renderView(element: SlideElement, background = "#ffffff", options: ViewOptions = {}): string {
  return renderToStaticMarkup(
    <InspectorPanelView
      element={element}
      slideId={"slide-1" as never}
      elementIndex={options.elementIndex ?? 0}
      elementCount={options.elementCount ?? 2}
      background={background}
      pageSize={{ width: emu(12_192_000), height: emu(6_858_000) }}
      speakerNotes={options.speakerNotes ?? ""}
      unit={options.unit ?? "inch"}
      onUnitChange={() => undefined}
      aspectLocked={options.aspectLocked ?? false}
      onToggleAspectLock={() => undefined}
      palette={options.palette}
      onCommand={() => undefined}
    />,
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

/** Tells whether the button carrying the given label was rendered disabled. */
function buttonDisabled(markup: string, label: string): boolean {
  const index = markup.indexOf(label);
  if (index < 0) throw new Error(`button not found: ${label}`);
  const open = markup.lastIndexOf("<button", index);
  return markup.slice(open, index).includes("disabled");
}

describe("inspector hidden layer notice", () => {
  it("explains a hidden selection and offers to show it again", () => {
    const hidden = shapeElement("rectangle");
    hidden.hidden = true;
    const markup = renderView(hidden);
    expect(markup).toContain("图层已隐藏");
    expect(markup).toContain("显示图层");
    expect(renderView(shapeElement("rectangle"))).not.toContain("图层已隐藏");
  });
});

describe("inspector panel", () => {
  it("shows the empty state when nothing is selected", () => {
    expect(renderToStaticMarkup(<InspectorPanel />)).toContain("选择画布中的对象");
  });

  it("labels the alignment buttons with their real meaning instead of a truncated first character", () => {
    const markup = renderView(textElement());
    // The align matrix names every place an object can take on the page.
    for (const label of [
      "左上对齐",
      "顶端对齐",
      "右上对齐",
      "左对齐",
      "居中对齐",
      "右对齐",
      "左下对齐",
      "底端对齐",
      "右下对齐",
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    // The old panel truncated every label to its first character, which rendered
    // "水平居中" as a button reading "水" and "垂直居中" as "垂".
    expect(markup).not.toContain(">水</button>");
    expect(markup).not.toContain(">垂</button>");
  });

  it("offers the colors of the template next to every color field", () => {
    const markup = renderView(textElement(), "#ffffff", { palette: ["#2b579a", "#d35230"] });
    expect(markup).toContain('aria-label="使用颜色 #2b579a"');
    expect(markup).toContain('aria-label="使用颜色 #d35230"');
  });

  it("shows the speaker notes of the page and says where they go", () => {
    const markup = renderView(textElement(), "#ffffff", { speakerNotes: "这一页先讲背景" });
    expect(markup).toContain("演讲备注");
    expect(markup).toContain("这一页先讲背景");
    // 备注不显示在页面上，得说清楚它去哪了。
    expect(markup).toContain("不会显示在页面上");
  });

  it("folds the groups of properties away, because the panel is longer than the window", () => {
    const markup = renderView(textElement());
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("section-toggle");
  });

  it("lets a number be changed by dragging its label", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("按住左右拖动改值");
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

  it("offers the emphasis of a part of the text and shows what is already marked", () => {
    const markup = renderView(textElement());
    // Without a selection there is nothing to emphasise, so the control waits.
    expect(markup).toContain("加粗所选");
    expect(buttonDisabled(markup, "加粗所选")).toBe(true);
  });

  it("lists the emphasised fragments of the text", () => {
    const element = textElement();
    if (element.type !== "text") throw new Error("expected a text element");
    element.text = "覆盖机构：12万";
    element.runs = [{ start: 0, end: 4, bold: true }];
    const markup = renderView(element);
    expect(markup).toContain("已强调 1 处");
    expect(markup).toContain("覆盖机构");
    expect(buttonDisabled(markup, "清除全部强调")).toBe(false);
  });

  it("offers a link for a selected range and keeps links out of the emphasis list", () => {
    const element = textElement();
    if (element.type !== "text") throw new Error("expected a text element");
    element.text = "Open report now";
    element.runs = [{ start: 5, end: 11, hyperlinkUrl: "https://example.com/report" }];
    const markup = renderView(element);
    expect(markup).toContain("设置所选文字链接");
    expect(buttonDisabled(markup, "设置所选文字链接")).toBe(true);
    expect(buttonDisabled(markup, "清除所选文字链接")).toBe(true);
    // A link is not emphasis; the old list would have called this "已强调".
    expect(markup).not.toContain("已强调 1 处");
    expect(markup).toContain("已链接 1 处");
    expect(markup).toContain("report");
  });

  it("warns when the text does not fit and offers to fit it", () => {
    const element = textElement();
    if (element.type !== "text") throw new Error("expected a text element");
    element.text = "一段很长的标题需要放进同一个文本框里所以它必须换行很多次才能放下";
    const markup = renderView(element);
    expect(markup).toContain("文字超出文本框");
    expect(markup).toContain("适配文字");
  });

  it("keeps the geometry section and the layer actions", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("位置与尺寸");
    expect(markup).toContain("对齐（相对页面）");
    expect(markup).toContain("上移一层");
    expect(markup).toContain("下移一层");
    expect(markup).toContain("锁定");
  });

  it("gives the colour field a full row so the hex value stays readable", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("field field-wide");
  });

  it("shows the page size and the page background on every panel state", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("幻灯片尺寸");
    expect(markup).toContain("13.33 × 7.50 英寸");
    expect(markup).toContain("背景色");
    expect(markup).toContain("#ffffff");
  });

  it("warns when the text ink does not read on the page background", () => {
    // A light ink on a white page cannot reach the 4.5:1 threshold.
    const base = textElement();
    if (base.type !== "text") throw new Error("expected a text element");
    const element: SlideElement = { ...base, style: { ...base.style, color: "#f2f2f2", fontSizePt: 12, bold: false } };
    const markup = renderView(element, "#ffffff");
    expect(markup).toContain("文字对比度不足");
    expect(markup).toContain("换成可读颜色");
  });

  it("stays quiet when the text ink already reads on the page background", () => {
    const markup = renderView(textElement(), "#ffffff");
    expect(markup).not.toContain("文字对比度不足");
  });

  it("disables every editing control for a locked element", () => {
    const element = { ...textElement(), locked: true };
    const markup = renderView(element);
    expect(markup).toContain("解锁");
    expect(markup).not.toContain(">锁定<");
  });

  it("offers the whole layer order, not only the neighbouring steps", () => {
    const markup = renderView(textElement());
    expect(markup).toContain("置于顶层");
    expect(markup).toContain("置于底层");
  });

  it("keeps the layer order buttons in sync with the current position", () => {
    const bottom = renderView(textElement(), "#ffffff", { elementIndex: 0, elementCount: 3 });
    expect(buttonDisabled(bottom, "置于底层")).toBe(true);
    expect(buttonDisabled(bottom, "置于顶层")).toBe(false);
    const top = renderView(textElement(), "#ffffff", { elementIndex: 2, elementCount: 3 });
    expect(buttonDisabled(top, "置于顶层")).toBe(true);
    expect(buttonDisabled(top, "置于底层")).toBe(false);
  });

  it("puts steppers on the numeric fields so a value can be nudged without typing", () => {
    const markup = renderView(textElement());
    expect(markup).toContain('aria-label="宽度 增加 0.05"');
    expect(markup).toContain('aria-label="高度 减少 0.05"');
    expect(markup).toContain('aria-label="旋转 增加 15"');
  });

  it("switches the length fields to centimeters on request", () => {
    const markup = renderView(textElement(), "#ffffff", { unit: "cm" });
    expect(markup).toContain("厘米");
    expect(markup).toContain("33.87 × 19.05 厘米");
    expect(markup).toContain('aria-label="宽度 增加 0.1"');
  });

  it("marks the aspect ratio lock as pressed while it is on", () => {
    const unlocked = renderView(textElement());
    expect(unlocked).toContain('aria-pressed="false"');
    const locked = renderView(textElement(), "#ffffff", { aspectLocked: true });
    expect(locked).toContain('aria-pressed="true"');
  });

  it("shows a picture of the selected object next to the type chip", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const element = slide.elements[0]!;
    const markup = renderToStaticMarkup(<InspectorTitleBar element={element} slide={slide} />);
    // The picture is drawn with the same code the canvas uses, so the panel
    // shows the object instead of only naming it.
    expect(markup).toContain("element-preview");
    expect(markup).toContain("type-chip");
    expect(markup).toContain("文本");
    expect(markup).toContain("开始创造你的演示文稿");
  });

  it("keeps the title bar free of a picture when nothing is selected", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const markup = renderToStaticMarkup(<InspectorTitleBar element={undefined} slide={slide} />);
    expect(markup).not.toContain("element-preview");
    expect(markup).not.toContain("type-chip");
  });

  it("offers the icon set and marks the icon the element already uses", () => {
    const icon: SlideElement = {
      id: "44444444-4444-4444-8444-444444444444" as ElementId,
      type: "icon",
      name: "target",
      frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(100) },
      rotationMilliDegree: 0,
      locked: false,
      style: { color: "#2F6B5F", strokeWidth: 2 },
    };
    const markup = renderView(icon);
    expect(markup).toContain("图标");
    const target = markup.slice(markup.indexOf('aria-label="目标"'));
    expect(target.slice(0, 260)).toContain('aria-pressed="true"');
    const book = markup.slice(markup.indexOf('aria-label="书"'));
    expect(book.slice(0, 260)).toContain('aria-pressed="false"');
  });
});
