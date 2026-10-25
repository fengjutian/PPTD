import type {
  ElementId,
  Emu,
  RectEmu,
  ShapeFillGradient,
  ShapeShadowToken,
  SlideElement,
  TextAlign,
  TextContentRole,
} from "../../document-model";

interface TextOptions {
  contentRef?: TextContentRole;
  /** The slice of the bound field this element renders; see `TextElement`. */
  contentRange?: { start: number; end: number };
  lineHeight?: number;
  contentBlockRef?: { blockId: string; field: "label" | "value" };
}

/** A generated text box. Recipes only describe position, type and ink. */
export function textElement(
  text: string,
  frame: RectEmu,
  fontSizePt: number,
  color: string,
  bold: boolean,
  align: TextAlign,
  fontFamily: string,
  options: TextOptions = {},
): SlideElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "text",
    ...(options.contentRef ? { contentRef: options.contentRef } : {}),
    ...(options.contentRange ? { contentRange: { ...options.contentRange } } : {}),
    ...(options.contentBlockRef ? { contentBlockRef: options.contentBlockRef } : {}),
    frame,
    rotationMilliDegree: 0,
    locked: false,
    origin: "generated",
    text,
    style: {
      fontFamily,
      fontSizePt,
      color,
      bold,
      align,
      ...(options.lineHeight === undefined ? {} : { lineHeight: options.lineHeight }),
    },
  };
}

/** A generated filled rectangle. Rules and bars are rectangles, not pictures. */
export function rectElement(
  frame: RectEmu,
  fill: string,
  fillGradient?: ShapeFillGradient,
  options: { shadow?: ShapeShadowToken } = {},
): SlideElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "shape",
    frame,
    rotationMilliDegree: 0,
    locked: false,
    origin: "generated",
    shape: "rectangle",
    style: {
      fill,
      stroke: fill,
      strokeWidthPt: 0,
      radiusPt: 0,
      ...(fillGradient ? { fillGradient } : {}),
      ...(options.shadow ? { shadow: options.shadow } : {}),
    },
  };
}

/** A generated filled ellipse, used for step nodes and the comparison mark. */
export function ellipseElement(frame: RectEmu, fill: string): SlideElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "shape",
    frame,
    rotationMilliDegree: 0,
    locked: false,
    origin: "generated",
    shape: "ellipse",
    style: { fill, stroke: fill, strokeWidthPt: 0, radiusPt: 999 },
  };
}

/** A vertical rule in page-relative units. */
export function verticalRule(
  x: number,
  y: number,
  height: number,
  width: number,
  page: { width: Emu; height: Emu },
  fill: string,
): SlideElement {
  return rectElement(
    {
      x: Math.round(x * page.width) as Emu,
      y: Math.round(y * page.height) as Emu,
      width: Math.max(1, Math.round(width * page.width)) as Emu,
      height: Math.max(1, Math.round(height * page.height)) as Emu,
    },
    fill,
  );
}
