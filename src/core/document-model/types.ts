import type { SchemaVersion } from "./schema";
import type { BuiltinIconName } from "./icons";
import type { LayoutBinding, LayoutDefinition } from "../layout/tree";

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
  | {
      id: string;
      type: "chart";
      kind: "column" | "bar" | "line" | "pie";
      categories: string[];
      /** Single-series shorthand. Ignored when `series` is present. */
      values?: number[];
      /** One or more named series. Each must match `categories` in length. */
      series?: Array<{ name: string; values: number[] }>;
      unit?: string;
    }
  | { id: string; type: "timeline"; items: Array<{ label: string; text: string }> }
  | { id: string; type: "comparison"; leftLabel: string; rightLabel: string; leftItems: string[]; rightItems: string[] }
  | { id: string; type: "process"; items: Array<{ label: string; text: string }> }
  | {
      id: string;
      type: "table-data";
      header: string[];
      rows: string[][];
      /** Spans of merged cells. A covered cell is not rendered or exported. */
      merges?: TableMerge[];
    };

/** One merged region of a reviewed table. */
export interface TableMerge {
  section: "header" | "body";
  /** Row inside the section; the header has exactly one row. */
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

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

/** Where the text sits vertically inside its frame. */
export type TextVerticalAlign = "top" | "middle" | "bottom";

/**
 * The paragraph marker of a text box.
 *
 * A marker belongs to the whole text box in this version: the copy is a plain
 * string, so there is no per-paragraph structure to hang a marker on. Every
 * line therefore gets the same marker, and the number of a numbered list counts
 * up per line.
 */
export type TextBullet = "none" | "dot" | "number";

export interface TextTabStop {
  /** Position from the paragraph origin, in points. */
  positionPt: number;
  alignment: "left" | "center" | "right" | "decimal";
}

/** Presentation-only styling of a text run. Never part of the content hash. */
export interface TextElementStyle {
  fontFamily: string;
  fontSizePt: number;
  color: string;
  bold: boolean;
  align: TextAlign;
  /** Tracking between characters, in points. Absent keeps the font's default. */
  letterSpacingPt?: number;
  /** Line height as a multiple of the font size. Absent keeps the renderer's default. */
  lineHeight?: number;
  /** Space before/after each paragraph, in points. */
  paragraphSpaceBeforePt?: number;
  paragraphSpaceAfterPt?: number;
  /** Native paragraph tab stops shared by the text box in the current model. */
  tabStops?: TextTabStop[];
  /** Absent means upright. */
  italic?: boolean;
  /** Absent means no underline. A run may override this for its own range. */
  underline?: boolean;
  /** Absent means no strike line. */
  strikethrough?: boolean;
  /** Absent means top, which is where the canvas has always drawn text. */
  verticalAlign?: TextVerticalAlign;
  /** Absent means no marker, so existing documents keep their plain paragraphs. */
  bullet?: TextBullet;
  /** Indent level of the whole text box, 0–8. Absent means no indent. */
  indentLevel?: number;
}

/** One stop of a native linear gradient. */
export interface ShapeFillGradientStop {
  /** Position along the gradient, 0–1. */
  offset: number;
  color: string;
  /** 0–100, the PowerPoint "Fill > Transparency" value. */
  transparency?: number;
}

/**
 * A native linear gradient of a vector shape.
 *
 * `angleDeg` uses the DrawingML convention: 0 points right, 90 points down.
 * `fill` stays the solid fallback for renderers and for a failed export patch.
 */
export interface ShapeFillGradient {
  angleDeg: number;
  stops: ShapeFillGradientStop[];
}

/** Presentation-only styling of a vector shape. Never part of the content hash. */
export interface ShapeElementStyle {
  fill: string;
  stroke: string;
  strokeWidthPt: number;
  radiusPt: number;
  fillGradient?: ShapeFillGradient;
  /**
   * How far the shape sits above the page.
   *
   * A token, not a blur value: the recipe says "this is a raised card", the
   * design system decides how far that is, and the exporter writes the same
   * numbers the canvas preview uses. Absent means flat — an older document
   * renders exactly as before.
   */
  shadow?: ShapeShadowToken;
}

/**
 * The shadow levels a shape may use.
 *
 * Three, because a deck needs three: a card that barely leaves the page, a
 * plate that floats over a picture, and one emphasised card. More levels would
 * be values a recipe could pick arbitrarily, which is what the token exists to
 * prevent.
 */
export type ShapeShadowToken = "card" | "raised" | "emphasis";

/**
 * 线条的方向。
 *
 * 线条是独立的元素类型，不是"很扁的矩形"：它的填充没有意义，箭头端点是
 * 样式的一部分，导出时也必须写成原生线条而不是矩形。
 */
export type LineDirection = "horizontal" | "vertical" | "diagonal";

/** 线条某一端是否有箭头。 */
export type LineEnd = "none" | "arrow";

/** Presentation-only styling of a line. Never part of the content hash. */
export interface LineElementStyle {
  stroke: string;
  strokeWidthPt: number;
  /** 起点箭头。 */
  startArrow: LineEnd;
  /** 终点箭头。 */
  endArrow: LineEnd;
  /** 是否是虚线。 */
  dashed: boolean;
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

/** The longest layer name the editor accepts, in UTF-16 code units. */
export const ELEMENT_NAME_MAX_LENGTH = 80;

export interface ElementBase {
  id: ElementId;
  frame: RectEmu;
  rotationMilliDegree: number;
  locked: boolean;
  /**
   * User-facing layer name. Absent means the name is derived from the object
   * (its text, alternative text or kind). It is editor metadata: it never
   * changes the copy, the content hash or the exported geometry.
   */
  name?: string;
  /**
   * Editor-only visibility. A hidden object stays in the document and in the
   * layer list, but is not drawn on the canvas or in previews and is left out of
   * the exported PPTX, which the export report states.
   */
  hidden?: boolean;
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
  /** External link preserved for this fragment. Only http(s) and mailto are accepted. */
  hyperlinkUrl?: string;
}

/**
 * The reviewed block a generated text renders, and which of its fields.
 *
 * A stat card draws a metric as two text boxes. Without this link the card is
 * just two strings: editing the number would change the picture while the
 * reviewed metric (and any chart that reads it) kept the old value.
 */
export interface TextBlockRef {
  blockId: string;
  field: "label" | "value";
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  /** Links this visual text back to the semantic content it renders. */
  contentRef?: TextContentRole;
  /** Links a generated card text to the content block it reproduces. */
  contentBlockRef?: TextBlockRef;
  /**
   * The slice of the bound field this element renders.
   *
   * A cover splits one reviewed title into an eyebrow and a headline: both are
   * views of the same field, and typing in one splices its text back into that
   * range instead of replacing the whole title. Offsets are UTF-16, the same
   * units `String.prototype.slice` uses. Absent means the element renders the
   * whole field, which is every document that predates the split.
   */
  contentRange?: { start: number; end: number };
  style: TextElementStyle;
  /** Presentation-only fragments of the text. Absent means one uniform style. */
  runs?: TextRun[];
}

/** The preset geometries the canvas, importer and exporter share. */
export type ShapeKind =
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "chevron"
  | "arrow"
  | "star"
  | "parallelogram"
  | "trapezoid";

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "chevron",
  "arrow",
  "star",
  "parallelogram",
  "trapezoid",
];

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: ShapeKind;
  style: ShapeElementStyle;
}

/**
 * A straight line.
 *
 * A line is its own element kind rather than a very flat rectangle: it has no
 * fill, its arrow heads are part of its style, and the exporter has to write a
 * native line object so the result stays editable in PowerPoint.
 */
export interface LineElement extends ElementBase {
  type: "line";
  /** Which way the line runs inside its frame. */
  direction: LineDirection;
  style: LineElementStyle;
}

/**
 * One level of the type scale a theme declares.
 *
 * The generator reads these instead of hard-coded point sizes, so a template or
 * a built-in theme can own its own hierarchy: a 26pt title and a 16pt body keep
 * their relation without every layout branch repeating the numbers.
 */
export interface TextStyleToken {
  fontSizePt: number;
  bold?: boolean;
  color?: string;
  /** Multiple of the font size. Absent means the renderer's default leading. */
  lineHeight?: number;
  letterSpacingPt?: number;
}

/** The named levels of a theme's type scale. */
export interface DocumentTextStyles {
  display?: TextStyleToken;
  title?: TextStyleToken;
  subtitle?: TextStyleToken;
  body?: TextStyleToken;
  caption?: TextStyleToken;
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
  /**
   * A second face for display-size type only.
   *
   * A theme that omits it keeps using `majorFont` for titles, so a template
   * without a display face is rendered exactly as before. It is design state,
   * never learned from the content, and the taste lint allows at most one such
   * family — confined to text at title size or larger.
   */
  displayFont?: string;
  /** Theme color slots in scheme order, e.g. dk1, lt1, accent1. */
  colors: Array<{ name: string; value: string }>;
  /** Named type levels. Absent levels fall back to the generator defaults. */
  textStyles?: DocumentTextStyles;
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
  /**
   * What the layout's placeholders can hold.
   *
   * The regions themselves describe one rendering of the template and are not
   * persisted; their meaning for composition is. A page that needs a picture
   * cannot use a layout without a picture placeholder, and the check needs that
   * fact at export time, long after the analysis is gone.
   */
  capabilities?: SlideLayoutCapabilities;
}

export interface SlideLayoutCapabilities {
  hasTitle: boolean;
  hasBody: boolean;
  hasImage: boolean;
  /** Body columns the layout offers: a comparison page needs two. */
  columns: number;
  /** No body placeholder: a cover, a section divider, or a full-bleed plate. */
  free: boolean;
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

export type AssetVerification = "verified" | "pending" | "user";

/**
 * Where a picture came from.
 *
 * Design state, not content: it never enters the content hash. "verified" means
 * the user supplied a source URL and a licence; without both, the picture stays
 * "pending" and must not be presented as an official asset.
 */
export interface AssetProvenance {
  verification: AssetVerification;
  sourceUrl?: string;
  license?: string;
  /** ISO timestamp of the last verification edit. */
  checkedAt?: string;
  /** FNV-1a fingerprint of the embedded data URL, to detect a replaced picture. */
  contentHash?: string;
}

/**
 * The shape a picture is clipped into.
 *
 * Two, because they are the two a deck actually uses: a soft-cornered plate and
 * a circle for a face or a badge. Both are native PowerPoint geometries, so the
 * picture stays replaceable instead of being baked into pixels (ADR 0102).
 */
export type ImageFrameShape = "roundRect" | "ellipse";

/**
 * A two-colour tone applied to a picture.
 *
 * The picture's own colours are mapped onto the two ends: shadows become
 * `dark`, highlights become `light`. On a dark page this is what makes a
 * photograph belong to the deck instead of sitting on it as a bright rectangle.
 *
 * Two colours and no strength, because that is what the OOXML `duotone` effect
 * takes. A strength would have to be faked with a second pass the renderer does
 * not have, and a strength that silently does nothing is worse than none.
 */
export interface ImageTone {
  /** The colour shadows are mapped to. */
  dark: string;
  /** The colour highlights are mapped to. */
  light: string;
}

export interface ImageElement extends ElementBase {
  type: "image";
  source: { kind: "embedded"; dataUrl: string; mimeType: SupportedImageMimeType };
  altText: string;
  /** Crop of the source image. Absent means the whole picture is shown. */
  crop?: ImageCrop;
  /** A two-colour mapping, drawn by the canvas and written as `a:duotone`. */
  tone?: ImageTone;
  /**
   * The geometry the picture is clipped into. Absent means the plain frame.
   *
   * A frame shape turns the exported picture into a shape filled by the image;
   * the crop is applied inside the fill, so the two compose.
   */
  frameShape?: ImageFrameShape;
  /** Source and licence of the picture. Absent on imported or unlabelled images. */
  provenance?: AssetProvenance;
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
  /** Alternating body row fill. Absent keeps every body row flat. */
  bandingFill?: string;
  /** Header cells are bold. Defaults to true when absent. */
  headerBold?: boolean;
  /** Cell padding on each side, in points. */
  cellPaddingPt?: number;
  /** Border width, in points. */
  borderWidthPt?: number;
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

export type SlideElement =
  TextElement | ShapeElement | LineElement | IconElement | ImageElement | ChartElement | TableElement;

export type AnimationEffect =
  "appear" | "fade" | "fly-in" | "float-in" | "split" | "wipe" | "zoom" | "pulse" | "disappear";
export type AnimationPhase = "entrance" | "emphasis" | "exit";
export type AnimationStart = "on-click" | "with-previous" | "after-previous";
export type AnimationDirection = "none" | "left" | "right" | "top" | "bottom";

/** A design-only animation attached to one stable page element. */
export interface SlideAnimation {
  id: string;
  elementId: ElementId;
  effect: AnimationEffect;
  phase: AnimationPhase;
  start: AnimationStart;
  durationMs: number;
  delayMs: number;
  direction: AnimationDirection;
}

/**
 * A page transition: what happens between two slides, not to an object.
 *
 * It is design state like an animation. The absence of the field means the page
 * has no transition, so old projects need no migration value for "none".
 */
export type SlideTransitionKind = "fade" | "push" | "wipe" | "split";
export type SlideTransitionDirection = "left" | "right" | "up" | "down";
export type SlideTransitionSpeed = "fast" | "medium" | "slow";

export interface SlideTransition {
  kind: SlideTransitionKind;
  speed: SlideTransitionSpeed;
  /** Only meaningful for push, wipe and split. Absent means left. */
  direction?: SlideTransitionDirection;
}

/** Presentation-only styling of a built-in icon. */
export interface IconElementStyle {
  color: string;
  /** Stroke width on the 24×24 grid. */
  strokeWidth?: number;
}

/**
 * A line icon from the built-in set.
 *
 * An icon is an element of its own rather than a picture: the canvas draws it
 * as vectors and the export writes an SVG picture, so the shape stays crisp at
 * any size. It carries only a name, so a corrupt file cannot smuggle arbitrary
 * path data into the renderer.
 */
export interface IconElement extends ElementBase {
  type: "icon";
  name: BuiltinIconName;
  style: IconElementStyle;
}

/**
 * A selection group on one page.
 *
 * The group is design metadata, not a nested element: the objects stay in
 * `slide.elements` so every renderer, exporter and content path keeps working.
 * Selecting any member selects the whole group, which is what makes moving,
 * aligning and deleting a group feel like one object. Groups are flattened on
 * export; the export report says so.
 */
export interface SlideGroup {
  id: string;
  elementIds: ElementId[];
}

export interface Slide {
  id: SlideId;
  content: SlideContent;
  elements: SlideElement[];
  animations?: SlideAnimation[];
  /** Transition into this page when presenting. */
  transition?: SlideTransition;
  groups?: SlideGroup[];
  background: string;
  /** The template layout this slide was designed against. */
  layoutId?: string;
  /** Declarative low-code layout instance. It is design metadata only. */
  layoutBinding?: LayoutBinding;
}

/** The reviewed content of one page at the moment it was confirmed. */
export interface ContentVersionSlide {
  slideId: SlideId;
  title: string;
  body: string;
  blocks?: ContentBlock[];
  speakerNotes: string;
}

/**
 * A confirmed snapshot of the whole deck's content.
 *
 * It deliberately stores no elements, styles, backgrounds or status: a design
 * change must not create a content version, and comparing versions should not
 * report font or position changes as content review work.
 */
export interface ContentVersionDesignSlide {
  slideId: SlideId;
  background: string;
  elements: SlideElement[];
  animations?: SlideAnimation[];
  transition?: SlideTransition;
  groups?: SlideGroup[];
  layoutId?: string;
}

/** The design state at the moment a content version was confirmed. */
export interface ContentVersionDesign {
  pageSize: { width: Emu; height: Emu };
  theme?: DocumentTheme;
  layouts?: SlideLayoutSpec[];
  /** Template target of the same moment; absent in versions created before v22. */
  templateStyle?: TemplateReviewTarget;
  slides: ContentVersionDesignSlide[];
}

export interface ContentVersion {
  id: string;
  /** Content revision this snapshot was confirmed at. */
  contentRevision: number;
  /** Document revision this snapshot was confirmed at. */
  documentRevision: number;
  slides: ContentVersionSlide[];
  /** Design snapshot of the same moment; absent in versions created before v20. */
  design?: ContentVersionDesign;
}

/** A persisted summary of one visual review, so it survives reopening. */
export interface ReviewTrace {
  id: string;
  /** ISO timestamp of the review. */
  createdAt: string;
  overallScore: number;
  /** Template adherence of the same review, when a template target existed. */
  templateFitScore?: number;
  /** Display name and source fingerprint of the template used for the review. */
  templateName?: string;
  templateHash?: string;
  /** Template findings by stable code, e.g. { "template-title-axis": 2 }. */
  templateFitCounts?: Record<string, number>;
  issueCount: number;
  slides: Array<{ slideIndex: number; overallScore: number }>;
}

/**
 * The persisted vocabulary of a design direction.
 *
 * It mirrors `core/design/deck-concept.ts` but lives here because the document
 * model is the lower layer. The command layer rejects a preset the renderer
 * cannot draw, and `designDirections` is design state: it never enters the
 * content hash or the content revision.
 */
export type DesignDirectionPreset = "editorial" | "documentary" | "paper" | "instrument";
export type DesignDirectionImagery = "none" | "hero" | "band" | "side" | "texture";
export type DesignDirectionContrast = "calm" | "strong" | "dramatic";

export const MAX_DESIGN_DIRECTIONS = 20;

export interface DesignDirectionProposal {
  id: string;
  preset: DesignDirectionPreset;
  name: string;
  idea: string;
  rationale: string;
  typeContrast: DesignDirectionContrast;
  imagery: DesignDirectionImagery;
  /** The pages rendered for the user, with the content they were rendered from. */
  previewPages: Array<{ index: number; contentFingerprint: string }>;
}

/** The user's direction decision, recorded with the design it produced. */
export interface DesignDirectionRecord {
  id: string;
  createdAt: string;
  contentRevision: number;
  contentFingerprint: string;
  proposals: DesignDirectionProposal[];
  selectedProposalId: string;
  selectedBy: "user" | "fallback";
  /** The user's own words when they chose or rejected a direction. */
  userWords?: string;
  regenerations: number;
  promptVersion: string;
  model?: string;
}

/**
 * A grid compiled from the uploaded template.
 *
 * It is design state: it never contains reviewed copy and therefore does not
 * enter the content hash. Persisting it lets a reopened project keep using the
 * template as the review target without re-running template analysis.
 */
export interface TemplateGrid {
  left: number;
  right: number;
  top: number;
  bottom: number;
  titleX: number;
  titleY: number;
  titleWidth: number;
  titleHeight: number;
  bodyTop: number;
  bodyBottom: number;
}

export interface TemplateLayoutTarget {
  name: string;
  grid: TemplateGrid;
  titleSizePt?: number;
  bodySizePt?: number;
  /** Ink the template assigned to its title/body placeholder. */
  titleInk?: string;
  bodyInk?: string;
  /** Paragraph alignment the template assigned to the placeholder. */
  titleAlign?: "left" | "center" | "right";
  bodyAlign?: "left" | "center" | "right";
  /** Line spacing multiple from the template placeholder. */
  titleLineHeight?: number;
  bodyLineHeight?: number;
  /** Cover, section, quote and image-led pages may break the content grid. */
  freeComposition: boolean;
}

export interface TemplateTolerances {
  axis: number;
  axisY: number;
  margin: number;
  fontSizePt: number;
  colorChannel: number;
}

/** The measurable target derived from an uploaded template. */
export interface TemplateReviewTarget {
  name: string;
  /** SHA-256 of the source template file, when the target came from one. */
  templateHash?: string;
  page: { widthEmu: number; heightEmu: number };
  grid: TemplateGrid;
  layouts: TemplateLayoutTarget[];
  palette: string[];
  majorFont?: string;
  minorFont?: string;
  titleInk?: string;
  bodyInk?: string;
  titleAlign?: "left" | "center" | "right";
  bodyAlign?: "left" | "center" | "right";
  titleLineHeight?: number;
  bodyLineHeight?: number;
  titleSizePt?: number;
  bodySizePt?: number;
  alignment: "left-grid" | "centered-grid";
  confidence: "high" | "low";
  minimumFit: number;
  tolerances: TemplateTolerances;
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
  /** Reusable declarative layout skeletons referenced by slide bindings. */
  layoutDefinitions?: LayoutDefinition[];
  /**
   * Template target used by visual review. Design state: editing it never
   * increments the content revision or invalidates reviewed copy.
   */
  templateStyle?: TemplateReviewTarget;
  /** Confirmed content snapshots, oldest first. Capped by the document model. */
  contentVersions?: ContentVersion[];
  /** Visual review summaries, oldest first. Capped by the document model. */
  reviewTraces?: ReviewTrace[];
  /** Direction decisions, oldest first. Capped by MAX_DESIGN_DIRECTIONS. */
  designDirections?: DesignDirectionRecord[];
}
