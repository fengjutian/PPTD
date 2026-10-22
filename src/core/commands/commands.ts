import type { ChartElementStyle, ChartKind, ContentBlock, DocumentTheme, ElementId, Emu, ImageCrop, PresentationDocument, RectEmu, ShapeElementStyle, Slide, SlideElement, SlideId, SlideLayoutSpec, SupportedImageMimeType, TableElementStyle, TextElementStyle, TextRun } from "../document-model";
import { createDocument, createSlide, inches, parseMetricValue, applyTextRun, subtractTextRange, type TextRunStyle } from "../document-model";
import { colorLuminance, fillForInk, isLargeText, readableTextColor, readableTextColorOnRange, type BackgroundRange } from "../rendering/contrast";
import { estimateTextLines } from "../rendering/text-fit";
import {
  planTemplateLayouts,
  templateColumnRegions,
  templateContentRegion,
  templateTitleRegion,
  type AiNormalizedRect,
  type AiSlideDesign,
  type AiTemplateDecoration,
  type AiTemplateLayout,
  type BackgroundRhythm,
  type TemplateLayoutIntent,
} from "./template-layouts";
import { classifyRelayoutElements, inferRelayoutContext } from "./slide-relayout";

export type {
  AiElementRepair,
  AiLayoutKind,
  AiNormalizedRect,
  AiSlideDesign,
  AiTemplateDecoration,
  AiTemplateLayout,
  AiTemplateRegion,
  BackgroundRhythm,
  TemplateLayoutIntent,
} from "./template-layouts";

export type ChangeDomain = "content" | "design" | "both";
export type AiContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "metric"; label: string; value: string }
  | { type: "timeline"; items: Array<{ label: string; text: string }> }
  | { type: "comparison"; leftLabel: string; rightLabel: string; leftItems: string[]; rightItems: string[] }
  | { type: "process"; items: Array<{ label: string; text: string }> }
  | { type: "table-data"; header: string[]; rows: string[][] };
export interface AiSlideDraft { title: string; body: string; speakerNotes: string; blocks?: AiContentBlock[]; plan?: { visualIntent: "hero" | "quote" | "timeline" | "comparison" | "process" | "data-chart" | "image-story" | "summary" | "structured-text" } }

/**
 * The theme of the source template. It is design state: it describes the
 * typography and the palette of the deck, never the reviewed copy.
 */
export interface AiTemplateTheme {
  name?: string;
  majorFont?: string;
  minorFont?: string;
  colors?: Array<{ name: string; value: string }>;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function readTemplateTheme(theme: AiTemplateTheme | undefined): DocumentTheme | undefined {
  if (!theme) return undefined;
  const majorFont = theme.majorFont?.trim();
  const minorFont = theme.minorFont?.trim();
  const colors = (theme.colors ?? [])
    .filter((color) => typeof color.name === "string" && color.name.trim() && HEX_COLOR_PATTERN.test(color.value))
    .map((color) => ({ name: color.name.trim(), value: color.value.toUpperCase() }));
  if (!majorFont && !minorFont && colors.length === 0) return undefined;
  return {
    name: theme.name?.trim() || "模板主题",
    majorFont: majorFont || minorFont || "Calibri",
    minorFont: minorFont || majorFont || "Calibri",
    colors,
  };
}

function toContentBlocks(blocks: AiContentBlock[] | undefined): ContentBlock[] | undefined {
  if (!blocks) return undefined;
  return blocks.map((block): ContentBlock => {
    const id = crypto.randomUUID();
    if (block.type === "paragraph") return { id, type: "paragraph", text: block.text };
    if (block.type === "bullet-list") return { id, type: "bullet-list", items: [...block.items] };
    if (block.type === "quote") return { id, type: "quote", text: block.text, attribution: block.attribution };
    if (block.type === "metric") return { id, type: "metric", label: block.label, value: block.value };
    if (block.type === "timeline") return { id, type: "timeline", items: block.items.map((item) => ({ ...item })) };
    if (block.type === "comparison") return { id, type: "comparison", leftLabel: block.leftLabel, rightLabel: block.rightLabel, leftItems: [...block.leftItems], rightItems: [...block.rightItems] };
    if (block.type === "table-data") return { id, type: "table-data", header: [...block.header], rows: block.rows.map((row) => [...row]) };
    return { id, type: "process", items: block.items.map((item) => ({ ...item })) };
  });
}

/**
 * Deep copy of the content blocks of a page, safe to read from an Immer draft.
 * The block IDs are kept: the elements of the copy point at the same blocks, so
 * a copied chart or table still shows the cells of the copied page.
 */
function cloneContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "bullet-list") return { ...block, items: [...block.items] };
    if (block.type === "timeline" || block.type === "process") return { ...block, items: block.items.map((item) => ({ ...item })) };
    if (block.type === "comparison") return { ...block, leftItems: [...block.leftItems], rightItems: [...block.rightItems] };
    if (block.type === "table-data") return { ...block, header: [...block.header], rows: block.rows.map((row) => [...row]) };
    return { ...block };
  });
}

/** Plain deep copy of an element, safe to read from an Immer draft. */
function cloneElement(element: SlideElement): SlideElement {
  if (element.type === "text") return { ...element, frame: { ...element.frame }, style: { ...element.style }, ...(element.runs ? { runs: element.runs.map((run) => ({ ...run })) } : {}) };
  if (element.type === "shape") return { ...element, frame: { ...element.frame }, style: { ...element.style } };
  if (element.type === "chart") return { ...element, frame: { ...element.frame }, style: { ...element.style, seriesColors: [...element.style.seriesColors] }, contentBlockIds: [...element.contentBlockIds] };
  if (element.type === "table") return { ...element, frame: { ...element.frame }, style: { ...element.style } };
  return { ...element, frame: { ...element.frame }, source: { ...element.source } };
}

/** Strips document block IDs before handing reviewed content back to the renderer. */
function toAiBlocks(blocks: ContentBlock[] | undefined): AiContentBlock[] | undefined {
  if (!blocks) return undefined;
  return blocks.map((block): AiContentBlock => {
    if (block.type === "paragraph") return { type: "paragraph", text: block.text };
    if (block.type === "bullet-list") return { type: "bullet-list", items: [...block.items] };
    if (block.type === "quote") return { type: "quote", text: block.text, attribution: block.attribution };
    if (block.type === "metric") return { type: "metric", label: block.label, value: block.value };
    if (block.type === "timeline") return { type: "timeline", items: block.items.map((item) => ({ ...item })) };
    if (block.type === "comparison") return { type: "comparison", leftLabel: block.leftLabel, rightLabel: block.rightLabel, leftItems: [...block.leftItems], rightItems: [...block.rightItems] };
    if (block.type === "table-data") return { type: "table-data", header: [...block.header], rows: block.rows.map((row) => [...row]) };
    return { type: "process", items: block.items.map((item) => ({ ...item })) };
  });
}
export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "apply-ai-draft"; title: string; slides: AiSlideDraft[] }
  | { type: "apply-ai-designed-draft"; title: string; slides: AiSlideDraft[]; designs: AiSlideDesign[]; pageSize?: { width: Emu; height: Emu }; fontFamily?: string; bodyFontFamily?: string; templateDecorations?: AiTemplateDecoration[]; templateLayouts?: AiTemplateLayout[]; templateTheme?: AiTemplateTheme; backgroundRhythm?: BackgroundRhythm }
  | { type: "relayout-slide"; slideId: SlideId }
  | { type: "duplicate-slide"; slideId: SlideId }
  | { type: "delete-slide"; slideId: SlideId }
  | { type: "move-slide"; slideId: SlideId; toIndex: number }
  | { type: "set-slide"; slideId: SlideId }
  | { type: "set-slide-background"; slideId: SlideId; background: string }
  | { type: "add-text"; slideId: SlideId }
  | { type: "add-image"; slideId: SlideId; dataUrl: string; mimeType: SupportedImageMimeType; altText: string; naturalWidth?: number; naturalHeight?: number }
  | { type: "add-shape"; slideId: SlideId; shape: "rectangle" | "ellipse" }
  | { type: "duplicate-element"; slideId: SlideId; elementId: ElementId }
  | { type: "delete-element"; slideId: SlideId; elementId: ElementId }
  | { type: "set-element-lock"; slideId: SlideId; elementId: ElementId; locked: boolean }
  | { type: "reorder-element"; slideId: SlideId; elementId: ElementId; toIndex: number }
  | { type: "align-element"; slideId: SlideId; elementId: ElementId; align: "left" | "center" | "right" | "top" | "middle" | "bottom" }
  | { type: "transform-element"; slideId: SlideId; elementId: ElementId; frame: RectEmu; rotationMilliDegree: number }
  | { type: "move-element"; slideId: SlideId; elementId: ElementId; x: Emu; y: Emu }
  | { type: "set-text-style"; slideId: SlideId; elementId: ElementId; style: Partial<TextElementStyle> }
  | { type: "set-text-emphasis"; slideId: SlideId; elementId: ElementId; start: number; end: number; style: TextRunStyle }
  | { type: "clear-text-emphasis"; slideId: SlideId; elementId: ElementId; start: number; end: number }
  | { type: "set-shape-style"; slideId: SlideId; elementId: ElementId; style: Partial<ShapeElementStyle> }
  | { type: "set-chart-style"; slideId: SlideId; elementId: ElementId; style: Partial<ChartElementStyle> }
  | { type: "set-chart-kind"; slideId: SlideId; elementId: ElementId; kind: ChartKind }
  | { type: "set-table-style"; slideId: SlideId; elementId: ElementId; style: Partial<TableElementStyle> }
  | { type: "set-image-alt-text"; slideId: SlideId; elementId: ElementId; altText: string }
  | { type: "set-image-crop"; slideId: SlideId; elementId: ElementId; crop: ImageCrop | null }
  | { type: "edit-text"; slideId: SlideId; elementId: ElementId; text: string };

/** Text styling is presentation-only, so every guard here rejects values the exporter or the schema could not round-trip. */
function assertTextStyle(style: Partial<TextElementStyle>): void {
  const fontFamily = style.fontFamily;
  if (fontFamily !== undefined && (typeof fontFamily !== "string" || !fontFamily.trim() || fontFamily.length > 100)) throw new Error("INVALID_TEXT_STYLE");
  if (style.fontSizePt !== undefined && (!Number.isFinite(style.fontSizePt) || style.fontSizePt < 4 || style.fontSizePt > 400)) throw new Error("INVALID_TEXT_STYLE");
  if (style.color !== undefined && !HEX_COLOR_PATTERN.test(style.color)) throw new Error("INVALID_TEXT_STYLE");
  if (style.bold !== undefined && typeof style.bold !== "boolean") throw new Error("INVALID_TEXT_STYLE");
  if (style.align !== undefined && style.align !== "left" && style.align !== "center" && style.align !== "right") throw new Error("INVALID_TEXT_STYLE");
}

/** The style of a run is presentation-only, so it is guarded like the others. */
function assertTextRunStyle(style: TextRunStyle): void {
  if (style.bold !== undefined && typeof style.bold !== "boolean") throw new Error("INVALID_TEXT_EMPHASIS");
  if (style.underline !== undefined && typeof style.underline !== "boolean") throw new Error("INVALID_TEXT_EMPHASIS");
  if (style.color !== undefined && !HEX_COLOR_PATTERN.test(style.color)) throw new Error("INVALID_TEXT_EMPHASIS");
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * A run addresses a range of the text of the element, so the range has to stay
 * inside the text and may not cut a surrogate pair in half: a fragment that
 * starts in the middle of a character would export as a broken glyph.
 */
function assertTextRange(text: string, start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) throw new Error("INVALID_TEXT_EMPHASIS");
  if (start > 0 && isHighSurrogate(text.charCodeAt(start - 1)) && isLowSurrogate(text.charCodeAt(start))) throw new Error("INVALID_TEXT_EMPHASIS");
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) throw new Error("INVALID_TEXT_EMPHASIS");
}

function assertShapeStyle(style: Partial<ShapeElementStyle>): void {
  if (style.fill !== undefined && !HEX_COLOR_PATTERN.test(style.fill)) throw new Error("INVALID_SHAPE_STYLE");
  if (style.stroke !== undefined && !HEX_COLOR_PATTERN.test(style.stroke)) throw new Error("INVALID_SHAPE_STYLE");
  if (style.strokeWidthPt !== undefined && (!Number.isFinite(style.strokeWidthPt) || style.strokeWidthPt < 0 || style.strokeWidthPt > 100)) throw new Error("INVALID_SHAPE_STYLE");
  if (style.radiusPt !== undefined && (!Number.isFinite(style.radiusPt) || style.radiusPt < 0 || style.radiusPt > 1000)) throw new Error("INVALID_SHAPE_STYLE");
}

/** The style of a chart is presentation-only, so it is guarded like the others. */
function assertChartStyle(style: Partial<ChartElementStyle>): void {
  if (style.fontFamily !== undefined && (typeof style.fontFamily !== "string" || !style.fontFamily.trim() || style.fontFamily.length > 100)) throw new Error("INVALID_CHART_STYLE");
  if (style.fontSizePt !== undefined && (!Number.isFinite(style.fontSizePt) || style.fontSizePt < 4 || style.fontSizePt > 400)) throw new Error("INVALID_CHART_STYLE");
  if (style.textColor !== undefined && !HEX_COLOR_PATTERN.test(style.textColor)) throw new Error("INVALID_CHART_STYLE");
  if (style.seriesColors !== undefined) {
    if (!Array.isArray(style.seriesColors) || style.seriesColors.length < 1 || style.seriesColors.length > 12) throw new Error("INVALID_CHART_STYLE");
    if (style.seriesColors.some((value) => !HEX_COLOR_PATTERN.test(value))) throw new Error("INVALID_CHART_STYLE");
  }
  if (style.showLegend !== undefined && typeof style.showLegend !== "boolean") throw new Error("INVALID_CHART_STYLE");
  if (style.showValueLabels !== undefined && typeof style.showValueLabels !== "boolean") throw new Error("INVALID_CHART_STYLE");
}

/**
 * The style of a table is presentation-only, so it is guarded like the others.
 */
function assertTableStyle(style: Partial<TableElementStyle>): void {
  if (style.fontFamily !== undefined && (typeof style.fontFamily !== "string" || !style.fontFamily.trim() || style.fontFamily.length > 100)) throw new Error("INVALID_TABLE_STYLE");
  if (style.fontSizePt !== undefined && (!Number.isFinite(style.fontSizePt) || style.fontSizePt < 4 || style.fontSizePt > 400)) throw new Error("INVALID_TABLE_STYLE");
  if (style.headerFill !== undefined && !HEX_COLOR_PATTERN.test(style.headerFill)) throw new Error("INVALID_TABLE_STYLE");
  if (style.headerTextColor !== undefined && !HEX_COLOR_PATTERN.test(style.headerTextColor)) throw new Error("INVALID_TABLE_STYLE");
  if (style.bodyTextColor !== undefined && !HEX_COLOR_PATTERN.test(style.bodyTextColor)) throw new Error("INVALID_TABLE_STYLE");
  if (style.borderColor !== undefined && !HEX_COLOR_PATTERN.test(style.borderColor)) throw new Error("INVALID_TABLE_STYLE");
  if (style.firstColumnBold !== undefined && typeof style.firstColumnBold !== "boolean") throw new Error("INVALID_TABLE_STYLE");
}

/**
 * A crop cuts a fraction off each side of the source image. The guard keeps the
 * visible region non empty, because a picture without a visible area cannot be
 * rendered by the canvas or written into a PPTX.
 */
function assertImageCrop(crop: ImageCrop): void {
  const sides = [crop.top, crop.bottom, crop.left, crop.right];
  if (sides.some((value) => !Number.isFinite(value) || value < 0 || value >= 1)) throw new Error("INVALID_IMAGE_CROP");
  if (crop.top + crop.bottom >= 1 || crop.left + crop.right >= 1) throw new Error("INVALID_IMAGE_CROP");
}

/** The box a new picture is placed in. */
const IMAGE_BOX = { x: 2, y: 1.7, width: 4, height: 3 } as const;

/**
 * A picture is placed in the box with the proportions of its own pixels, so it
 * is never squeezed into a shape it does not have.
 */
function imageFrame(naturalWidth?: number, naturalHeight?: number): RectEmu {
  const box = IMAGE_BOX;
  if (!naturalWidth || !naturalHeight || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { x: inches(box.x), y: inches(box.y), width: inches(box.width), height: inches(box.height) };
  }
  const aspect = naturalWidth / naturalHeight;
  const width = aspect >= box.width / box.height ? box.width : box.height * aspect;
  const height = aspect >= box.width / box.height ? box.width / aspect : box.height;
  return {
    x: inches(box.x + (box.width - width) / 2),
    y: inches(box.y + (box.height - height) / 2),
    width: inches(width),
    height: inches(height),
  };
}

export function commandDomain(command: DocumentCommand, document?: PresentationDocument): ChangeDomain | null {
  switch (command.type) {
    case "set-slide": return null;
    case "set-slide-background": return "design";
    case "set-text-style":
    case "set-text-emphasis":
    case "clear-text-emphasis":
    case "set-shape-style":
    case "set-chart-style":
    case "set-chart-kind":
    case "set-table-style":
    case "set-image-alt-text":
    case "set-image-crop": return "design";
    case "edit-text":
    case "delete-element": {
      if (!document) return command.type === "edit-text" ? "content" : "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const element = slide?.elements.find((item) => item.id === command.elementId);
      const legacyTitle = element?.type === "text" && !element.contentRef && slide?.elements[0]?.id === element.id;
      return element?.type === "text" && (element.contentRef === "title" || element.contentRef === "body" || legacyTitle) ? "content" : "design";
    }
    case "add-text": return "design";
    case "add-image": return "design";
    case "relayout-slide": return "design";
    case "add-slide": return "both";
    case "apply-ai-draft": return "both";
    case "apply-ai-designed-draft": return "both";
    case "duplicate-slide": return "both";
    case "delete-slide": return "both";
    case "move-slide": return "both";
    default: return "design";
  }
}

/**
 * Rebuilds only the generated composition of one slide.
 *
 * The reviewed content and its block IDs stay untouched. Generated elements are
 * replaced from the same content, while user images/text, locked objects and
 * anything the legacy classifier cannot prove is generated are carried over.
 */
function relayoutSlide(document: PresentationDocument, slide: Slide): void {
  const context = inferRelayoutContext(slide, document);
  const preserved = classifyRelayoutElements(slide).preserved.map((element) => {
    const copy = cloneElement(element);
    copy.origin = "user";
    return copy;
  });
  const blocks = toAiBlocks(slide.content.blocks);
  const draft: AiSlideDraft = {
    title: slide.content.title,
    body: slide.content.body,
    speakerNotes: slide.content.speakerNotes,
    ...(blocks ? { blocks } : {}),
  };
  const temp = createDocument();
  temp.title = document.title;
  temp.pageSize = { ...document.pageSize };
  const relayoutCommand: DocumentCommand = {
    type: "apply-ai-designed-draft",
    title: document.title,
    slides: [draft],
    designs: [context.design],
    pageSize: { ...document.pageSize },
    templateLayouts: [context.templateLayout],
    backgroundRhythm: { coverVariants: 1, contentVariants: 1, repeatLimit: 1 },
    ...(context.fontFamily ? { fontFamily: context.fontFamily } : {}),
    ...(context.bodyFontFamily ? { bodyFontFamily: context.bodyFontFamily } : {}),
    ...(document.theme ? { templateTheme: document.theme } : {}),
  };
  applyCommand(temp, relayoutCommand);
  const generatedSlide = temp.slides[0];
  if (!generatedSlide) throw new Error("RELAYOUT_FAILED");

  slide.background = generatedSlide.background;
  slide.elements = [...generatedSlide.elements, ...preserved];
  const generatedLayout = temp.layouts?.[0];
  if (!generatedLayout) {
    delete slide.layoutId;
    return;
  }
  const existingLayout = document.layouts?.find((layout) => layout.name === generatedLayout.name && layout.backgroundColor === generatedLayout.backgroundColor);
  if (existingLayout) {
    slide.layoutId = existingLayout.id;
    return;
  }
  if (!document.layouts) document.layouts = [];
  const layoutCopy = structuredClone(generatedLayout);
  document.layouts.push(layoutCopy);
  slide.layoutId = layoutCopy.id;
}

export function applyCommand(document: PresentationDocument, command: DocumentCommand): void {
  if (command.type === "set-slide") return;
  if (command.type === "add-slide") {
    document.slides.push(createSlide(document.slides.length + 1));
    return;
  }
  if (command.type === "apply-ai-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20) throw new Error("AI_DRAFT_INVALID");
    document.title = command.title.trim();
    document.slides = command.slides.map((draft, index) => {
      const slide = createSlide(index + 1);
      const blocks = toContentBlocks(draft.blocks);
      slide.content = { title: draft.title, body: draft.body, ...(blocks ? { blocks } : {}), speakerNotes: draft.speakerNotes, status: "approved" };
      const title = slide.elements[0];
      if (title?.type === "text") {
        title.text = draft.title;
        title.origin = "generated";
      }
      if (draft.body.trim()) slide.elements.push({ id: crypto.randomUUID() as ElementId, type: "text", contentRef: "body", frame: { x: inches(0.9), y: inches(1.8), width: inches(10.8), height: inches(4.6) }, rotationMilliDegree: 0, locked: false, origin: "generated", text: draft.body, style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#262626", bold: false, align: "left" } });
      return slide;
    });
    return;
  }
  if (command.type === "apply-ai-designed-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20 || command.designs.length !== command.slides.length) throw new Error("AI_DESIGN_INVALID");
    if (command.pageSize) document.pageSize = command.pageSize;
    const templateTheme = readTemplateTheme(command.templateTheme);
    if (templateTheme) document.theme = templateTheme;
    else delete document.theme;
    // The design replaces every page, so the layouts of the previous template
    // must not survive as empty references.
    const layouts: SlideLayoutSpec[] = [];
    document.layouts = layouts;
    const layoutSpecs = new Map<number, SlideLayoutSpec>();
    const pageWidth = document.pageSize.width;
    const pageHeight = document.pageSize.height;
    const pageWidthIn = pageWidth / 914400;
    const pageHeightIn = pageHeight / 914400;
    const frame = (x: number, y: number, width: number, height: number): RectEmu => ({ x: Math.round(x * pageWidth) as Emu, y: Math.round(y * pageHeight) as Emu, width: Math.round(width * pageWidth) as Emu, height: Math.round(height * pageHeight) as Emu });
    // A slide is wider than it is tall, so a circle has to be sized in inches on
    // both axes. A square in normalized coordinates is an ellipse on screen.
    const circleFrame = (x: number, y: number, diameterInches: number): RectEmu => frame(x, y, diameterInches / pageWidthIn, diameterInches / pageHeightIn);
    const fittedFontSize = (value: string, box: RectEmu, preferredPt: number, minimumPt = 12): number => {
      const widthPt = box.width / 12_700;
      const heightPt = box.height / 12_700;
      // The same line estimator the quality gate uses decides whether a size
      // fits, so a page that passes generation cannot be reported as overflow.
      for (let size = preferredPt; size >= minimumPt; size -= 1) {
        if (estimateTextLines(value, widthPt, size) * size * 1.2 <= heightPt) return size;
      }
      return minimumPt;
    };
    // Every text element is checked against the background it actually sits on.
    // A design that asks for dark text on dark artwork is corrected instead of
    // being rendered as invisible copy.
    const ink = (luminance: number) => (luminance < 0.45 ? { strong: "#FFFFFF", soft: "#DCE3EA" } : { strong: "#171A1F", soft: "#3E4650" });
    const text = (value: string, box: RectEmu, fontSizePt: number, color: string, bold: boolean, align: "left" | "center" | "right", contentRef?: "title" | "body" | "decorative", background?: BackgroundRange | number) => {
      const fitted = fittedFontSize(value, box, fontSizePt);
      const range = typeof background === "number" ? { darkest: background, lightest: background } : background;
      const palette = ink(range ? range.darkest : 1);
      const large = isLargeText(fitted, bold);
      const fallback = bold ? palette.strong : palette.soft;
      const resolved = range ? readableTextColorOnRange(color, range, large, fallback) : readableTextColor(color, 1, large, fallback);
      return { id: crypto.randomUUID() as ElementId, type: "text" as const, contentRef, frame: box, rotationMilliDegree: 0, locked: false, text: value, style: { fontFamily: command.fontFamily || "Microsoft YaHei", fontSizePt: fitted, color: resolved, bold, align } };
    };
    const shape = (box: RectEmu, fill: string, kind: "rectangle" | "ellipse" = "rectangle", stroke = fill, strokeWidthPt = 0) => ({ id: crypto.randomUUID() as ElementId, type: "shape" as const, frame: box, rotationMilliDegree: 0, locked: false, shape: kind, style: { fill, stroke, strokeWidthPt, radiusPt: kind === "ellipse" ? 999 : 8 } });
    const points = (body: string) => body.split(/\n+|(?=(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*)/).map((value) => value.trim()).filter(Boolean);
    const cleanPoint = (value: string) => value.replace(/^(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*/, "");
    // The layout of every page is decided as a sequence: the deck should rotate
    // through a small set of template layouts instead of repeating one artwork.
    const layoutIntents: TemplateLayoutIntent[] = command.slides.map((content, index) => {
      const design = command.designs[index]!;
      const blocks = content.blocks ?? [];
      const hasBlock = (type: AiContentBlock["type"]) => blocks.some((block) => block.type === type);
      const blockItems = blocks
        .filter((block): block is Extract<AiContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
        .flatMap((block) => block.items);
      const items = blockItems.length > 0 ? blockItems : points(content.body);
      const shortItems = items.every((item) => cleanPoint(item).length <= 48);
      // The template intent must match the composition the renderer will actually
      // produce. A short split page becomes an editorial count/quote page, and a
      // six-point split page becomes a card grid; selecting split artwork for
      // those pages leaves the new composition on top of two-column geometry.
      if (design.layout === "split" && !hasBlock("comparison") && shortItems) {
        if (items.length >= 3 && items.length <= 5) return hasBlock("quote") ? "quote" : "body";
        if (items.length === 6) return "cards";
      }
      if (design.layout === "cover") return "cover";
      if (design.layout === "section") return "section";
      if (design.layout === "quote" || hasBlock("quote")) return "quote";
      if (design.layout === "split" || hasBlock("comparison")) return "split";
      if (design.layout === "cards" || hasBlock("timeline") || hasBlock("process") || hasBlock("metric")) return "cards";
      return "body";
    });
    const chosenLayouts = planTemplateLayouts({ layouts: command.templateLayouts ?? [], intents: layoutIntents, rhythm: command.backgroundRhythm });
    document.title = command.title.trim();
    document.slides = command.slides.map((content, index) => {
      const design = command.designs[index]!;
      const slide = createSlide(index + 1);
      slide.background = design.background;
      const contentBlocks = toContentBlocks(content.blocks);
      slide.content = { title: content.title, body: content.body, ...(contentBlocks ? { blocks: contentBlocks } : {}), speakerNotes: content.speakerNotes, status: "approved" };
      const blocks = content.blocks ?? [];
      const bulletItems = blocks
        .filter((block): block is Extract<AiContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
        .flatMap((block) => block.items);
      // The structured block is the fact source. Body copy is only a fallback
      // for legacy or hand-authored drafts that do not carry blocks.
      const items = bulletItems.length > 0 ? bulletItems : points(content.body);
      const timelineBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "timeline" }> => block.type === "timeline");
      const comparisonBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "comparison" }> => block.type === "comparison");
      const processBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "process" }> => block.type === "process");
      const quoteBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "quote" }> => block.type === "quote");
      const metricBlocks = blocks.filter((block): block is Extract<AiContentBlock, { type: "metric" }> => block.type === "metric");
      // A table block is rendered as a native table: the exporter writes real
      // table cells, so the reviewer keeps an editable grid instead of a picture.
      const tableBlock = blocks.find((block): block is Extract<AiContentBlock, { type: "table-data" }> => block.type === "table-data");
      // A quoted line already present in the reviewed copy can carry the page
      // as a pull quote. It is a visual emphasis of existing content, never a
      // new claim, and gives dense list pages an editorial anchor.
      const quotedBlock = quoteBlock?.text.trim();
      const pullQuote = quotedBlock && quotedBlock.length >= 6 && quotedBlock.length <= 96
        ? quotedBlock
        : items
          .map(cleanPoint)
          .filter((item) => item.length >= 6 && item.length <= 48 && /[“”"'‘’「」『』]/.test(item))
          .sort((left, right) => right.length - left.length)[0];
      // A short summary or split page without a quotation still needs a visual
      // anchor. A count panel uses the real number of points, so it fills the
      // right side without inventing a headline or duplicating a bullet.
      const shortItems = items.every((item) => cleanPoint(item).length <= 48);
      const countPanel = !pullQuote
        && (design.layout === "summary" || design.layout === "split")
        && items.length >= 3
        && items.length <= 5
        && shortItems;
      const editorialSplit = design.layout === "split" && shortItems;
      const shortSplitAsCards = design.layout === "split" && items.length === 6 && shortItems;
      const hasDeterministicBlock = Boolean(timelineBlock || comparisonBlock || processBlock || metricBlocks.length > 0 || tableBlock);
      // The rendered artwork and the placeholder geometry describe the same
      // layout, so editable text has to land on the geometry of the layout that
      // was actually chosen. Dropping the geometry whenever a background image
      // existed is what pushed the text onto a hard coded grid and left the
      // template design unused.
      const recipe = chosenLayouts[index];
      // A page that was designed against a template layout keeps a reference to
      // it. The exporter turns that reference into a real slide master, so the
      // exported deck still carries the structure of the template instead of a
      // flat list of shapes.
      if (recipe) {
        let spec = layoutSpecs.get(recipe.index);
        if (!spec) {
          const backgroundColor = recipe.backgroundColor && HEX_COLOR_PATTERN.test(recipe.backgroundColor) ? recipe.backgroundColor.toUpperCase() : undefined;
          spec = { id: crypto.randomUUID(), name: recipe.name?.trim() || `模板版式 ${recipe.index + 1}`, ...(backgroundColor ? { backgroundColor } : {}) };
          layoutSpecs.set(recipe.index, spec);
          layouts.push(spec);
        }
        slide.layoutId = spec.id;
      }
      const recipeTitleRegion = recipe ? templateTitleRegion(recipe) : undefined;
      const recipeContentRegion = recipe ? templateContentRegion(recipe) : undefined;
      const recipeColumnRegions = recipe ? templateColumnRegions(recipe) : undefined;
      const recipeTitle = recipeTitleRegion?.frame;
      const recipeContent = recipeContentRegion?.frame;
      // The template states which ink and which size each placeholder was drawn
      // with. Using them keeps a generated page inside the template's own
      // typography instead of substituting a guessed palette. A design that
      // explicitly overrides the ink (the contrast repair does) wins instead,
      // otherwise the repair could never take effect.
      const titleInk = design.inkOverride ? design.titleColor : (recipeTitleRegion?.textColor ?? design.titleColor);
      const bodyInk = design.inkOverride ? design.bodyColor : (recipeContentRegion?.textColor ?? design.bodyColor);
      const templateTitleSize = recipeTitleRegion?.fontSizePt;
      const templateBodySize = recipeContentRegion?.fontSizePt;
      const templateColumnSize = recipeColumnRegions?.[0]?.fontSizePt;
      const artworkTreatment = design.backgroundTreatment ?? "none";
      const keepsArtwork = artworkTreatment !== "simplify" && Boolean(recipe?.backgroundImageDataUrl);
      slide.background = recipe?.backgroundColor ?? design.background;
      const pageLuminance = colorLuminance(slide.background) ?? 1;
      // The artwork under the placeholders is a range, not a single value: the
      // ink has to read on the patch that carries the text.
      const titleBackground = recipe?.backgroundLuminance?.title;
      const bodyBackground = recipe?.backgroundLuminance?.body ?? titleBackground;
      const titleLuminance = titleBackground ?? pageLuminance;
      const bodyLuminance = bodyBackground ?? titleBackground ?? pageLuminance;
      const isSafeRegion = (candidate: { x: number; y: number; width: number; height: number } | undefined, minimumWidth: number, minimumHeight: number) => Boolean(candidate && candidate.x >= 0 && candidate.y >= 0 && candidate.width >= minimumWidth && candidate.height >= minimumHeight && candidate.x + candidate.width <= 1 && candidate.y + candidate.height <= 1);
      const safeFrame = (candidate: { x: number; y: number; width: number; height: number } | undefined, fallback: [number, number, number, number], minimumWidth = 0.25, minimumHeight = 0.08) => isSafeRegion(candidate, minimumWidth, minimumHeight) ? frame(candidate!.x, candidate!.y, candidate!.width, candidate!.height) : frame(...fallback);
      const [leftRecipe, rightRecipe] = recipeColumnRegions?.map((region) => region.frame) ?? [];
      const hasSafeColumns = isSafeRegion(leftRecipe, 0.25, 0.25) && isSafeRegion(rightRecipe, 0.25, 0.25) && leftRecipe!.x + leftRecipe!.width <= rightRecipe!.x && Math.abs(leftRecipe!.y - rightRecipe!.y) < 0.18;
      const intersects = (left: AiNormalizedRect, right: AiNormalizedRect) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
      const insetObstacle = (region: AiNormalizedRect): AiNormalizedRect => ({ x: Math.max(0, region.x - 0.015), y: Math.max(0, region.y - 0.015), width: Math.min(1, region.width + 0.03), height: Math.min(1, region.height + 0.03) });
      const obstacles = (design.obstacleRegions ?? []).filter((region) => isSafeRegion(region, 0.001, 0.001)).map(insetObstacle);
      const largestFreeRegion = (source: AiNormalizedRect): AiNormalizedRect => {
        let candidates = [source];
        for (const obstacle of obstacles) {
          candidates = candidates.flatMap((candidate) => {
            if (!intersects(candidate, obstacle)) return [candidate];
            const right = candidate.x + candidate.width; const bottom = candidate.y + candidate.height;
            const obstacleRight = obstacle.x + obstacle.width; const obstacleBottom = obstacle.y + obstacle.height;
            return [
              { x: candidate.x, y: candidate.y, width: Math.max(0, obstacle.x - candidate.x), height: candidate.height },
              { x: Math.min(right, obstacleRight), y: candidate.y, width: Math.max(0, right - Math.max(candidate.x, obstacleRight)), height: candidate.height },
              { x: candidate.x, y: candidate.y, width: candidate.width, height: Math.max(0, obstacle.y - candidate.y) },
              { x: candidate.x, y: Math.min(bottom, obstacleBottom), width: candidate.width, height: Math.max(0, bottom - Math.max(candidate.y, obstacleBottom)) },
            ].filter((region) => region.width >= 0.28 && region.height >= 0.20);
          });
        }
        return candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? source;
      };
      const requestedSafe = design.safeRegion && isSafeRegion(design.safeRegion, 0.30, 0.25) ? design.safeRegion : { x: 0.07, y: 0.12, width: 0.86, height: 0.75 };
      const visualSafe = largestFreeRegion(requestedSafe);
      const safeLeft = visualSafe?.x ?? 0.07; const safeRight = visualSafe ? visualSafe.x + visualSafe.width : 0.93; const safeTop = visualSafe?.y ?? 0.20; const safeBottom = visualSafe ? visualSafe.y + visualSafe.height : 0.87;
      const alignmentGrid = { left: safeLeft, right: safeRight, titleY: safeTop, titleHeight: Math.min(0.10, (safeBottom - safeTop) * 0.18), ruleY: safeTop + Math.min(0.12, (safeBottom - safeTop) * 0.22), contentY: safeTop + Math.min(0.17, (safeBottom - safeTop) * 0.30), contentBottom: safeBottom } as const;
      slide.elements = [];
      if (keepsArtwork) slide.elements.push({ id: crypto.randomUUID() as ElementId, type: "image", placement: "layout-background", frame: frame(0, 0, 1, 1), rotationMilliDegree: 0, locked: true, source: { kind: "embedded", dataUrl: recipe!.backgroundImageDataUrl!, mimeType: "image/png" }, altText: `模板版式背景：${recipe!.name ?? recipe!.index}` });
      const decorations = keepsArtwork ? [] : [...(command.templateDecorations ?? []), ...(recipe?.decorations ?? [])];
      decorations.forEach((decoration) => {
        if (isSafeRegion(decoration.frame, 0.001, 0.001)) slide.elements.push(shape(frame(decoration.frame.x, decoration.frame.y, decoration.frame.width, decoration.frame.height), decoration.fill, decoration.shape));
      });
      // A scrim belongs to the text block only. Painting the whole page erased the
      // template artwork and was the single biggest reason a generated deck looked
      // like a blank sheet with a coloured border.
      const scrimFill = design.background;
      const scrimLuminance = colorLuminance(scrimFill) ?? 1;
      const contentBox = recipeContent ?? { x: alignmentGrid.left, y: alignmentGrid.contentY, width: alignmentGrid.right - alignmentGrid.left, height: alignmentGrid.contentBottom - alignmentGrid.contentY };
      const titleBox = recipeTitle ?? { x: alignmentGrid.left, y: alignmentGrid.titleY, width: alignmentGrid.right - alignmentGrid.left, height: alignmentGrid.titleHeight };
      if (artworkTreatment === "local-scrim") {
        slide.elements.push(shape(frame(Math.max(0, contentBox.x - 0.02), Math.max(0, contentBox.y - 0.02), Math.min(1 - Math.max(0, contentBox.x - 0.02), contentBox.width + 0.04), Math.min(1 - Math.max(0, contentBox.y - 0.02), contentBox.height + 0.04)), scrimFill));
      }
      const contentTextLuminance = artworkTreatment === "local-scrim" ? scrimLuminance : bodyLuminance;
      // A white card on a white page is invisible. Pick a surface that separates
      // the card from the page while keeping dark body ink readable.
      const cardFill = pageLuminance < 0.45 ? "#FFFFFF" : "#F3F5F7";
      const cardStroke = pageLuminance < 0.45 ? "#FFFFFF" : "#E2E7EC";
      const cardLuminance = colorLuminance(cardFill) ?? 0.9;
      const accentLuminance = colorLuminance(design.accent) ?? pageLuminance;
      // Badges and header bars carry white text, so the brand accent is only
      // used as their fill when it can hold white; otherwise it is deepened
      // instead of letting the numerals turn into unreadable ink.
      const accentFill = fillForInk("#FFFFFF", design.accent);
      const accentFillLuminance = colorLuminance(accentFill) ?? accentLuminance;
      // Text is drawn from the top of its frame, so a block that has to look
      // centred inside a slot starts half its own height above the middle of
      // the slot. The height comes from the same line estimator the quality
      // gate uses, so a centred block is never cut off.
      const pointsToFraction = (points: number) => points / 72 / (pageHeight / 914400);
      const blockHeight = (value: string, widthFraction: number, fontSizePt: number) => {
        const widthPt = widthFraction * (pageWidth / 914400) * 72;
        return pointsToFraction(estimateTextLines(value, widthPt, fontSizePt) * fontSizePt * 1.25);
      };
      const centeredBlock = (value: string, slot: { x: number; y: number; width: number; height: number }, fontSizePt: number) => {
        const height = blockHeight(value, slot.width, fontSizePt) * 1.04;
        return frame(slot.x, slot.y + slot.height / 2 - height / 2, slot.width, height);
      };
      if (design.layout === "cover" && !hasDeterministicBlock) {
        const coverTitle = safeFrame(recipeTitle, [0.10, 0.24, 0.78, 0.28], 0.25, 0.04);
        const coverBody = safeFrame(recipeContent, [0.10, 0.56, 0.72, 0.16], 0.25, 0.08);
        if (!keepsArtwork) slide.elements.push(shape(frame(0, 0, 0.035, 1), design.accent), shape(frame(0.08, 0.70, 0.18, 0.018), design.accent));
        slide.elements.push(text(content.title, coverTitle, templateTitleSize ?? 42, titleInk, true, "left", undefined, titleLuminance));
        if (content.body.trim()) slide.elements.push(text(content.body, coverBody, templateBodySize ?? 19, bodyInk, false, "left", undefined, contentTextLuminance));
      } else if (design.layout === "section" && !hasDeterministicBlock) {
        const sectionTitle = safeFrame(recipeTitle, [0.39, 0.30, 0.50, 0.22], 0.25, 0.04);
        const sectionBody = safeFrame(recipeContent, [0.39, 0.56, 0.47, 0.20], 0.25, 0.08);
        // The template draws its own section number into the artwork, so PPTD must
        // not add a second one on top of it.
        if (!keepsArtwork) slide.elements.push(shape(frame(0, 0, 0.32, 1), design.accent), text(String(index + 1).padStart(2, "0"), frame(0.07, 0.17, 0.16, 0.18), 52, "#FFFFFF", true, "left", undefined, accentLuminance));
        slide.elements.push(text(content.title, sectionTitle, templateTitleSize ?? 36, titleInk, true, "left", undefined, titleLuminance));
        if (content.body.trim()) slide.elements.push(text(content.body, sectionBody, templateBodySize ?? 18, bodyInk, false, "left", undefined, contentTextLuminance));
      } else if (timelineBlock) {
        const timelineItems = timelineBlock.items.slice(0, 6);
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.20), 0.012), design.accent));
        const startX = contentBox.x + contentBox.width * 0.05; const endX = contentBox.x + contentBox.width * 0.95;
        const lineY = contentBox.y + contentBox.height * 0.45;
        const itemWidth = Math.min(0.22, contentBox.width * 0.18);
        slide.elements.push(shape(frame(startX, lineY, endX - startX, 0.008), design.accent));
        timelineItems.forEach((item, itemIndex) => {
          const x = timelineItems.length === 1 ? (startX + endX) / 2 : startX + itemIndex * ((endX - startX) / (timelineItems.length - 1));
          const above = itemIndex % 2 === 0;
          slide.elements.push(shape(circleFrame(x, lineY - 0.15 / pageHeightIn, 0.3), design.accent, "ellipse"));
          slide.elements.push(text(item.label, frame(x - itemWidth / 2, above ? lineY - contentBox.height * 0.30 : lineY + contentBox.height * 0.11, itemWidth, contentBox.height * 0.11), 15, design.accent, true, "center", undefined, contentTextLuminance));
          slide.elements.push(text(item.text, frame(x - itemWidth / 2, above ? lineY - contentBox.height * 0.18 : lineY + contentBox.height * 0.23, itemWidth, contentBox.height * 0.22), 13, bodyInk, false, "center", undefined, contentTextLuminance));
        });
      } else if (comparisonBlock) {
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        const columnWidth = contentBox.width * 0.44;
        const columns = [
          { x: contentBox.x, label: comparisonBlock.leftLabel, items: comparisonBlock.leftItems },
          { x: contentBox.x + contentBox.width * 0.52, label: comparisonBlock.rightLabel, items: comparisonBlock.rightItems },
        ];
        // The panel is sized to the list it carries. Stretching it to the whole
        // placeholder left two thirds of both columns empty.
        const labelSize = 18; const itemSize = 16;
        const headerHeight = pointsToFraction(labelSize * 1.2) + 0.018;
        const itemText = (items: string[]) => items.slice(0, 7).map((item) => `• ${item}`).join("\n\n");
        const panelHeight = Math.min(contentBox.height, headerHeight + 0.03 + Math.max(...columns.map((column) => blockHeight(itemText(column.items), columnWidth - 0.07, itemSize))) + 0.03);
        const panelTop = contentBox.y + (contentBox.height - panelHeight) * 0.30;
        columns.forEach((column) => {
          slide.elements.push(shape(frame(column.x, panelTop, columnWidth, panelHeight), cardFill, "rectangle", cardStroke, 0.75), shape(frame(column.x, panelTop, columnWidth, headerHeight), accentFill));
          slide.elements.push(text(column.label, centeredBlock(column.label, { x: column.x + 0.025, y: panelTop, width: columnWidth - 0.05, height: headerHeight }, labelSize), labelSize, "#FFFFFF", true, "center", undefined, accentFillLuminance));
          slide.elements.push(text(itemText(column.items), frame(column.x + 0.035, panelTop + headerHeight + 0.015, columnWidth - 0.07, panelHeight - headerHeight - 0.03), itemSize, bodyInk, false, "left", undefined, cardLuminance));
        });
      } else if (tableBlock) {
        const tableIndex = blocks.indexOf(tableBlock);
        const tableContent = contentBlocks?.[tableIndex];
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.20), 0.012), design.accent));
        // The table element holds no cells of its own: it points at the reviewed
        // table block, so editing the numbers keeps the grid in sync.
        if (tableContent?.type === "table-data" && tableContent.header.length > 0 && tableContent.rows.length > 0) {
          slide.elements.push({
            id: crypto.randomUUID() as ElementId,
            type: "table",
            contentBlockId: tableContent.id,
            frame: frame(contentBox.x, contentBox.y + contentBox.height * 0.06, contentBox.width, Math.min(contentBox.height * 0.80, 0.52)),
            rotationMilliDegree: 0,
            locked: false,
            style: {
              fontFamily: command.bodyFontFamily || command.fontFamily || "Microsoft YaHei",
              fontSizePt: 14,
              headerFill: accentFill,
              headerTextColor: "#FFFFFF",
              bodyTextColor: bodyInk,
              borderColor: cardStroke,
              firstColumnBold: true,
            },
          });
        }
      } else if (metricBlocks.length > 0) {
        const metrics = metricBlocks.slice(0, 6);
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.20), 0.012), design.accent));
        // The metrics of a page are the reviewed numbers of the page. When they
        // are numbers of the same unit, they are drawn as a native chart: the
        // exported file keeps an editable chart instead of a picture of bars.
        const chartMetrics = metrics
          .map((metric, metricIndex) => {
            const parsed = parseMetricValue(metric.value);
            const block = contentBlocks?.filter((candidate) => candidate.type === "metric")[metricIndex];
            return parsed && block?.type === "metric" ? { blockId: block.id, label: metric.label, value: parsed.value, unit: parsed.unit } : undefined;
          })
          .filter((metric): metric is { blockId: string; label: string; value: number; unit: string } => Boolean(metric));
        const sameUnit = chartMetrics.length > 0 && chartMetrics.every((metric) => metric.unit === chartMetrics[0]!.unit);
        if (chartMetrics.length >= 2 && sameUnit) {
          // A page with many categories reads better with horizontal bars.
          const kind = chartMetrics.length > 4 ? "bar" : "column";
          const chartFrame = frame(contentBox.x, contentBox.y + contentBox.height * 0.06, contentBox.width, Math.min(contentBox.height * 0.80, 0.46));
          slide.elements.push({
            id: crypto.randomUUID() as ElementId,
            type: "chart",
            contentBlockIds: chartMetrics.map((metric) => metric.blockId),
            kind,
            frame: chartFrame,
            rotationMilliDegree: 0,
            locked: false,
            style: {
              fontFamily: command.bodyFontFamily || command.fontFamily || "Microsoft YaHei",
              fontSizePt: 14,
              textColor: bodyInk,
              seriesColors: [design.accent, accentFill, cardStroke],
              showLegend: false,
              showValueLabels: true,
            },
          });
        } else {
          const columns = metrics.length > 3 ? 3 : metrics.length; const rows = Math.ceil(metrics.length / columns);
          const cellWidth = contentBox.width / columns;
          const cardGap = 0.03;
          const valueSize = 30;
          const labelSize = 15;
          // The stat card carries a number and its label; it is sized to that
          // pair instead of stretching over the whole placeholder, which used to
          // leave the label stranded at the bottom of a mostly empty card.
          const cardHeight = Math.min(0.24, contentBox.height / rows - 0.04);
          const gridHeight = rows * cardHeight + (rows - 1) * cardGap;
          const gridTop = contentBox.y + (contentBox.height - gridHeight) * 0.30;
          metrics.forEach((metric, metricIndex) => {
            const column = metricIndex % columns; const row = Math.floor(metricIndex / columns);
            const width = cellWidth - 0.025;
            const x = contentBox.x + column * cellWidth; const y = gridTop + row * (cardHeight + cardGap);
            slide.elements.push(shape(frame(x, y, width, cardHeight), cardFill, "rectangle", cardStroke, 0.75));
            slide.elements.push(text(metric.value, centeredBlock(metric.value, { x: x + 0.02, y: y + cardHeight * 0.10, width: width - 0.04, height: cardHeight * 0.46 }, valueSize), valueSize, design.accent, true, "center", undefined, cardLuminance));
            slide.elements.push(text(metric.label, centeredBlock(metric.label, { x: x + 0.02, y: y + cardHeight * 0.54, width: width - 0.04, height: cardHeight * 0.36 }, labelSize), labelSize, bodyInk, false, "center", undefined, cardLuminance));
          });
        }
      } else if (processBlock) {
        const processItems = processBlock.items.slice(0, 6);
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.20), 0.012), design.accent));
        const stepGap = 0.03;
        const stepWidth = (contentBox.width - stepGap * Math.max(processItems.length - 1, 0)) / Math.max(processItems.length, 1);
        const labelSize = 17; const textSize = 14; const badgeSize = 15;
        const badgeDiameter = 0.5;
        const badgeHeight = badgeDiameter / pageHeightIn;
        // A step card holds a label and a sentence. Sizing it to that content
        // keeps the row compact instead of leaving a tall empty panel.
        const stepHeight = Math.min(0.26, contentBox.height * 0.44);
        const stepTop = contentBox.y + (contentBox.height - stepHeight) * 0.34;
        processItems.forEach((item, itemIndex) => {
          const x = contentBox.x + itemIndex * (stepWidth + stepGap);
          const badgeY = stepTop - 0.01 - badgeHeight / 2;
          slide.elements.push(shape(frame(x, stepTop, stepWidth, stepHeight), cardFill, "rectangle", cardStroke, 0.75), shape(circleFrame(x + 0.02, badgeY, badgeDiameter), accentFill, "ellipse"));
          slide.elements.push(text(String(itemIndex + 1), centeredBlock(String(itemIndex + 1), { x: x + 0.02, y: badgeY, width: badgeDiameter / pageWidthIn, height: badgeHeight }, badgeSize), badgeSize, "#FFFFFF", true, "center", undefined, accentFillLuminance));
          slide.elements.push(text(item.label, centeredBlock(item.label, { x: x + 0.025, y: stepTop + stepHeight * 0.12, width: stepWidth - 0.05, height: stepHeight * 0.28 }, labelSize), labelSize, titleInk, true, "center", undefined, cardLuminance));
          slide.elements.push(text(item.text, centeredBlock(item.text, { x: x + 0.025, y: stepTop + stepHeight * 0.44, width: stepWidth - 0.05, height: stepHeight * 0.46 }, textSize), textSize, bodyInk, false, "center", undefined, cardLuminance));
          if (itemIndex < processItems.length - 1) {
            const arrowHeight = pointsToFraction(22 * 1.2);
            slide.elements.push(text("→", frame(x + stepWidth, stepTop + stepHeight / 2 - arrowHeight / 2, stepGap, arrowHeight), 22, design.accent, true, "center", undefined, contentTextLuminance));
          }
        });
      } else if ((design.layout === "quote" || quoteBlock) && items.length < 3) {
        const quoteText = quoteBlock?.text ?? content.body;
        const attribution = quoteBlock?.attribution?.trim();
        if (!keepsArtwork) slide.elements.push(shape(frame(0.08, 0.16, 0.025, 0.68), design.accent));
        const quoteTitle = text(content.title, safeFrame(recipeTitle, [0.15, 0.12, 0.72, 0.13], 0.25, 0.04), templateTitleSize ?? 28, titleInk, true, "left", undefined, titleLuminance);
        slide.elements.push(quoteTitle);
        if (quoteText.trim()) {
          const quoteBox = safeFrame(recipeContent, [0.16, 0.30, 0.66, 0.38], 0.25, 0.12);
          const quoteFrame = { x: quoteBox.x + Math.round(pageWidth * 0.035), y: quoteBox.y, width: Math.max(Math.round(pageWidth * 0.25), quoteBox.width - Math.round(pageWidth * 0.035)), height: quoteBox.height };
          const quoteSize = Math.max(26, templateBodySize ?? 26);
          const quoteElement = text(quoteText, centeredBlock(quoteText, { x: quoteFrame.x / pageWidth, y: quoteFrame.y / pageHeight, width: quoteFrame.width / pageWidth, height: quoteFrame.height / pageHeight }, quoteSize), quoteSize, bodyInk, false, "left", undefined, contentTextLuminance);
          slide.elements.push(quoteElement);
          const markY = quoteElement.frame.y / pageHeight - 0.065;
          const titleBottom = quoteTitle.frame.y / pageHeight + quoteTitle.frame.height / pageHeight;
          if (!keepsArtwork && markY > titleBottom + 0.01) {
            const markX = Math.max(0.02, quoteFrame.x / pageWidth - 0.08);
            slide.elements.push(text("“", frame(markX, markY, 0.07, 0.12), 60, design.accent, true, "left", undefined, contentTextLuminance));
          }
          if (attribution) {
            const attributionY = quoteElement.frame.y / pageHeight + quoteElement.frame.height / pageHeight + 0.025;
            if (attributionY < 0.90) {
              slide.elements.push(text(`— ${attribution}`, frame(quoteFrame.x / pageWidth, attributionY, quoteFrame.width / pageWidth, Math.min(0.06, 0.96 - attributionY)), 14, bodyInk, false, "left", undefined, contentTextLuminance));
            }
          }
        }
      } else if (
        (pullQuote || countPanel)
        && items.length >= 3
        && items.length <= 5
        && contentBox.width >= 0.55
        && contentBox.height >= 0.35
        && (design.layout === "cards" || design.layout === "title-body" || design.layout === "summary" || design.layout === "quote" || editorialSplit)
      ) {
        // A narrow numbered column plus one visual anchor: an oversized pull
        // quote copied from the reviewed body, or the real count of summary
        // points when there is no quote. Neither invents content.
        const listItems = items.slice(0, 5);
        const listWidth = contentBox.width * 0.56;
        const panelX = contentBox.x + contentBox.width * 0.60;
        const panelWidth = contentBox.width * 0.37;
        const rowGap = 0.006;
        const rowHeight = (contentBox.height - rowGap * (listItems.length - 1)) / listItems.length;
        const numberWidth = Math.min(0.07, listWidth * 0.16);
        const numberSize = Math.max(16, Math.min(22, rowHeight * pageHeightIn * 72 * 0.48));
        const itemSize = Math.max(17, Math.min(20, templateBodySize ?? 20));
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.20), 0.012), design.accent));
        listItems.forEach((item, itemIndex) => {
          const rowY = contentBox.y + itemIndex * (rowHeight + rowGap);
          const cleanItem = cleanPoint(item);
          slide.elements.push(shape(frame(contentBox.x, rowY, 0.006, rowHeight), design.accent));
          slide.elements.push(text(String(itemIndex + 1).padStart(2, "0"), centeredBlock(String(itemIndex + 1).padStart(2, "0"), { x: contentBox.x + 0.015, y: rowY, width: numberWidth, height: rowHeight }, numberSize), numberSize, design.accent, true, "left", undefined, contentTextLuminance));
          const itemBox = { x: contentBox.x + numberWidth + 0.03, y: rowY, width: listWidth - numberWidth - 0.03, height: rowHeight };
          const fittedItemSize = fittedFontSize(cleanItem, frame(itemBox.x, itemBox.y, itemBox.width, itemBox.height), itemSize, 14);
          slide.elements.push(text(cleanItem, centeredBlock(cleanItem, itemBox, fittedItemSize), fittedItemSize, bodyInk, false, "left", undefined, contentTextLuminance));
          if (itemIndex < listItems.length - 1) slide.elements.push(shape(frame(contentBox.x, rowY + rowHeight + rowGap / 2 - 0.002, listWidth, 0.004), cardStroke));
        });
        slide.elements.push(shape(frame(panelX, contentBox.y, panelWidth, contentBox.height), accentFill, "rectangle"));
        if (pullQuote) {
          slide.elements.push(text("“", frame(panelX + 0.04, contentBox.y + 0.02, 0.12, 0.13), 62, "#FFFFFF", true, "left", undefined, accentFillLuminance));
          const quoteAttribution = quoteBlock?.attribution?.trim();
          // Prefer a punctuation boundary near the middle over an arbitrary
          // CJK wrap. This is display-only; the reviewed body stays unchanged.
          const displayQuote = (value: string) => {
            if (value.includes("\n")) return value;
            const characters = [...value];
            if (characters.length < 12) return value;
            const candidates = characters
              .map((character, characterIndex) => (/[，,、；;]/.test(character) ? characterIndex + 1 : -1))
              .filter((breakIndex) => breakIndex > 0 && breakIndex < characters.length - 1)
              .filter((breakIndex) => breakIndex >= characters.length * 0.35 && breakIndex <= characters.length * 0.65);
            if (candidates.length === 0) return value;
            const breakIndex = candidates.sort((left, right) => Math.abs(left - characters.length / 2) - Math.abs(right - characters.length / 2))[0]!;
            return `${characters.slice(0, breakIndex).join("")}\n${characters.slice(breakIndex).join("").trimStart()}`;
          };
          const panelQuote = quoteAttribution ? `${displayQuote(pullQuote)}\n— ${quoteAttribution}` : displayQuote(pullQuote);
          const quoteSize = panelQuote.length > 60 ? 16 : panelQuote.length > 40 ? 18 : 22;
          slide.elements.push(text(panelQuote, centeredBlock(panelQuote, { x: panelX + 0.05, y: contentBox.y + 0.14, width: panelWidth - 0.10, height: contentBox.height * 0.58 }, quoteSize), quoteSize, "#FFFFFF", false, "left", undefined, accentFillLuminance));
          slide.elements.push(shape(frame(panelX + 0.05, contentBox.y + contentBox.height - 0.18, panelWidth - 0.10, 0.004), "#FFFFFF"));
          slide.elements.push(text("关键摘录", frame(panelX + 0.05, contentBox.y + contentBox.height - 0.145, panelWidth - 0.10, 0.06), 12, "#FFFFFF", true, "left", undefined, accentFillLuminance));
        } else {
          const countText = String(items.length).padStart(2, "0");
          slide.elements.push(text(countText, centeredBlock(countText, { x: panelX + 0.05, y: contentBox.y + 0.16, width: panelWidth - 0.10, height: contentBox.height * 0.24 }, 86), 86, "#FFFFFF", true, "left", undefined, accentFillLuminance));
          slide.elements.push(shape(frame(panelX + 0.05, contentBox.y + contentBox.height * 0.47, panelWidth - 0.10, 0.004), "#FFFFFF"));
          slide.elements.push(text("项要点", frame(panelX + 0.05, contentBox.y + contentBox.height * 0.50, panelWidth - 0.10, 0.07), 18, "#FFFFFF", true, "left", undefined, accentFillLuminance));
          slide.elements.push(text("本页要点", frame(panelX + 0.05, contentBox.y + contentBox.height - 0.145, panelWidth - 0.10, 0.06), 12, "#FFFFFF", false, "left", undefined, accentFillLuminance));
        }
      } else if (items.length > 1 && items.length <= 6 && (design.layout === "cards" || shortSplitAsCards || (items.length >= 3 && (design.layout === "title-body" || design.layout === "summary") && shortItems))) {
        slide.elements.push(text(content.title, frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height), templateTitleSize ?? 32, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(text(String(index + 1).padStart(2, "0"), frame(alignmentGrid.right - 0.07, alignmentGrid.titleY, 0.07, alignmentGrid.titleHeight), 14, titleInk, true, "right", undefined, titleLuminance), shape(frame(alignmentGrid.left, alignmentGrid.ruleY, Math.min(0.12, (alignmentGrid.right - alignmentGrid.left) * 0.20), 0.009), design.accent));
        const visible = items.slice(0, 6);
        const columns = visible.length === 3 || visible.length >= 5 ? 3 : 2;
        const rows = Math.ceil(visible.length / columns);
        const contentWidth = contentBox.width; const contentHeight = contentBox.height;
        const columnGap = 0.022; const rowGap = 0.040;
        const cardWidth = (contentWidth - columnGap * (columns - 1)) / columns;
        // A single row of cards can carry more height than a two-row grid; use
        // that space instead of leaving the lower half of the page empty.
        const cardHeight = Math.min(rows === 1 ? 0.30 : 0.24, contentHeight / rows - 0.04);
        const gridHeight = rows * cardHeight + (rows - 1) * rowGap;
        const gridTop = contentBox.y + (contentHeight - gridHeight) * (rows === 1 ? 0.42 : 0.30);
        visible.forEach((item, itemIndex) => {
          const row = Math.floor(itemIndex / columns); const column = itemIndex % columns;
          const rowItemCount = Math.min(columns, visible.length - row * columns);
          const rowWidth = rowItemCount * cardWidth + (rowItemCount - 1) * columnGap;
          const rowStart = contentBox.x + (contentWidth - rowWidth) / 2;
          const x = rowStart + column * (cardWidth + columnGap); const y = gridTop + row * (cardHeight + rowGap);
          const cleanItem = cleanPoint(item);
          // A top-left badge frees the whole card width for copy. Placing the
          // badge in a left gutter made the text column narrow and the card
          // look unbalanced on portrait-ish three-column grids.
          const badgeDiameter = 0.36;
          const badgeWidth = badgeDiameter / pageWidthIn;
          const badgeHeight = badgeDiameter / pageHeightIn;
          const badgeX = x + 0.03;
          const badgeY = y + 0.035;
          const textTop = badgeY + badgeHeight + 0.03;
          slide.elements.push(shape(frame(x, y, cardWidth, cardHeight), cardFill, "rectangle", cardStroke, 0.75), shape(frame(x, y, cardWidth, 0.008), design.accent));
          slide.elements.push(shape(circleFrame(badgeX, badgeY, badgeDiameter), accentFill, "ellipse"));
          const badgeText = String(itemIndex + 1).padStart(2, "0");
          slide.elements.push(text(badgeText, centeredBlock(badgeText, { x: badgeX, y: badgeY, width: badgeWidth, height: badgeHeight }, 12), 12, "#FFFFFF", true, "center", undefined, accentFillLuminance));
          const cardTextBox = { x: x + 0.03, y: textTop, width: cardWidth - 0.06, height: Math.max(0.06, y + cardHeight - 0.03 - textTop) };
          const fittedCardSize = fittedFontSize(cleanItem, frame(cardTextBox.x, cardTextBox.y, cardTextBox.width, cardTextBox.height), 16, 12);
          slide.elements.push(text(cleanItem, centeredBlock(cleanItem, cardTextBox, fittedCardSize), fittedCardSize, "#293241", false, "left", undefined, cardLuminance));
        });
      } else if ((design.layout === "split" || (design.layout === "cards" && items.length > 6)) && items.length > 1) {
        slide.elements.push(text(content.title, safeFrame(recipeTitle, [0.07, 0.07, 0.84, 0.13], 0.25, 0.04), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(0.50, 0.25, 0.012, 0.60), design.accent));
        const middle = Math.ceil(items.length / 2);
        const columnCopy = (columnItems: string[]) => columnItems
          .map((item) => `• ${cleanPoint(item)}`)
          .join("\n\n");
        const columnFont = templateColumnSize ?? 18;
        const leftSlot = hasSafeColumns
          ? { x: leftRecipe!.x, y: leftRecipe!.y, width: leftRecipe!.width, height: leftRecipe!.height }
          : { x: 0.08, y: 0.28, width: 0.36, height: 0.54 };
        const rightSlot = hasSafeColumns
          ? { x: rightRecipe!.x, y: rightRecipe!.y, width: rightRecipe!.width, height: rightRecipe!.height }
          : { x: 0.57, y: 0.28, width: 0.35, height: 0.54 };
        // Long copy can fill a split column, but a short column was previously
        // pinned to the top and left the lower half of the page blank. Center
        // the block when it fits; keep the full slot when it needs to shrink.
        const columnFrame = (copy: string, slot: { x: number; y: number; width: number; height: number }) => {
          const usedHeight = blockHeight(copy, slot.width, columnFont);
          const height = Math.max(0.04, Math.min(slot.height, usedHeight));
          const top = usedHeight < slot.height ? slot.y + (slot.height - usedHeight) / 2 : slot.y;
          return frame(slot.x, top, slot.width, height);
        };
        const leftCopy = columnCopy(items.slice(0, middle));
        const rightCopy = columnCopy(items.slice(middle));
        slide.elements.push(text(leftCopy, columnFrame(leftCopy, leftSlot), columnFont, bodyInk, false, "left", undefined, contentTextLuminance), text(rightCopy, columnFrame(rightCopy, rightSlot), columnFont, bodyInk, false, "left", undefined, contentTextLuminance));
      } else if ((design.layout === "title-body" || design.layout === "summary") && items.length >= 3 && items.length <= 6) {
        // A short list is a sequence of visual units, not one paragraph. Keeping
        // it as a single text box was the reason a five-point page looked like a
        // small block stranded in a large empty canvas.
        const listItems = items.slice(0, 6);
        slide.elements.push(text(content.title, safeFrame(recipeTitle, [alignmentGrid.left, alignmentGrid.titleY, alignmentGrid.right - alignmentGrid.left, alignmentGrid.titleHeight], 0.25, 0.04), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(alignmentGrid.left, alignmentGrid.ruleY, Math.min(0.11, (alignmentGrid.right - alignmentGrid.left) * 0.20), 0.012), design.accent));
        const rowGap = Math.min(0.012, contentBox.height * 0.02);
        const rowHeight = (contentBox.height - rowGap * (listItems.length - 1)) / listItems.length;
        const numberWidth = Math.min(0.085, contentBox.width * 0.12);
        const itemWidth = contentBox.width - numberWidth - 0.02;
        const numberSize = Math.max(12, Math.min(22, (rowHeight * pageHeightIn * 72) * 0.52));
        listItems.forEach((item, itemIndex) => {
          const rowY = contentBox.y + itemIndex * (rowHeight + rowGap);
          const cleanItem = cleanPoint(item);
          slide.elements.push(shape(frame(contentBox.x, rowY, 0.008, rowHeight), design.accent));
          slide.elements.push(text(String(itemIndex + 1).padStart(2, "0"), centeredBlock(String(itemIndex + 1).padStart(2, "0"), { x: contentBox.x + 0.022, y: rowY, width: numberWidth, height: rowHeight }, numberSize), numberSize, design.accent, true, "left", undefined, contentTextLuminance));
          slide.elements.push(text(cleanItem, centeredBlock(cleanItem, { x: contentBox.x + numberWidth + 0.025, y: rowY, width: itemWidth, height: rowHeight }, templateBodySize ?? 18), templateBodySize ?? 18, bodyInk, false, "left", undefined, contentTextLuminance));
          if (itemIndex < listItems.length - 1) slide.elements.push(shape(frame(contentBox.x, rowY + rowHeight + rowGap / 2 - 0.003, contentBox.width, 0.006), cardStroke));
        });
      } else {
        slide.elements.push(text(content.title, safeFrame(recipeTitle, [alignmentGrid.left, alignmentGrid.titleY, alignmentGrid.right - alignmentGrid.left, alignmentGrid.titleHeight], 0.25, 0.04), templateTitleSize ?? 30, titleInk, true, "left", undefined, titleLuminance));
        if (!keepsArtwork) slide.elements.push(shape(frame(alignmentGrid.left, alignmentGrid.ruleY, Math.min(0.11, (alignmentGrid.right - alignmentGrid.left) * 0.20), 0.012), design.accent));
        if (content.body.trim()) slide.elements.push(text(content.body, safeFrame(recipeContent, [alignmentGrid.left + 0.01, alignmentGrid.contentY, alignmentGrid.right - alignmentGrid.left - 0.02, alignmentGrid.contentBottom - alignmentGrid.contentY], 0.25, 0.12), templateBodySize ?? 20, bodyInk, false, "left", undefined, contentTextLuminance));
      }
      // Link rendered title/body text back to semantic content. Structured
      // layouts (cards, timeline items, metrics) stay decorative because one
      // visual element cannot safely overwrite a multi-field content block.
      const bodyFontFamily = command.bodyFontFamily || command.fontFamily;
      for (const element of slide.elements) {
        if (element.type !== "text") continue;
        if (element.text === content.title) element.contentRef = "title";
        else if (content.body.trim() && element.text === content.body) element.contentRef = "body";
        else element.contentRef = "decorative";
        // Display type for the headline, text type for running copy. Using the
        // template major font for both made dense body copy look heavy.
        if (element.contentRef !== "title" && bodyFontFamily) element.style.fontFamily = bodyFontFamily;
      }
      // The typographic quote mark reads as two bars in many CJK UI fonts.
      // A serif glyph keeps the pull quote looking like a quotation instead of
      // a pair of slashes.
      const quoteMark = slide.elements.find((element) => element.type === "text" && element.text === "“");
      if (quoteMark?.type === "text") quoteMark.style.fontFamily = "Georgia";
      const titleRepair = design.elementRepairs?.find((repair) => repair.action !== "changeLayout" && repair.target === "title");
      const bodyRepair = design.elementRepairs?.find((repair) => repair.action !== "changeLayout" && repair.target === "body");
      for (const element of slide.elements) {
        if (element.type !== "text") continue;
        const repair = element.text === content.title ? titleRepair : element.text === content.body ? bodyRepair : undefined;
        if (!repair) continue;
        if (repair.action === "move" || repair.action === "resize") {
          const collisionFreeFrame = obstacles.some((obstacle) => intersects(repair.frame, obstacle))
            ? repair.target === "title"
              ? { x: visualSafe.x, y: visualSafe.y, width: visualSafe.width, height: Math.min(0.14, visualSafe.height * 0.22) }
              : { x: visualSafe.x, y: visualSafe.y + Math.min(0.18, visualSafe.height * 0.28), width: visualSafe.width, height: Math.max(0.08, visualSafe.height - Math.min(0.18, visualSafe.height * 0.28)) }
            : repair.frame;
          element.frame = frame(collisionFreeFrame.x, collisionFreeFrame.y, collisionFreeFrame.width, collisionFreeFrame.height);
        }
        if (repair.action === "restyle") element.style = { ...element.style, fontSizePt: Math.max(12, element.style.fontSizePt * (repair.fontScale ?? 1)), color: repair.color ?? element.style.color };
      }
      if (design.hierarchyAction === "strengthen-title") {
        const title = slide.elements.find((element) => element.type === "text" && element.text === content.title);
        if (title?.type === "text") title.style = { ...title.style, fontSizePt: Math.min(44, title.style.fontSizePt * 1.15), bold: true };
      }
      if (design.hierarchyAction === "reduce-density") {
        const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
        if (body?.type === "text") body.frame = { ...body.frame, height: Math.max(body.frame.height, Math.round(pageHeight * 0.42)) as Emu };
      }
      if (design.hierarchyAction === "increase-whitespace") {
        const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
        if (body?.type === "text") body.frame = { ...body.frame, x: (body.frame.x + Math.round(pageWidth * 0.025)) as Emu, width: Math.max(Math.round(pageWidth * 0.30), body.frame.width - Math.round(pageWidth * 0.05)) as Emu };
      }
      // Provenance is what lets a later design-only relayout replace the
      // generated composition without deleting anything the user added.
      for (const element of slide.elements) element.origin = "generated";
      return slide;
    });
    return;
  }
  if (command.type === "duplicate-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    const source = document.slides[sourceIndex]!;
    const duplicate = {
      ...source,
      id: crypto.randomUUID() as SlideId,
      content: { ...source.content, ...(source.content.blocks ? { blocks: cloneContentBlocks(source.content.blocks) } : {}) },
      elements: source.elements.map((element) => element.type === "text"
        ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style }, ...(element.runs ? { runs: element.runs.map((run) => ({ ...run })) } : {}) }
        : element.type === "shape"
          ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }
          : element.type === "chart"
            ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style, seriesColors: [...element.style.seriesColors] }, contentBlockIds: [...element.contentBlockIds] }
            : element.type === "table"
              ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, style: { ...element.style } }
              : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame }, source: { ...element.source } }),
    };
    document.slides.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "delete-slide") {
    if (document.slides.length === 1) throw new Error("LAST_SLIDE_CANNOT_BE_DELETED");
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    document.slides.splice(sourceIndex, 1);
    return;
  }
  if (command.type === "move-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= document.slides.length) {
      throw new Error("SLIDE_INDEX_OUT_OF_RANGE");
    }
    if (sourceIndex === command.toIndex) return;
    const [slide] = document.slides.splice(sourceIndex, 1);
    document.slides.splice(command.toIndex, 0, slide!);
    return;
  }
  const slide = document.slides.find((item) => item.id === command.slideId);
  if (!slide) throw new Error("SLIDE_NOT_FOUND");

  if (command.type === "relayout-slide") {
    relayoutSlide(document, slide);
    return;
  }
  if (command.type === "set-slide-background") {
    if (!HEX_COLOR_PATTERN.test(command.background)) throw new Error("INVALID_BACKGROUND_COLOR");
    slide.background = command.background;
    return;
  }
  if (command.type === "add-text") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "text",
      frame: { x: inches(1), y: inches(1.8), width: inches(4), height: inches(0.65) },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      text: "新文本",
      contentRef: "decorative",
      style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#17181c", bold: false, align: "left" },
    });
    return;
  }
  if (command.type === "add-image") {
    const expectedPrefix = `data:${command.mimeType};base64,`;
    const payload = command.dataUrl.slice(expectedPrefix.length);
    if (!command.dataUrl.startsWith(expectedPrefix) || command.dataUrl.length > 360_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || command.altText.length > 500) {
      throw new Error("INVALID_IMAGE_SOURCE");
    }
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "image",
      frame: imageFrame(command.naturalWidth, command.naturalHeight),
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      source: { kind: "embedded", dataUrl: command.dataUrl, mimeType: command.mimeType },
      altText: command.altText,
    });
    return;
  }
  if (command.type === "add-shape") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "shape",
      shape: command.shape,
      frame: { x: inches(4), y: inches(2.4), width: inches(2.4), height: inches(1.4) },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: { fill: "#d35230", stroke: "#7f2f1d", strokeWidthPt: 1.5, radiusPt: 12 },
    });
    return;
  }

  const element = slide.elements.find((item) => item.id === command.elementId);
  if (!element) throw new Error("ELEMENT_NOT_FOUND");
  if (command.type === "set-element-lock") {
    element.locked = command.locked;
    return;
  }
  if (element.locked) throw new Error("ELEMENT_LOCKED");
  if (command.type === "duplicate-element") {
    const sourceIndex = slide.elements.findIndex((item) => item.id === command.elementId);
    const offset = inches(0.2);
    const duplicate = element.type === "text"
      ? { ...element, id: crypto.randomUUID() as ElementId, contentRef: "decorative" as const, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style }, ...(element.runs ? { runs: element.runs.map((run) => ({ ...run })) } : {}) }
      : element.type === "shape"
        ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } }
        : element.type === "chart"
          ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style, seriesColors: [...element.style.seriesColors] }, contentBlockIds: [...element.contentBlockIds] }
          : element.type === "table"
            ? { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, style: { ...element.style } }
            : { ...element, id: crypto.randomUUID() as ElementId, frame: { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu }, source: { ...element.source } };
    // A copy is user-owned even when its source was generated.
    duplicate.origin = "user";
    slide.elements.splice(sourceIndex + 1, 0, duplicate);
    return;
  }
  if (command.type === "reorder-element") {
    const sourceIndex = slide.elements.findIndex((item) => item.id === command.elementId);
    if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= slide.elements.length) {
      throw new Error("ELEMENT_INDEX_OUT_OF_RANGE");
    }
    if (sourceIndex === command.toIndex) return;
    const [moved] = slide.elements.splice(sourceIndex, 1);
    slide.elements.splice(command.toIndex, 0, moved!);
    return;
  }
  if (command.type === "align-element") {
    const { width, height } = document.pageSize;
    const frame = { ...element.frame };
    if (command.align === "left") frame.x = 0 as Emu;
    if (command.align === "center") frame.x = Math.max(0, Math.round((width - frame.width) / 2)) as Emu;
    if (command.align === "right") frame.x = Math.max(0, width - frame.width) as Emu;
    if (command.align === "top") frame.y = 0 as Emu;
    if (command.align === "middle") frame.y = Math.max(0, Math.round((height - frame.height) / 2)) as Emu;
    if (command.align === "bottom") frame.y = Math.max(0, height - frame.height) as Emu;
    element.frame = frame;
    return;
  }
  if (command.type === "set-text-style") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    assertTextStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-text-emphasis") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    assertTextRunStyle(command.style);
    assertTextRange(element.text, command.start, command.end);
    element.runs = applyTextRun(element.runs, command.start, command.end, command.style);
    return;
  }
  if (command.type === "clear-text-emphasis") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    assertTextRange(element.text, command.start, command.end);
    const remaining = subtractTextRange(element.runs, command.start, command.end);
    element.runs = remaining.length > 0 ? remaining : undefined;
    return;
  }
  if (command.type === "set-shape-style") {
    if (element.type !== "shape") throw new Error("ELEMENT_NOT_SHAPE");
    assertShapeStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-chart-style") {
    if (element.type !== "chart") throw new Error("ELEMENT_NOT_CHART");
    assertChartStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-chart-kind") {
    if (element.type !== "chart") throw new Error("ELEMENT_NOT_CHART");
    if (command.kind !== "column" && command.kind !== "bar" && command.kind !== "line" && command.kind !== "pie") throw new Error("INVALID_CHART_KIND");
    element.kind = command.kind;
    return;
  }
  if (command.type === "set-table-style") {
    if (element.type !== "table") throw new Error("ELEMENT_NOT_TABLE");
    assertTableStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-image-alt-text") {
    if (element.type !== "image") throw new Error("ELEMENT_NOT_IMAGE");
    if (command.altText.length > 500) throw new Error("INVALID_ALT_TEXT");
    element.altText = command.altText;
    return;
  }
  if (command.type === "set-image-crop") {
    if (element.type !== "image") throw new Error("ELEMENT_NOT_IMAGE");
    if (command.crop === null) {
      delete element.crop;
      return;
    }
    assertImageCrop(command.crop);
    element.crop = { ...command.crop };
    return;
  }
  if (command.type === "delete-element") {
    if (element.type === "text") {
      if (element.contentRef === "title") slide.content.title = "";
      if (element.contentRef === "body") {
        slide.content.body = "";
        slide.content.blocks = [];
      }
    }
    slide.elements.splice(slide.elements.findIndex((item) => item.id === command.elementId), 1);
    return;
  }
  if (command.type === "move-element") {
    if (!Number.isSafeInteger(command.x) || !Number.isSafeInteger(command.y)) throw new Error("INVALID_ELEMENT_TRANSFORM");
    element.frame = { ...element.frame, x: command.x, y: command.y };
  }
  if (command.type === "transform-element") {
    const values = [command.frame.x, command.frame.y, command.frame.width, command.frame.height, command.rotationMilliDegree];
    if (!values.every(Number.isSafeInteger) || command.frame.width <= 0 || command.frame.height <= 0) {
      throw new Error("INVALID_ELEMENT_TRANSFORM");
    }
    element.frame = { ...command.frame };
    element.rotationMilliDegree = command.rotationMilliDegree;
  }
  if (command.type === "edit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    element.text = command.text;
    // The fragments address ranges of the old copy, so they would point at the
    // wrong words once the copy changed. Dropping them keeps the emphasis
    // honest instead of highlighting something the reviewer did not select.
    element.runs = undefined;
    const contentBound = element.contentRef === "title" || element.contentRef === "body" || (!element.contentRef && slide.elements[0]?.id === element.id);
    if (element.contentRef === "title" || (!element.contentRef && slide.elements[0]?.id === element.id)) slide.content.title = command.text;
    if (element.contentRef === "body") {
      slide.content.body = command.text;
      slide.content.blocks = command.text.trim()
        ? [{ id: slide.content.blocks?.[0]?.id ?? crypto.randomUUID(), type: "paragraph", text: command.text }]
        : [];
    }
    if (contentBound && slide.content.status === "approved") slide.content.status = "changed";
  }
}
