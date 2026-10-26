import type {
  ChartElementStyle,
  ContentBlock,
  ElementId,
  Emu,
  ImageCrop,
  LineElementStyle,
  RectEmu,
  ShapeElementStyle,
  Slide,
  SlideElement,
  IconElementStyle,
  TableElementStyle,
  TextElement,
  TextElementStyle,
} from "../document-model";
import { emu, stableStringify, type TextRunStyle } from "../document-model";

import { estimateTextLines } from "../rendering/text-fit";

import type { AiContentBlock, HorizontalAlign, VerticalAlign } from "./command-types";
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

import { type NormalizedRect } from "./visual-asset";
import { HEX_COLOR_PATTERN, type MetricBlock } from "./ai-draft-helpers";

export { directionContentFingerprint } from "./ai-draft-helpers";

/**
 * Deep copy of the content blocks of a page, safe to read from an Immer draft.
 * The block IDs are kept: the elements of the copy point at the same blocks, so
 * a copied chart or table still shows the cells of the copied page.
 */
export function cloneContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
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
function copyElementBase(element: SlideElement, offset: number): SlideElement {
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
 * The copy used by paste and duplicate.
 *
 * A copy is a fresh, visible edit target: hiding is editor state of the source,
 * not a property of the copy. The custom name stays, so a renamed object is
 * still recognisable after it is duplicated.
 */
export function copyElementForPaste(element: SlideElement, offset: number): SlideElement {
  const copy = copyElementBase(element, offset);
  delete copy.hidden;
  return copy;
}

/**
 * Layer names are one-line labels: collapse internal whitespace and trim.
 *
 * The schema and the rename command share this normalization, so typing two
 * spaces into the layer input cannot produce a name that later fails to load.
 */
export function normalizeElementName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Reviewed copy changed: an approved page has to leave the approved state.
 *
 * Deleting a content-bound title/body is a content edit just as much as typing
 * over it. Without this transition the page could be empty and still be
 * reported as approved, and the export preflight would not warn about it.
 */
export function markContentChanged(slide: Slide): void {
  if (slide.content.status === "approved") slide.content.status = "changed";
}

/** The design fields a content version snapshots, without its content. */
export function slideDesignOf(slide: Slide) {
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
export function scaleElementForPage(element: SlideElement, scaleX: number, scaleY: number): void {
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
export function pruneGroups(slide: Slide): void {
  if (!slide.groups) return;
  const alive = new Set(slide.elements.map((element) => element.id));
  const kept = slide.groups.filter((group) => group.elementIds.every((id) => alive.has(id)));
  slide.groups = kept.length > 0 ? kept : undefined;
}

export type TableBlock = Extract<ContentBlock, { type: "table-data" }>;

export function findMetricBlock(slide: Slide | undefined, blockId: string): MetricBlock | undefined {
  return slide?.content.blocks?.find(
    (candidate): candidate is MetricBlock => candidate.id === blockId && candidate.type === "metric",
  );
}

export function findTableBlock(slide: Slide | undefined, blockId: string): TableBlock | undefined {
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
export function textEditTouchesContent(slide: Slide, element: TextElement): boolean {
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
export function applyTextEdit(slide: Slide, element: TextElement, text: string): void {
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
  // A fragment of a split title (the headline of a cover, say) edits its own
  // range: replacing the whole field here would delete the part of the title
  // that this element does not show.
  const range = element.contentRange;
  const splice = (field: string): string =>
    range ? field.slice(0, range.start) + text + field.slice(range.end) : text;
  if (element.contentRef === "title" || (!element.contentRef && slide.elements[0]?.id === element.id))
    slide.content.title = splice(slide.content.title);
  if (element.contentRef === "body") {
    slide.content.body = splice(slide.content.body);
    // A whole-body edit rebuilds the paragraph block. A fragment keeps the
    // blocks untouched: it is a view of the field, not its source.
    if (!range) {
      slide.content.blocks = text.trim()
        ? [{ id: slide.content.blocks?.[0]?.id ?? crypto.randomUUID(), type: "paragraph", text }]
        : [];
    }
  }
  if (range && element.contentRef === "title") {
    element.contentRange = { start: range.start, end: range.start + text.length };
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
export function syncMetricText(slide: Slide, blockId: string, field: "label" | "value", value: string): void {
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
export function syncContentText(slide: Slide, title: string, body: string): boolean {
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
export function restoreSlideBlocks(slide: Slide, sourceBlocks: ContentBlock[] | undefined): boolean {
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
export function cloneElement(element: SlideElement): SlideElement {
  if (element.type === "text")
    return {
      ...element,
      frame: { ...element.frame },
      style: { ...element.style },
      ...(element.contentBlockRef ? { contentBlockRef: { ...element.contentBlockRef } } : {}),
      ...(element.contentRange ? { contentRange: { ...element.contentRange } } : {}),
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
export const HORIZONTAL_ALIGN: Record<string, HorizontalAlign | undefined> = {
  left: "left",
  center: "center",
  right: "right",
};
export const VERTICAL_ALIGN: Record<string, VerticalAlign | undefined> = {
  top: "top",
  middle: "middle",
  bottom: "bottom",
};

export type { ArrangeHorizontal, ArrangeVertical } from "./arrange";

/** Text styling is presentation-only, so every guard here rejects values the exporter or the schema could not round-trip. */ export function assertTextStyle(
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
  for (const spacing of [style.paragraphSpaceBeforePt, style.paragraphSpaceAfterPt]) {
    if (spacing !== undefined && (!Number.isFinite(spacing) || spacing < 0 || spacing > 200))
      throw new Error("INVALID_TEXT_STYLE");
  }
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
export function fittingTextSize(text: string, frame: RectEmu, fontFamily: string, preferredPt: number): number {
  const widthPt = frame.width / 12_700;
  const heightPt = frame.height / 12_700;
  for (let size = preferredPt; size >= 8; size -= 1) {
    if (estimateTextLines(text, widthPt, size, fontFamily) * size * 1.2 <= heightPt * 1.08) return size;
  }
  return 8;
}

/** The style of a run is presentation-only, so it is guarded like the others. */
export function assertTextRunStyle(style: TextRunStyle): void {
  if (style.bold !== undefined && typeof style.bold !== "boolean") throw new Error("INVALID_TEXT_EMPHASIS");
  if (style.underline !== undefined && typeof style.underline !== "boolean") throw new Error("INVALID_TEXT_EMPHASIS");
  if (style.color !== undefined && !HEX_COLOR_PATTERN.test(style.color)) throw new Error("INVALID_TEXT_EMPHASIS");
}

export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * A run addresses a range of the text of the element, so the range has to stay
 * inside the text and may not cut a surrogate pair in half: a fragment that
 * starts in the middle of a character would export as a broken glyph.
 */
export function assertTextRange(text: string, start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length)
    throw new Error("INVALID_TEXT_EMPHASIS");
  if (start > 0 && isHighSurrogate(text.charCodeAt(start - 1)) && isLowSurrogate(text.charCodeAt(start)))
    throw new Error("INVALID_TEXT_EMPHASIS");
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end)))
    throw new Error("INVALID_TEXT_EMPHASIS");
}

export function assertShapeStyle(style: Partial<ShapeElementStyle>): void {
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
export function assertLineStyle(style: Partial<LineElementStyle>): void {
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
export function assertChartStyle(style: Partial<ChartElementStyle>): void {
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
export function assertIconStyle(style: Partial<IconElementStyle>): void {
  if (style.color !== undefined && !HEX_COLOR_PATTERN.test(style.color)) throw new Error("INVALID_ICON_STYLE");
  if (
    style.strokeWidth !== undefined &&
    (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 1 || style.strokeWidth > 6)
  )
    throw new Error("INVALID_ICON_STYLE");
}

export function assertTableStyle(style: Partial<TableElementStyle>): void {
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
export function assertImageCrop(crop: ImageCrop): void {
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
export function normalizedToEmuRect(rect: NormalizedRect, pageSize: { width: number; height: number }): RectEmu {
  return {
    x: Math.round(rect.x * pageSize.width) as Emu,
    y: Math.round(rect.y * pageSize.height) as Emu,
    width: Math.round(rect.width * pageSize.width) as Emu,
    height: Math.round(rect.height * pageSize.height) as Emu,
  };
}

/** 页面上的实际矩形换成归一化的矩形。 */
export function emuToNormalizedRect(frame: RectEmu, pageSize: { width: number; height: number }): NormalizedRect {
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
export function fitImageIntoBox(box: RectEmu, naturalWidth?: number, naturalHeight?: number): RectEmu {
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
export function makeRoomForAsset(
  slide: Slide,
  textArea: NormalizedRect,
  pageSize: { width: number; height: number },
): void {
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
