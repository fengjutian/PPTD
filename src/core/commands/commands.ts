import type {
  BuiltinIconName,
  ChartElementStyle,
  ChartKind,
  ContentBlock,
  DocumentTextStyles,
  DocumentTheme,
  ElementId,
  Emu,
  ImageCrop,
  LineDirection,
  LineElementStyle,
  PresentationDocument,
  RectEmu,
  ShapeElementStyle,
  ShapeKind,
  SlideAnimation,
  Slide,
  SlideElement,
  SlideId,
  SlideLayoutSpec,
  SupportedImageMimeType,
  IconElementStyle,
  TableElementStyle,
  SlideTransition,
  TextElement,
  TextElementStyle,
} from "../document-model";
import {
  BUILTIN_ICONS,
  captureContentVersion,
  createDocument,
  createSlide,
  diffContentVersion,
  emu,
  iconForText,
  inches,
  MAX_PAGE_SIZE_IN,
  MIN_PAGE_SIZE_IN,
  parseMetricValue,
  phaseForEffect,
  SHAPE_KINDS,
  stableStringify,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  applyTextRun,
  subtractTextRange,
  clearedTextStyle,
  type TextRunStyle,
} from "../document-model";
import {
  colorLuminance,
  fillForInk,
  isLargeText,
  readableTextColor,
  readableTextColorOnRange,
  type BackgroundRange,
} from "../rendering/contrast";
import { alignFrames, distributeFrames, unionFrame, type ArrangeHorizontal, type ArrangeVertical } from "./arrange";
import { estimateTextLines, textLikelyOverflows } from "../rendering/text-fit";
import { layoutFlow } from "../rendering/flow";
import {
  planTemplateLayouts,
  templateColumnRegions,
  templateContentRegion,
  templateImageRegion,
  templateLayoutHasFooterMarker,
  templateTitleRegion,
  type AiElementRepair,
  type AiNormalizedRect,
  type AiSlideDesign,
  type AiTemplateDecoration,
  type AiTemplateLayout,
  type BackgroundRhythm,
  type TemplateLayoutIntent,
} from "./template-layouts";
import { classifyRelayoutElements, inferRelayoutContext } from "./slide-relayout";
import type { TextReplaceEdit } from "./text-search";
import {
  CONTENT_REGION,
  DEFAULT_CONTENT_REGION,
  LAYOUT_CAPACITY,
  PANEL_TYPE_SCALE,
  stripListPrefix,
} from "./layout-capacity";
import { resolveTypeScale } from "../design/type-scale";
import { findThemePreset } from "../design/theme-presets";
import { deriveDesignTokens } from "../design/design-tokens";
import type { DeckConcept } from "../design/deck-concept";
import { consumptionProblem, selectRecipe } from "../layout/recipes/plan";
import { planPageChrome } from "../layout/page-chrome";
import { coverCrop } from "../rendering/image-fit";
import {
  DENSITY_FACTORS,
  EMPHASIS_FACTORS,
  autoComposition,
  detectPullQuote,
  resolvePageDesign,
  type CompositionFacts,
} from "./design-intent";
import { planDeckCompositions } from "./deck-composition";
import { narrativeComposition } from "./visual-narrative";
import {
  isVisualAssetRole,
  planManualVisualAssetLayout,
  planVisualAssetLayout,
  resolveVisualAsset,
  type AiVisualAssetRole,
  type NormalizedRect,
} from "./visual-asset";

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

/**
 * 一页已经生成好的配图。
 *
 * 图片是外部依赖的产物：可能没有凭据、可能超时、可能只生成了几页。
 * 因此它是可选的，缺哪页就少哪页，文稿照常成立。
 */
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

/**
 * The theme of the source template. It is design state: it describes the
 * typography and the palette of the deck, never the reviewed copy.
 */
export interface AiTemplateTheme {
  name?: string;
  majorFont?: string;
  minorFont?: string;
  colors?: Array<{ name: string; value: string }>;
  /** The type scale of the theme, when the template or preset declares one. */
  textStyles?: DocumentTextStyles;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const TEXT_STYLE_LEVELS = ["display", "title", "subtitle", "body", "caption"] as const;

/**
 * Reads the named type levels of a theme.
 *
 * The value arrives from outside the domain (a template analysis or a preset),
 * so every level is re-validated: a missing or absurd size is dropped instead of
 * silently scaling the whole deck.
 */
function readTextStyles(input: AiTemplateTheme["textStyles"]): DocumentTheme["textStyles"] {
  if (!input) return undefined;
  const result: NonNullable<DocumentTheme["textStyles"]> = {};
  for (const level of TEXT_STYLE_LEVELS) {
    const token = input[level];
    if (!token || !Number.isFinite(token.fontSizePt)) continue;
    const fontSizePt = Math.min(120, Math.max(8, token.fontSizePt));
    result[level] = {
      fontSizePt,
      ...(typeof token.bold === "boolean" ? { bold: token.bold } : {}),
      ...(typeof token.color === "string" && HEX_COLOR_PATTERN.test(token.color) ? { color: token.color } : {}),
      ...(typeof token.lineHeight === "number" && Number.isFinite(token.lineHeight)
        ? { lineHeight: token.lineHeight }
        : {}),
      ...(typeof token.letterSpacingPt === "number" && Number.isFinite(token.letterSpacingPt)
        ? { letterSpacingPt: token.letterSpacingPt }
        : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readTemplateTheme(theme: AiTemplateTheme | undefined): DocumentTheme | undefined {
  if (!theme) return undefined;
  const majorFont = theme.majorFont?.trim();
  const minorFont = theme.minorFont?.trim();
  const colors = (theme.colors ?? [])
    .filter((color) => typeof color.name === "string" && color.name.trim() && HEX_COLOR_PATTERN.test(color.value))
    .map((color) => ({ name: color.name.trim(), value: color.value.toUpperCase() }));
  const textStyles = readTextStyles(theme.textStyles);
  if (!majorFont && !minorFont && colors.length === 0 && !textStyles) return undefined;
  return {
    name: theme.name?.trim() || "模板主题",
    majorFont: majorFont || minorFont || "Calibri",
    minorFont: minorFont || majorFont || "Calibri",
    colors,
    ...(textStyles ? { textStyles } : {}),
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
    if (block.type === "comparison")
      return {
        id,
        type: "comparison",
        leftLabel: block.leftLabel,
        rightLabel: block.rightLabel,
        leftItems: [...block.leftItems],
        rightItems: [...block.rightItems],
      };
    if (block.type === "table-data")
      return { id, type: "table-data", header: [...block.header], rows: block.rows.map((row) => [...row]) };
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
    if (block.type === "timeline" || block.type === "process")
      return { ...block, items: block.items.map((item) => ({ ...item })) };
    if (block.type === "comparison")
      return { ...block, leftItems: [...block.leftItems], rightItems: [...block.rightItems] };
    if (block.type === "table-data")
      return { ...block, header: [...block.header], rows: block.rows.map((row) => [...row]) };
    return { ...block };
  });
}

/**
 * 复制一个对象，用来做粘贴。
 *
 * 副本比原件往后挪一点，让用户一眼看出"这是新的一份"。标题和正文这类
 * 内容占位符不能被复制成第二份——那会让一页出现两个标题，所以文本副本
 * 变成装饰性文本。
 */
function copyElementForPaste(element: SlideElement, offset: number): SlideElement {
  const moved = { ...element.frame, x: (element.frame.x + offset) as Emu, y: (element.frame.y + offset) as Emu };
  if (element.type === "text") {
    const copy: TextElement = {
      ...element,
      id: crypto.randomUUID() as ElementId,
      contentRef: "decorative",
      frame: moved,
      style: { ...element.style },
      ...(element.runs ? { runs: element.runs.map((run) => ({ ...run })) } : {}),
    };
    // The copy may land on another page, where the block it pointed at does not
    // exist. A pasted card is user copy, not another view of the reviewed one.
    delete copy.contentBlockRef;
    return copy;
  }
  if (element.type === "shape")
    return { ...element, id: crypto.randomUUID() as ElementId, frame: moved, style: { ...element.style } };
  if (element.type === "line")
    return { ...element, id: crypto.randomUUID() as ElementId, frame: moved, style: { ...element.style } };
  if (element.type === "chart")
    return {
      ...element,
      id: crypto.randomUUID() as ElementId,
      frame: moved,
      style: { ...element.style, seriesColors: [...element.style.seriesColors] },
      contentBlockIds: [...element.contentBlockIds],
    };
  if (element.type === "table")
    return { ...element, id: crypto.randomUUID() as ElementId, frame: moved, style: { ...element.style } };
  if (element.type === "icon")
    return { ...element, id: crypto.randomUUID() as ElementId, frame: moved, style: { ...element.style } };
  return { ...element, id: crypto.randomUUID() as ElementId, frame: moved, source: { ...element.source } };
}

/**
 * Reviewed copy changed: an approved page has to leave the approved state.
 *
 * Deleting a content-bound title/body is a content edit just as much as typing
 * over it. Without this transition the page could be empty and still be
 * reported as approved, and the export preflight would not warn about it.
 */
function markContentChanged(slide: Slide): void {
  if (slide.content.status === "approved") slide.content.status = "changed";
}

/** The design fields a content version snapshots, without its content. */
function slideDesignOf(slide: Slide) {
  return {
    background: slide.background,
    elements: slide.elements,
    ...(slide.animations ? { animations: slide.animations } : {}),
    ...(slide.transition ? { transition: slide.transition } : {}),
    ...(slide.groups ? { groups: slide.groups } : {}),
    ...(slide.layoutId ? { layoutId: slide.layoutId } : {}),
  };
}

/**
 * Scales one object with the page when the user explicitly asks for it.
 *
 * Frames follow the page's two ratios. Type and stroke sizes follow the
 * smaller ratio: a non-uniform page change (16:9 → 4:3) must not stretch
 * glyphs, and keeping the larger ratio would overflow the narrower dimension.
 * Content — titles, table cells, metric values, notes — is never touched.
 */
function scaleElementForPage(element: SlideElement, scaleX: number, scaleY: number): void {
  const frame = element.frame;
  element.frame = {
    x: emu(Math.round(frame.x * scaleX)),
    y: emu(Math.round(frame.y * scaleY)),
    width: emu(Math.max(1, Math.round(frame.width * scaleX))),
    height: emu(Math.max(1, Math.round(frame.height * scaleY))),
  };
  const typeScale = Math.min(scaleX, scaleY);
  const point = (value: number) => Math.min(400, Math.max(4, Math.round(value * typeScale * 100) / 100));
  const length = (value: number) => Math.max(0, Math.round(value * typeScale * 100) / 100);
  switch (element.type) {
    case "text":
      element.style.fontSizePt = point(element.style.fontSizePt);
      if (element.style.letterSpacingPt !== undefined) {
        element.style.letterSpacingPt = length(element.style.letterSpacingPt);
      }
      break;
    case "shape":
      element.style.strokeWidthPt = length(element.style.strokeWidthPt);
      element.style.radiusPt = length(element.style.radiusPt);
      break;
    case "line":
      element.style.strokeWidthPt = length(element.style.strokeWidthPt);
      break;
    case "table":
      element.style.fontSizePt = point(element.style.fontSizePt);
      if (element.style.cellPaddingPt !== undefined) element.style.cellPaddingPt = length(element.style.cellPaddingPt);
      if (element.style.borderWidthPt !== undefined) element.style.borderWidthPt = length(element.style.borderWidthPt);
      break;
    case "chart":
      element.style.fontSizePt = point(element.style.fontSizePt);
      break;
  }
}

/**
 * Drops groups whose members no longer all exist.
 *
 * A group is a selection helper, not a container: deleting one member leaves
 * the other objects in place, and keeping a half-group would make the next
 * click select objects that are no longer a meaningful unit.
 */
function pruneGroups(slide: Slide): void {
  if (!slide.groups) return;
  const alive = new Set(slide.elements.map((element) => element.id));
  const kept = slide.groups.filter((group) => group.elementIds.every((id) => alive.has(id)));
  slide.groups = kept.length > 0 ? kept : undefined;
}

type MetricBlock = Extract<ContentBlock, { type: "metric" }>;
type TableBlock = Extract<ContentBlock, { type: "table-data" }>;

function findMetricBlock(slide: Slide | undefined, blockId: string): MetricBlock | undefined {
  return slide?.content.blocks?.find(
    (candidate): candidate is MetricBlock => candidate.id === blockId && candidate.type === "metric",
  );
}

function findTableBlock(slide: Slide | undefined, blockId: string): TableBlock | undefined {
  return slide?.content.blocks?.find(
    (candidate): candidate is TableBlock => candidate.id === blockId && candidate.type === "table-data",
  );
}

/**
 * Whether changing this copy changes reviewed content.
 *
 * A title/body (including the legacy first element without a role) is content.
 * A card bound to a metric is content too: the number is reviewed copy shown in
 * more than one place. Everything else is a decorative text box.
 */
function textEditTouchesContent(slide: Slide, element: TextElement): boolean {
  const metric = element.contentBlockRef ? findMetricBlock(slide, element.contentBlockRef.blockId) : undefined;
  return (
    element.contentRef === "title" ||
    element.contentRef === "body" ||
    (!element.contentRef && slide.elements[0]?.id === element.id) ||
    Boolean(metric)
  );
}

/**
 * Writes one copy and keeps its content bindings in step.
 *
 * `edit-text` and the batch find/replace command both go through here, so a
 * replacement updates the reviewed title/body/metric exactly like typing does,
 * and both paths drop run fragments that would address the old copy.
 */
function applyTextEdit(slide: Slide, element: TextElement, text: string): void {
  const blockRef = element.contentBlockRef;
  const metric = blockRef ? findMetricBlock(slide, blockRef.blockId) : undefined;
  // The block schema caps a metric field at 1,000 characters. Refusing the edit
  // is better than saving a document that fails validation later.
  if (metric && text.length > 1_000) throw new Error("CONTENT_TEXT_TOO_LONG");
  element.text = text;
  // The fragments address ranges of the old copy, so they would point at the
  // wrong words once the copy changed. Dropping them keeps the emphasis honest
  // instead of highlighting something the reviewer did not select.
  element.runs = undefined;
  if (element.contentRef === "title" || (!element.contentRef && slide.elements[0]?.id === element.id))
    slide.content.title = text;
  if (element.contentRef === "body") {
    slide.content.body = text;
    slide.content.blocks = text.trim()
      ? [{ id: slide.content.blocks?.[0]?.id ?? crypto.randomUUID(), type: "paragraph", text }]
      : [];
  }
  if (metric && blockRef) {
    // A card is a view of the metric, not a second copy of it: typing in the
    // card edits the reviewed number every other view reads.
    if (blockRef.field === "value") metric.value = text;
    else metric.label = text;
    syncMetricText(slide, metric.id, blockRef.field, text);
  }
  if (textEditTouchesContent(slide, element)) markContentChanged(slide);
}

/**
 * Keeps every card text that renders the same metric field in step with the
 * block. A page may show one reviewed number twice; editing either copy must
 * not leave the other one claiming an older value.
 */
function syncMetricText(slide: Slide, blockId: string, field: "label" | "value", value: string): void {
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    if (element.contentBlockRef?.blockId !== blockId || element.contentBlockRef.field !== field) continue;
    if (element.text === value) continue;
    element.text = value;
    // Fragment offsets address the old copy, so they no longer mean anything.
    element.runs = undefined;
  }
}

/**
 * Keeps the title/body text objects in step with the content they render.
 *
 * Those objects are views of the reviewed copy, not independent text. A
 * restore that only rewrote `slide.content` would leave the canvas showing the
 * newer words while the content panel and exporter use the restored ones.
 */
function syncContentText(slide: Slide, title: string, body: string): boolean {
  let changed = false;
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    const legacyTitle = !element.contentRef && slide.elements[0]?.id === element.id;
    const next =
      element.contentRef === "title" || legacyTitle ? title : element.contentRef === "body" ? body : undefined;
    if (next === undefined || element.text === next) continue;
    element.text = next;
    // Fragment offsets address the old copy, so they no longer mean anything.
    element.runs = undefined;
    changed = true;
  }
  return changed;
}

/**
 * Copies a snapshot's blocks into the current blocks while keeping the current
 * block IDs.
 *
 * Charts, tables and card texts point at those IDs. Replacing the IDs would
 * silently break those bindings, so a snapshot is only restorable when each of
 * its blocks can find a current block of the same type. When the topology does
 * not match, the restore is refused instead of guessing.
 */
function restoreSlideBlocks(slide: Slide, sourceBlocks: ContentBlock[] | undefined): boolean {
  const source = sourceBlocks ?? [];
  const target = slide.content.blocks ?? [];
  if (source.length === 0) {
    if (target.length === 0) return false;
    throw new Error("CONTENT_VERSION_BLOCKS_INCOMPATIBLE");
  }
  if (source.length !== target.length) throw new Error("CONTENT_VERSION_BLOCKS_INCOMPATIBLE");

  const used = new Set<number>();
  const assignments: Array<{ source: ContentBlock; target: ContentBlock }> = [];
  for (const block of source) {
    let index = target.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) && candidate.id === block.id && candidate.type === block.type,
    );
    if (index < 0) {
      index = target.findIndex(
        (candidate, candidateIndex) => !used.has(candidateIndex) && candidate.type === block.type,
      );
    }
    if (index < 0) throw new Error("CONTENT_VERSION_BLOCKS_INCOMPATIBLE");
    used.add(index);
    assignments.push({ source: block, target: target[index]! });
  }

  const restored = assignments.map((assignment) => {
    const { id: _sourceId, ...fields } = assignment.source;
    return { ...fields, id: assignment.target.id } as ContentBlock;
  });
  const contentChanged = restored.some(
    (block, index) => stableStringify(block) !== stableStringify(assignments[index]!.target),
  );
  const orderChanged = restored.some((block, index) => block.id !== target[index]?.id);
  if (contentChanged || orderChanged) slide.content.blocks = restored;

  // Bindings normally point at the current ids already. A design re-application
  // can regenerate those ids while the snapshot still knows the old ones; map
  // the references so a card, chart or table keeps following its restored data.
  const idMap = new Map(assignments.map((assignment) => [assignment.source.id, assignment.target.id]));
  let bindingsChanged = false;
  for (const element of slide.elements) {
    if (element.type === "text" && element.contentBlockRef) {
      const mapped = idMap.get(element.contentBlockRef.blockId);
      if (mapped && mapped !== element.contentBlockRef.blockId) {
        element.contentBlockRef = { ...element.contentBlockRef, blockId: mapped };
        bindingsChanged = true;
      }
    } else if (element.type === "chart") {
      const mapped = element.contentBlockIds.map((id) => idMap.get(id) ?? id);
      if (mapped.some((id, index) => id !== element.contentBlockIds[index])) {
        element.contentBlockIds = mapped;
        bindingsChanged = true;
      }
    } else if (element.type === "table") {
      const mapped = idMap.get(element.contentBlockId);
      if (mapped && mapped !== element.contentBlockId) {
        element.contentBlockId = mapped;
        bindingsChanged = true;
      }
    }
  }

  // A metric card is a view of the block. Copying the block alone would leave
  // the visible card on the newer number while the chart and panel show the
  // restored one.
  for (const block of restored) {
    if (block.type !== "metric") continue;
    syncMetricText(slide, block.id, "label", block.label);
    syncMetricText(slide, block.id, "value", block.value);
  }
  return contentChanged || orderChanged || bindingsChanged;
}

/** Plain deep copy of an element, safe to read from an Immer draft. */
function cloneElement(element: SlideElement): SlideElement {
  if (element.type === "text")
    return {
      ...element,
      frame: { ...element.frame },
      style: { ...element.style },
      ...(element.contentBlockRef ? { contentBlockRef: { ...element.contentBlockRef } } : {}),
      ...(element.runs ? { runs: element.runs.map((run) => ({ ...run })) } : {}),
    };
  if (element.type === "shape") return { ...element, frame: { ...element.frame }, style: { ...element.style } };
  if (element.type === "line") return { ...element, frame: { ...element.frame }, style: { ...element.style } };
  if (element.type === "chart")
    return {
      ...element,
      frame: { ...element.frame },
      style: { ...element.style, seriesColors: [...element.style.seriesColors] },
      contentBlockIds: [...element.contentBlockIds],
    };
  if (element.type === "table") return { ...element, frame: { ...element.frame }, style: { ...element.style } };
  if (element.type === "icon") return { ...element, frame: { ...element.frame }, style: { ...element.style } };
  return {
    ...element,
    frame: { ...element.frame },
    source: { ...element.source },
    ...(element.crop ? { crop: { ...element.crop } } : {}),
  };
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
    if (block.type === "comparison")
      return {
        type: "comparison",
        leftLabel: block.leftLabel,
        rightLabel: block.rightLabel,
        leftItems: [...block.leftItems],
        rightItems: [...block.rightItems],
      };
    if (block.type === "table-data")
      return {
        type: "table-data",
        header: [...block.header],
        rows: block.rows.map((row) => [...row]),
        ...(block.merges ? { merges: block.merges.map((merge) => ({ ...merge })) } : {}),
      };
    return { type: "process", items: block.items.map((item) => ({ ...item })) };
  });
}
/** The horizontal place of an object on the page. */
export type HorizontalAlign = "left" | "center" | "right";
/** The vertical place of an object on the page. */
export type VerticalAlign = "top" | "middle" | "bottom";
/**
 * Where an object is placed on the page.
 *
 * A single axis moves one direction and leaves the other one alone; both axes
 * together place the object in a corner, in the middle or on an edge of the
 * page. Both are one intent, so both are one command and one undo step.
 */
export type AlignTarget = HorizontalAlign | VerticalAlign | { horizontal?: HorizontalAlign; vertical?: VerticalAlign };

/** The axis each single direction belongs to. */
const HORIZONTAL_ALIGN: Record<string, HorizontalAlign | undefined> = {
  left: "left",
  center: "center",
  right: "right",
};
const VERTICAL_ALIGN: Record<string, VerticalAlign | undefined> = { top: "top", middle: "middle", bottom: "bottom" };

export type { ArrangeHorizontal, ArrangeVertical } from "./arrange";

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
  | { type: "group-elements"; slideId: SlideId; elementIds: ElementId[] }
  | { type: "ungroup-elements"; slideId: SlideId; groupId: string }
  | { type: "reorder-element"; slideId: SlideId; elementId: ElementId; toIndex: number }
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
  | { type: "set-line-style"; slideId: SlideId; elementId: ElementId; style: Partial<LineElementStyle> }
  | { type: "set-line-direction"; slideId: SlideId; elementId: ElementId; direction: LineDirection }
  | { type: "set-chart-style"; slideId: SlideId; elementId: ElementId; style: Partial<ChartElementStyle> }
  | { type: "set-chart-kind"; slideId: SlideId; elementId: ElementId; kind: ChartKind }
  | { type: "set-table-style"; slideId: SlideId; elementId: ElementId; style: Partial<TableElementStyle> }
  | { type: "set-icon-style"; slideId: SlideId; elementId: ElementId; style: Partial<IconElementStyle> }
  | { type: "set-icon-name"; slideId: SlideId; elementId: ElementId; name: BuiltinIconName }
  | { type: "set-image-alt-text"; slideId: SlideId; elementId: ElementId; altText: string }
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
  | { type: "restore-content-version"; versionId: string; includeDesign?: boolean };

/** Text styling is presentation-only, so every guard here rejects values the exporter or the schema could not round-trip. */ function assertTextStyle(
  style: Partial<TextElementStyle>,
): void {
  const fontFamily = style.fontFamily;
  if (fontFamily !== undefined && (typeof fontFamily !== "string" || !fontFamily.trim() || fontFamily.length > 100))
    throw new Error("INVALID_TEXT_STYLE");
  if (
    style.fontSizePt !== undefined &&
    (!Number.isFinite(style.fontSizePt) || style.fontSizePt < 4 || style.fontSizePt > 400)
  )
    throw new Error("INVALID_TEXT_STYLE");
  if (style.color !== undefined && !HEX_COLOR_PATTERN.test(style.color)) throw new Error("INVALID_TEXT_STYLE");
  if (style.bold !== undefined && typeof style.bold !== "boolean") throw new Error("INVALID_TEXT_STYLE");
  if (style.align !== undefined && style.align !== "left" && style.align !== "center" && style.align !== "right")
    throw new Error("INVALID_TEXT_STYLE");
  if (style.italic !== undefined && typeof style.italic !== "boolean") throw new Error("INVALID_TEXT_STYLE");
  if (style.underline !== undefined && typeof style.underline !== "boolean") throw new Error("INVALID_TEXT_STYLE");
  if (style.strikethrough !== undefined && typeof style.strikethrough !== "boolean")
    throw new Error("INVALID_TEXT_STYLE");
  if (
    style.verticalAlign !== undefined &&
    style.verticalAlign !== "top" &&
    style.verticalAlign !== "middle" &&
    style.verticalAlign !== "bottom"
  )
    throw new Error("INVALID_TEXT_STYLE");
  if (style.bullet !== undefined && style.bullet !== "none" && style.bullet !== "dot" && style.bullet !== "number")
    throw new Error("INVALID_TEXT_STYLE");
  if (
    style.indentLevel !== undefined &&
    (!Number.isInteger(style.indentLevel) || style.indentLevel < 0 || style.indentLevel > 8)
  )
    throw new Error("INVALID_TEXT_STYLE");
  if (
    style.lineHeight !== undefined &&
    (!Number.isFinite(style.lineHeight) || style.lineHeight < 0.8 || style.lineHeight > 3)
  )
    throw new Error("INVALID_TEXT_STYLE");
  if (
    style.letterSpacingPt !== undefined &&
    (!Number.isFinite(style.letterSpacingPt) || style.letterSpacingPt < -2 || style.letterSpacingPt > 20)
  )
    throw new Error("INVALID_TEXT_STYLE");
}

/**
 * The largest size the text fits into its frame at, or the current size when it
 * already fits. The thresholds are the ones the quality gate uses, so a text
 * that is reported as overflowing can be repaired and the report disappears.
 */
function fittingTextSize(text: string, frame: RectEmu, fontFamily: string, preferredPt: number): number {
  const widthPt = frame.width / 12_700;
  const heightPt = frame.height / 12_700;
  for (let size = preferredPt; size >= 8; size -= 1) {
    if (estimateTextLines(text, widthPt, size, fontFamily) * size * 1.2 <= heightPt * 1.08) return size;
  }
  return 8;
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
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length)
    throw new Error("INVALID_TEXT_EMPHASIS");
  if (start > 0 && isHighSurrogate(text.charCodeAt(start - 1)) && isLowSurrogate(text.charCodeAt(start)))
    throw new Error("INVALID_TEXT_EMPHASIS");
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end)))
    throw new Error("INVALID_TEXT_EMPHASIS");
}

function assertShapeStyle(style: Partial<ShapeElementStyle>): void {
  if (style.fill !== undefined && !HEX_COLOR_PATTERN.test(style.fill)) throw new Error("INVALID_SHAPE_STYLE");
  if (style.stroke !== undefined && !HEX_COLOR_PATTERN.test(style.stroke)) throw new Error("INVALID_SHAPE_STYLE");
  if (
    style.strokeWidthPt !== undefined &&
    (!Number.isFinite(style.strokeWidthPt) || style.strokeWidthPt < 0 || style.strokeWidthPt > 100)
  )
    throw new Error("INVALID_SHAPE_STYLE");
  if (style.radiusPt !== undefined && (!Number.isFinite(style.radiusPt) || style.radiusPt < 0 || style.radiusPt > 1000))
    throw new Error("INVALID_SHAPE_STYLE");
}

/** The style of a line is presentation-only, so it is guarded like the others. */
function assertLineStyle(style: Partial<LineElementStyle>): void {
  if (style.stroke !== undefined && !HEX_COLOR_PATTERN.test(style.stroke)) throw new Error("INVALID_LINE_STYLE");
  if (
    style.strokeWidthPt !== undefined &&
    (!Number.isFinite(style.strokeWidthPt) || style.strokeWidthPt < 0 || style.strokeWidthPt > 100)
  )
    throw new Error("INVALID_LINE_STYLE");
  if (style.startArrow !== undefined && style.startArrow !== "none" && style.startArrow !== "arrow")
    throw new Error("INVALID_LINE_STYLE");
  if (style.endArrow !== undefined && style.endArrow !== "none" && style.endArrow !== "arrow")
    throw new Error("INVALID_LINE_STYLE");
  if (style.dashed !== undefined && typeof style.dashed !== "boolean") throw new Error("INVALID_LINE_STYLE");
}

/** The style of a chart is presentation-only, so it is guarded like the others. */
function assertChartStyle(style: Partial<ChartElementStyle>): void {
  if (
    style.fontFamily !== undefined &&
    (typeof style.fontFamily !== "string" || !style.fontFamily.trim() || style.fontFamily.length > 100)
  )
    throw new Error("INVALID_CHART_STYLE");
  if (
    style.fontSizePt !== undefined &&
    (!Number.isFinite(style.fontSizePt) || style.fontSizePt < 4 || style.fontSizePt > 400)
  )
    throw new Error("INVALID_CHART_STYLE");
  if (style.textColor !== undefined && !HEX_COLOR_PATTERN.test(style.textColor)) throw new Error("INVALID_CHART_STYLE");
  if (style.seriesColors !== undefined) {
    if (!Array.isArray(style.seriesColors) || style.seriesColors.length < 1 || style.seriesColors.length > 12)
      throw new Error("INVALID_CHART_STYLE");
    if (style.seriesColors.some((value) => !HEX_COLOR_PATTERN.test(value))) throw new Error("INVALID_CHART_STYLE");
  }
  if (style.showLegend !== undefined && typeof style.showLegend !== "boolean") throw new Error("INVALID_CHART_STYLE");
  if (style.showValueLabels !== undefined && typeof style.showValueLabels !== "boolean")
    throw new Error("INVALID_CHART_STYLE");
}

/**
 * The style of a table is presentation-only, so it is guarded like the others.
 */
function assertIconStyle(style: Partial<IconElementStyle>): void {
  if (style.color !== undefined && !HEX_COLOR_PATTERN.test(style.color)) throw new Error("INVALID_ICON_STYLE");
  if (
    style.strokeWidth !== undefined &&
    (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 1 || style.strokeWidth > 6)
  )
    throw new Error("INVALID_ICON_STYLE");
}

function assertTableStyle(style: Partial<TableElementStyle>): void {
  if (
    style.fontFamily !== undefined &&
    (typeof style.fontFamily !== "string" || !style.fontFamily.trim() || style.fontFamily.length > 100)
  )
    throw new Error("INVALID_TABLE_STYLE");
  if (
    style.fontSizePt !== undefined &&
    (!Number.isFinite(style.fontSizePt) || style.fontSizePt < 4 || style.fontSizePt > 400)
  )
    throw new Error("INVALID_TABLE_STYLE");
  if (style.headerFill !== undefined && !HEX_COLOR_PATTERN.test(style.headerFill))
    throw new Error("INVALID_TABLE_STYLE");
  if (style.headerTextColor !== undefined && !HEX_COLOR_PATTERN.test(style.headerTextColor))
    throw new Error("INVALID_TABLE_STYLE");
  if (style.bodyTextColor !== undefined && !HEX_COLOR_PATTERN.test(style.bodyTextColor))
    throw new Error("INVALID_TABLE_STYLE");
  if (style.borderColor !== undefined && !HEX_COLOR_PATTERN.test(style.borderColor))
    throw new Error("INVALID_TABLE_STYLE");
  if (style.firstColumnBold !== undefined && typeof style.firstColumnBold !== "boolean")
    throw new Error("INVALID_TABLE_STYLE");
  if (style.bandingFill !== undefined && !HEX_COLOR_PATTERN.test(style.bandingFill))
    throw new Error("INVALID_TABLE_STYLE");
  if (style.headerBold !== undefined && typeof style.headerBold !== "boolean") throw new Error("INVALID_TABLE_STYLE");
  if (
    style.cellPaddingPt !== undefined &&
    (!Number.isFinite(style.cellPaddingPt) || style.cellPaddingPt < 0 || style.cellPaddingPt > 30)
  )
    throw new Error("INVALID_TABLE_STYLE");
  if (
    style.borderWidthPt !== undefined &&
    (!Number.isFinite(style.borderWidthPt) || style.borderWidthPt < 0 || style.borderWidthPt > 10)
  )
    throw new Error("INVALID_TABLE_STYLE");
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
  if (
    !naturalWidth ||
    !naturalHeight ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
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

/**
 * 一个归一化的矩形换成页面上的实际矩形。
 *
 * 归一化坐标按页宽页高各算一份：归一化的宽高比不等于像素的宽高比，
 * 直接拿归一化的宽高当成像素宽高，框就不是想要的比例了。
 */
function normalizedToEmuRect(rect: NormalizedRect, pageSize: { width: number; height: number }): RectEmu {
  return {
    x: Math.round(rect.x * pageSize.width) as Emu,
    y: Math.round(rect.y * pageSize.height) as Emu,
    width: Math.round(rect.width * pageSize.width) as Emu,
    height: Math.round(rect.height * pageSize.height) as Emu,
  };
}

/** 页面上的实际矩形换成归一化的矩形。 */
function emuToNormalizedRect(frame: RectEmu, pageSize: { width: number; height: number }): NormalizedRect {
  return {
    x: frame.x / pageSize.width,
    y: frame.y / pageSize.height,
    width: frame.width / pageSize.width,
    height: frame.height / pageSize.height,
  };
}

/**
 * 把一张图放进一个框里。
 *
 * 图按自己的像素比例落位：比例和框一致时正好铺满，一点都不切；不一致时
 * 宁可留白也不拉伸——拉伸过的图一眼就假。
 */
function fitImageIntoBox(box: RectEmu, naturalWidth?: number, naturalHeight?: number): RectEmu {
  if (
    !naturalWidth ||
    !naturalHeight ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  )
    return box;
  const aspect = naturalWidth / naturalHeight;
  const boxAspect = box.width / box.height;
  const width = aspect >= boxAspect ? box.width : Math.round(box.height * aspect);
  const height = aspect >= boxAspect ? Math.round(box.width / aspect) : box.height;
  return {
    x: Math.round(box.x + (box.width - width) / 2) as Emu,
    y: Math.round(box.y + (box.height - height) / 2) as Emu,
    width: width as Emu,
    height: height as Emu,
  };
}

/**
 * 给图腾地方。
 *
 * 只动正文框的几何，不动一个字：内容已经审过，图片进来不能把正文挤没。
 * 让位之后正文小到读不了，就宁可不动——让用户自己挪。
 */
function makeRoomForAsset(slide: Slide, textArea: NormalizedRect, pageSize: { width: number; height: number }): void {
  const body = slide.elements.find(
    (element) => element.type === "text" && element.contentRef === "body" && !element.locked,
  );
  if (!body) return;
  const current = emuToNormalizedRect(body.frame, pageSize);
  const left = Math.max(current.x, textArea.x);
  const top = Math.max(current.y, textArea.y);
  const right = Math.min(current.x + current.width, textArea.x + textArea.width);
  const bottom = Math.min(current.y + current.height, textArea.y + textArea.height);
  const width = right - left;
  const height = bottom - top;
  // 让位之后正文几乎没了，这一页就废了；不动比动更合适。
  if (width <= 0.02 || height <= 0.02) return;
  if (Math.abs(width - current.width) < 0.001 && Math.abs(height - current.height) < 0.001) return;
  body.frame = normalizedToEmuRect({ x: left, y: top, width, height }, pageSize);
}

export function commandDomain(command: DocumentCommand, document?: PresentationDocument): ChangeDomain | null {
  switch (command.type) {
    case "rename-document":
      return "content";
    case "set-slide":
      return null;
    case "set-page-size":
      return "design";
    case "group-elements":
    case "ungroup-elements":
      return "design";
    case "set-slide-background":
    case "set-slide-background-image":
    case "remove-slide-background-image":
      return "design";
    case "set-text-style":
    case "set-text-style-elements":
    case "clear-text-format":
    case "fit-text":
    case "set-text-emphasis":
    case "clear-text-emphasis":
    case "set-shape-style":
    case "set-line-style":
    case "set-line-direction":
    case "set-chart-style":
    case "set-chart-kind":
    case "set-table-style":
    case "set-image-alt-text":
    case "set-image-crop":
    case "add-animation":
    case "remove-animation":
    case "duplicate-animation":
    case "clear-slide-animations":
    case "move-animation":
    case "set-animation":
      return "design";
    case "delete-elements": {
      // 批量删除可能连带清空标题或正文——那属于内容变更，不能算作纯设计操作。
      if (!document) return "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const touchesContent =
        slide?.elements.some(
          (item) =>
            command.elementIds.includes(item.id) &&
            item.type === "text" &&
            (item.contentRef === "title" || item.contentRef === "body"),
        ) ?? false;
      return touchesContent ? "content" : "design";
    }
    case "align-elements":
    case "distribute-elements":
    case "move-elements":
    case "paste-elements":
      return "design";
    case "edit-text": {
      if (!document) return "content";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const element = slide?.elements.find((item) => item.id === command.elementId);
      if (element?.type !== "text" || !slide) return "design";
      const legacyTitle = !element.contentRef && slide.elements[0]?.id === element.id;
      const metric = element.contentBlockRef ? findMetricBlock(slide, element.contentBlockRef.blockId) : undefined;
      if (metric && element.contentBlockRef) {
        const current = element.contentBlockRef.field === "value" ? metric.value : metric.label;
        // Clicking into a card and leaving without typing must not add an undo
        // step. Runs only change when the copy changes, so they count as work.
        if (!element.runs && element.text === command.text && current === command.text) return null;
      }
      return element.contentRef === "title" || element.contentRef === "body" || legacyTitle || Boolean(metric)
        ? "content"
        : "design";
    }
    case "replace-text-edits": {
      if (!document) return "content";
      let touchesContent = false;
      let touchesDesign = false;
      for (const edit of command.edits) {
        // 标题、备注、表格单元格和图表字段都是内容；它们的写回命令各自
        // 维护内容版本，所以批量替换里出现任何一条都算内容变更。
        if (edit.kind !== "text") {
          touchesContent = true;
          continue;
        }
        const slide = document.slides.find((item) => item.id === edit.slideId);
        const element = slide?.elements.find((item) => item.id === edit.elementId);
        if (!slide || element?.type !== "text") continue;
        if (textEditTouchesContent(slide, element)) touchesContent = true;
        else touchesDesign = true;
      }
      if (touchesContent && touchesDesign) return "both";
      return touchesDesign ? "design" : "content";
    }
    case "set-speaker-notes":
      return "content";
    case "set-slide-transition":
      // A transition changes what the audience sees between pages, not the
      // reviewed copy. It is the same design domain as an object animation.
      return "design";
    case "set-metric": {
      if (!document) return "content";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const block = findMetricBlock(slide, command.blockId);
      if (!block) return "content";
      const current = command.field === "value" ? block.value : block.label;
      return current === command.value ? null : "content";
    }
    case "set-table-cell": {
      if (!document) return "content";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const block = findTableBlock(slide, command.blockId);
      if (!block) return "content";
      const { cell } = command;
      // Out-of-range addresses are left to applyCommand so they fail loudly
      // instead of being mistaken for a no-op.
      if (!Number.isInteger(cell.column) || cell.column < 0 || cell.column >= block.header.length) return "content";
      if (cell.section === "body" && (!Number.isInteger(cell.row) || cell.row < 0 || cell.row >= block.rows.length))
        return "content";
      const current = cell.section === "header" ? block.header[cell.column] : block.rows[cell.row]![cell.column];
      return current === command.value ? null : "content";
    }
    case "delete-element": {
      if (!document) return "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const element = slide?.elements.find((item) => item.id === command.elementId);
      const legacyTitle = element?.type === "text" && !element.contentRef && slide?.elements[0]?.id === element.id;
      return element?.type === "text" &&
        (element.contentRef === "title" || element.contentRef === "body" || legacyTitle)
        ? "content"
        : "design";
    }
    case "approve-slide-content":
    case "reopen-slide-content": {
      // 审核状态是内容态。已经处于目标状态的命令不产生撤销项：状态没变，
      // 记录一次"确认"只会让用户多按一次撤销。
      if (!document) return "content";
      const slide = document.slides.find((item) => item.id === command.slideId);
      if (!slide) return "content";
      if (command.type === "approve-slide-content" && slide.content.status === "approved") return null;
      if (command.type === "reopen-slide-content" && slide.content.status === "review") return null;
      return "content";
    }
    case "restore-content-version": {
      if (!document) return command.includeDesign ? "both" : "content";
      const version = document.contentVersions?.find((item) => item.id === command.versionId);
      // 找不到版本或页面集合不一致时交给 applyCommand 报稳定错误，不能当成空事务。
      if (!version) return "content";
      const contentChanged = diffContentVersion(version, document).length > 0;
      if (!command.includeDesign) return contentChanged ? "content" : null;
      if (!version.design) return contentChanged ? "content" : null;
      const designChanged = version.design.slides.some((snapshot) => {
        const slide = document.slides.find((item) => item.id === snapshot.slideId);
        if (!slide) return false;
        const { slideId: _slideId, ...expected } = snapshot;
        return JSON.stringify(slideDesignOf(slide)) !== JSON.stringify(expected);
      });
      if (contentChanged && designChanged) return "both";
      return designChanged ? "design" : contentChanged ? "content" : null;
    }
    case "add-text":
    case "add-line":
      return "design";
    case "duplicate-elements":
      return "design";
    case "add-image":
      return "design";
    case "add-table":
    case "add-chart":
      // Inserting a table or a chart also creates the reviewed content block it
      // reads, so both the content and the design revision move.
      return "both";
    case "relayout-slide":
      return "design";
    case "add-slide":
      return "both";
    case "apply-ai-draft":
      return "both";
    case "apply-ai-designed-draft":
      return "both";
    case "duplicate-slide":
      return "both";
    case "delete-slide":
      return "both";
    case "move-slide":
      return "both";
    default:
      return "design";
  }
}

/**
 * Rebuilds only the generated composition of one slide.
 *
 * The reviewed content and its block IDs stay untouched. Generated elements are
 * replaced from the same content, while user images/text, locked objects and
 * anything the legacy classifier cannot prove is generated are carried over.
 */
/**
 * A page background has to stay behind everything the relayout generates.
 *
 * Preserved objects used to be appended after the new composition, which put a
 * full-page background picture on top of the text: the page looked blank after
 * "重排版式". Backgrounds keep their place at the bottom; other preserved
 * objects stay on top as annotations.
 */
function isPageBackground(element: SlideElement): boolean {
  return (
    element.type === "image" && (element.placement === "slide-background" || element.placement === "layout-background")
  );
}

function relayoutSlide(document: PresentationDocument, slide: Slide): void {
  const context = inferRelayoutContext(slide, document);
  const preserved = classifyRelayoutElements(slide)
    .preserved // A locked title/body placeholder is still the content binding. Keeping it
    // beside the newly rendered placeholder would duplicate the heading or the
    // body; the reviewed content itself is unchanged either way.
    .filter((element) => element.type !== "text" || (element.contentRef !== "title" && element.contentRef !== "body"))
    .map((element) => {
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
  const documentTitle = document.title.trim() || "未命名演示文稿";
  temp.title = documentTitle;
  temp.pageSize = { ...document.pageSize };
  const pageIndex = document.slides.findIndex((item) => item.id === slide.id);
  // A section page keeps its name in the footer of the pages that follow it.
  // The temporary one-page render cannot see that page, so the name is carried
  // in explicitly.
  let sectionLabel: string | undefined;
  for (let index = pageIndex; index >= 0 && sectionLabel === undefined; index -= 1) {
    const candidate = document.slides[index];
    if (!candidate) continue;
    const candidateLayout = document.layouts?.find((layout) => layout.id === candidate.layoutId)?.name ?? "";
    if (!/(章节|section|过渡|分隔)/u.test(candidateLayout)) continue;
    sectionLabel = candidate.content.title.trim() || undefined;
  }
  const relayoutCommand: DocumentCommand = {
    type: "apply-ai-designed-draft",
    title: documentTitle,
    slides: [draft],
    designs: [context.design],
    pageSize: { ...document.pageSize },
    templateLayouts: [context.templateLayout],
    backgroundRhythm: { coverVariants: 1, contentVariants: 1, repeatLimit: 1 },
    ...(pageIndex >= 0
      ? { pageContext: { index: pageIndex, total: document.slides.length, ...(sectionLabel ? { sectionLabel } : {}) } }
      : {}),
    ...(context.fontFamily ? { fontFamily: context.fontFamily } : {}),
    ...(context.bodyFontFamily ? { bodyFontFamily: context.bodyFontFamily } : {}),
    ...(document.theme ? { templateTheme: document.theme } : {}),
  };
  applyCommand(temp, relayoutCommand);
  const generatedSlide = temp.slides[0];
  if (!generatedSlide) throw new Error("RELAYOUT_FAILED");

  // Chart and table elements point at reviewed content blocks. The temporary
  // render creates fresh block ids, so map those references back to the ids of
  // the page that stays in the document.
  const tempBlocks = generatedSlide.content.blocks ?? [];
  const targetBlocks = slide.content.blocks ?? [];
  const mapBlockId = (id: string): string | undefined => {
    const index = tempBlocks.findIndex((block) => block.id === id);
    const target = index >= 0 ? targetBlocks[index] : undefined;
    return target && target.type === tempBlocks[index]?.type ? target.id : undefined;
  };
  generatedSlide.elements = generatedSlide.elements.flatMap((element): SlideElement[] => {
    if (element.type === "chart") {
      const ids = element.contentBlockIds.map(mapBlockId).filter((id): id is string => Boolean(id));
      if (ids.length === 0) return [];
      element.contentBlockIds = ids;
      return [element];
    }
    if (element.type === "table") {
      const id = mapBlockId(element.contentBlockId);
      if (!id) return [];
      element.contentBlockId = id;
      return [element];
    }
    if (element.type === "text" && element.contentBlockRef) {
      // A card rendered in the temporary document points at a temporary block.
      // Without remapping, editing the relaid-out card would write into a block
      // the page does not own and the reviewed number would stay behind.
      const id = mapBlockId(element.contentBlockRef.blockId);
      if (!id) delete element.contentBlockRef;
      else element.contentBlockRef.blockId = id;
      return [element];
    }
    return [element];
  });

  slide.background = generatedSlide.background;
  // Backgrounds must be painted before the regenerated copy; user annotations
  // stay on top of it. Unconditionally appending `preserved` buried the page
  // under its own background picture.
  slide.elements = [
    ...preserved.filter(isPageBackground),
    ...generatedSlide.elements,
    ...preserved.filter((element) => !isPageBackground(element)),
  ];
  // Relayout replaces the composition; a group whose members were regenerated
  // would point at ids that no longer exist, so the grouping is dropped.
  slide.groups = undefined;
  const generatedLayout = temp.layouts?.[0];
  if (!generatedLayout) {
    delete slide.layoutId;
    return;
  }
  const existingLayout = document.layouts?.find(
    (layout) =>
      layout.name === generatedLayout.name &&
      (layout.backgroundColor ?? "").toUpperCase() === (generatedLayout.backgroundColor ?? "").toUpperCase(),
  );
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
  if (command.type === "rename-document") {
    const title = command.title.trim();
    if (!title || title.length > 512) throw new Error("DOCUMENT_TITLE_INVALID");
    document.title = title;
    return;
  }
  if (command.type === "set-page-size") {
    const { width, height } = command.pageSize;
    // PowerPoint's own limits: a page this editor accepts must open and stay
    // editable there. Fractional EMU would also break stable import/export.
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < inches(MIN_PAGE_SIZE_IN) ||
      width > inches(MAX_PAGE_SIZE_IN) ||
      height < inches(MIN_PAGE_SIZE_IN) ||
      height > inches(MAX_PAGE_SIZE_IN)
    )
      throw new Error("INVALID_PAGE_SIZE");
    const previous = document.pageSize;
    document.pageSize = { width, height };
    if (command.scaleObjects && (previous.width !== width || previous.height !== height)) {
      const scaleX = width / previous.width;
      const scaleY = height / previous.height;
      for (const slide of document.slides) {
        for (const element of slide.elements) scaleElementForPage(element, scaleX, scaleY);
      }
    }
    return;
  }
  if (command.type === "replace-text-edits") {
    if (command.edits.length === 0 || command.edits.length > 500) throw new Error("TEXT_EDITS_INVALID");
    // Resolve and validate every target before writing, so one bad id cannot
    // leave the document half-replaced. Each kind checks the same invariants
    // its single-target command would: a batch must not be a way around a lock
    // or a length limit.
    const resolved = command.edits.map((edit) => {
      if (edit.kind === "document-title") {
        const title = edit.text.trim();
        if (!title || title.length > 512) throw new Error("DOCUMENT_TITLE_INVALID");
        return { kind: "document-title" as const, text: title };
      }
      const targetSlide = document.slides.find((slide) => slide.id === edit.slideId);
      if (!targetSlide) throw new Error("TEXT_EDIT_TARGET_INVALID");
      if (edit.kind === "speaker-notes") {
        if (edit.text.length > 20_000) throw new Error("CONTENT_TEXT_TOO_LONG");
        return { kind: "speaker-notes" as const, slide: targetSlide, text: edit.text };
      }
      if (edit.kind === "text") {
        const target = targetSlide.elements.find((element) => element.id === edit.elementId);
        if (!target || target.type !== "text") throw new Error("TEXT_EDIT_TARGET_INVALID");
        if (target.locked) throw new Error("ELEMENT_LOCKED");
        if (edit.text.length > 20_000) throw new Error("CONTENT_TEXT_TOO_LONG");
        return { kind: "text" as const, slide: targetSlide, element: target, text: edit.text };
      }
      if (edit.kind === "table-cell") {
        const target = targetSlide.elements.find((element) => element.id === edit.elementId);
        if (!target || target.type !== "table" || target.contentBlockId !== edit.blockId) {
          throw new Error("TEXT_EDIT_TARGET_INVALID");
        }
        if (target.locked) throw new Error("ELEMENT_LOCKED");
        const block = findTableBlock(targetSlide, edit.blockId);
        if (!block) throw new Error("CONTENT_BLOCK_NOT_TABLE");
        const { cell } = edit;
        if (!Number.isInteger(cell.column) || cell.column < 0 || cell.column >= block.header.length) {
          throw new Error("TABLE_CELL_OUT_OF_RANGE");
        }
        if (cell.section === "body" && (!Number.isInteger(cell.row) || cell.row < 0 || cell.row >= block.rows.length)) {
          throw new Error("TABLE_CELL_OUT_OF_RANGE");
        }
        // The same per-field limits as `set-table-cell`. A long replacement must
        // not build a cell the project schema would reject on save.
        if (edit.text.length > (cell.section === "header" ? 200 : 500)) throw new Error("CONTENT_TEXT_TOO_LONG");
        return { kind: "table-cell" as const, slide: targetSlide, block, cell, text: edit.text };
      }
      const target = targetSlide.elements.find((element) => element.id === edit.elementId);
      if (!target || target.type !== "chart" || !target.contentBlockIds.includes(edit.blockId)) {
        throw new Error("TEXT_EDIT_TARGET_INVALID");
      }
      if (target.locked) throw new Error("ELEMENT_LOCKED");
      const block = findMetricBlock(targetSlide, edit.blockId);
      if (!block) throw new Error("CONTENT_BLOCK_NOT_METRIC");
      if (edit.text.length > 1_000) throw new Error("CONTENT_TEXT_TOO_LONG");
      return { kind: "metric" as const, slide: targetSlide, block, field: edit.field, text: edit.text };
    });

    for (const edit of resolved) {
      if (edit.kind === "document-title") {
        document.title = edit.text;
        continue;
      }
      if (edit.kind === "speaker-notes") {
        edit.slide.content.speakerNotes = edit.text;
        markContentChanged(edit.slide);
        continue;
      }
      if (edit.kind === "text") {
        applyTextEdit(edit.slide, edit.element, edit.text);
        continue;
      }
      if (edit.kind === "table-cell") {
        const { cell, block, text } = edit;
        if (cell.section === "header") {
          block.header[cell.column] = text;
        } else {
          const row = block.rows[cell.row]!;
          // Rows may be shorter than the header. Padding keeps the grid
          // rectangular instead of writing a hole the schema rejects.
          while (row.length <= cell.column) row.push("");
          row[cell.column] = text;
        }
        markContentChanged(edit.slide);
        continue;
      }
      if (edit.field === "value") edit.block.value = edit.text;
      else edit.block.label = edit.text;
      syncMetricText(edit.slide, edit.block.id, edit.field, edit.text);
      markContentChanged(edit.slide);
    }
    return;
  }
  if (command.type === "add-slide") {
    document.slides.push(createSlide(document.slides.length + 1));
    return;
  }
  if (command.type === "apply-ai-draft") {
    if (!command.title.trim() || command.slides.length < 1 || command.slides.length > 20)
      throw new Error("AI_DRAFT_INVALID");
    document.title = command.title.trim();
    document.slides = command.slides.map((draft, index) => {
      const slide = createSlide(index + 1);
      const blocks = toContentBlocks(draft.blocks);
      slide.content = {
        title: draft.title,
        body: draft.body,
        ...(blocks ? { blocks } : {}),
        speakerNotes: draft.speakerNotes,
        status: "approved",
      };
      const title = slide.elements[0];
      if (title?.type === "text") {
        title.text = draft.title;
        title.origin = "generated";
      }
      if (draft.body.trim())
        slide.elements.push({
          id: crypto.randomUUID() as ElementId,
          type: "text",
          contentRef: "body",
          frame: { x: inches(0.9), y: inches(1.8), width: inches(10.8), height: inches(4.6) },
          rotationMilliDegree: 0,
          locked: false,
          origin: "generated",
          text: draft.body,
          style: { fontFamily: "Microsoft YaHei", fontSizePt: 20, color: "#262626", bold: false, align: "left" },
        });
      return slide;
    });
    // 应用已审核的 AI 内容也是确认动作：设计阶段之前就留下内容基线。
    captureContentVersion(document);
    return;
  }
  if (command.type === "apply-ai-designed-draft") {
    if (
      !command.title.trim() ||
      command.slides.length < 1 ||
      command.slides.length > 20 ||
      command.designs.length !== command.slides.length
    )
      throw new Error("AI_DESIGN_INVALID");
    if (command.pageSize) document.pageSize = command.pageSize;
    const templateTheme = readTemplateTheme(command.templateTheme);
    // A template keeps its own placeholders, ink and type sizes. A preset may
    // still supply the palette, but it must not strip the template's region
    // text colour/size: that is what turned a white cover title on a dark
    // template into dark text on a dark picture.
    const hasTemplate = Boolean(
      command.templateLayouts?.length || command.templateDecorations?.length || command.templateTheme,
    );
    // A preset is the fallback for a deck generated without a template: it owns
    // the palette, the font pairing and the type scale. An explicitly chosen
    // preset wins over the template theme while the template keeps its layout.
    const preset = command.themePresetId ? findThemePreset(command.themePresetId) : undefined;
    const theme = preset?.theme ?? templateTheme;
    if (theme) document.theme = theme;
    else delete document.theme;
    // The type scale of the template or preset. Every branch reads this instead
    // of repeating point sizes, so the deck keeps one hierarchy.
    const typeScale = resolveTypeScale(document.theme);
    // The leading a theme declares for running copy. Frames that hold body text
    // reserve the same height, so the text and its box cannot disagree.
    const bodyLeading = document.theme?.textStyles?.body?.lineHeight ?? 1.25;
    // Fonts follow the same precedence as the type scale: the template wins,
    // then the theme/preset, then the renderer default.
    const majorFont = preset
      ? (document.theme?.majorFont ?? "Microsoft YaHei")
      : command.fontFamily || document.theme?.majorFont || "Microsoft YaHei";
    const minorFont = preset
      ? (document.theme?.minorFont ?? document.theme?.majorFont ?? "Microsoft YaHei")
      : command.bodyFontFamily ||
        command.fontFamily ||
        document.theme?.minorFont ||
        document.theme?.majorFont ||
        "Microsoft YaHei";
    // A chosen preset owns the type scale. On a template page the template's
    // placeholder ink still wins: a white cover title on a dark template must
    // not become dark just because a preset was applied on top of it.
    const effectiveLayouts = preset
      ? (command.templateLayouts ?? []).map((layout) => ({
          ...layout,
          regions: layout.regions.map(({ fontSizePt: _size, textColor, ...region }) =>
            hasTemplate && textColor ? { ...region, textColor } : region,
          ),
        }))
      : command.templateLayouts;
    // The design replaces every page, so the layouts of the previous template
    // must not survive as empty references.
    const layouts: SlideLayoutSpec[] = [];
    document.layouts = layouts;
    const layoutSpecs = new Map<number, SlideLayoutSpec>();
    const pageWidth = document.pageSize.width;
    const pageHeight = document.pageSize.height;
    const pageWidthIn = pageWidth / 914400;
    const pageHeightIn = pageHeight / 914400;
    const frame = (x: number, y: number, width: number, height: number): RectEmu => ({
      x: Math.round(x * pageWidth) as Emu,
      y: Math.round(y * pageHeight) as Emu,
      width: Math.round(width * pageWidth) as Emu,
      height: Math.round(height * pageHeight) as Emu,
    });
    // A slide is wider than it is tall, so a circle has to be sized in inches on
    // both axes. A square in normalized coordinates is an ellipse on screen.
    const circleFrame = (x: number, y: number, diameterInches: number): RectEmu =>
      frame(x, y, diameterInches / pageWidthIn, diameterInches / pageHeightIn);
    const fittedFontSize = (
      value: string,
      box: RectEmu,
      preferredPt: number,
      minimumPt = 12,
      lineHeightRatio = 1.2,
      maximumPt = preferredPt,
    ): number => {
      const widthPt = box.width / 12_700;
      const heightPt = box.height / 12_700;
      // The same line estimator the quality gate uses decides whether a size
      // fits, so a page that passes generation cannot be reported as overflow.
      const fits = (size: number) =>
        estimateTextLines(value, widthPt, size, majorFont) * size * lineHeightRatio <= heightPt;
      const minimum = Math.max(1, Math.round(minimumPt));
      const maximum = Math.max(minimum, Math.round(maximumPt));
      const preferred = Math.min(maximum, Math.max(minimum, Math.round(preferredPt)));
      if (fits(preferred)) {
        for (let size = preferred + 1; size <= maximum; size += 1) {
          if (!fits(size)) return size - 1;
        }
        return maximum;
      }
      for (let size = preferred - 1; size >= minimum; size -= 1) {
        if (fits(size)) return size;
      }
      return minimum;
    };
    // Every text element is checked against the background it actually sits on.
    // A design that asks for dark text on dark artwork is corrected instead of
    // being rendered as invisible copy.
    const ink = (luminance: number) =>
      luminance < 0.45 ? { strong: "#FFFFFF", soft: "#DCE3EA" } : { strong: "#171A1F", soft: "#3E4650" };
    const text = (
      value: string,
      box: RectEmu,
      fontSizePt: number,
      color: string,
      bold: boolean,
      align: "left" | "center" | "right",
      contentRef?: "title" | "body" | "decorative",
      background?: BackgroundRange | number | null,
      minimumPt = 12,
    ): TextElement => {
      const fitted = fittedFontSize(value, box, fontSizePt, minimumPt);
      const range = typeof background === "number" ? { darkest: background, lightest: background } : background;
      const palette = ink(range ? range.darkest : 1);
      const large = isLargeText(fitted, bold);
      const fallback = bold ? palette.strong : palette.soft;
      // null means "the background is artwork we could not sample". Flipping the
      // ink against the page colour in that case is what turned a white template
      // cover title into dark text on a dark picture.
      const resolved =
        range === null
          ? color
          : range
            ? readableTextColorOnRange(color, range, large, fallback)
            : readableTextColor(color, 1, large, fallback);
      return {
        id: crypto.randomUUID() as ElementId,
        type: "text" as const,
        contentRef,
        frame: box,
        rotationMilliDegree: 0,
        locked: false,
        text: value,
        style: { fontFamily: majorFont, fontSizePt: fitted, color: resolved, bold, align },
      };
    };
    const shape = (
      box: RectEmu,
      fill: string,
      kind: "rectangle" | "ellipse" = "rectangle",
      stroke = fill,
      strokeWidthPt = 0,
    ) => ({
      id: crypto.randomUUID() as ElementId,
      type: "shape" as const,
      frame: box,
      rotationMilliDegree: 0,
      locked: false,
      shape: kind,
      style: { fill, stroke, strokeWidthPt, radiusPt: kind === "ellipse" ? 999 : 8 },
    });
    const points = (body: string) =>
      body
        .split(/\n+|(?=(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*)/)
        .map((value) => value.trim())
        .filter(Boolean);
    const cleanPoint = stripListPrefix;
    // 整册的构图在画之前就要定下来：模板版式的选择依赖构图，而构图要看着
    // 整册的节奏来定。逐页独立决定构图会让相邻页长成一个样。
    const pageFacts = command.slides.map((content, index) => {
      const design = command.designs[index]!;
      const blocks = content.blocks ?? [];
      const quoteBlock = blocks.find(
        (block): block is Extract<AiContentBlock, { type: "quote" }> => block.type === "quote",
      );
      const blockItems = blocks
        .filter((block): block is Extract<AiContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
        .flatMap((block) => block.items);
      const items = blockItems.length > 0 ? blockItems : points(content.body);
      const cleanItems = items.map(cleanPoint);
      const facts: CompositionFacts = {
        itemCount: items.length,
        shortItems: cleanItems.every((item) => item.length <= LAYOUT_CAPACITY.shortItemLength),
        longestItemLength: cleanItems.reduce((longest, item) => Math.max(longest, item.length), 0),
        bodyLength: content.body.length,
        hasQuote: Boolean(detectPullQuote({ quoteText: quoteBlock?.text, items })),
        hasComparison: blocks.some((block) => block.type === "comparison"),
        hasRowBlock: blocks.some(
          (block) => block.type === "timeline" || block.type === "process" || block.type === "metric",
        ),
        layout: design.layout,
      };
      return {
        facts,
        requested:
          design.composition && design.composition !== "auto"
            ? design.composition
            : design.visualNarrative
              ? narrativeComposition(design.visualNarrative)
              : design.composition,
      };
    });
    const deckPlan = planDeckCompositions(pageFacts);
    // The layout of every page is decided as a sequence: the deck should rotate
    // through a small set of template layouts instead of repeating one artwork.
    const layoutIntents: TemplateLayoutIntent[] = command.slides.map((content, index) => {
      const design = command.designs[index]!;
      const blocks = content.blocks ?? [];
      const hasBlock = (type: AiContentBlock["type"]) => blocks.some((block) => block.type === type);
      // The template intent must match the composition the renderer will actually
      // produce. An editorial page is drawn on a body-like template, a card grid
      // on a card template, and two columns on a two-column template; choosing
      // artwork that contradicts the composition leaves the new composition on
      // top of the wrong geometry.
      const composition = deckPlan.compositions[index]!;
      if (design.layout === "cover") return "cover";
      if (design.layout === "section") return "section";
      if (design.recipe === "image-led" || design.visualAsset?.enabled) return "image";
      if (hasBlock("comparison")) return "split";
      if (hasBlock("timeline") || hasBlock("process") || hasBlock("metric")) return "cards";
      if (design.layout === "quote") return "quote";
      if (hasBlock("quote") && composition !== "editorial") return "quote";
      if (composition === "editorial") return "body";
      if (composition === "grid") return "cards";
      if (composition === "columns") return "split";
      return "body";
    });
    const chosenLayouts = planTemplateLayouts({
      layouts: effectiveLayouts ?? [],
      intents: layoutIntents,
      rhythm: command.backgroundRhythm,
    });
    document.title = command.title.trim();
    document.slides = command.slides.map((content, index) => {
      const baseDesign = command.designs[index]!;
      // A chosen preset owns the palette: the model's per-page colours are a
      // variation inside that design system, not a reason to leave it.
      const paletteOf = (slot: string) => preset?.theme.colors.find((color) => color.name === slot)?.value;
      const design = preset
        ? {
            ...baseDesign,
            accent: paletteOf("accent") ?? baseDesign.accent,
            // Palette-aware AI designs have already been constrained to this
            // preset. Preserve their dark/light page rhythm. Legacy/manual
            // designs without roles keep the preset's safe defaults.
            background: baseDesign.palette ? baseDesign.background : (paletteOf("surface") ?? baseDesign.background),
            titleColor: baseDesign.palette ? baseDesign.titleColor : (paletteOf("primary") ?? baseDesign.titleColor),
            bodyColor: baseDesign.palette ? baseDesign.bodyColor : (paletteOf("muted") ?? baseDesign.bodyColor),
          }
        : baseDesign;
      const slide = createSlide(index + 1);
      slide.background = design.background;
      const contentBlocks = toContentBlocks(content.blocks);
      slide.content = {
        title: content.title,
        body: content.body,
        ...(contentBlocks ? { blocks: contentBlocks } : {}),
        speakerNotes: content.speakerNotes,
        status: "approved",
      };
      const blocks = content.blocks ?? [];
      const bulletItems = blocks
        .filter((block): block is Extract<AiContentBlock, { type: "bullet-list" }> => block.type === "bullet-list")
        .flatMap((block) => block.items);
      // The structured block is the fact source. Body copy is only a fallback
      // for legacy or hand-authored drafts that do not carry blocks.
      const items = bulletItems.length > 0 ? bulletItems : points(content.body);
      const timelineBlock = blocks.find(
        (block): block is Extract<AiContentBlock, { type: "timeline" }> => block.type === "timeline",
      );
      const comparisonBlock = blocks.find(
        (block): block is Extract<AiContentBlock, { type: "comparison" }> => block.type === "comparison",
      );
      const processBlock = blocks.find(
        (block): block is Extract<AiContentBlock, { type: "process" }> => block.type === "process",
      );
      const quoteBlock = blocks.find(
        (block): block is Extract<AiContentBlock, { type: "quote" }> => block.type === "quote",
      );
      const metricBlocks = blocks.filter(
        (block): block is Extract<AiContentBlock, { type: "metric" }> => block.type === "metric",
      );
      // A table block is rendered as a native table: the exporter writes real
      // table cells, so the reviewer keeps an editable grid instead of a picture.
      const tableBlock = blocks.find(
        (block): block is Extract<AiContentBlock, { type: "table-data" }> => block.type === "table-data",
      );
      // A quoted line already present in the reviewed copy can carry the page
      // as a pull quote. It is a visual emphasis of existing content, never a
      // new claim, and gives dense list pages an editorial anchor.
      const pullQuote = detectPullQuote({ quoteText: quoteBlock?.text, items });
      // A short summary or split page without a quotation still needs a visual
      // anchor. A count panel uses the real number of points, so it fills the
      // right side without inventing a headline or duplicating a bullet.
      const shortItems = items.every((item) => cleanPoint(item).length <= LAYOUT_CAPACITY.shortItemLength);
      const longestItemLength = items.reduce((longest, item) => Math.max(longest, cleanPoint(item).length), 0);
      const hasDeterministicBlock = Boolean(
        timelineBlock || comparisonBlock || processBlock || metricBlocks.length > 0 || tableBlock,
      );
      // A picture for this page. It is generated outside the document, so a page
      // without one simply has no picture: the deck still stands without it.
      const visualAsset = command.visualAssets?.find((asset) => asset.slideIndex === index);
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
          const backgroundColor =
            recipe.backgroundColor && HEX_COLOR_PATTERN.test(recipe.backgroundColor)
              ? recipe.backgroundColor.toUpperCase()
              : undefined;
          spec = {
            id: crypto.randomUUID(),
            name: recipe.name?.trim() || `模板版式 ${recipe.index + 1}`,
            ...(backgroundColor ? { backgroundColor } : {}),
          };
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
      // ink has to read on the patch that carries the text. The probe describes
      // artwork that is only painted when the layout is actually kept; on a flat
      // page it would describe a picture that is not there and turn the title
      // white on a light background.
      const titleBackground = keepsArtwork ? recipe?.backgroundLuminance?.title : undefined;
      const bodyBackground = keepsArtwork ? (recipe?.backgroundLuminance?.body ?? titleBackground) : undefined;
      // null: the artwork is present but its luminance was not sampled. The
      // page colour says nothing about the picture; keep the template/form ink
      // instead of flipping it against a white page.
      const titleLuminance = keepsArtwork && !titleBackground ? null : (titleBackground ?? pageLuminance);
      const bodyLuminance = bodyBackground ?? pageLuminance;
      const isSafeRegion = (
        candidate: { x: number; y: number; width: number; height: number } | undefined,
        minimumWidth: number,
        minimumHeight: number,
      ) =>
        Boolean(
          candidate &&
          candidate.x >= 0 &&
          candidate.y >= 0 &&
          candidate.width >= minimumWidth &&
          candidate.height >= minimumHeight &&
          candidate.x + candidate.width <= 1 &&
          candidate.y + candidate.height <= 1,
        );
      const safeFrame = (
        candidate: { x: number; y: number; width: number; height: number } | undefined,
        fallback: [number, number, number, number],
        minimumWidth = 0.25,
        minimumHeight = 0.08,
      ) =>
        isSafeRegion(candidate, minimumWidth, minimumHeight)
          ? frame(candidate!.x, candidate!.y, candidate!.width, candidate!.height)
          : frame(...fallback);
      const [leftRecipe, rightRecipe] = recipeColumnRegions?.map((region) => region.frame) ?? [];
      const hasSafeColumns =
        isSafeRegion(leftRecipe, 0.25, 0.25) &&
        isSafeRegion(rightRecipe, 0.25, 0.25) &&
        leftRecipe!.x + leftRecipe!.width <= rightRecipe!.x &&
        Math.abs(leftRecipe!.y - rightRecipe!.y) < 0.18;
      const intersects = (left: AiNormalizedRect, right: AiNormalizedRect) =>
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
      const insetObstacle = (region: AiNormalizedRect): AiNormalizedRect => ({
        x: Math.max(0, region.x - 0.015),
        y: Math.max(0, region.y - 0.015),
        width: Math.min(1, region.width + 0.03),
        height: Math.min(1, region.height + 0.03),
      });
      const obstacles = (design.obstacleRegions ?? [])
        .filter((region) => isSafeRegion(region, 0.001, 0.001))
        .map(insetObstacle);
      const largestFreeRegion = (source: AiNormalizedRect): AiNormalizedRect => {
        let candidates = [source];
        for (const obstacle of obstacles) {
          candidates = candidates.flatMap((candidate) => {
            if (!intersects(candidate, obstacle)) return [candidate];
            const right = candidate.x + candidate.width;
            const bottom = candidate.y + candidate.height;
            const obstacleRight = obstacle.x + obstacle.width;
            const obstacleBottom = obstacle.y + obstacle.height;
            return [
              {
                x: candidate.x,
                y: candidate.y,
                width: Math.max(0, obstacle.x - candidate.x),
                height: candidate.height,
              },
              {
                x: Math.min(right, obstacleRight),
                y: candidate.y,
                width: Math.max(0, right - Math.max(candidate.x, obstacleRight)),
                height: candidate.height,
              },
              { x: candidate.x, y: candidate.y, width: candidate.width, height: Math.max(0, obstacle.y - candidate.y) },
              {
                x: candidate.x,
                y: Math.min(bottom, obstacleBottom),
                width: candidate.width,
                height: Math.max(0, bottom - Math.max(candidate.y, obstacleBottom)),
              },
            ].filter((region) => region.width >= 0.28 && region.height >= 0.2);
          });
        }
        return candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0] ?? source;
      };
      const requestedSafe =
        design.safeRegion && isSafeRegion(design.safeRegion, 0.3, 0.25)
          ? design.safeRegion
          : { x: 0.07, y: 0.12, width: 0.86, height: 0.75 };
      const visualSafe = largestFreeRegion(requestedSafe);
      const safeLeft = visualSafe?.x ?? DEFAULT_CONTENT_REGION.left;
      const safeRight = visualSafe ? visualSafe.x + visualSafe.width : DEFAULT_CONTENT_REGION.right;
      const safeTop = visualSafe?.y ?? DEFAULT_CONTENT_REGION.top;
      const safeBottom = visualSafe ? visualSafe.y + visualSafe.height : DEFAULT_CONTENT_REGION.bottom;
      const alignmentGrid = {
        left: safeLeft,
        right: safeRight,
        titleY: safeTop,
        titleHeight: Math.min(0.1, (safeBottom - safeTop) * 0.18),
        ruleY: safeTop + Math.min(0.12, (safeBottom - safeTop) * 0.22),
        contentY: safeTop + Math.min(CONTENT_REGION.contentTopOffset, (safeBottom - safeTop) * 0.3),
        contentBottom: safeBottom,
      } as const;
      slide.elements = [];
      if (keepsArtwork)
        slide.elements.push({
          id: crypto.randomUUID() as ElementId,
          type: "image",
          placement: "layout-background",
          frame: frame(0, 0, 1, 1),
          rotationMilliDegree: 0,
          locked: true,
          source: { kind: "embedded", dataUrl: recipe!.backgroundImageDataUrl!, mimeType: "image/png" },
          altText: `模板版式背景：${recipe!.name ?? recipe!.index}`,
        });
      // A scrim belongs to the text block only. Painting the whole page erased the
      // template artwork and was the single biggest reason a generated deck looked
      // like a blank sheet with a coloured border.
      // The scrim restores the flat page colour over busy artwork. Using the
      // design background painted a black box on a white page: the design's
      // background is not the page's background.
      const scrimFill = slide.background;
      const scrimLuminance = colorLuminance(scrimFill) ?? 1;
      const contentRegion = recipeContent ?? {
        x: alignmentGrid.left,
        y: alignmentGrid.contentY,
        width: alignmentGrid.right - alignmentGrid.left,
        height: alignmentGrid.contentBottom - alignmentGrid.contentY,
      };
      const titleBox = recipeTitle ?? {
        x: alignmentGrid.left,
        y: alignmentGrid.titleY,
        width: alignmentGrid.right - alignmentGrid.left,
        height: alignmentGrid.titleHeight,
      };
      // Template ornaments are painted before the copy, so an ornament that runs
      // across the title sits under the glyphs and reads as a printing accident.
      // A small shape that overlaps the title box is dropped; a large panel
      // behind the title is a background and is kept.
      const titleGuard = {
        x: titleBox.x - 0.004,
        y: titleBox.y - 0.004,
        width: titleBox.width + 0.008,
        height: titleBox.height + 0.008,
      };
      const decorationCovers = (decoration: AiTemplateDecoration): number => {
        const width =
          Math.min(decoration.frame.x + decoration.frame.width, titleGuard.x + titleGuard.width) -
          Math.max(decoration.frame.x, titleGuard.x);
        const height =
          Math.min(decoration.frame.y + decoration.frame.height, titleGuard.y + titleGuard.height) -
          Math.max(decoration.frame.y, titleGuard.y);
        if (width <= 0 || height <= 0) return 0;
        return (width * height) / Math.max(1e-6, decoration.frame.width * decoration.frame.height);
      };
      const decorations = keepsArtwork ? [] : [...(command.templateDecorations ?? []), ...(recipe?.decorations ?? [])];
      decorations.forEach((decoration) => {
        if (!isSafeRegion(decoration.frame, 0.001, 0.001)) return;
        const area = decoration.frame.width * decoration.frame.height;
        if (area < 0.06 && decorationCovers(decoration) > 0.2) return;
        slide.elements.push(
          shape(
            frame(decoration.frame.x, decoration.frame.y, decoration.frame.width, decoration.frame.height),
            decoration.fill,
            decoration.shape,
          ),
        );
      });
      // A picture takes its own place on the page and the text moves out of its
      // way. The image is never laid over the copy: a page where the text is
      // unreadable under a picture is worse than a page without a picture.
      const assetPlan = resolveVisualAsset({
        layout: design.layout,
        itemCount: items.length,
        hasDeterministicBlock,
        requested: Boolean(visualAsset && design.visualAsset?.enabled),
        requestedRole: design.visualAsset?.role,
      });
      const assetLayout =
        visualAsset && assetPlan.enabled && assetPlan.role
          ? planVisualAssetLayout(assetPlan.role, contentRegion, pageWidth, pageHeight)
          : undefined;
      // The text area shrinks to whatever the picture left behind.
      const contentBox = assetLayout ? assetLayout.text : contentRegion;
      // The same text area in the units the element frames use.
      const contentAreaEmu = frame(contentBox.x, contentBox.y, contentBox.width, contentBox.height);
      // One chrome per page: title axis, accent rule and content region. Every
      // recipe and every legacy branch reads this object instead of inventing
      // its own title y / rule y / content top. That is what keeps six pages of
      // one deck on the same axis.
      const chrome = planPageChrome({
        page: { width: pageWidth, height: pageHeight },
        title: frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
        content: frame(contentBox.x, contentBox.y, contentBox.width, contentBox.height),
        safe: {
          x: safeLeft,
          y: safeTop,
          width: safeRight - safeLeft,
          height: safeBottom - safeTop,
        },
        // A template owns its header line and ornaments. Drawing the recipe
        // rule under the template's own rule produced a double header on the
        // generated templates; the content rules stay, the header rule does not.
        showRule: !hasTemplate,
      });
      // The intent of the page: which composition it is drawn in, which level of
      // the hierarchy carries the weight and how much white space it spends.
      // The composition is checked against the reviewed content, so an intent
      // that the content cannot carry is refused instead of producing a page
      // that does not hold its own copy.
      const compositionFacts: CompositionFacts = {
        itemCount: items.length,
        shortItems,
        longestItemLength,
        bodyLength: content.body.length,
        hasQuote: Boolean(pullQuote),
        hasComparison: Boolean(comparisonBlock),
        hasRowBlock: Boolean(timelineBlock || processBlock || metricBlocks.length > 0),
        hasMetric: metricBlocks.length > 0,
        hasTimeline: Boolean(timelineBlock),
        hasProcess: Boolean(processBlock),
        hasTable: Boolean(tableBlock),
        layout: design.layout,
      };
      const intent = resolvePageDesign({
        composition: deckPlan.compositions[index],
        emphasis: design.emphasis,
        densityTarget: design.densityTarget,
        facts: compositionFacts,
      });
      const emphasis = EMPHASIS_FACTORS[intent.emphasis];
      const density = DENSITY_FACTORS[intent.density];
      // An editorial page needs room for a numbered column and an anchor panel
      // beside it. A page that does not have that room falls back to the
      // composition its own layout would have produced.
      const composition =
        intent.composition === "editorial" && (contentBox.width < 0.55 || contentBox.height < 0.35)
          ? autoComposition(compositionFacts, { allowEditorial: false })
          : intent.composition;
      // A short summary or split page without a quotation still needs a visual
      // anchor. A count panel uses the real number of points, so it fills the
      // right side without inventing a headline or duplicating a bullet.
      const countPanel =
        !pullQuote &&
        (design.layout === "summary" || design.layout === "split" || composition === "editorial") &&
        items.length >= LAYOUT_CAPACITY.panelMinItems &&
        items.length <= LAYOUT_CAPACITY.panelMaxItems &&
        shortItems;
      if (artworkTreatment === "local-scrim") {
        slide.elements.push(
          shape(
            frame(
              Math.max(0, contentBox.x - 0.02),
              Math.max(0, contentBox.y - 0.02),
              Math.min(1 - Math.max(0, contentBox.x - 0.02), contentBox.width + 0.04),
              Math.min(1 - Math.max(0, contentBox.y - 0.02), contentBox.height + 0.04),
            ),
            scrimFill,
          ),
        );
      }
      // The picture goes on the page before the text, so the text stays on top of
      // it wherever the two touch. The picture is cropped to fill its box: a
      // stretched picture is the fastest way to make a generated deck look fake.
      if (visualAsset && assetLayout) {
        const imageFrame = frame(
          assetLayout.image.x,
          assetLayout.image.y,
          assetLayout.image.width,
          assetLayout.image.height,
        );
        const crop = coverCrop(
          { width: visualAsset.naturalWidth, height: visualAsset.naturalHeight },
          { width: assetLayout.image.width * pageWidth, height: assetLayout.image.height * pageHeight },
        );
        slide.elements.push({
          id: crypto.randomUUID() as ElementId,
          type: "image",
          placement: "content",
          frame: imageFrame,
          rotationMilliDegree: 0,
          locked: false,
          source: { kind: "embedded", dataUrl: visualAsset.dataUrl, mimeType: visualAsset.mimeType },
          altText: visualAsset.altText,
          ...(crop ? { crop } : {}),
        });
      }
      const contentTextLuminance =
        artworkTreatment === "local-scrim" ? scrimLuminance : keepsArtwork && !bodyBackground ? null : bodyLuminance;
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
      const blockHeight = (value: string, widthFraction: number, fontSizePt: number, lineHeight = 1.25) => {
        const widthPt = widthFraction * (pageWidth / 914400) * 72;
        return pointsToFraction(estimateTextLines(value, widthPt, fontSizePt, majorFont) * fontSizePt * lineHeight);
      };
      const centeredBlock = (
        value: string,
        slot: { x: number; y: number; width: number; height: number },
        fontSizePt: number,
      ) => {
        const height = blockHeight(value, slot.width, fontSizePt) * 1.04;
        return frame(slot.x, slot.y + slot.height / 2 - height / 2, slot.width, height);
      };
      /**
       * 把一个文字框收进文字区。
       *
       * 封面和章节页的标题框来自模板占位或固定比例，不看内容区的宽窄。
       * 页面右侧放了图之后，这些框会一直伸到图下面，标题就压在图上了。
       * 收进文字区之后，标题停在图开始的地方。
       */
      const clipToTextArea = (box: RectEmu, area: RectEmu): RectEmu => {
        const right = Math.min(box.x + box.width, area.x + area.width);
        const bottom = Math.min(box.y + box.height, area.y + area.height);
        const left = Math.max(box.x, area.x);
        const top = Math.max(box.y, area.y);
        // 完全在文字区之外的框保持原样：收成一个零宽的框会让文字消失。
        if (right <= left || bottom <= top) return box;
        return { x: left as Emu, y: top as Emu, width: (right - left) as Emu, height: (bottom - top) as Emu };
      };
      // A concept page is drawn by a pure recipe before the legacy branch chain.
      // The recipe only appends content elements; background artwork, scrim,
      // footer, contrast repairs and visual repairs remain in the shared passes
      // below. Every reviewed item is checked by `consumed`; a recipe that would
      // drop copy throws instead of writing the page.
      const recipePlan = (() => {
        const concept = command.designConcept;
        // A recipe only appends content elements, so a template's background,
        // Logo and decorations stay in place. The recipe still has to fit the
        // template's title/body placeholders, which the chrome above carries.
        if (!concept) return undefined;
        const hasActualAsset = Boolean(visualAsset && assetLayout);
        const templateImage = recipe ? templateImageRegion(recipe)?.frame : undefined;
        const selection = selectRecipe({
          facts: compositionFacts,
          concept,
          requested: design.recipe,
          options: {
            hasArtwork: keepsArtwork,
            hasAsset: hasActualAsset,
            hasTemplate,
            ...(templateImage ? { hasTemplateImage: true } : {}),
            ...(hasActualAsset && assetPlan.role ? { assetRole: assetPlan.role } : {}),
          },
        });
        if (!selection.recipe) return undefined;
        const pageIndex = command.pageContext?.index ?? index;
        const pageTotal = command.pageContext?.total ?? command.slides.length;
        const tokens = deriveDesignTokens(document.theme, document.pageSize, concept);
        // The template artwork is the background the recipe actually paints on.
        // A dark artwork needs the title ink as the accent, otherwise the
        // numbers and rules disappear into the picture.
        const artworkDark = keepsArtwork
          ? (bodyBackground?.darkest ?? titleBackground?.darkest ?? pageLuminance) < 0.45
          : pageLuminance < 0.45;
        const accentInk = artworkDark ? titleInk : design.accent;
        const ruleInk = artworkDark ? "#DCE3EA" : "#E2E7EC";
        const plan = selection.recipe.plan({
          content: slide.content,
          facts: compositionFacts,
          concept,
          tokens,
          colors: {
            title: titleInk,
            body: bodyInk,
            accent: accentInk,
            background: slide.background,
            rule: ruleInk,
            card: cardFill,
          },
          frame: {
            title: frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
            content: frame(contentBox.x, contentBox.y, contentBox.width, contentBox.height),
            safe: {
              x: safeLeft,
              y: safeTop,
              width: safeRight - safeLeft,
              height: safeBottom - safeTop,
            },
            page: { width: pageWidth, height: pageHeight },
          },
          page: { index: pageIndex, total: pageTotal },
          chrome,
          ...(templateImage ? { templateImage } : {}),
          ...(design.variant ? { variant: design.variant } : {}),
          ...(design.focal ? { focal: design.focal } : {}),
        });
        if (!("elements" in plan)) return undefined;
        const problem = consumptionProblem(plan, slide.content);
        if (problem) throw new Error(`AI_DESIGN_CONTENT_LOSS: ${problem}`);
        return plan;
      })();
      if (recipePlan) {
        slide.elements.push(...recipePlan.elements);
        if (recipePlan.imageFrame && visualAsset) {
          // The picture was placed before the recipe with the default side/band
          // geometry. A recipe that owns the picture may give it a larger frame;
          // recomputing the crop keeps the image from stretching.
          for (let imageIndex = slide.elements.length - 1; imageIndex >= 0; imageIndex -= 1) {
            const candidate = slide.elements[imageIndex]!;
            if (candidate.type !== "image" || candidate.placement !== "content") continue;
            candidate.frame = frame(
              recipePlan.imageFrame.x,
              recipePlan.imageFrame.y,
              recipePlan.imageFrame.width,
              recipePlan.imageFrame.height,
            );
            const crop = coverCrop(
              { width: visualAsset.naturalWidth, height: visualAsset.naturalHeight },
              { width: candidate.frame.width, height: candidate.frame.height },
            );
            if (crop) candidate.crop = crop;
            else delete candidate.crop;
            break;
          }
        }
      } else if (design.layout === "cover" && !hasDeterministicBlock) {
        const coverTitle = safeFrame(recipeTitle, [0.1, 0.24, 0.78, 0.28], 0.25, 0.04);
        const coverBody = safeFrame(recipeContent, [0.1, 0.56, 0.72, 0.16], 0.25, 0.08);
        // A picture on the cover takes the right side of the page, so the
        // headline and the subtitle have to stop where the picture starts.
        // Otherwise the title runs underneath the picture.
        const clippedTitle = clipToTextArea(coverTitle, contentAreaEmu);
        const clippedBody = clipToTextArea(coverBody, contentAreaEmu);
        // A four-character title at display size looks like a caption on a
        // 13-inch page. A short cover title may grow to hold the page; a long
        // one keeps the display size, because the frame is the limit.
        const coverTitleSize =
          templateTitleSize ??
          (content.title.trim().length <= 8 ? Math.min(72, Math.round(typeScale.display * 1.5)) : typeScale.display);
        if (!keepsArtwork)
          slide.elements.push(
            shape(frame(0, 0, 0.035, 1), design.accent),
            shape(frame(0.08, 0.7, 0.18, 0.018), design.accent),
          );
        slide.elements.push(
          text(content.title, clippedTitle, coverTitleSize, titleInk, true, "left", undefined, titleLuminance),
        );
        if (content.body.trim())
          slide.elements.push(
            text(
              content.body,
              clippedBody,
              templateBodySize ?? typeScale.subtitle,
              bodyInk,
              false,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
      } else if (design.layout === "section" && !hasDeterministicBlock) {
        const sectionTitle = safeFrame(recipeTitle, [0.39, 0.3, 0.5, 0.22], 0.25, 0.04);
        const sectionBody = safeFrame(recipeContent, [0.39, 0.56, 0.47, 0.2], 0.25, 0.08);
        // The template draws its own section number into the artwork, so PPTD must
        // not add a second one on top of it.
        if (!keepsArtwork)
          slide.elements.push(
            shape(frame(0, 0, 0.32, 1), design.accent),
            text(
              String(index + 1).padStart(2, "0"),
              frame(0.07, 0.17, 0.16, 0.18),
              52,
              "#FFFFFF",
              true,
              "left",
              undefined,
              accentLuminance,
            ),
          );
        slide.elements.push(
          text(
            content.title,
            clipToTextArea(sectionTitle, contentAreaEmu),
            templateTitleSize ?? typeScale.section,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (content.body.trim())
          slide.elements.push(
            text(
              content.body,
              clipToTextArea(sectionBody, contentAreaEmu),
              templateBodySize ?? typeScale.body,
              bodyInk,
              false,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
      } else if (timelineBlock) {
        // Every reviewed step is drawn. A timeline that cut its last steps
        // would drop reviewed copy from the exported file, so the row narrows
        // and the type shrinks instead.
        const timelineItems = timelineBlock.items;
        slide.elements.push(
          text(
            content.title,
            frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.2), 0.012),
              design.accent,
            ),
          );
        const startX = contentBox.x + contentBox.width * 0.05;
        const endX = contentBox.x + contentBox.width * 0.95;
        const lineY = contentBox.y + contentBox.height * 0.45;
        const stepGap = timelineItems.length > 1 ? (endX - startX) / (timelineItems.length - 1) : endX - startX;
        const itemWidth = Math.min(0.22, contentBox.width * 0.18, stepGap * 0.92);
        slide.elements.push(shape(frame(startX, lineY, endX - startX, 0.008), design.accent));
        const lineGap = 0.03;
        const labelFraction = pointsToFraction(15 * 1.3);
        const textFraction = pointsToFraction(13 * 1.3 * 2);
        timelineItems.forEach((item, itemIndex) => {
          const x = timelineItems.length === 1 ? (startX + endX) / 2 : startX + itemIndex * stepGap;
          const above = itemIndex % 2 === 0;
          slide.elements.push(shape(circleFrame(x, lineY - 0.15 / pageHeightIn, 0.3), design.accent, "ellipse"));
          // Label and sentence each stay on their own side of the line. The old
          // frames were anchored to the line by a fraction of the content area
          // and were taller than the space they were given, so the sentence of
          // an above item was drawn across the line and its dots.
          const itemLeft = Math.max(
            contentBox.x,
            Math.min(x - itemWidth / 2, contentBox.x + contentBox.width - itemWidth),
          );
          const labelY = above ? lineY - lineGap - textFraction - 0.005 - labelFraction : lineY + lineGap;
          const textY = above ? lineY - lineGap - textFraction : labelY + labelFraction + 0.005;
          const labelFrame = frame(itemLeft, Math.max(contentBox.y, labelY), itemWidth, labelFraction);
          const stepTextFrame = frame(itemLeft, textY, itemWidth, textFraction);
          const labelSize = fittedFontSize(item.label, labelFrame, 15, 10);
          slide.elements.push(
            text(item.label, labelFrame, labelSize, design.accent, true, "center", undefined, contentTextLuminance),
          );
          const stepTextSize = fittedFontSize(item.text, stepTextFrame, 13, 9);
          slide.elements.push(
            text(item.text, stepTextFrame, stepTextSize, bodyInk, false, "center", undefined, contentTextLuminance),
          );
        });
      } else if (comparisonBlock) {
        slide.elements.push(
          text(
            content.title,
            frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
              design.accent,
            ),
          );
        const columnWidth = contentBox.width * CONTENT_REGION.comparisonColumnWidth;
        const columnGap = contentBox.width * CONTENT_REGION.comparisonColumnGap;
        const panelPaddingX = 0.28 / pageWidthIn;
        const columns = [
          { x: contentBox.x, label: comparisonBlock.leftLabel, items: comparisonBlock.leftItems },
          {
            x: contentBox.x + columnWidth + columnGap,
            label: comparisonBlock.rightLabel,
            items: comparisonBlock.rightItems,
          },
        ];
        const labelSize = CONTENT_REGION.comparisonLabelFontSizePt;
        const headerHeight = pointsToFraction(labelSize * 1.2) + 0.018;
        // A comparison column carries every point the writer reviewed. A column
        // that cut its last point would drop reviewed copy from the exported
        // file, so the copy shrinks to fit instead of losing a point.
        const itemText = (items: string[]) => items.map((item) => `• ${cleanPoint(item)}`).join("\n");
        const copyWidth = columnWidth - panelPaddingX * 2;
        const availableHeight = Math.max(0.05, contentBox.height - headerHeight - 0.06);
        const longestColumn = columns.reduce(
          (longest, column) => (itemText(column.items).length > itemText(longest.items).length ? column : longest),
          columns[0]!,
        );
        const itemSize = fittedFontSize(
          itemText(longestColumn.items),
          frame(contentBox.x, contentBox.y, copyWidth, availableHeight),
          CONTENT_REGION.comparisonItemFontSizePt,
          CONTENT_REGION.comparisonMinimumItemFontSizePt,
          1.25,
          CONTENT_REGION.comparisonItemFontSizePt,
        );
        const copyHeight = Math.max(
          ...columns.map((column) => blockHeight(itemText(column.items), copyWidth, itemSize, bodyLeading)),
        );
        // The panel is as tall as its copy plus a physical padding, with a small
        // floor for very short copy. A panel that nearly fills the content area
        // starts on the content axis; a short one is centred so the white space
        // is not all below it.
        const panelPaddingY = 0.2 / pageHeightIn;
        const panelHeight = Math.min(contentBox.height, Math.max(0.32, headerHeight + panelPaddingY * 2 + copyHeight));
        const panelTop =
          panelHeight < contentBox.height * 0.7
            ? contentBox.y + (contentBox.height - panelHeight) / 2
            : contentBox.y + 0.02;
        columns.forEach((column) => {
          const copy = itemText(column.items);
          const columnHeight = blockHeight(copy, copyWidth, itemSize, bodyLeading);
          const bodyAreaTop = panelTop + headerHeight + panelPaddingY;
          const bodyAreaHeight = Math.max(0.02, panelHeight - headerHeight - panelPaddingY * 2);
          const textTop = bodyAreaTop + Math.max(0, (bodyAreaHeight - columnHeight) / 2);
          const textHeight = Math.min(
            columnHeight * 1.04 + 0.004,
            Math.max(0.02, contentBox.y + contentBox.height - textTop),
          );
          slide.elements.push(
            shape(frame(column.x, panelTop, columnWidth, panelHeight), cardFill, "rectangle", cardStroke, 0.75),
            shape(frame(column.x, panelTop, columnWidth, headerHeight), accentFill),
          );
          slide.elements.push(
            text(
              column.label,
              centeredBlock(
                column.label,
                { x: column.x + 0.02, y: panelTop, width: columnWidth - 0.04, height: headerHeight },
                labelSize,
              ),
              labelSize,
              "#FFFFFF",
              true,
              "center",
              undefined,
              accentFillLuminance,
            ),
          );
          slide.elements.push(
            text(
              copy,
              frame(column.x + panelPaddingX, textTop, copyWidth, textHeight),
              itemSize,
              bodyInk,
              false,
              "left",
              undefined,
              cardLuminance,
            ),
          );
        });
      } else if (tableBlock) {
        const tableIndex = blocks.indexOf(tableBlock);
        const tableContent = contentBlocks?.[tableIndex];
        slide.elements.push(
          text(
            content.title,
            frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.2), 0.012),
              design.accent,
            ),
          );
        // The table element holds no cells of its own: it points at the reviewed
        // table block, so editing the numbers keeps the grid in sync.
        if (tableContent?.type === "table-data" && tableContent.header.length > 0 && tableContent.rows.length > 0) {
          slide.elements.push({
            id: crypto.randomUUID() as ElementId,
            type: "table",
            contentBlockId: tableContent.id,
            frame: frame(
              contentBox.x,
              contentBox.y + contentBox.height * 0.06,
              contentBox.width,
              Math.min(contentBox.height * 0.8, 0.52),
            ),
            rotationMilliDegree: 0,
            locked: false,
            style: {
              fontFamily: command.bodyFontFamily || majorFont,
              fontSizePt: 14,
              headerFill: accentFill,
              headerTextColor: "#FFFFFF",
              bodyTextColor: bodyInk,
              borderColor: cardStroke,
              firstColumnBold: true,
              bandingFill: cardFill,
              headerBold: true,
              cellPaddingPt: 6,
              borderWidthPt: 0.75,
            },
          });
        }
      } else if (metricBlocks.length > 0) {
        // Every reviewed metric is drawn. A page that cut its last metrics
        // would drop reviewed numbers from the exported file, so the grid
        // grows a row and the type shrinks instead.
        const metrics = metricBlocks;
        slide.elements.push(
          text(
            content.title,
            frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
              design.accent,
            ),
          );
        // The metrics of a page are the reviewed numbers of the page. When they
        // are numbers of the same unit, they are drawn as a native chart: the
        // exported file keeps an editable chart instead of a picture of bars.
        const metricContentBlocks = (contentBlocks ?? []).filter(
          (block): block is MetricBlock => block.type === "metric",
        );
        const chartMetrics = metrics
          .map((metric, metricIndex) => {
            const parsed = parseMetricValue(metric.value);
            const block = metricContentBlocks[metricIndex];
            return parsed && block
              ? { blockId: block.id, label: metric.label, value: parsed.value, unit: parsed.unit }
              : undefined;
          })
          .filter((metric): metric is { blockId: string; label: string; value: number; unit: string } =>
            Boolean(metric),
          );
        const sameUnit =
          chartMetrics.length > 0 && chartMetrics.every((metric) => metric.unit === chartMetrics[0]!.unit);
        if (chartMetrics.length >= 2 && sameUnit) {
          // A page with many categories reads better with horizontal bars.
          const kind = chartMetrics.length > 4 ? "bar" : "column";
          const chartFrame = frame(
            contentBox.x,
            contentBox.y + contentBox.height * 0.06,
            contentBox.width,
            Math.min(contentBox.height * 0.8, 0.46),
          );
          slide.elements.push({
            id: crypto.randomUUID() as ElementId,
            type: "chart",
            contentBlockIds: chartMetrics.map((metric) => metric.blockId),
            kind,
            frame: chartFrame,
            rotationMilliDegree: 0,
            locked: false,
            style: {
              fontFamily: command.bodyFontFamily || majorFont,
              fontSizePt: 14,
              textColor: bodyInk,
              seriesColors: [design.accent, accentFill, cardStroke],
              showLegend: false,
              showValueLabels: true,
            },
          });
        } else {
          const columns = metrics.length > 3 ? 3 : metrics.length;
          const rows = Math.ceil(metrics.length / columns);
          const cellWidth = contentBox.width / columns;
          const cardGap = 0.03;
          const valueSize = columns >= 3 ? 40 : 48;
          const labelSize = 18;
          const cardPaddingX = 0.22 / pageWidthIn;
          const cardPaddingY = 0.2 / pageHeightIn;
          const cardWidth = cellWidth - cardGap;
          const valueHeight = Math.max(
            ...metrics.map((metric) => blockHeight(metric.value, cardWidth - cardPaddingX * 2, valueSize, bodyLeading)),
          );
          const labelHeight = Math.max(
            ...metrics.map((metric) => blockHeight(metric.label, cardWidth - cardPaddingX * 2, labelSize, bodyLeading)),
          );
          // The card carries a number and its label; the height is measured
          // from those two blocks plus a physical padding. The old 0.24 cap
          // left a 1.8in card holding a single line of 15pt label with a hole
          // between the number and its name.
          const cardHeight = Math.min(
            Math.max(0.24, contentBox.height / rows - cardGap),
            Math.max(0.24, cardPaddingY * 2 + valueHeight + 0.02 + labelHeight),
          );
          const gridHeight = rows * cardHeight + (rows - 1) * cardGap;
          const gridTop = contentBox.y + (contentBox.height - gridHeight) * CONTENT_REGION.blockVerticalAnchor;
          metrics.forEach((metric, metricIndex) => {
            const column = metricIndex % columns;
            const row = Math.floor(metricIndex / columns);
            const width = cardWidth;
            const x = contentBox.x + column * cellWidth;
            const y = gridTop + row * (cardHeight + cardGap);
            // The card text is a view of the reviewed metric, not a copy of it.
            // The link is what makes editing the card edit the content.
            const block = metricContentBlocks[metricIndex];
            slide.elements.push(shape(frame(x, y, width, cardHeight), cardFill, "rectangle", cardStroke, 0.75));
            // The number and its label share a card that grows shorter with
            // every extra row, so both are fitted to the card they sit in.
            const valueFrame = frame(x + cardPaddingX, y + cardPaddingY, width - cardPaddingX * 2, valueHeight);
            const fittedValueSize = fittedFontSize(
              metric.value,
              frame(valueFrame.x, valueFrame.y, valueFrame.width, valueFrame.height),
              valueSize,
              24,
              bodyLeading,
              valueSize + 8,
            );
            const valueText = text(
              metric.value,
              valueFrame,
              fittedValueSize,
              design.accent,
              true,
              "center",
              undefined,
              cardLuminance,
            );
            if (block) valueText.contentBlockRef = { blockId: block.id, field: "value" };
            slide.elements.push(valueText);
            const labelFrame = frame(
              x + cardPaddingX,
              y + cardPaddingY + valueHeight + 0.02,
              width - cardPaddingX * 2,
              labelHeight,
            );
            const fittedLabelSize = fittedFontSize(
              metric.label,
              frame(labelFrame.x, labelFrame.y, labelFrame.width, labelFrame.height),
              labelSize,
              12,
              bodyLeading,
              20,
            );
            const labelText = text(
              metric.label,
              labelFrame,
              fittedLabelSize,
              bodyInk,
              false,
              "center",
              undefined,
              cardLuminance,
            );
            if (block) labelText.contentBlockRef = { blockId: block.id, field: "label" };
            slide.elements.push(labelText);
          });
        }
      } else if (processBlock) {
        // Every reviewed step is drawn. A process that cut its last steps
        // would drop reviewed copy from the exported file, so the row narrows
        // and the type shrinks instead.
        const processItems = processBlock.items;
        slide.elements.push(
          text(
            content.title,
            frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
              design.accent,
            ),
          );
        const stepGap = 0.03 * density.gap;
        const stepWidth =
          (contentBox.width - stepGap * Math.max(processItems.length - 1, 0)) / Math.max(processItems.length, 1);
        const labelSize = 20;
        const textSize = 16;
        const badgeSize = 14;
        const badgeDiameter = 0.38;
        const badgeHeight = badgeDiameter / pageHeightIn;
        // Padding is a physical distance, not a share of the page. The old
        // 0.045-of-page-width value took 0.6in from each side of a 2.8in card
        // and left a 1.6in text column, which is what broke "建库" into "建"
        // and "库" on the same card.
        const paddingX = 0.22 / pageWidthIn;
        const paddingY = 0.22 / pageHeightIn;
        const labelHeight = pointsToFraction(labelSize * 1.3);
        const bodyHeight = Math.max(
          ...processItems.map((item) => blockHeight(item.text, stepWidth - paddingX * 2, textSize, bodyLeading)),
        );
        const stepHeight = Math.min(
          contentBox.height,
          Math.min(0.36, Math.max(0.2, paddingY * 2 + badgeHeight + 0.02 + labelHeight + 0.01 + bodyHeight)),
        );
        // The band sits on the content axis when it nearly fills the area. A
        // short band is centred instead of being pinned to the top with its
        // white space all at the bottom.
        const stepTop =
          stepHeight < contentBox.height * 0.7
            ? contentBox.y + (contentBox.height - stepHeight) / 2
            : contentBox.y + 0.02;
        processItems.forEach((item, itemIndex) => {
          const x = contentBox.x + itemIndex * (stepWidth + stepGap);
          const badgeX = x + paddingX;
          const badgeY = stepTop + paddingY;
          slide.elements.push(
            shape(frame(x, stepTop, stepWidth, stepHeight), cardFill, "rectangle", cardStroke, 0.75),
            shape(frame(x, stepTop, stepWidth, 0.008), design.accent),
          );
          slide.elements.push(shape(circleFrame(badgeX, badgeY, badgeDiameter), accentFill, "ellipse"));
          slide.elements.push(
            text(
              String(itemIndex + 1),
              centeredBlock(
                String(itemIndex + 1),
                { x: badgeX, y: badgeY, width: badgeDiameter / pageWidthIn, height: badgeHeight },
                badgeSize,
              ),
              badgeSize,
              "#FFFFFF",
              true,
              "center",
              undefined,
              accentFillLuminance,
            ),
          );
          // Left aligned type reads as an editorial column; centring every line
          // in four identical boxes is what made the page look like a template.
          const labelY = badgeY + badgeHeight + 0.018;
          const labelFrame = frame(x + paddingX, labelY, stepWidth - paddingX * 2, labelHeight);
          const fittedLabelSize = fittedFontSize(item.label, labelFrame, labelSize, 12);
          slide.elements.push(
            text(item.label, labelFrame, fittedLabelSize, titleInk, true, "left", undefined, cardLuminance),
          );
          const copyFrame = frame(
            x + paddingX,
            labelY + labelHeight + 0.008,
            stepWidth - paddingX * 2,
            Math.max(0.04, bodyHeight),
          );
          const fittedTextSize = fittedFontSize(item.text, copyFrame, textSize, 10);
          slide.elements.push(
            text(item.text, copyFrame, fittedTextSize, bodyInk, false, "left", undefined, cardLuminance),
          );
        });
      } else if ((design.layout === "quote" || quoteBlock) && items.length < 3) {
        const quoteText = quoteBlock?.text ?? content.body;
        const attribution = quoteBlock?.attribution?.trim();
        if (!keepsArtwork) slide.elements.push(shape(frame(0.08, 0.16, 0.025, 0.68), design.accent));
        const quoteTitle = text(
          content.title,
          safeFrame(recipeTitle, [0.15, 0.12, 0.72, 0.13], 0.25, 0.04),
          templateTitleSize ?? 28,
          titleInk,
          true,
          "left",
          undefined,
          titleLuminance,
        );
        slide.elements.push(quoteTitle);
        if (quoteText.trim()) {
          const quoteBox = safeFrame(recipeContent, [0.16, 0.3, 0.66, 0.38], 0.25, 0.12);
          const quoteFrame = {
            x: quoteBox.x + Math.round(pageWidth * 0.035),
            y: quoteBox.y,
            width: Math.max(Math.round(pageWidth * 0.25), quoteBox.width - Math.round(pageWidth * 0.035)),
            height: quoteBox.height,
          };
          const quoteSize = Math.max(26, templateBodySize ?? 26);
          const quoteElement = text(
            quoteText,
            centeredBlock(
              quoteText,
              {
                x: quoteFrame.x / pageWidth,
                y: quoteFrame.y / pageHeight,
                width: quoteFrame.width / pageWidth,
                height: quoteFrame.height / pageHeight,
              },
              quoteSize,
            ),
            quoteSize,
            bodyInk,
            false,
            "left",
            undefined,
            contentTextLuminance,
          );
          slide.elements.push(quoteElement);
          const markY = quoteElement.frame.y / pageHeight - 0.065;
          const titleBottom = quoteTitle.frame.y / pageHeight + quoteTitle.frame.height / pageHeight;
          if (!keepsArtwork && markY > titleBottom + 0.01) {
            const markX = Math.max(0.02, quoteFrame.x / pageWidth - 0.08);
            slide.elements.push(
              text(
                "“",
                frame(markX, markY, 0.07, 0.12),
                60,
                design.accent,
                true,
                "left",
                undefined,
                contentTextLuminance,
              ),
            );
          }
          if (attribution) {
            const attributionY = quoteElement.frame.y / pageHeight + quoteElement.frame.height / pageHeight + 0.025;
            if (attributionY < 0.9) {
              slide.elements.push(
                text(
                  `— ${attribution}`,
                  frame(
                    quoteFrame.x / pageWidth,
                    attributionY,
                    quoteFrame.width / pageWidth,
                    Math.min(0.06, 0.96 - attributionY),
                  ),
                  14,
                  bodyInk,
                  false,
                  "left",
                  undefined,
                  contentTextLuminance,
                ),
              );
            }
          }
        }
      } else if (
        composition === "editorial" &&
        (pullQuote || countPanel) &&
        items.length >= LAYOUT_CAPACITY.panelMinItems &&
        items.length <= LAYOUT_CAPACITY.panelMaxItems &&
        contentBox.width >= 0.55 &&
        contentBox.height >= 0.35
      ) {
        // A narrow numbered column plus one visual anchor: an oversized pull
        // quote copied from the reviewed body, or the real count of summary
        // points when there is no quote. Neither invents content.
        const listItems = items.slice(0, 5);
        const listWidth = contentBox.width * 0.56;
        const panelX = contentBox.x + contentBox.width * 0.6;
        const panelWidth = contentBox.width * 0.37;
        const numberWidth = Math.min(0.07, listWidth * 0.16);
        const itemSize = Math.max(17, Math.min(20, templateBodySize ?? typeScale.body));
        const cleanItems = listItems.map(cleanPoint);
        // The rows are measured instead of divided into equal slots. A row that
        // needs two lines and a row that needs one leave a different amount of
        // white space around them when both get the same slot, and the rhythm
        // of the column breaks.
        const listFlow = layoutFlow({
          items: cleanItems,
          widthPt: (listWidth - numberWidth - 0.03) * pageWidthIn * 72,
          availableHeightPt: contentBox.height * pageHeightIn * 72,
          preferredFontSizePt: itemSize,
          minimumFontSizePt: 14,
          minimumGapPt: 6 * 72 * 0.0139 * density.gap,
          // A compact page does not let the leftover space drift the points
          // apart: the list has to read as one list.
          ...(density.gap < 1 ? { maximumGapPt: 18 * density.gap } : {}),
          lineHeightRatio: density.leading,
          fontFamily: majorFont,
        });
        const flowFontPt = listFlow.fontSizePt;
        const rowGapPt = listFlow.gapPt;
        const flowHeightFraction = (points: number) => points / (pageHeightIn * 72);
        const numberSize = Math.max(
          PANEL_TYPE_SCALE.railNumberMinPt,
          Math.min(PANEL_TYPE_SCALE.railNumberMaxPt, flowFontPt * PANEL_TYPE_SCALE.railNumberRatio),
        );
        slide.elements.push(
          text(
            content.title,
            frame(titleBox.x, titleBox.y, titleBox.width, titleBox.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(titleBox.x, titleBox.y + titleBox.height + 0.03, Math.min(0.12, titleBox.width * 0.2), 0.012),
              design.accent,
            ),
          );
        listFlow.rows.forEach((row, itemIndex) => {
          const rowY = contentBox.y + flowHeightFraction(row.topPt);
          const rowHeight = flowHeightFraction(row.heightPt);
          slide.elements.push(shape(frame(contentBox.x, rowY, 0.006, rowHeight), design.accent));
          // The number sits on the first line of its row, so the column of
          // numbers reads as one straight line even when the rows below it
          // need a second line. Its box is one line of its own size: a numeral
          // that is a step above the copy needs a taller line, and squeezing it
          // into the row's line box was what shrank it back to body size.
          const numberLineHeight = flowHeightFraction(numberSize * 1.25);
          const numberBox = { x: contentBox.x + 0.015, y: rowY, width: numberWidth, height: numberLineHeight };
          slide.elements.push(
            text(
              String(itemIndex + 1).padStart(2, "0"),
              frame(numberBox.x, numberBox.y, numberBox.width, numberBox.height),
              numberSize,
              design.accent,
              true,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
          const itemBox = {
            x: contentBox.x + numberWidth + 0.03,
            y: rowY,
            width: listWidth - numberWidth - 0.03,
            height: rowHeight,
          };
          slide.elements.push(
            text(
              row.text,
              frame(itemBox.x, itemBox.y, itemBox.width, itemBox.height),
              row.fontSizePt,
              bodyInk,
              false,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
          if (itemIndex < listFlow.rows.length - 1)
            slide.elements.push(
              shape(
                frame(contentBox.x, rowY + rowHeight + flowHeightFraction(rowGapPt) / 2 - 0.002, listWidth, 0.004),
                cardStroke,
              ),
            );
        });
        slide.elements.push(shape(frame(panelX, contentBox.y, panelWidth, contentBox.height), accentFill, "rectangle"));
        if (pullQuote) {
          const quoteAttribution = quoteBlock?.attribution?.trim();
          const panelQuote = quoteAttribution ? `${pullQuote}\n— ${quoteAttribution}` : pullQuote;
          const quoteWidthPt = (panelWidth - 0.1) * pageWidthIn * 72;
          const panelHeightPt = contentBox.height * pageHeightIn * 72;
          const pageHeightPt = pageHeightIn * 72;
          // The panel is measured instead of split into fixed fractions. The
          // quote mark, the quote and the label are placed by the height the
          // quote really needs, so a short quote does not leave a hole under
          // the mark and a long one does not push the label off the panel.
          const markSize = 62;
          // The quote mark keeps its own size: shrinking it to fit the panel
          // made the largest ornament of the page the smallest object on it.
          // The height is one line of the mark, so the fitting step of the text
          // helper does not shrink it either.
          const markHeightPt = markSize * 1.25;
          const labelHeightPt = PANEL_TYPE_SCALE.labelPt * 1.25;
          const markTopPt = 8;
          const labelBottomMarginPt = 10;
          const labelTopPt = panelHeightPt - labelHeightPt - labelBottomMarginPt;
          // The quote sits under the mark and is centred in the room that is left
          // above the rule, so the panel reads as one block instead of a
          // mark, a hole and a quote.
          const quoteAreaTopPt = markTopPt + markHeightPt + 4;
          const quoteAreaPt = Math.max(20, labelTopPt - 14 - quoteAreaTopPt);
          // The font size is the largest one whose quote still fits the area.
          // Picking it by the length of the text instead ignored the width of
          // the panel and produced quotes of three different sizes. The size
          // is also capped: a pull quote is a display object, but a quote that
          // is set larger than the title of the page takes over the page.
          const quoteSizes = [30, 28, 26, 24, 22, 20, 18].filter(
            (size) => size >= PANEL_TYPE_SCALE.quoteMinPt && size <= PANEL_TYPE_SCALE.quoteMaxPt,
          );
          let quoteSize = quoteSizes[quoteSizes.length - 1]!;
          let quoteHeightPt = 0;
          for (const size of quoteSizes) {
            const lines = estimateTextLines(panelQuote, quoteWidthPt, size, majorFont);
            const height = lines * size * 1.25;
            quoteSize = size;
            quoteHeightPt = height;
            if (height <= quoteAreaPt) break;
          }
          const quoteTopPt = quoteAreaTopPt + Math.max(0, (quoteAreaPt - quoteHeightPt) / 2);
          const quoteFrame = frame(
            panelX + 0.05,
            contentBox.y + quoteTopPt / pageHeightPt,
            panelWidth - 0.1,
            quoteHeightPt / pageHeightPt,
          );
          slide.elements.push(
            text(
              "“",
              frame(panelX + 0.04, contentBox.y + markTopPt / pageHeightPt, 0.2, markHeightPt / pageHeightPt),
              markSize,
              "#FFFFFF",
              true,
              "left",
              undefined,
              accentFillLuminance,
            ),
          );
          slide.elements.push(
            text(panelQuote, quoteFrame, quoteSize, "#FFFFFF", false, "left", undefined, accentFillLuminance),
          );
          // The rule and the label keep their place under the quote, so the
          // panel always ends the same way. The rule keeps a clear distance
          // above the label: too close and the line cuts through the text.
          const rulePt = labelTopPt - 12;
          const ruleY = contentBox.y + rulePt / pageHeightPt;
          slide.elements.push(shape(frame(panelX + 0.05, ruleY, panelWidth - 0.1, 0.004), "#FFFFFF"));
          slide.elements.push(
            text(
              "关键摘录",
              frame(
                panelX + 0.05,
                contentBox.y + labelTopPt / pageHeightPt,
                panelWidth - 0.1,
                labelHeightPt / pageHeightPt,
              ),
              PANEL_TYPE_SCALE.labelPt,
              "#FFFFFF",
              true,
              "left",
              undefined,
              accentFillLuminance,
            ),
          );
        } else {
          const countText = String(items.length).padStart(2, "0");
          // The numeral is the anchor, so measure its own block and place the
          // rule and label below it instead of guessing a fixed fraction. Short
          // panels step the numeral down so the label and footer still fit.
          const compact = contentBox.height < 0.4;
          const countSize = compact ? 64 : 86;
          const labelSize = compact ? 14 : 18;
          const labelHeight = compact ? 0.05 : 0.07;
          const footerY = contentBox.y + contentBox.height - (compact ? 0.04 : 0.055);
          const countFrame = frame(
            panelX + 0.05,
            contentBox.y + contentBox.height * 0.1,
            panelWidth - 0.1,
            blockHeight(countText, panelWidth - 0.1, countSize) * 1.04,
          );
          const countBottom = countFrame.y / pageHeight + countFrame.height / pageHeight;
          const labelY = Math.min(countBottom + 0.04, footerY - labelHeight - 0.01);
          slide.elements.push(
            text(countText, countFrame, countSize, "#FFFFFF", true, "left", undefined, accentFillLuminance),
          );
          slide.elements.push(shape(frame(panelX + 0.05, countBottom + 0.02, panelWidth - 0.1, 0.004), "#FFFFFF"));
          slide.elements.push(
            text(
              "项要点",
              frame(panelX + 0.05, labelY, panelWidth - 0.1, labelHeight),
              labelSize,
              "#FFFFFF",
              true,
              "left",
              undefined,
              accentFillLuminance,
            ),
          );
          slide.elements.push(
            text(
              "本页要点",
              frame(panelX + 0.05, footerY, panelWidth - 0.1, 0.06),
              PANEL_TYPE_SCALE.labelPt,
              "#FFFFFF",
              false,
              "left",
              undefined,
              accentFillLuminance,
            ),
          );
        }
      } else if (composition === "grid" && items.length > 1 && items.length <= LAYOUT_CAPACITY.cardsMaxItems) {
        slide.elements.push(
          text(
            content.title,
            frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork) {
          // A single-page deck has no footer, so the page index is its own mark.
          // A longer deck prints the number in the footer; repeating it at the
          // top right made the page look like it had two page numbers.
          if (command.slides.length === 1)
            slide.elements.push(
              text(
                String(index + 1).padStart(2, "0"),
                frame(chrome.title.x + chrome.title.width - 0.07, chrome.title.y, 0.07, chrome.title.height),
                14,
                titleInk,
                true,
                "right",
                undefined,
                titleLuminance,
              ),
            );
          slide.elements.push(
            shape(
              frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
              design.accent,
            ),
          );
        }
        const visible = items.slice(0, 6);
        const columns = visible.length === 3 || visible.length >= 5 ? 3 : 2;
        const rows = Math.ceil(visible.length / columns);
        const contentWidth = contentBox.width;
        const contentHeight = contentBox.height;
        const columnGap = 0.022 * density.gap;
        const rowGap = 0.04 * density.gap;
        const cardWidth = (contentWidth - columnGap * (columns - 1)) / columns;
        // Padding is a physical distance, not a share of the page. A 0.03-of-
        // page-width gutter is 0.4in on a 2-column card and the same 0.4in on a
        // 3-column card, which is where the narrow text column came from.
        const cardPaddingX = 0.24 / pageWidthIn;
        const cardPaddingY = 0.2 / pageHeightIn;
        // A top-left badge frees the whole card width for copy. Placing the
        // badge in a left gutter made the text column narrow and the card
        // look unbalanced on portrait-ish three-column grids.
        const badgeDiameter = 0.36;
        const badgeHeight = badgeDiameter / pageHeightIn;
        const cardTextTop = cardPaddingY + badgeHeight + 0.02;
        // Four short points leave a grid that reads as a caption when the type
        // stays at the dense size. Sparse grids carry one point more.
        const sparseCards = visible.length <= 4 && visible.every((item) => item.trim().length <= 16);
        const cardFontSize = sparseCards ? 19 : 17;
        const cardTextWidth = cardWidth - cardPaddingX * 2;
        const cardTextHeight = Math.max(
          ...visible.map((item) => blockHeight(cleanPoint(item), cardTextWidth, cardFontSize, bodyLeading)),
        );
        // A card is as tall as the badge and the copy it carries. Stretching a
        // one-line card to a fixed 0.24/0.26 page height left the copy stranded
        // in the middle of an empty box.
        const cardHeight = Math.min(
          Math.max(0.16, contentHeight / rows - 0.03),
          Math.max(0.16, cardTextTop + cardTextHeight + cardPaddingY),
        );
        const gridHeight = rows * cardHeight + (rows - 1) * rowGap;
        const gridTop = contentBox.y + (contentHeight - gridHeight) * CONTENT_REGION.blockVerticalAnchor;
        visible.forEach((item, itemIndex) => {
          const row = Math.floor(itemIndex / columns);
          const column = itemIndex % columns;
          const rowItemCount = Math.min(columns, visible.length - row * columns);
          const rowWidth = rowItemCount * cardWidth + (rowItemCount - 1) * columnGap;
          const rowStart = contentBox.x + (contentWidth - rowWidth) / 2;
          const x = rowStart + column * (cardWidth + columnGap);
          const y = gridTop + row * (cardHeight + rowGap);
          const cleanItem = cleanPoint(item);
          const badgeWidth = badgeDiameter / pageWidthIn;
          const badgeX = x + cardPaddingX;
          const badgeY = y + cardPaddingY;
          const textTop = y + cardTextTop;
          slide.elements.push(
            shape(frame(x, y, cardWidth, cardHeight), cardFill, "rectangle", cardStroke, 0.75),
            shape(frame(x, y, cardWidth, 0.008), design.accent),
          );
          slide.elements.push(shape(circleFrame(badgeX, badgeY, badgeDiameter), accentFill, "ellipse"));
          // A point that names something the icon set can draw gets the icon;
          // anything else keeps the number, which stays the honest default.
          const cardIcon = iconForText(cleanItem);
          if (cardIcon) {
            const iconSide = 0.24;
            slide.elements.push({
              id: crypto.randomUUID() as ElementId,
              type: "icon",
              name: cardIcon,
              frame: frame(
                badgeX + (badgeDiameter - iconSide) / 2 / pageWidthIn,
                badgeY + (badgeDiameter - iconSide) / 2 / pageHeightIn,
                iconSide / pageWidthIn,
                iconSide / pageHeightIn,
              ),
              rotationMilliDegree: 0,
              locked: false,
              style: { color: accentFillLuminance > 0.55 ? "#1E2A32" : "#FFFFFF", strokeWidth: 2 },
            });
          } else {
            const badgeText = String(itemIndex + 1).padStart(2, "0");
            slide.elements.push(
              text(
                badgeText,
                centeredBlock(badgeText, { x: badgeX, y: badgeY, width: badgeWidth, height: badgeHeight }, 14),
                14,
                "#FFFFFF",
                true,
                "center",
                undefined,
                accentFillLuminance,
              ),
            );
          }
          const cardTextBox = {
            x: x + cardPaddingX,
            y: textTop,
            width: cardTextWidth,
            height: Math.max(0.05, cardHeight - cardTextTop - cardPaddingY),
          };
          const fittedCardSize = fittedFontSize(
            cleanItem,
            frame(cardTextBox.x, cardTextBox.y, cardTextBox.width, cardTextBox.height),
            cardFontSize,
            12,
            bodyLeading,
            22,
          );
          const fittedHeight = blockHeight(cleanItem, cardTextWidth, fittedCardSize, bodyLeading);
          // Top-align the copy under the badge. The card is already sized to
          // the text; centring a one-line card inside a taller floor is what
          // made short cards look like empty boxes.
          const copyTop = cardTextBox.y;
          slide.elements.push(
            text(
              cleanItem,
              frame(
                cardTextBox.x,
                copyTop,
                cardTextBox.width,
                Math.max(0.04, Math.min(cardTextBox.height, fittedHeight * 1.04 + 0.004)),
              ),
              fittedCardSize,
              "#293241",
              false,
              "left",
              undefined,
              cardLuminance,
            ),
          );
        });
      } else if (composition === "columns" && items.length > 1) {
        slide.elements.push(
          text(
            content.title,
            safeFrame(recipeTitle, [0.07, 0.07, 0.84, 0.13], 0.25, 0.04),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        const cleanItems = items.map(cleanPoint).filter((item) => item.length > 0);
        const slots: Array<{ x: number; y: number; width: number; height: number }> = hasSafeColumns
          ? [
              { x: leftRecipe!.x, y: leftRecipe!.y, width: leftRecipe!.width, height: leftRecipe!.height },
              { x: rightRecipe!.x, y: rightRecipe!.y, width: rightRecipe!.width, height: rightRecipe!.height },
            ]
          : [
              { x: 0.08, y: contentBox.y, width: 0.36, height: contentBox.height },
              { x: 0.57, y: contentBox.y, width: 0.35, height: contentBox.height },
            ];
        const padding = 0.035;
        // The marker owns a gutter of its own, and wrapped lines start at the
        // copy column instead of running back under the bullet. Concatenating
        // "• item" into one paragraph produced a list whose second line started
        // at the bullet, which reads as a typing accident rather than a list.
        const markerGutter = 0.022;
        const rowGap = 0.018 * density.gap;
        const sparseColumns = items.length <= 4 && items.every((item) => item.trim().length <= 16);
        const preferredSize = templateColumnSize ?? (sparseColumns ? 20 : 18);
        const copyWidth = (slot: { width: number }) => slot.width - padding * 2 - markerGutter;
        const measure = (column: string[], slot: { width: number }, size: number) => {
          const width = copyWidth(slot);
          const heights = column.map((item) => blockHeight(item, width, size, bodyLeading));
          return {
            heights,
            total: heights.reduce((sum, height) => sum + height, 0) + rowGap * Math.max(0, heights.length - 1),
          };
        };
        // Both columns share one type size and one top edge. Centring each panel
        // on its own copy put the first line of the left column at a different
        // height from the right one; the eye reads that as a misalignment even
        // when each panel is internally centred.
        const available = Math.min(slots[0]!.height, slots[1]!.height) - padding * 2;
        // Grow the copy to the room the columns have before shrinking it: a pair
        // of panels filled with 18pt copy on a 7.5in page leaves half the card
        // empty and reads as a page that was never finished.
        const maximumSize = Math.min(26, preferredSize + 8);
        // A cut at the midpoint is not always the balanced one: five points of
        // different lengths can put three short ones against two long ones and
        // leave one card half empty. Try every cut and keep the one whose two
        // columns need the same height.
        const bestCut = (size: number) => {
          let best:
            | {
                at: number;
                left: ReturnType<typeof measure>;
                right: ReturnType<typeof measure>;
                difference: number;
                needed: number;
              }
            | undefined;
          for (let at = 1; at < cleanItems.length; at += 1) {
            const left = measure(cleanItems.slice(0, at), slots[0]!, size);
            const right = measure(cleanItems.slice(at), slots[1]!, size);
            const difference = Math.abs(left.total - right.total);
            if (!best || difference < best.difference) {
              best = { at, left, right, difference, needed: Math.max(left.total, right.total) };
            }
          }
          return best;
        };
        let cut = Math.max(1, Math.ceil(cleanItems.length / 2));
        let columnSize = 12;
        let measured = [
          measure(cleanItems.slice(0, cut), slots[0]!, 12),
          measure(cleanItems.slice(cut), slots[1]!, 12),
        ] as const;
        for (let size = maximumSize; size >= 12; size -= 1) {
          const candidate = bestCut(size);
          if (!candidate) break;
          if (candidate.needed <= available || size === 12) {
            cut = candidate.at;
            columnSize = size;
            measured = [candidate.left, candidate.right] as const;
            break;
          }
        }
        // The panels share one top edge and are each as tall as the copy they
        // carry. Forcing a short column to the height of a long one left the
        // shorter card half empty underneath its last point; two cards of
        // different heights that start on the same line read as columns of one
        // block, not as two unrelated objects.
        const panelBlockHeight = Math.min(
          slots[0]!.height,
          slots[1]!.height,
          Math.max(measured[0].total, measured[1].total) + padding * 2,
        );
        [cleanItems.slice(0, cut), cleanItems.slice(cut)].forEach((column, columnIndex) => {
          const slot = slots[columnIndex]!;
          const authoredHeight = measured[columnIndex]!.total + padding * 2;
          const panelHeight = Math.min(slot.height, authoredHeight);
          const panelTop = slot.y + (slot.height - panelBlockHeight) / 2;
          slide.elements.push(
            shape(frame(slot.x, panelTop, slot.width, panelHeight), cardFill, "rectangle", cardStroke, 0.75),
            shape(frame(slot.x, panelTop, slot.width, 0.008), design.accent),
          );
          const width = copyWidth(slot);
          let rowY = panelTop + padding;
          column.forEach((item, itemIndex) => {
            const itemHeight = measured[columnIndex]!.heights[itemIndex]!;
            // The marker is its own element, so a wrapped point keeps its
            // hanging indent and the list stays editable point by point.
            slide.elements.push(
              text(
                "•",
                frame(slot.x + padding, rowY, markerGutter, Math.max(0.02, itemHeight)),
                columnSize,
                design.accent,
                false,
                "left",
                undefined,
                cardLuminance,
              ),
            );
            slide.elements.push(
              text(
                item,
                frame(slot.x + padding + markerGutter, rowY, width, Math.max(0.02, itemHeight + 0.004)),
                columnSize,
                bodyInk,
                false,
                "left",
                undefined,
                cardLuminance,
              ),
            );
            rowY += itemHeight + rowGap;
          });
        });
      } else if (
        composition === "stacked" &&
        (design.layout === "title-body" || design.layout === "summary") &&
        items.length >= LAYOUT_CAPACITY.cardsGridMinItems &&
        items.length <= LAYOUT_CAPACITY.cardsMaxItems
      ) {
        // A short list is a sequence of visual units, not one paragraph. Keeping
        // it as a single text box was the reason a five-point page looked like a
        // small block stranded in a large empty canvas.
        const listItems = items.slice(0, 6);
        slide.elements.push(
          text(
            content.title,
            safeFrame(
              recipeTitle,
              [
                alignmentGrid.left,
                alignmentGrid.titleY,
                alignmentGrid.right - alignmentGrid.left,
                alignmentGrid.titleHeight,
              ],
              0.25,
              0.04,
            ),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(
                alignmentGrid.left,
                alignmentGrid.ruleY,
                Math.min(0.11, (alignmentGrid.right - alignmentGrid.left) * 0.2),
                0.012,
              ),
              design.accent,
            ),
          );
        const rowGap = Math.min(0.012 * density.gap, contentBox.height * 0.02);
        const rowHeight = (contentBox.height - rowGap * (listItems.length - 1)) / listItems.length;
        const numberWidth = Math.min(0.085, contentBox.width * 0.12);
        const itemWidth = contentBox.width - numberWidth - 0.02;
        const numberSize = Math.max(12, Math.min(22, rowHeight * pageHeightIn * 72 * 0.52));
        listItems.forEach((item, itemIndex) => {
          const rowY = contentBox.y + itemIndex * (rowHeight + rowGap);
          const cleanItem = cleanPoint(item);
          slide.elements.push(shape(frame(contentBox.x, rowY, 0.008, rowHeight), design.accent));
          slide.elements.push(
            text(
              String(itemIndex + 1).padStart(2, "0"),
              centeredBlock(
                String(itemIndex + 1).padStart(2, "0"),
                { x: contentBox.x + 0.022, y: rowY, width: numberWidth, height: rowHeight },
                numberSize,
              ),
              numberSize,
              design.accent,
              true,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
          slide.elements.push(
            text(
              cleanItem,
              centeredBlock(
                cleanItem,
                { x: contentBox.x + numberWidth + 0.025, y: rowY, width: itemWidth, height: rowHeight },
                templateBodySize ?? typeScale.body,
              ),
              templateBodySize ?? typeScale.body,
              bodyInk,
              false,
              "left",
              undefined,
              contentTextLuminance,
            ),
          );
          if (itemIndex < listItems.length - 1)
            slide.elements.push(
              shape(frame(contentBox.x, rowY + rowHeight + rowGap / 2 - 0.003, contentBox.width, 0.006), cardStroke),
            );
        });
      } else {
        slide.elements.push(
          text(
            content.title,
            frame(chrome.title.x, chrome.title.y, chrome.title.width, chrome.title.height),
            templateTitleSize ?? typeScale.title,
            titleInk,
            true,
            "left",
            undefined,
            titleLuminance,
          ),
        );
        if (!keepsArtwork)
          slide.elements.push(
            shape(
              frame(chrome.rule.x, chrome.rule.y, chrome.rule.width, Math.max(0.009, chrome.rule.height)),
              design.accent,
            ),
          );
        if (content.body.trim()) {
          // A single paragraph used to be pinned to the top of a full-height
          // frame: 17pt copy ended at 38% of the page and the rest was white.
          // A closing/summary page with short copy is now set larger and
          // centred as one statement. A template body placeholder keeps its own
          // geometry and size: the template's type scale is not ours to
          // overwrite. Running copy keeps the theme's body size.
          const templateBody = recipeContent;
          const summary = design.layout === "summary" || design.layout === "quote";
          const shortStatement = summary && content.body.length <= 160;
          const bodyWidth = templateBody ? templateBody.width : Math.min(contentBox.width, 0.72);
          const preferred = templateBody ? (templateBodySize ?? typeScale.body) : shortStatement ? 22 : typeScale.body;
          const bodyBox = templateBody
            ? safeFrame(templateBody, [contentBox.x, contentBox.y, bodyWidth, contentBox.height], 0.25, 0.12)
            : frame(contentBox.x, contentBox.y, bodyWidth, contentBox.height);
          const bodySize = fittedFontSize(
            content.body,
            bodyBox,
            preferred,
            12,
            bodyLeading,
            templateBody ? preferred : shortStatement ? 24 : preferred,
          );
          const measured = blockHeight(content.body, bodyWidth, bodySize, bodyLeading);
          const centered = shortStatement && measured < contentBox.height * 0.55;
          const bodyY = centered
            ? contentBox.y + (contentBox.height - measured) / 2
            : templateBody
              ? templateBody.y
              : contentBox.y;
          const bodyFrame = centered
            ? frame(
                templateBody ? templateBody.x : contentBox.x,
                bodyY,
                bodyWidth,
                Math.max(0.06, measured * 1.04 + 0.004),
              )
            : templateBody
              ? bodyBox
              : frame(contentBox.x, bodyY, bodyWidth, Math.max(0.06, measured * 1.04 + 0.004));
          slide.elements.push(
            text(content.body, bodyFrame, bodySize, bodyInk, false, "left", undefined, contentTextLuminance),
          );
        }
      }
      // Link rendered title/body text back to semantic content. Structured
      // layouts (cards, timeline items, metrics) stay decorative because one
      // visual element cannot safely overwrite a multi-field content block.
      const bodyFontFamily = minorFont;
      const titleToken = document.theme?.textStyles?.title;
      const bodyToken = document.theme?.textStyles?.body;
      for (const element of slide.elements) {
        if (element.type !== "text") continue;
        if (element.text === content.title) element.contentRef = "title";
        else if (content.body.trim() && element.text === content.body) element.contentRef = "body";
        else element.contentRef = "decorative";
        // Display type for the headline, text type for running copy. Using the
        // template major font for both made dense body copy look heavy.
        if (element.contentRef !== "title" && bodyFontFamily) element.style.fontFamily = bodyFontFamily;
        // The type token may also carry tracking and leading. They are design
        // state, so they live on the element like its size and colour.
        const token =
          element.contentRef === "title" ? titleToken : element.contentRef === "body" ? bodyToken : undefined;
        if (token?.letterSpacingPt !== undefined) element.style.letterSpacingPt = token.letterSpacingPt;
        if (token?.lineHeight !== undefined) element.style.lineHeight = token.lineHeight;
      }
      // The typographic quote mark reads as two bars in many CJK UI fonts.
      // A serif glyph keeps the pull quote looking like a quotation instead of
      // a pair of slashes.
      const quoteMark = slide.elements.find((element) => element.type === "text" && element.text === "“");
      if (quoteMark?.type === "text") quoteMark.style.fontFamily = "Georgia";
      const titleRepair = design.elementRepairs?.find(
        (repair) => repair.action !== "changeLayout" && repair.target === "title",
      );
      const bodyRepair = design.elementRepairs?.find(
        (repair) => repair.action !== "changeLayout" && repair.target === "body",
      );
      // A region repair points at a place on the page instead of at a role.
      // The review model looked at a picture, so a rectangle is the only thing
      // it can honestly name.
      const regionRepairs = (design.elementRepairs ?? []).filter(
        (repair): repair is Exclude<AiElementRepair, { action: "changeLayout" }> =>
          repair.action !== "changeLayout" && repair.target === "region",
      );
      const elementBox = (element: { frame: RectEmu }) => ({
        x: element.frame.x / pageWidth,
        y: element.frame.y / pageHeight,
        width: element.frame.width / pageWidth,
        height: element.frame.height / pageHeight,
      });
      /** How much of the element lies inside the region. */
      const overlapRatio = (element: { frame: RectEmu }, region: AiNormalizedRect): number => {
        const box = elementBox(element);
        const left = Math.max(box.x, region.x);
        const top = Math.max(box.y, region.y);
        const right = Math.min(box.x + box.width, region.x + region.width);
        const bottom = Math.min(box.y + box.height, region.y + region.height);
        if (right <= left || bottom <= top) return 0;
        // The boxes are normalized, so their area is far below one. Guarding
        // against a zero denominator must not raise it to one, or every
        // overlap ratio collapses and no region repair ever applies.
        const area = Math.max(1e-6, box.width * box.height);
        return ((right - left) * (bottom - top)) / area;
      };
      const pageArea = pageWidth * pageHeight;
      const overlapArea = (left: RectEmu, right: RectEmu): number => {
        const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
        const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
        return width > 0 && height > 0 ? width * height : 0;
      };
      for (const element of slide.elements) {
        if (element.type !== "text") continue;
        // Text that sits inside a generated card, header bar or panel belongs to
        // that shape. A repair that moves the text alone detaches it from its
        // card and paints it over the page — which is exactly how a generated
        // deck ends up with copy outside its boxes. Geometry repairs therefore
        // stop at the shape boundary; restyling is still allowed.
        const elementArea = element.frame.width * element.frame.height;
        // The text frame is allowed to stand a little outside its container (a
        // centred label can be a few points taller than the bar that carries
        // it), so "belongs to" is measured by overlap, not full containment.
        const container =
          elementArea > 0
            ? slide.elements.find(
                (candidate) =>
                  candidate.type === "shape" &&
                  candidate.frame.width * candidate.frame.height < pageArea * 0.4 &&
                  overlapArea(candidate.frame, element.frame) / elementArea >= 0.8,
              )
            : undefined;
        const repair =
          element.text === content.title ? titleRepair : element.text === content.body ? bodyRepair : undefined;
        if (repair) {
          if ((repair.action === "move" || repair.action === "resize") && !container) {
            const collisionFreeFrame = obstacles.some((obstacle) => intersects(repair.frame, obstacle))
              ? repair.target === "title"
                ? {
                    x: visualSafe.x,
                    y: visualSafe.y,
                    width: visualSafe.width,
                    height: Math.min(0.14, visualSafe.height * 0.22),
                  }
                : {
                    x: visualSafe.x,
                    y: visualSafe.y + Math.min(0.18, visualSafe.height * 0.28),
                    width: visualSafe.width,
                    height: Math.max(0.08, visualSafe.height - Math.min(0.18, visualSafe.height * 0.28)),
                  }
              : repair.frame;
            element.frame = frame(
              collisionFreeFrame.x,
              collisionFreeFrame.y,
              collisionFreeFrame.width,
              collisionFreeFrame.height,
            );
          }
          if (repair.action === "restyle")
            element.style = {
              ...element.style,
              fontSizePt: Math.max(12, element.style.fontSizePt * (repair.fontScale ?? 1)),
              color: repair.color ?? element.style.color,
            };
        }
        // A region repair applies to everything that lies inside the region.
        for (const regionRepair of regionRepairs) {
          const regionFrame = "frame" in regionRepair ? regionRepair.frame : undefined;
          if (!regionFrame) continue;
          if (overlapRatio(element, regionFrame) < 0.5) continue;
          // Moving a contained text without its shape tears the composition
          // apart; only a restyle can be applied safely inside a card.
          if (container && regionRepair.action !== "restyle") continue;
          if (regionRepair.action === "move" || regionRepair.action === "resize") {
            // A region move needs a destination. Without one there is nothing
            // to move towards, so the element keeps its place.
            const destination = regionRepair.to;
            if (!destination) continue;
            // The block inside the region is moved and scaled as one piece, so
            // the relative layout of the block survives the repair.
            const box = elementBox(element);
            const source = regionFrame;
            const scaleX = destination.width / Math.max(0.01, source.width);
            const scaleY = destination.height / Math.max(0.01, source.height);
            const origin = regionRepair.action === "move" ? destination : source;
            const moved = {
              x: origin.x + (box.x - source.x) * scaleX,
              y: origin.y + (box.y - source.y) * scaleY,
              width: box.width * scaleX,
              height: box.height * scaleY,
            };
            if (obstacles.some((obstacle) => intersects(moved, obstacle))) continue;
            element.frame = frame(moved.x, moved.y, moved.width, moved.height);
          }
          if (regionRepair.action === "restyle")
            element.style = {
              ...element.style,
              fontSizePt: Math.max(12, element.style.fontSizePt * (regionRepair.fontScale ?? 1)),
              color: regionRepair.color ?? element.style.color,
            };
          if (regionRepair.action === "align") {
            const box = elementBox(element);
            const aligned =
              regionRepair.axis === "top"
                ? { x: box.x, y: regionFrame.y, width: box.width, height: box.height }
                : { x: regionFrame.x, y: box.y, width: box.width, height: box.height };
            element.frame = frame(aligned.x, aligned.y, aligned.width, aligned.height);
          }
        }
      }
      if (design.hierarchyAction === "strengthen-title") {
        const title = slide.elements.find((element) => element.type === "text" && element.text === content.title);
        if (title?.type === "text")
          title.style = { ...title.style, fontSizePt: Math.min(44, title.style.fontSizePt * 1.15), bold: true };
      }
      if (design.hierarchyAction === "reduce-density") {
        const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
        if (body?.type === "text")
          body.frame = { ...body.frame, height: Math.max(body.frame.height, Math.round(pageHeight * 0.42)) as Emu };
      }
      if (design.hierarchyAction === "increase-whitespace") {
        const body = slide.elements.find((element) => element.type === "text" && element.text === content.body);
        if (body?.type === "text")
          body.frame = {
            ...body.frame,
            x: (body.frame.x + Math.round(pageWidth * 0.025)) as Emu,
            width: Math.max(Math.round(pageWidth * 0.3), body.frame.width - Math.round(pageWidth * 0.05)) as Emu,
          };
      }
      // The emphasis of the page decides which level of the hierarchy carries
      // the weight. A title that is pushed up has to stay inside its own frame,
      // so the size is capped by the height of the box it lives in: a bigger
      // title that no longer fits is a title that overlaps the copy below it.
      if (intent.emphasis !== "balanced") {
        const emphasisTarget = (element: SlideElement, factor: number) => {
          if (element.type !== "text") return;
          const scaled = element.style.fontSizePt * factor;
          const readableInBox = Math.floor(element.frame.height / 12_700 / 1.25);
          element.style = {
            ...element.style,
            fontSizePt: Math.max(12, Math.min(Math.round(scaled), readableInBox, 44)),
          };
        };
        const title = slide.elements.find((element) => element.type === "text" && element.text === content.title);
        if (title) emphasisTarget(title, emphasis.title);
        for (const element of slide.elements) {
          if (element.type !== "text" || element.text === content.title) continue;
          if (content.body.trim() && element.text === content.body) emphasisTarget(element, emphasis.body);
        }
      }
      // A repair or an emphasis can enlarge a text after the layout fitted it.
      // Refit the ink to the frame it ended up in, so a scaled title cannot
      // spill out of its box and paint over the copy below it.
      for (const element of slide.elements) {
        if (element.type !== "text" || !textLikelyOverflows(element)) continue;
        let fitted = element.style.fontSizePt;
        while (fitted > 8) {
          fitted -= 1;
          if (!textLikelyOverflows({ ...element, style: { ...element.style, fontSizePt: fitted } })) break;
        }
        element.style = { ...element.style, fontSizePt: fitted };
      }
      // A repair may also repaint a text with a colour that does not read on the
      // surface it sits on. The last pass resolves every ink against the shape
      // that actually carries it, so a repaint cannot leave invisible copy.
      slide.elements.forEach((element, elementIndex) => {
        if (element.type !== "text") return;
        let carrying: string | undefined;
        const carrierArea = element.frame.width * element.frame.height;
        for (let candidateIndex = 0; candidateIndex < elementIndex; candidateIndex += 1) {
          const candidate = slide.elements[candidateIndex]!;
          if (
            candidate.type === "shape" &&
            carrierArea > 0 &&
            overlapArea(candidate.frame, element.frame) / carrierArea >= 0.8
          )
            carrying = candidate.style.fill;
        }
        const large = isLargeText(element.style.fontSizePt, element.style.bold);
        // The footer sits outside the artwork placeholders, so the artwork
        // probe does not describe what is behind it. Resolving it against the
        // dark content range turned the page number white on a white page.
        const inFooter = element.frame.y >= pageHeight * 0.9;
        if (!carrying && keepsArtwork && !inFooter) {
          // The artwork probe is a range of luminance, not one value; resolve
          // against the same range the page was built with.
          const range = element.contentRef === "title" ? titleBackground : bodyBackground;
          if (range) {
            element.style = {
              ...element.style,
              color: readableTextColorOnRange(element.style.color, range, large, bodyInk),
            };
            return;
          }
        }
        const background = carrying ?? (keepsArtwork && !inFooter ? undefined : slide.background);
        const luminance = background ? colorLuminance(background) : undefined;
        if (luminance === undefined) return;
        element.style = { ...element.style, color: readableTextColor(element.style.color, luminance, large, bodyInk) };
      });
      // Page numbers are part of the generated design, not of the reviewed copy:
      // they are added after the composition so no layout branch has to remember
      // them. A one-page draft has nothing to number, a cover or a section page
      // carries its own mark, and a template that already declares the footer as
      // busy keeps it. The footer never sits on top of the copy: it uses the
      // margin below the safe area.
      const footerBand = { x: 0, y: 0.94, width: 1, height: 0.06 };
      const footerClaimed = obstacles.some((obstacle) => intersects(footerBand, obstacle));
      const templateFooter = recipe ? templateLayoutHasFooterMarker(recipe) : false;
      // Relayout renders one page through a one-slide command. The deck it
      // belongs to still decides whether a footer exists and what it says.
      const pageIndex = command.pageContext?.index ?? index;
      const pageTotal = command.pageContext?.total ?? command.slides.length;
      if (
        pageTotal > 1 &&
        design.layout !== "cover" &&
        design.layout !== "section" &&
        !footerClaimed &&
        !templateFooter
      ) {
        const pageLabel = `${String(pageIndex + 1).padStart(2, "0")} / ${String(pageTotal).padStart(2, "0")}`;
        // The left side names the section the page belongs to, not the deck:
        // a 20-page deck whose footer repeats the deck title on every page says
        // nothing about where the reader is. Without sections it falls back to
        // the deck title.
        let sectionLabel = command.pageContext?.sectionLabel;
        for (let sectionIndex = pageIndex; sectionLabel === undefined && sectionIndex >= 0; sectionIndex -= 1) {
          if (command.designs[sectionIndex]?.layout !== "section") continue;
          const sectionTitle = command.slides[sectionIndex]?.title.trim();
          if (sectionTitle) {
            sectionLabel = sectionTitle;
            break;
          }
        }
        const titleChars = [...(sectionLabel ?? command.title.trim())];
        const footerLabel = titleChars.length > 30 ? `${titleChars.slice(0, 29).join("")}…` : titleChars.join("");
        const footerInk = readableTextColor("#5F6B76", pageLuminance, false, bodyInk);
        slide.elements.push({
          ...text(
            footerLabel,
            frame(alignmentGrid.left, 0.947, 0.55, 0.03),
            10,
            footerInk,
            false,
            "left",
            "decorative",
            pageLuminance,
            8,
          ),
          origin: "generated",
        });
        slide.elements.push({
          ...text(
            pageLabel,
            frame(alignmentGrid.right - 0.16, 0.947, 0.16, 0.03),
            10,
            footerInk,
            false,
            "right",
            "decorative",
            pageLuminance,
            8,
          ),
          origin: "generated",
        });
      }
      // Provenance is what lets a later design-only relayout replace the
      // generated composition without deleting anything the user added.
      for (const element of slide.elements) element.origin = "generated";
      return slide;
    });
    // Applying a reviewed draft is a confirmation act: keep the confirmed copy
    // so a later edit can be compared with what the user actually approved.
    captureContentVersion(document);
    return;
  }
  if (command.type === "duplicate-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    const source = document.slides[sourceIndex]!;
    const duplicate = {
      ...source,
      id: crypto.randomUUID() as SlideId,
      // The element ids are regenerated below; the source groups would point at
      // the old ids, so the duplicate starts ungrouped.
      groups: undefined,
      content: {
        ...source.content,
        ...(source.content.blocks ? { blocks: cloneContentBlocks(source.content.blocks) } : {}),
      },
      elements: source.elements.map((element) =>
        element.type === "text"
          ? {
              ...element,
              id: crypto.randomUUID() as ElementId,
              frame: { ...element.frame },
              style: { ...element.style },
              ...(element.runs ? { runs: element.runs.map((run) => ({ ...run })) } : {}),
            }
          : element.type === "shape"
            ? {
                ...element,
                id: crypto.randomUUID() as ElementId,
                frame: { ...element.frame },
                style: { ...element.style },
              }
            : element.type === "chart"
              ? {
                  ...element,
                  id: crypto.randomUUID() as ElementId,
                  frame: { ...element.frame },
                  style: { ...element.style, seriesColors: [...element.style.seriesColors] },
                  contentBlockIds: [...element.contentBlockIds],
                }
              : element.type === "line"
                ? {
                    ...element,
                    id: crypto.randomUUID() as ElementId,
                    frame: { ...element.frame },
                    style: { ...element.style },
                  }
                : element.type === "table"
                  ? {
                      ...element,
                      id: crypto.randomUUID() as ElementId,
                      frame: { ...element.frame },
                      style: { ...element.style },
                    }
                  : element.type === "icon"
                    ? {
                        ...element,
                        id: crypto.randomUUID() as ElementId,
                        frame: { ...element.frame },
                        style: { ...element.style },
                      }
                    : {
                        ...element,
                        id: crypto.randomUUID() as ElementId,
                        frame: { ...element.frame },
                        source: { ...element.source },
                      },
      ),
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
  if (command.type === "restore-content-version") {
    // 版本恢复只回滚内容：标题、正文、内容块、备注和页序。版式、对象和背景
    // 留在当前文稿里，不能借一次"内容恢复"把设计也静默回滚。
    const version = document.contentVersions?.find((item) => item.id === command.versionId);
    if (!version) throw new Error("CONTENT_VERSION_NOT_FOUND");
    const currentIds = new Set(document.slides.map((item) => item.id));
    if (
      version.slides.length !== document.slides.length ||
      version.slides.some((item) => !currentIds.has(item.slideId))
    ) {
      throw new Error("CONTENT_VERSION_PAGE_SET_MISMATCH");
    }
    const sourceById = new Map(version.slides.map((item) => [item.slideId, item]));
    for (const page of document.slides) {
      const source = sourceById.get(page.id)!;
      const textChanged =
        page.content.title !== source.title ||
        page.content.body !== source.body ||
        page.content.speakerNotes !== source.speakerNotes;
      if (textChanged) {
        page.content.title = source.title;
        page.content.body = source.body;
        page.content.speakerNotes = source.speakerNotes;
      }
      const blocksChanged = restoreSlideBlocks(page, source.blocks);
      const viewsChanged = syncContentText(page, page.content.title, page.content.body);
      if (textChanged || blocksChanged || viewsChanged) markContentChanged(page);
    }
    const order = new Map(version.slides.map((item, index) => [item.slideId, index]));
    document.slides.sort((left, right) => order.get(left.id)! - order.get(right.id)!);
    if (command.includeDesign) {
      const design = version.design;
      if (!design) throw new Error("CONTENT_VERSION_DESIGN_MISSING");
      if (design.slides.length !== document.slides.length) throw new Error("CONTENT_VERSION_DESIGN_PAGE_SET_MISMATCH");
      document.pageSize = structuredClone(design.pageSize);
      if (design.theme) document.theme = structuredClone(design.theme);
      else delete document.theme;
      if (design.layouts) document.layouts = structuredClone(design.layouts);
      else delete document.layouts;
      const designById = new Map(design.slides.map((snapshot) => [snapshot.slideId, snapshot]));
      for (const page of document.slides) {
        const snapshot = designById.get(page.id);
        if (!snapshot) throw new Error("CONTENT_VERSION_DESIGN_PAGE_SET_MISMATCH");
        page.background = snapshot.background;
        page.elements = structuredClone(snapshot.elements);
        if (snapshot.animations) page.animations = structuredClone(snapshot.animations);
        else delete page.animations;
        if (snapshot.transition) page.transition = structuredClone(snapshot.transition);
        else delete page.transition;
        if (snapshot.groups) page.groups = structuredClone(snapshot.groups);
        else delete page.groups;
        if (snapshot.layoutId) page.layoutId = snapshot.layoutId;
        else delete page.layoutId;
      }
    }
    return;
  }

  const slide = document.slides.find((item) => item.id === command.slideId);
  if (!slide) throw new Error("SLIDE_NOT_FOUND");

  if (command.type === "paste-elements") {
    if (command.elements.length === 0 || command.elements.length > 200) throw new Error("PASTE_ELEMENTS_INVALID");
    const offset = command.offsetEmu ?? inches(0.2);
    if (!Number.isFinite(offset) || Math.abs(offset) > inches(10)) throw new Error("PASTE_ELEMENTS_INVALID");
    // A table or chart is a view of content blocks on its own page. Pasting it
    // onto a page without those blocks would create a dangling reference the
    // exporter cannot resolve, so the command refuses instead of pasting a
    // broken object. Text is safe: the copy becomes decorative and loses its
    // block binding in `copyElementForPaste`.
    for (const element of command.elements) {
      if (element.type === "table" && !findTableBlock(slide, element.contentBlockId))
        throw new Error("PASTE_REQUIRES_CONTENT_BLOCK");
      if (element.type === "chart" && element.contentBlockIds.some((blockId) => !findMetricBlock(slide, blockId)))
        throw new Error("PASTE_REQUIRES_CONTENT_BLOCK");
    }
    const copies = command.elements.map((element) => {
      const copy = copyElementForPaste(element, offset);
      copy.origin = "user";
      // A pasted object is a fresh edit target; the source's lock is not a
      // property of the copy.
      copy.locked = false;
      return copy;
    });
    slide.elements.push(...copies);
    return;
  }

  if (command.type === "set-elements-lock") {
    const targets = slide.elements.filter((element) => command.elementIds.includes(element.id));
    if (targets.length === 0) throw new Error("ELEMENT_NOT_FOUND");
    for (const target of targets) target.locked = command.locked;
    return;
  }

  if (command.type === "group-elements") {
    const unique = [...new Set(command.elementIds)];
    if (unique.length < 2) throw new Error("GROUP_TOO_SMALL");
    const targets = unique.map((id) => slide.elements.find((element) => element.id === id));
    if (targets.some((element) => !element)) throw new Error("ELEMENT_NOT_FOUND");
    if (targets.some((element) => element!.locked)) throw new Error("ELEMENT_LOCKED");
    if ((slide.groups ?? []).some((group) => group.elementIds.some((id) => unique.includes(id))))
      throw new Error("ELEMENT_ALREADY_GROUPED");
    slide.groups = [...(slide.groups ?? []), { id: crypto.randomUUID(), elementIds: unique }];
    return;
  }

  if (command.type === "ungroup-elements") {
    const groups = slide.groups ?? [];
    const next = groups.filter((group) => group.id !== command.groupId);
    if (next.length === groups.length) throw new Error("GROUP_NOT_FOUND");
    slide.groups = next.length > 0 ? next : undefined;
    return;
  }

  if (command.type === "set-text-style-elements") {
    assertTextStyle(command.style);
    const targets = slide.elements.filter(
      (element): element is TextElement =>
        command.elementIds.includes(element.id) && element.type === "text" && !element.locked,
    );
    // A batch that selects no editable text would otherwise push an empty undo
    // entry; the UI disables the controls, so this is a programming error.
    if (targets.length === 0) throw new Error("ELEMENT_NOT_TEXT");
    for (const target of targets) {
      target.style = { ...target.style, ...command.style };
      if (command.clearRuns) target.runs = undefined;
    }
    return;
  }
  if (command.type === "clear-text-format") {
    const targets = slide.elements.filter(
      (element): element is TextElement =>
        command.elementIds.includes(element.id) && element.type === "text" && !element.locked,
    );
    if (targets.length === 0) throw new Error("ELEMENT_NOT_TEXT");
    // Clearing restores the deck's own type scale instead of a hard-coded size:
    // the theme owns the body and title tokens, and a deck without a theme keeps
    // the factory defaults. Fragment emphasis is character formatting too, so it
    // goes away with the rest; geometry and copy are untouched.
    for (const target of targets) {
      target.style = clearedTextStyle(target.contentRef, document.theme);
      target.runs = undefined;
    }
    return;
  }

  if (command.type === "relayout-slide") {
    relayoutSlide(document, slide);
    return;
  }
  if (command.type === "set-slide-background") {
    if (!HEX_COLOR_PATTERN.test(command.background)) throw new Error("INVALID_BACKGROUND_COLOR");
    slide.background = command.background;
    return;
  }
  if (command.type === "remove-slide-background-image") {
    slide.elements = slide.elements.filter(
      (element) => element.type !== "image" || element.placement !== "slide-background",
    );
    return;
  }
  if (command.type === "set-slide-background-image") {
    const expectedPrefix = `data:${command.mimeType};base64,`;
    const payload = command.dataUrl.slice(expectedPrefix.length);
    if (
      !command.dataUrl.startsWith(expectedPrefix) ||
      command.dataUrl.length > 360_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
    ) {
      throw new Error("INVALID_IMAGE_SOURCE");
    }
    slide.elements = slide.elements.filter(
      (element) => element.type !== "image" || element.placement !== "slide-background",
    );
    let afterLayoutArtwork = 0;
    while (afterLayoutArtwork < slide.elements.length) {
      const element = slide.elements[afterLayoutArtwork]!;
      if (element.type !== "image" || element.placement !== "layout-background") break;
      afterLayoutArtwork += 1;
    }
    slide.elements.splice(afterLayoutArtwork, 0, {
      id: crypto.randomUUID() as ElementId,
      type: "image",
      placement: "slide-background",
      frame: { x: 0 as Emu, y: 0 as Emu, width: document.pageSize.width, height: document.pageSize.height },
      rotationMilliDegree: 0,
      locked: true,
      origin: "user",
      source: { kind: "embedded", dataUrl: command.dataUrl, mimeType: command.mimeType },
      altText: "页面背景图",
    });
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
    if (
      !command.dataUrl.startsWith(expectedPrefix) ||
      command.dataUrl.length > 360_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(payload) ||
      command.altText.length > 500
    ) {
      throw new Error("INVALID_IMAGE_SOURCE");
    }
    if (command.role !== undefined && !isVisualAssetRole(command.role)) {
      throw new Error("INVALID_VISUAL_ASSET_ROLE");
    }
    // 带角色的图走确定性图位：图落在引擎算好的地方，正文给它让出位置。
    // 不带角色的图是用户随手插的图片，沿用原来的行为——放在页面中间那块空地。
    if (command.role) {
      const layout = planManualVisualAssetLayout(command.role, document.pageSize.width, document.pageSize.height);
      const box = normalizedToEmuRect(layout.image, document.pageSize);
      slide.elements.push({
        id: crypto.randomUUID() as ElementId,
        type: "image",
        frame: fitImageIntoBox(box, command.naturalWidth, command.naturalHeight),
        rotationMilliDegree: 0,
        locked: false,
        origin: "user",
        source: { kind: "embedded", dataUrl: command.dataUrl, mimeType: command.mimeType },
        altText: command.altText,
      });
      makeRoomForAsset(slide, layout.text, document.pageSize);
      return;
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
    if (!SHAPE_KINDS.includes(command.shape)) throw new Error("INVALID_SHAPE_KIND");
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

  if (command.type === "add-icon") {
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "icon",
      name: command.name,
      frame: { x: inches(5.8), y: inches(2.8), width: inches(1), height: inches(1) },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: { color: "#d35230", strokeWidth: 2 },
    });
    return;
  }

  if (command.type === "add-table") {
    if (
      !Number.isInteger(command.columns) ||
      command.columns < 2 ||
      command.columns > TABLE_MAX_COLUMNS ||
      !Number.isInteger(command.rows) ||
      command.rows < 1 ||
      command.rows > TABLE_MAX_ROWS
    )
      throw new Error("INVALID_TABLE_SIZE");
    const block = {
      id: crypto.randomUUID(),
      type: "table-data" as const,
      header: Array.from({ length: command.columns }, (_, index) => `列 ${index + 1}`),
      rows: Array.from({ length: command.rows }, () => Array.from({ length: command.columns }, () => "")),
    };
    slide.content.blocks = [...(slide.content.blocks ?? []), block];
    const width = Math.round(document.pageSize.width * 0.62);
    const height = Math.round(document.pageSize.height * 0.46);
    const headerFill = document.theme?.colors.find((color) => color.name === "primary")?.value ?? "#3366CC";
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "table",
      contentBlockId: block.id,
      frame: {
        x: emu(Math.round((document.pageSize.width - width) / 2)),
        y: emu(Math.round((document.pageSize.height - height) / 2)),
        width: emu(width),
        height: emu(height),
      },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: {
        fontFamily: document.theme?.minorFont ?? "Microsoft YaHei",
        fontSizePt: 14,
        headerFill,
        headerTextColor: "#FFFFFF",
        bodyTextColor: "#17181c",
        borderColor: "#D9DEE5",
        firstColumnBold: true,
        headerBold: true,
        bandingFill: "#F5F7FA",
        cellPaddingPt: 5,
        borderWidthPt: 0.75,
      },
    });
    markContentChanged(slide);
    return;
  }

  if (command.type === "add-chart") {
    if (command.kind !== "column" && command.kind !== "bar" && command.kind !== "line" && command.kind !== "pie")
      throw new Error("INVALID_CHART_KIND");
    // A chart reads reviewed metric blocks. Three placeholder values give the
    // user a chart they can edit in the inspector instead of an empty frame
    // that the exporter would reject.
    const blocks = [
      { label: "项目 A", value: "10" },
      { label: "项目 B", value: "20" },
      { label: "项目 C", value: "30" },
    ].map((metric) => ({ id: crypto.randomUUID(), type: "metric" as const, ...metric }));
    slide.content.blocks = [...(slide.content.blocks ?? []), ...blocks];
    const width = Math.round(document.pageSize.width * 0.62);
    const height = Math.round(document.pageSize.height * 0.5);
    const accent = document.theme?.colors.find((color) => color.name === "accent")?.value ?? "#3366CC";
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "chart",
      contentBlockIds: blocks.map((block) => block.id),
      kind: command.kind,
      frame: {
        x: emu(Math.round((document.pageSize.width - width) / 2)),
        y: emu(Math.round((document.pageSize.height - height) / 2)),
        width: emu(width),
        height: emu(height),
      },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: {
        fontFamily: document.theme?.minorFont ?? "Microsoft YaHei",
        fontSizePt: 14,
        textColor: "#17181c",
        seriesColors: [accent, "#E27D60", "#5B8C5A", "#D6A84B"],
        showLegend: command.kind === "pie",
        showValueLabels: true,
      },
    });
    markContentChanged(slide);
    return;
  }

  if (command.type === "add-line") {
    // 线条默认横着放在页面中间偏上，宽度够长、够细。
    slide.elements.push({
      id: crypto.randomUUID() as ElementId,
      type: "line",
      direction: command.direction,
      frame: {
        x: inches(3),
        y: inches(3),
        width: command.direction === "vertical" ? inches(0.02) : inches(4),
        height: command.direction === "horizontal" ? inches(0.02) : inches(2),
      },
      rotationMilliDegree: 0,
      locked: false,
      origin: "user",
      style: {
        stroke: "#7f2f1d",
        strokeWidthPt: 2,
        startArrow: "none",
        endArrow: command.direction === "diagonal" ? "arrow" : "none",
        dashed: false,
      },
    });
    return;
  }

  // 多选的三个命令在单元素解析之前处理：它们一次动一组对象，没有
  // 单一的 elementId。
  if (command.type === "align-elements") {
    // 多选对齐以这一组的外接框为基准：把三个对象的左边推齐，和把它们推齐
    // 到页面左边，是两件事。前者才是"对齐"。
    const targets = slide.elements.filter((item) => command.elementIds.includes(item.id) && !item.locked);
    if (targets.length === 0) return;
    const reference = unionFrame(targets.map((item) => item.frame));
    if (!reference) return;
    const aligned = alignFrames(
      targets.map((item) => item.frame),
      reference,
      command.align,
    );
    targets.forEach((item, index) => {
      item.frame = aligned[index]!;
    });
    return;
  }
  if (command.type === "distribute-elements") {
    const targets = slide.elements.filter((item) => command.elementIds.includes(item.id) && !item.locked);
    if (targets.length < 3) return;
    const distributed = distributeFrames(
      targets.map((item) => item.frame),
      command.axis,
    );
    targets.forEach((item, index) => {
      item.frame = distributed[index]!;
    });
    return;
  }
  if (command.type === "delete-elements") {
    // 删除整组是一个意图，所以是一个命令、一个撤销项。
    // 逐个删会留下 N 个撤销项，用户得按 N 次撤销才回到原样。
    for (const elementId of command.elementIds) {
      const target = slide.elements.find((item) => item.id === elementId);
      if (!target || target.locked) continue;
      if (target.type === "text") {
        if (target.contentRef === "title") {
          slide.content.title = "";
          markContentChanged(slide);
        }
        if (target.contentRef === "body") {
          slide.content.body = "";
          slide.content.blocks = [];
          markContentChanged(slide);
        }
      }
      slide.elements.splice(
        slide.elements.findIndex((item) => item.id === elementId),
        1,
      );
      if (slide.animations)
        slide.animations = slide.animations.filter((animation) => animation.elementId !== elementId);
    }
    pruneGroups(slide);
    return;
  }
  if (command.type === "move-elements") {
    // 整组一起移动是一个意图，所以是一个命令、一个撤销项。
    if (!Number.isSafeInteger(command.dx) || !Number.isSafeInteger(command.dy))
      throw new Error("INVALID_ELEMENT_TRANSFORM");
    for (const item of slide.elements) {
      if (!command.elementIds.includes(item.id) || item.locked) continue;
      item.frame = { ...item.frame, x: (item.frame.x + command.dx) as Emu, y: (item.frame.y + command.dy) as Emu };
    }
    return;
  }

  if (command.type === "duplicate-elements") {
    // 整组复制是一个意图，所以是一个命令、一个撤销项。
    // 副本插在整组的最后面之后，保持它们原来的相对顺序。
    const offset = inches(0.2);
    const sources = command.elementIds
      .map((id) => slide.elements.find((item) => item.id === id))
      .filter((item): item is SlideElement => Boolean(item) && !item!.locked);
    if (sources.length === 0) return;
    const lastIndex = Math.max(...sources.map((item) => slide.elements.findIndex((other) => other.id === item.id)));
    const copies = sources.map((item) => {
      const copy = copyElementForPaste(item, offset);
      // A copy is user-owned even when its source was generated.
      copy.origin = "user";
      return copy;
    });
    slide.elements.splice(lastIndex + 1, 0, ...copies);
    const copiedAnimations = sources.flatMap((source, index) =>
      (slide.animations ?? [])
        .filter((animation) => animation.elementId === source.id)
        .map((animation) => ({ ...animation, id: crypto.randomUUID(), elementId: copies[index]!.id })),
    );
    if (copiedAnimations.length) slide.animations = [...(slide.animations ?? []), ...copiedAnimations];
    return;
  }

  if (command.type === "set-speaker-notes") {
    // 演讲备注是内容：它进 PPTX 的备注页，也进内容哈希。
    slide.content.speakerNotes = command.notes;
    markContentChanged(slide);
    return;
  }

  if (command.type === "set-slide-transition") {
    if (command.transition === null) {
      delete slide.transition;
      return;
    }
    const { kind, speed, direction } = command.transition;
    if (!["fade", "push", "wipe", "split"].includes(kind) || !["fast", "medium", "slow"].includes(speed)) {
      throw new Error("INVALID_SLIDE_TRANSITION");
    }
    if (direction !== undefined && !["left", "right", "up", "down"].includes(direction)) {
      throw new Error("INVALID_SLIDE_TRANSITION");
    }
    // Split has an orientation rather than a side; the direction still picks
    // which half opens first, so it is kept for every directional kind.
    slide.transition = { kind, speed, ...(direction ? { direction } : {}) };
    return;
  }

  if (command.type === "set-metric") {
    const block = findMetricBlock(slide, command.blockId);
    if (!block) throw new Error("CONTENT_BLOCK_NOT_METRIC");
    if (command.value.length > 1_000) throw new Error("CONTENT_TEXT_TOO_LONG");
    if (command.field === "value") block.value = command.value;
    else block.label = command.value;
    syncMetricText(slide, block.id, command.field, command.value);
    markContentChanged(slide);
    return;
  }

  if (command.type === "set-table-cell") {
    const block = findTableBlock(slide, command.blockId);
    if (!block) throw new Error("CONTENT_BLOCK_NOT_TABLE");
    const { cell } = command;
    if (!Number.isInteger(cell.column) || cell.column < 0 || cell.column >= block.header.length) {
      throw new Error("TABLE_CELL_OUT_OF_RANGE");
    }
    if (cell.section === "header") {
      if (command.value.length > 200) throw new Error("CONTENT_TEXT_TOO_LONG");
      block.header[cell.column] = command.value;
    } else {
      if (!Number.isInteger(cell.row) || cell.row < 0 || cell.row >= block.rows.length) {
        throw new Error("TABLE_CELL_OUT_OF_RANGE");
      }
      if (command.value.length > 500) throw new Error("CONTENT_TEXT_TOO_LONG");
      const row = block.rows[cell.row]!;
      // Rows may be shorter than the header. Filling the gap with empty cells
      // keeps the grid rectangular instead of writing a hole the schema rejects.
      while (row.length <= cell.column) row.push("");
      row[cell.column] = command.value;
    }
    markContentChanged(slide);
    return;
  }

  if (command.type === "approve-slide-content") {
    // 复核闭环的另一半：内容被改过（changed）或人工退回（review）之后，
    // 用户确认这一页仍然是审过的版本，导出前置检查才会放行。
    slide.content.status = "approved";
    // 只有确认才留下可追溯版本；同内容重复确认由 capture 自己跳过。
    captureContentVersion(document);
    return;
  }

  if (command.type === "reopen-slide-content") {
    // 退回审核，不是退回草稿：内容本身没变，只是这一页重新进入审核。
    slide.content.status = "review";
    return;
  }

  if (command.type === "add-animation") {
    const target = slide.elements.find((item) => item.id === command.elementId);
    if (!target) throw new Error("ELEMENT_NOT_FOUND");
    if (target.locked) throw new Error("ELEMENT_LOCKED");
    slide.animations ??= [];
    slide.animations.push({
      id: crypto.randomUUID(),
      elementId: command.elementId,
      phase: phaseForEffect(command.animation.effect),
      ...command.animation,
    });
    return;
  }

  if (command.type === "remove-animation") {
    const index = (slide.animations ?? []).findIndex((animation) => animation.id === command.animationId);
    if (index < 0) throw new Error("ANIMATION_NOT_FOUND");
    const animation = slide.animations![index]!;
    if (slide.elements.find((item) => item.id === animation.elementId)?.locked) throw new Error("ELEMENT_LOCKED");
    slide.animations!.splice(index, 1);
    return;
  }

  if (command.type === "duplicate-animation") {
    const animations = slide.animations ?? [];
    const index = animations.findIndex((animation) => animation.id === command.animationId);
    if (index < 0) throw new Error("ANIMATION_NOT_FOUND");
    const source = animations[index]!;
    if (slide.elements.find((item) => item.id === source.elementId)?.locked) throw new Error("ELEMENT_LOCKED");
    // The copy sits right behind its source so the preview order is obvious.
    animations.splice(index + 1, 0, { ...source, id: crypto.randomUUID() });
    return;
  }

  if (command.type === "clear-slide-animations") {
    const animations = slide.animations ?? [];
    if (animations.some((animation) => slide.elements.find((item) => item.id === animation.elementId)?.locked))
      throw new Error("ELEMENT_LOCKED");
    slide.animations = [];
    return;
  }

  if (command.type === "move-animation") {
    const animations = slide.animations ?? [];
    const index = animations.findIndex((animation) => animation.id === command.animationId);
    if (index < 0) throw new Error("ANIMATION_NOT_FOUND");
    const destination = Math.max(0, Math.min(command.toIndex, animations.length - 1));
    if (destination === index) return;
    const [animation] = animations.splice(index, 1);
    animations.splice(destination, 0, animation!);
    return;
  }

  if (command.type === "set-animation") {
    const animation = (slide.animations ?? []).find((item) => item.id === command.animationId);
    if (!animation) throw new Error("ANIMATION_NOT_FOUND");
    if (slide.elements.find((item) => item.id === animation.elementId)?.locked) throw new Error("ELEMENT_LOCKED");
    if (
      command.changes.durationMs !== undefined &&
      (!Number.isInteger(command.changes.durationMs) ||
        command.changes.durationMs < 100 ||
        command.changes.durationMs > 60_000)
    )
      throw new Error("ANIMATION_DURATION_INVALID");
    if (
      command.changes.delayMs !== undefined &&
      (!Number.isInteger(command.changes.delayMs) || command.changes.delayMs < 0 || command.changes.delayMs > 60_000)
    )
      throw new Error("ANIMATION_DELAY_INVALID");
    Object.assign(animation, command.changes);
    // Changing the effect may move it to another phase (pulse, disappear, or
    // back to an entrance). The phase is derived, never supplied by the UI.
    if (command.changes.effect) animation.phase = phaseForEffect(command.changes.effect);
    return;
  }

  // Commands below this point are element commands. Keep the runtime guard as
  // well as the TypeScript narrowing: slide-only review commands may be added
  // to the union without accidentally being treated as element mutations.
  if (!("elementId" in command)) throw new Error("ELEMENT_COMMAND_REQUIRED");
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
    const duplicate = copyElementForPaste(element, offset);
    // A copy is user-owned even when its source was generated.
    duplicate.origin = "user";
    slide.elements.splice(sourceIndex + 1, 0, duplicate);
    const copiedAnimations = (slide.animations ?? [])
      .filter((animation) => animation.elementId === element.id)
      .map((animation) => ({ ...animation, id: crypto.randomUUID(), elementId: duplicate.id }));
    if (copiedAnimations.length) slide.animations = [...(slide.animations ?? []), ...copiedAnimations];
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
    const target = command.align;
    const horizontal = typeof target === "string" ? HORIZONTAL_ALIGN[target] : target.horizontal;
    const vertical = typeof target === "string" ? VERTICAL_ALIGN[target] : target.vertical;
    if (horizontal === "left") frame.x = 0 as Emu;
    if (horizontal === "center") frame.x = Math.max(0, Math.round((width - frame.width) / 2)) as Emu;
    if (horizontal === "right") frame.x = Math.max(0, width - frame.width) as Emu;
    if (vertical === "top") frame.y = 0 as Emu;
    if (vertical === "middle") frame.y = Math.max(0, Math.round((height - frame.height) / 2)) as Emu;
    if (vertical === "bottom") frame.y = Math.max(0, height - frame.height) as Emu;
    element.frame = frame;
    return;
  }
  if (command.type === "set-text-style") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    assertTextStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "fit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    // Fitting only changes the design: the copy and the review state stay.
    const size = fittingTextSize(element.text, element.frame, element.style.fontFamily, element.style.fontSizePt);
    if (size !== element.style.fontSizePt) {
      element.style = { ...element.style, fontSizePt: size };
    }
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
  if (command.type === "set-line-style") {
    if (element.type !== "line") throw new Error("ELEMENT_NOT_LINE");
    assertLineStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-line-direction") {
    if (element.type !== "line") throw new Error("ELEMENT_NOT_LINE");
    if (command.direction !== "horizontal" && command.direction !== "vertical" && command.direction !== "diagonal")
      throw new Error("INVALID_LINE_DIRECTION");
    const previous = element.direction;
    // 水平线和竖线用宽高表达方向。只改 direction 不换宽高的话，一条 4in ×
    // 0.02in 的横线切到 vertical 后会变成 0.02in 宽的“点”。以中心为轴交换
    // 宽高，线不会跳到别处。
    const axisAligned = (direction: typeof command.direction) => direction === "horizontal" || direction === "vertical";
    if (axisAligned(previous) && axisAligned(command.direction) && previous !== command.direction) {
      const centerX = element.frame.x + element.frame.width / 2;
      const centerY = element.frame.y + element.frame.height / 2;
      const width = element.frame.height;
      const height = element.frame.width;
      element.frame = {
        x: Math.round(centerX - width / 2) as Emu,
        y: Math.round(centerY - height / 2) as Emu,
        width: width as Emu,
        height: height as Emu,
      };
    }
    element.direction = command.direction;
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
    if (command.kind !== "column" && command.kind !== "bar" && command.kind !== "line" && command.kind !== "pie")
      throw new Error("INVALID_CHART_KIND");
    element.kind = command.kind;
    return;
  }
  if (command.type === "set-table-style") {
    if (element.type !== "table") throw new Error("ELEMENT_NOT_TABLE");
    assertTableStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-icon-style") {
    if (element.type !== "icon") throw new Error("ELEMENT_NOT_ICON");
    assertIconStyle(command.style);
    element.style = { ...element.style, ...command.style };
    return;
  }
  if (command.type === "set-icon-name") {
    if (element.type !== "icon") throw new Error("ELEMENT_NOT_ICON");
    if (!(command.name in BUILTIN_ICONS)) throw new Error("INVALID_ICON_NAME");
    element.name = command.name;
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
      if (element.contentRef === "title") {
        slide.content.title = "";
        markContentChanged(slide);
      }
      if (element.contentRef === "body") {
        slide.content.body = "";
        slide.content.blocks = [];
        markContentChanged(slide);
      }
    }
    slide.elements.splice(
      slide.elements.findIndex((item) => item.id === command.elementId),
      1,
    );
    if (slide.animations)
      slide.animations = slide.animations.filter((animation) => animation.elementId !== command.elementId);
    pruneGroups(slide);
    return;
  }
  if (command.type === "move-element") {
    if (!Number.isSafeInteger(command.x) || !Number.isSafeInteger(command.y))
      throw new Error("INVALID_ELEMENT_TRANSFORM");
    element.frame = { ...element.frame, x: command.x, y: command.y };
  }
  if (command.type === "transform-element") {
    const values = [
      command.frame.x,
      command.frame.y,
      command.frame.width,
      command.frame.height,
      command.rotationMilliDegree,
    ];
    if (!values.every(Number.isSafeInteger) || command.frame.width <= 0 || command.frame.height <= 0) {
      throw new Error("INVALID_ELEMENT_TRANSFORM");
    }
    element.frame = { ...command.frame };
    element.rotationMilliDegree = command.rotationMilliDegree;
  }
  if (command.type === "edit-text") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    if (command.text.length > 20_000) throw new Error("CONTENT_TEXT_TOO_LONG");
    applyTextEdit(slide, element, command.text);
  }
}
