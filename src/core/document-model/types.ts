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
  | { id: string; type: "process"; items: Array<{ label: string; text: string }> };

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

interface ElementBase {
  id: ElementId;
  frame: RectEmu;
  rotationMilliDegree: number;
  locked: boolean;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  /** Links this visual text back to the semantic content it renders. */
  contentRef?: TextContentRole;
  style: TextElementStyle;
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
  placement?: "content" | "layout-background";
}

export type SlideElement = TextElement | ShapeElement | ImageElement;

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
  schemaVersion: 4;
  title: string;
  pageSize: { width: Emu; height: Emu };
  revisions: Revisions;
  slides: Slide[];
  theme?: DocumentTheme;
  layouts?: SlideLayoutSpec[];
}
