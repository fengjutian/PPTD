import type { SchemaVersion } from "./schema";

export type Brand<T, B extends string> = T & { readonly __brand: B };
export type DocumentId = Brand<string, "DocumentId">;
export type SlideId = Brand<string, "SlideId">;
export type ElementId = Brand<string, "ElementId">;
export type Emu = Brand<number, "Emu">;

export interface RectEmu {
  x: Emu;
  y: Emu;
  width: Emu;
  height: Emu;
}

export interface Revisions {
  document: number;
  content: number;
  design: number;
}

export type ContentStatus = "draft" | "review" | "approved" | "changed" | "needs_review";

export type ContentBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "bullet-list"; items: string[] }
  | { id: string; type: "quote"; text: string; attribution?: string }
  | { id: string; type: "metric"; label: string; value: string }
  | { id: string; type: "timeline"; items: Array<{ label: string; text: string }> }
  | { id: string; type: "comparison"; leftLabel: string; rightLabel: string; leftItems: string[]; rightItems: string[] }
  | { id: string; type: "process"; items: Array<{ label: string; text: string }> }
  | { id: string; type: "table-data"; header: string[]; rows: string[][] };

export interface SlideContent {
  title: string;
  body: string;
  blocks?: ContentBlock[];
  speakerNotes: string;
  status: ContentStatus;
  /** Deterministic hash of title/blocks/body/notes; excludes review status. */
  contentHash?: string;
}

export type TextContentRole = "title" | "body" | "decorative";

/**
 * Where an element came from. Generated elements belong to the layout and may
 * be replaced by a design-only relayout; user elements must survive it.
 * Documents created before provenance existed have no value, so the relayout
 * command falls back to conservative structural inference for them.
 */
export type ElementOrigin = "generated" | "user";

export type TextAlign = "left" | "center" | "right";

/** Presentation-only styling of a text run. Never part of the content hash. */
export interface TextElementStyle {
  fontFamily: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  align: TextAlign;
}

/** Presentation-only styling of a vector shape. Never part of the content hash. */
export interface ShapeElementStyle {
  fill: string;
  stroke: string;
  strokeWidthPt: number;
  radiusPt: number;
}

/** The kind of a native chart. The choice is design, the numbers are content. */
export type ChartKind = "column" | "bar" | "line" | "pie";

/** Presentation-only styling of a native chart. Never part of the content hash. */
export interface ChartElementStyle {
  fontFamily: string;
  fontSizePt: number;
  textColor: string;
  /** Colors of the series, in order. */
  seriesColors: string[];
  showLegend: boolean;
  showValueLabels: boolean;
}

export interface ElementBase {
  id: ElementId;
  frame: RectEmu;
  rotationMilliDegree: number;
  locked: boolean;
  /** Design provenance used by design-only relayout. */
  origin?: ElementOrigin;
}

/**
 * A native chart. The numbers are not stored here: they stay in the metric
 * blocks of the reviewed content, and the chart only points at them. Editing
 * the content therefore changes the chart, and the chart cannot invent a
 * number of its own.
 */
export interface ChartElement extends ElementBase {
  type: "chart";
  /** The metric blocks that carry the categories and the values, in order. */
  contentBlockIds: string[];
  kind: ChartKind;
  style: ChartElementStyle;
}

/**
 * A styled fragment of a text element.
 *
 * The fragment is addressed by its offsets in the text of the element, so the
 * copy itself stays in the content and the run only carries presentation. A
 * run therefore cannot introduce a word the content does not carry.
 */
export interface TextRun {
  /** Offset of the first character of the fragment, in UTF-16 code units. */
  start: number;
  /** Offset behind the last character of the fragment. */
  end: number;
  bold?: boolean;
  color?: string;
  underline?: boolean;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  /** Links this visual text back to the semantic content it renders. */
  contentRef?: TextContentRole;
  style: TextElementStyle;
  /** Presentation-only fragments of the text. Absent means one uniform style. */
  runs?: TextRun[];
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: "rectangle" | "ellipse";
  style: ShapeElementStyle;
}

/**
 * The theme of the template the deck was designed against. It is design state:
 * it never carries reviewed copy, so it may change without touching the content
 * version.
 */
export interface DocumentTheme {
  name: string;
  majorFont: string;
  minorFont: string;
  /** Theme color slots in scheme order, e.g. dk1, lt1, accent1. */
  colors: Array<{ name: string; value: string }>;
}

/**
 * A template layout a slide was designed against. The layout is the unit that
 * becomes a slide master in the exported PPTX, so a deck keeps the structure of
 * its template instead of collapsing into a flat list of shapes.
 */
export interface SlideLayoutSpec {
  id: string;
  name: string;
  backgroundColor?: string;
}

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

/**
 * The part of the source image that is cut away, as a fraction of the source
 * on each side. The remaining region fills the frame of the picture, the same
 * way PowerPoint stores a crop as a source rectangle.
 */
export interface ImageCrop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ImageElement extends ElementBase {
  type: "image";
  source: { kind: "embedded"; dataUrl: string; mimeType: SupportedImageMimeType };
  altText: string;
  /** Crop of the source image. Absent means the whole picture is shown. */
  crop?: ImageCrop;
  /**
   * "layout-background" marks the artwork of the template layout itself. The
   * canvas still paints it, but the exporter moves it into the slide master so
   * the page background is part of the layout and not a loose picture.
   */
  placement?: "content" | "layout-background" | "slide-background";
}

/** Presentation-only styling of a native table. Never part of the content hash. */
export interface TableElementStyle {
  fontFamily: string;
  fontSizePt: number;
  headerFill: string;
  headerTextColor: string;
  bodyTextColor: string;
  borderColor: string;
  /** The first column carries the row names and is set in bold. */
  firstColumnBold: boolean;
}

/**
 * A native table. Like the chart, it holds no data of its own: the cells are
 * read from the table block of the reviewed content.
 */
export interface TableElement extends ElementBase {
  type: "table";
  /** The content block that carries the header and the rows. */
  contentBlockId: string;
  style: TableElementStyle;
}

export type SlideElement = TextElement | ShapeElement | ImageElement | ChartElement | TableElement;

export interface Slide {
  id: SlideId;
  content: SlideContent;
  elements: SlideElement[];
  background: string;
  /** The template layout this slide was designed against. */
  layoutId?: string;
}

export interface PresentationDocument {
  id: DocumentId;
  schemaVersion: SchemaVersion;
  title: string;
  pageSize: { width: Emu; height: Emu };
  revisions: Revisions;
  slides: Slide[];
  theme?: DocumentTheme;
  layouts?: SlideLayoutSpec[];
}
