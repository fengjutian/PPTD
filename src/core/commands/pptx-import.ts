import {
  createDocument,
  createSlide,
  emu,
  refreshContentHashes,
  type ChartKind,
  type ImageCrop,
  type PresentationDocument,
  type ShapeElement,
  type TableMerge,
  type Slide,
  type SlideElement,
  type SlideGroup,
  type SupportedImageMimeType,
  type TextElementStyle,
  type TextRun,
  type TextVerticalAlign,
} from "../document-model";

/** The reader's compatibility report. It is shown in the import dialog, not persisted. */
export interface ImportReport {
  format: "pptx" | "ppt";
  compatibility: "A" | "B" | "C";
  slideCount: number;
  counts: { text: number; image: number; shape: number; table: number; chart?: number };
  unsupported: Array<{ slideIndex: number; kind: string; detail: string }>;
  warnings: string[];
  assets: { extracted: number; skipped: number; bytes: number };
}

/** The neutral structure returned by the Rust Level A reader. */
export interface ImportedDeck {
  title: string;
  pageSize: { width: number; height: number };
  slides: ImportedSlide[];
  theme?: ImportedTheme;
  report: ImportReport;
}

export interface ImportedSlide {
  index: number;
  title?: string;
  body?: string;
  background?: string | null;
  speakerNotes: string;
  elements: ImportedElement[];
  /** Indexes into `elements` for each imported selection group. */
  groups?: number[][];
}

export type ImportedElement =
  | {
      type: "text";
      frame: ImportedFrame;
      rotationMilliDegree: number;
      text: string;
      style: ImportedTextStyle;
      runs: ImportedRun[];
      contentRef: "title" | "body" | null;
    }
  | {
      type: "image";
      frame: ImportedFrame;
      rotationMilliDegree: number;
      dataUrl: string;
      mimeType: string;
      altText: string;
      crop: ImportedCrop | null;
    }
  | {
      type: "shape";
      frame: ImportedFrame;
      rotationMilliDegree: number;
      shape: ShapeElement["shape"];
      fill: string;
      stroke: string;
      strokeWidthPt: number;
      radiusPt: number;
    }
  | {
      type: "line";
      frame: ImportedFrame;
      rotationMilliDegree: number;
      direction: "horizontal" | "vertical" | "diagonal";
      stroke: string;
      strokeWidthPt: number;
      dashed: boolean;
      startArrow: boolean;
      endArrow: boolean;
    }
  | {
      type: "table";
      frame: ImportedFrame;
      rotationMilliDegree: number;
      header: string[];
      rows: string[][];
      merges?: Array<{
        section: "header" | "body";
        row: number;
        column: number;
        rowSpan: number;
        columnSpan: number;
      }>;
    }
  | {
      type: "chart";
      frame: ImportedFrame;
      rotationMilliDegree: number;
      kind: ChartKind;
      categories: string[];
      values: number[];
      colors: string[];
      showLegend: boolean;
      showValues: boolean;
    };

export interface ImportedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImportedTextStyle {
  fontFamily: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  align: "left" | "center" | "right";
  verticalAlign: TextVerticalAlign;
  lineHeight?: number | null;
  bullet: "none" | "dot" | "number";
}

export interface ImportedRun {
  start: number;
  end: number;
  bold: boolean;
  color: string;
  underline: boolean;
}

export interface ImportedCrop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ImportedTheme {
  majorFont?: string | null;
  minorFont?: string | null;
  colors: Array<{ name: string; value: string }>;
}

/**
 * Turns the neutral import structure into the editor's document model.
 *
 * The mapping is deliberately conservative: imported pages start in `review`,
 * every element is user-owned, and anything the reader could not represent
 * faithfully is already listed in `report`. The mapper only converts types and
 * fills the document defaults; it does not invent content or layout.
 */
export function importedDeckToDocument(imported: ImportedDeck): PresentationDocument {
  const document = createDocument();
  document.title = imported.title.trim() || "导入的演示文稿";
  document.pageSize = {
    width: emu(imported.pageSize.width),
    height: emu(imported.pageSize.height),
  };
  document.theme = imported.theme
    ? {
        name: "导入主题",
        majorFont: imported.theme.majorFont ?? "Microsoft YaHei",
        minorFont: imported.theme.minorFont ?? "Microsoft YaHei",
        colors: imported.theme.colors.map((color) => ({ name: color.name, value: color.value })),
      }
    : undefined;
  document.slides = imported.slides.map((slide, index) => mapSlide(slide, index, imported));
  refreshContentHashes(document);
  return document;
}

function themeColor(imported: ImportedDeck, name: string, fallback: string): string {
  return imported.theme?.colors.find((color) => color.name === name)?.value ?? fallback;
}

function mapSlide(slide: ImportedSlide, index: number, imported: ImportedDeck): Slide {
  const base = createSlide(index + 1);
  const background = slide.background ?? themeColor(imported, "lt1", "#FFFFFF");
  const blocks: NonNullable<Slide["content"]["blocks"]> = [];
  const elements: SlideElement[] = slide.elements.map((element) => {
    if (element.type === "table") {
      const merges: TableMerge[] = (element.merges ?? [])
        .filter((merge) => merge.columnSpan > 1 || merge.rowSpan > 1)
        .map((merge) => ({
          section: merge.section,
          row: merge.row,
          column: merge.column,
          rowSpan: merge.rowSpan,
          columnSpan: merge.columnSpan,
        }));
      const block = {
        id: crypto.randomUUID(),
        type: "table-data" as const,
        header: [...element.header],
        rows: element.rows.map((row) => [...row]),
        ...(merges.length > 0 ? { merges } : {}),
      };
      blocks.push(block);
      return {
        id: crypto.randomUUID() as never,
        type: "table" as const,
        contentBlockId: block.id,
        frame: frameOf(element.frame),
        rotationMilliDegree: element.rotationMilliDegree,
        locked: false,
        origin: "user" as const,
        style: {
          fontFamily: imported.theme?.minorFont ?? "Microsoft YaHei",
          fontSizePt: 14,
          headerFill: themeColor(imported, "accent1", "#3366CC"),
          headerTextColor: "#FFFFFF",
          bodyTextColor: themeColor(imported, "tx1", "#17181c"),
          borderColor: "#D9DEE5",
          firstColumnBold: true,
          headerBold: true,
          bandingFill: "#F5F7FA",
          cellPaddingPt: 5,
          borderWidthPt: 0.75,
        },
      };
    }
    if (element.type === "chart") {
      const contentBlockIds = element.categories.map((category, categoryIndex) => {
        const block = {
          id: crypto.randomUUID(),
          type: "metric" as const,
          label: category || `分类 ${categoryIndex + 1}`,
          value: chartValue(element.values[categoryIndex] ?? 0),
        };
        blocks.push(block);
        return block.id;
      });
      return {
        id: crypto.randomUUID() as never,
        type: "chart" as const,
        contentBlockIds,
        kind: element.kind,
        frame: frameOf(element.frame),
        rotationMilliDegree: element.rotationMilliDegree,
        locked: false,
        origin: "user" as const,
        style: {
          fontFamily: imported.theme?.minorFont ?? "Microsoft YaHei",
          fontSizePt: 12,
          textColor: themeColor(imported, "tx1", "#17181c"),
          seriesColors: element.colors.length > 0 ? element.colors : [themeColor(imported, "accent1", "#3366CC")],
          showLegend: element.showLegend,
          showValueLabels: element.showValues,
        },
      };
    }
    if (element.type === "text") {
      const style: TextElementStyle = {
        fontFamily: element.style.fontFamily,
        fontSizePt: element.style.fontSizePt,
        color: element.style.color,
        bold: element.style.bold,
        align: element.style.align,
        italic: element.style.italic,
        underline: element.style.underline,
        strikethrough: element.style.strikethrough,
        verticalAlign: element.style.verticalAlign,
        ...(element.style.lineHeight ? { lineHeight: element.style.lineHeight } : {}),
        bullet: element.style.bullet,
        indentLevel: 0,
      };
      return {
        id: crypto.randomUUID() as never,
        type: "text" as const,
        text: element.text,
        ...(element.contentRef ? { contentRef: element.contentRef } : {}),
        frame: frameOf(element.frame),
        rotationMilliDegree: element.rotationMilliDegree,
        locked: false,
        origin: "user" as const,
        style,
        ...(element.runs.length > 0
          ? { runs: element.runs.map((run) => runOf(run)).filter((run): run is TextRun => run !== undefined) }
          : {}),
      };
    }
    if (element.type === "image") {
      return {
        id: crypto.randomUUID() as never,
        type: "image" as const,
        source: {
          kind: "embedded" as const,
          dataUrl: element.dataUrl,
          mimeType: element.mimeType as SupportedImageMimeType,
        },
        frame: frameOf(element.frame),
        rotationMilliDegree: element.rotationMilliDegree,
        locked: false,
        origin: "user" as const,
        altText: element.altText,
        ...(element.crop ? { crop: cropOf(element.crop) } : {}),
      };
    }
    if (element.type === "line") {
      return {
        id: crypto.randomUUID() as never,
        type: "line" as const,
        direction: element.direction,
        frame: frameOf(element.frame),
        rotationMilliDegree: element.rotationMilliDegree,
        locked: false,
        origin: "user" as const,
        style: {
          stroke: element.stroke,
          strokeWidthPt: element.strokeWidthPt,
          dashed: element.dashed,
          startArrow: element.startArrow ? "arrow" : "none",
          endArrow: element.endArrow ? "arrow" : "none",
        },
      };
    }
    const shape = shapeOf(element);
    return {
      id: crypto.randomUUID() as never,
      type: "shape" as const,
      shape,
      frame: frameOf(element.frame),
      rotationMilliDegree: element.rotationMilliDegree,
      locked: false,
      origin: "user" as const,
      style: {
        fill: element.fill,
        stroke: element.stroke,
        strokeWidthPt: element.strokeWidthPt,
        radiusPt: element.radiusPt,
      },
    };
  });

  const titleElement = elements.find(
    (element): element is Extract<SlideElement, { type: "text" }> =>
      element.type === "text" && element.contentRef === "title",
  );
  const bodyElement = elements.find(
    (element): element is Extract<SlideElement, { type: "text" }> =>
      element.type === "text" && element.contentRef === "body",
  );
  const content = {
    title: slide.title?.trim() || titleElement?.text.trim() || `第 ${index + 1} 页`,
    body: slide.body ?? bodyElement?.text ?? "",
    ...(blocks.length > 0 ? { blocks } : {}),
    speakerNotes: slide.speakerNotes,
    status: "review" as const,
  };
  const groups: SlideGroup[] = (slide.groups ?? [])
    .map((indexes) => [...new Set(indexes)].map((elementIndex) => elements[elementIndex]?.id))
    .filter((ids): ids is NonNullable<(typeof ids)[number]>[] => ids.length >= 2 && ids.every(Boolean))
    .map((elementIds) => ({ id: crypto.randomUUID(), elementIds }));
  return {
    ...base,
    background,
    content,
    elements,
    ...(groups.length > 0 ? { groups } : {}),
    layoutId: undefined,
  };
}

function chartValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function frameOf(frame: ImportedFrame) {
  return {
    x: emu(frame.x),
    y: emu(frame.y),
    width: emu(Math.max(1, frame.width)),
    height: emu(Math.max(1, frame.height)),
  };
}

function runOf(run: ImportedRun): TextRun | undefined {
  if (!Number.isInteger(run.start) || !Number.isInteger(run.end) || run.start < 0 || run.end <= run.start) {
    return undefined;
  }
  return {
    start: run.start,
    end: run.end,
    ...(run.bold ? { bold: true } : {}),
    ...(run.color ? { color: run.color } : {}),
    ...(run.underline ? { underline: true } : {}),
  };
}

function cropOf(crop: ImportedCrop): ImageCrop {
  return {
    top: clampFraction(crop.top),
    bottom: clampFraction(crop.bottom),
    left: clampFraction(crop.left),
    right: clampFraction(crop.right),
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.99, Math.max(0, value));
}

function shapeOf(element: Extract<ImportedElement, { type: "shape" }>): ShapeElement["shape"] {
  // The Rust reader already normalized unknown presets to "rectangle" and
  // rounded rectangles to a rectangle with a radius; the value is trusted.
  return element.shape;
}
