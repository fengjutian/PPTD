import type {
  AssetProvenance,
  BuiltinIconName,
  ChartElementStyle,
  ChartKind,
  DocumentTextStyles,
  DesignDirectionRecord,
  ElementId,
  Emu,
  ImageCrop,
  LineDirection,
  LineElementStyle,
  RectEmu,
  ShapeElementStyle,
  ShapeKind,
  SlideAnimation,
  SlideElement,
  SlideId,
  SupportedImageMimeType,
  IconElementStyle,
  TableElementStyle,
  SlideTransition,
  TemplateReviewTarget,
  TextElementStyle,
} from "../document-model";
import type { DeckConcept } from "../design/deck-concept";
import type { StyleConstraint } from "../design/style-profiles";
import type { DesignLayoutTrace } from "../layout/design-compiler";
import type { LayoutBinding, LayoutDefinition } from "../layout/tree";
import type { AiVisualAssetRole } from "./visual-asset";
import { type TextRunStyle } from "../document-model";

import { type ArrangeHorizontal, type ArrangeVertical } from "./arrange";

import {
  type AiSlideDesign,
  type AiTemplateDecoration,
  type AiTemplateLayout,
  type BackgroundRhythm,
} from "./template-layouts";

import type { TextReplaceEdit } from "./text-search";

export type ChangeDomain = "content" | "design" | "both";

export type AiContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "metric"; label: string; value: string }
  | {
      type: "chart";
      kind: "column" | "bar" | "line" | "pie";
      categories: string[];
      values?: number[];
      series?: Array<{ name: string; values: number[] }>;
      unit?: string;
    }
  | { type: "timeline"; items: Array<{ label: string; text: string }> }
  | { type: "comparison"; leftLabel: string; rightLabel: string; leftItems: string[]; rightItems: string[] }
  | { type: "process"; items: Array<{ label: string; text: string }> }
  | { type: "table-data"; header: string[]; rows: string[][] };

export interface AiSlideDraft {
  title: string;
  body: string;
  speakerNotes: string;
  blocks?: AiContentBlock[];
  plan?: {
    visualIntent:
      | "hero"
      | "quote"
      | "timeline"
      | "comparison"
      | "process"
      | "data-chart"
      | "image-story"
      | "summary"
      | "structured-text";
  };
}

export interface AiVisualAssetData {
  /** 页面索引。 */
  slideIndex: number;
  /** 图片数据。 */
  dataUrl: string;
  /** 图片类型。 */
  mimeType: SupportedImageMimeType;
  /** 图片的原始像素宽。 */
  naturalWidth: number;
  /** 图片的原始像素高。 */
  naturalHeight: number;
  /** 替代文字，导出与无障碍读取都用它。 */
  altText: string;
}

export interface AiTemplateTheme {
  name?: string;
  majorFont?: string;
  minorFont?: string;
  colors?: Array<{ name: string; value: string }>;
  /** The type scale of the theme, when the template or preset declares one. */
  textStyles?: DocumentTextStyles;
}

export type HorizontalAlign = "left" | "center" | "right";

export type VerticalAlign = "top" | "middle" | "bottom";

export type AlignTarget = HorizontalAlign | VerticalAlign | { horizontal?: HorizontalAlign; vertical?: VerticalAlign };

export type DocumentCommand =
  | { type: "add-slide" }
  | { type: "rename-document"; title: string }
  | {
      type: "set-page-size";
      pageSize: { width: Emu; height: Emu };
      /**
       * Explicit opt-in: scale every object with the page.
       *
       * Absent keeps the default of ADR 0048 — change the paper, leave the
       * composition alone. The user asks for this by ticking "缩放对象" rather
       * than the command deciding for them.
       */
      scaleObjects?: boolean;
    }
  | { type: "apply-ai-draft"; title: string; slides: AiSlideDraft[] }
  | {
      type: "apply-ai-designed-draft";
      title: string;
      slides: AiSlideDraft[];
      designs: AiSlideDesign[];
      /**
       * The deck-level design direction. Optional: a design without a concept
       * keeps the legacy composition path byte-for-byte.
       */
      designConcept?: DeckConcept;
      /** Ephemeral design-system bounds consumed while compiling editable objects. */
      styleConstraint?: StyleConstraint;
      /** Ephemeral Workbench evidence copied into compile reports, never persisted. */
      layoutTrace?: DesignLayoutTrace;
      /**
       * The direction decision that produced this design. It is written with the
       * design in one transaction, so undo removes both and the content hash is
       * untouched. The fingerprint must still match the reviewed content.
       */
      designDirection?: DesignDirectionRecord;
      pageSize?: { width: Emu; height: Emu };
      fontFamily?: string;
      bodyFontFamily?: string;
      templateDecorations?: AiTemplateDecoration[];
      templateLayouts?: AiTemplateLayout[];
      templateTheme?: AiTemplateTheme;
      backgroundRhythm?: BackgroundRhythm;
      visualAssets?: AiVisualAssetData[];
      themePresetId?: string;
      /**
       * The page's place in the deck, when this command renders only one page
       * of a larger document (relayout). Without it the footer counts the
       * one-page command, so a relaid-out page loses its "03 / 12".
       */
      pageContext?: { index: number; total: number; sectionLabel?: string };
    }
  | { type: "relayout-slide"; slideId: SlideId }
  | { type: "apply-slide-layout"; slideId: SlideId; layoutId: string }
  | {
      type: "apply-layout-plan";
      /** Optimistic guard captured when editing or when an AI proposal was built. */
      expectedRevision: { document: number; content: number; design: number };
      definitions: LayoutDefinition[];
      slides: Array<{
        slideId: SlideId;
        binding: LayoutBinding | null;
        elementFrames?: Array<{ elementId: ElementId; frame: RectEmu }>;
      }>;
    }
  | { type: "duplicate-slide"; slideId: SlideId }
  | { type: "delete-slide"; slideId: SlideId }
  | { type: "move-slide"; slideId: SlideId; toIndex: number }
  | { type: "set-slide"; slideId: SlideId }
  | { type: "set-slide-background"; slideId: SlideId; background: string }
  | { type: "set-slide-background-image"; slideId: SlideId; dataUrl: string; mimeType: SupportedImageMimeType }
  | { type: "remove-slide-background-image"; slideId: SlideId }
  | { type: "add-text"; slideId: SlideId }
  | {
      type: "add-image";
      slideId: SlideId;
      dataUrl: string;
      mimeType: SupportedImageMimeType;
      altText: string;
      naturalWidth?: number;
      naturalHeight?: number;
      role?: AiVisualAssetRole;
    }
  | { type: "add-shape"; slideId: SlideId; shape: ShapeKind }
  | { type: "add-line"; slideId: SlideId; direction: LineDirection }
  | { type: "add-icon"; slideId: SlideId; name: BuiltinIconName }
  | { type: "add-table"; slideId: SlideId; columns: number; rows: number }
  | { type: "add-chart"; slideId: SlideId; kind: ChartKind }
  | { type: "duplicate-element"; slideId: SlideId; elementId: ElementId }
  | { type: "duplicate-elements"; slideId: SlideId; elementIds: ElementId[] }
  | { type: "delete-element"; slideId: SlideId; elementId: ElementId }
  | { type: "delete-elements"; slideId: SlideId; elementIds: ElementId[] }
  | { type: "set-element-lock"; slideId: SlideId; elementId: ElementId; locked: boolean }
  | { type: "set-elements-lock"; slideId: SlideId; elementIds: ElementId[]; locked: boolean }
  | {
      type: "rename-element";
      slideId: SlideId;
      elementId: ElementId;
      /** Empty or whitespace removes the custom name and restores the derived one. */
      name: string;
    }
  | { type: "set-elements-hidden"; slideId: SlideId; elementIds: ElementId[]; hidden: boolean }
  | { type: "group-elements"; slideId: SlideId; elementIds: ElementId[] }
  | { type: "ungroup-elements"; slideId: SlideId; groupId: string }
  | { type: "reorder-element"; slideId: SlideId; elementId: ElementId; toIndex: number }
  | {
      type: "reorder-elements";
      slideId: SlideId;
      /**
       * The objects that move as one block, for example a multi-selection or a
       * layer row dragged together with its group. Their relative z-order is
       * kept; the order of this array itself is not meaningful.
       */
      elementIds: ElementId[];
      /**
       * Insertion index in the array that remains after the block is removed,
       * so `0` is the bottom of the page and `remaining.length` the top. The
       * panel converts its top-down drop position into this index.
       */
      toIndex: number;
    }
  | {
      type: "add-animation";
      slideId: SlideId;
      elementId: ElementId;
      animation: Omit<SlideAnimation, "id" | "elementId" | "phase">;
    }
  | { type: "remove-animation"; slideId: SlideId; animationId: string }
  | { type: "duplicate-animation"; slideId: SlideId; animationId: string }
  | { type: "clear-slide-animations"; slideId: SlideId }
  | { type: "move-animation"; slideId: SlideId; animationId: string; toIndex: number }
  | {
      type: "set-animation";
      slideId: SlideId;
      animationId: string;
      changes: Partial<Omit<SlideAnimation, "id" | "elementId" | "phase">>;
    }
  | { type: "align-element"; slideId: SlideId; elementId: ElementId; align: AlignTarget }
  | {
      type: "align-elements";
      slideId: SlideId;
      elementIds: ElementId[];
      align: { horizontal?: ArrangeHorizontal; vertical?: ArrangeVertical };
    }
  | { type: "distribute-elements"; slideId: SlideId; elementIds: ElementId[]; axis: "horizontal" | "vertical" }
  | { type: "move-elements"; slideId: SlideId; elementIds: ElementId[]; dx: Emu; dy: Emu }
  | {
      type: "paste-elements";
      slideId: SlideId;
      elements: SlideElement[];
      /** The diagonal shift of this paste, so repeated pastes do not stack. */
      offsetEmu?: Emu;
    }
  | { type: "transform-element"; slideId: SlideId; elementId: ElementId; frame: RectEmu; rotationMilliDegree: number }
  | { type: "move-element"; slideId: SlideId; elementId: ElementId; x: Emu; y: Emu }
  | { type: "set-text-style"; slideId: SlideId; elementId: ElementId; style: Partial<TextElementStyle> }
  | {
      type: "set-text-style-elements";
      slideId: SlideId;
      elementIds: ElementId[];
      style: Partial<TextElementStyle>;
      /**
       * The format painter replaces the whole format, so fragment emphasis the
       * source does not have must go as well. A plain bold toggle leaves it on.
       */
      clearRuns?: boolean;
    }
  | { type: "clear-text-format"; slideId: SlideId; elementIds: ElementId[] }
  | {
      type: "set-text-hyperlink";
      slideId: SlideId;
      elementIds: ElementId[];
      /** `null` removes the link; the text and its fragments stay untouched. */
      url: string | null;
      /**
       * A character range inside one text element. Omit it to address the whole
       * text box, which is also what the ribbon button does.
       */
      range?: { start: number; end: number };
    }
  | { type: "fit-text"; slideId: SlideId; elementId: ElementId }
  | {
      type: "set-text-emphasis";
      slideId: SlideId;
      elementId: ElementId;
      start: number;
      end: number;
      style: TextRunStyle;
    }
  | { type: "clear-text-emphasis"; slideId: SlideId; elementId: ElementId; start: number; end: number }
  | { type: "set-shape-style"; slideId: SlideId; elementId: ElementId; style: Partial<ShapeElementStyle> }
  | {
      type: "set-shape-styles";
      slideId: SlideId;
      elementIds: ElementId[];
      style: Partial<ShapeElementStyle>;
    }
  | { type: "set-line-style"; slideId: SlideId; elementId: ElementId; style: Partial<LineElementStyle> }
  | { type: "set-line-direction"; slideId: SlideId; elementId: ElementId; direction: LineDirection }
  | { type: "set-chart-style"; slideId: SlideId; elementId: ElementId; style: Partial<ChartElementStyle> }
  | { type: "set-chart-kind"; slideId: SlideId; elementId: ElementId; kind: ChartKind }
  | { type: "set-table-style"; slideId: SlideId; elementId: ElementId; style: Partial<TableElementStyle> }
  | { type: "set-icon-style"; slideId: SlideId; elementId: ElementId; style: Partial<IconElementStyle> }
  | { type: "set-icon-name"; slideId: SlideId; elementId: ElementId; name: BuiltinIconName }
  | { type: "set-image-alt-text"; slideId: SlideId; elementId: ElementId; altText: string }
  | {
      type: "set-image-provenance";
      slideId: SlideId;
      elementId: ElementId;
      provenance: AssetProvenance | null;
    }
  | { type: "set-image-crop"; slideId: SlideId; elementId: ElementId; crop: ImageCrop | null }
  | { type: "edit-text"; slideId: SlideId; elementId: ElementId; text: string }
  | { type: "replace-text-edits"; edits: TextReplaceEdit[] }
  | { type: "set-speaker-notes"; slideId: SlideId; notes: string }
  | { type: "set-slide-transition"; slideId: SlideId; transition: SlideTransition | null }
  | { type: "set-metric"; slideId: SlideId; blockId: string; field: "label" | "value"; value: string }
  | {
      type: "set-table-cell";
      slideId: SlideId;
      blockId: string;
      cell: { section: "header"; column: number } | { section: "body"; row: number; column: number };
      value: string;
    }
  | { type: "approve-slide-content"; slideId: SlideId }
  | { type: "reopen-slide-content"; slideId: SlideId }
  | { type: "restore-content-version"; versionId: string; includeDesign?: boolean }
  | { type: "set-template-style"; templateStyle?: TemplateReviewTarget };
