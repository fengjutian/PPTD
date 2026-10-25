import type {
  ChartElementStyle,
  ContentBlock,
  ElementId,
  Emu,
  ImageCrop,
  LineElementStyle,
  PresentationDocument,
  RectEmu,
  ShapeElementStyle,
  Slide,
  SlideElement,
  SlideId,
  IconElementStyle,
  TableElementStyle,
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
  hashString,
  inches,
  MAX_PAGE_SIZE_IN,
  MIN_PAGE_SIZE_IN,
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

import { alignFrames, distributeFrames, unionFrame } from "./arrange";
import { estimateTextLines } from "../rendering/text-fit";

import { classifyRelayoutElements, inferRelayoutContext } from "./slide-relayout";

import type {
  ChangeDomain,
  AiContentBlock,
  AiSlideDraft,
  HorizontalAlign,
  VerticalAlign,
  DocumentCommand,
} from "./command-types";
export type {
  ChangeDomain,
  AiContentBlock,
  AiSlideDraft,
  AiVisualAssetData,
  AiTemplateTheme,
  HorizontalAlign,
  VerticalAlign,
  AlignTarget,
  DocumentCommand,
} from "./command-types";

import { isVisualAssetRole, planManualVisualAssetLayout, type NormalizedRect } from "./visual-asset";
import { HEX_COLOR_PATTERN, imageFrame, toContentBlocks, type MetricBlock } from "./ai-draft-helpers";
import { applyAiDesignedDraft } from "./ai-designed-draft";
export { directionContentFingerprint } from "./ai-draft-helpers";

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
    if (block.type === "chart")
      return {
        ...block,
        categories: [...block.categories],
        ...(block.values ? { values: [...block.values] } : {}),
        ...(block.series
          ? { series: block.series.map((item) => ({ name: item.name, values: [...item.values] })) }
          : {}),
      };
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
export function toAiBlocks(blocks: ContentBlock[] | undefined): AiContentBlock[] | undefined {
  if (!blocks) return undefined;
  return blocks.map((block): AiContentBlock => {
    if (block.type === "paragraph") return { type: "paragraph", text: block.text };
    if (block.type === "bullet-list") return { type: "bullet-list", items: [...block.items] };
    if (block.type === "quote") return { type: "quote", text: block.text, attribution: block.attribution };
    if (block.type === "metric") return { type: "metric", label: block.label, value: block.value };
    if (block.type === "chart")
      return {
        type: "chart",
        kind: block.kind,
        categories: [...block.categories],
        ...(block.series
          ? { series: block.series.map((item) => ({ name: item.name, values: [...item.values] })) }
          : block.values
            ? { values: [...block.values] }
            : {}),
        ...(block.unit ? { unit: block.unit } : {}),
      };
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

/** The axis each single direction belongs to. */
const HORIZONTAL_ALIGN: Record<string, HorizontalAlign | undefined> = {
  left: "left",
  center: "center",
  right: "right",
};
const VERTICAL_ALIGN: Record<string, VerticalAlign | undefined> = { top: "top", middle: "middle", bottom: "bottom" };

export type { ArrangeHorizontal, ArrangeVertical } from "./arrange";

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
  const gradient = style.fillGradient;
  if (gradient !== undefined) {
    if (
      !Number.isFinite(gradient.angleDeg) ||
      gradient.angleDeg < 0 ||
      gradient.angleDeg > 360 ||
      !Array.isArray(gradient.stops) ||
      gradient.stops.length < 2 ||
      gradient.stops.length > 10
    )
      throw new Error("INVALID_SHAPE_STYLE");
    let previous = -1;
    for (const stop of gradient.stops) {
      if (
        !Number.isFinite(stop.offset) ||
        stop.offset < 0 ||
        stop.offset > 1 ||
        stop.offset < previous ||
        !HEX_COLOR_PATTERN.test(stop.color) ||
        (stop.transparency !== undefined &&
          (!Number.isFinite(stop.transparency) || stop.transparency < 0 || stop.transparency > 100))
      )
        throw new Error("INVALID_SHAPE_STYLE");
      previous = stop.offset;
    }
  }
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
    case "set-template-style":
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
      const templateChanged =
        JSON.stringify(document.templateStyle ?? null) !== JSON.stringify(version.design.templateStyle ?? null);
      const designChanged =
        templateChanged ||
        version.design.slides.some((snapshot) => {
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
  if (command.type === "set-template-style") {
    if (command.templateStyle) document.templateStyle = structuredClone(command.templateStyle);
    else delete document.templateStyle;
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
    applyAiDesignedDraft(document, command);
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
      if (design.templateStyle) document.templateStyle = structuredClone(design.templateStyle);
      else delete document.templateStyle;
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
    const next = { ...element.style, ...command.style };
    // A new solid fill is a request to leave the gradient behind; otherwise the
    // old gradient would keep painting over the color the user just picked.
    if (command.style.fill !== undefined && command.style.fillGradient === undefined) delete next.fillGradient;
    element.style = next;
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
  if (command.type === "set-image-provenance") {
    if (element.type !== "image") throw new Error("ELEMENT_NOT_IMAGE");
    if (command.provenance === null) {
      delete element.provenance;
      return;
    }
    const provenance = command.provenance;
    const sourceUrl = provenance.sourceUrl?.trim();
    const license = provenance.license?.trim();
    if (sourceUrl && (sourceUrl.length > 2048 || !/^https?:\/\//i.test(sourceUrl))) {
      throw new Error("IMAGE_PROVENANCE_URL_INVALID");
    }
    if (license && license.length > 200) throw new Error("IMAGE_PROVENANCE_LICENSE_INVALID");
    if (provenance.verification === "verified" && (!sourceUrl || !license)) {
      throw new Error("IMAGE_PROVENANCE_INCOMPLETE");
    }
    element.provenance = {
      verification: provenance.verification,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(license ? { license } : {}),
      checkedAt: provenance.checkedAt ?? new Date().toISOString(),
      // The hash is over the bytes actually embedded, not the URL.
      contentHash: hashString(element.source.dataUrl),
    };
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
