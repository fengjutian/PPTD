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
  style: { fontFamily: string; fontSizePt: number; color: string; bold: boolean; align: "left" | "center" | "right" };
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: "rectangle" | "ellipse";
  style: { fill: string; stroke: string; strokeWidthPt: number; radiusPt: number };
}

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageElement extends ElementBase {
  type: "image";
  source: { kind: "embedded"; dataUrl: string; mimeType: SupportedImageMimeType };
  altText: string;
}

export type SlideElement = TextElement | ShapeElement | ImageElement;

export interface Slide {
  id: SlideId;
  content: SlideContent;
  elements: SlideElement[];
  background: string;
}

export interface PresentationDocument {
  id: DocumentId;
  schemaVersion: 2;
  title: string;
  pageSize: { width: Emu; height: Emu };
  revisions: Revisions;
  slides: Slide[];
}
