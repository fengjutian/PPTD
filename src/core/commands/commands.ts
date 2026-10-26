import type {
  ElementId,
  Emu,
  PresentationDocument,
  Slide,
  SlideElement,
  SlideLayoutSpec,
  TextElement,
} from "../document-model";
import {
  captureContentVersion,
  createDocument,
  diffContentVersion,
  emu,
  ELEMENT_NAME_MAX_LENGTH,
  inches,
  phaseForEffect,
  SHAPE_KINDS,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  clearedTextStyle,
  hasTextRunStyle,
  isSafeTextHyperlinkUrl,
  keepTextHyperlinks,
  setTextHyperlink,
  setTextHyperlinkRange,
  textFragments,
} from "../document-model";

import { alignFrames, distributeFrames, unionFrame } from "./arrange";

import {
  classifyRelayoutElements,
  inferRelayoutContext,
  slideLayoutApplicationIssue,
  slideLayoutOptions,
} from "./slide-relayout";
export {
  classifyRelayoutElements,
  inferRelayoutContext,
  slideLayoutApplicationIssue,
  slideLayoutOptions,
  type SlideLayoutOption,
} from "./slide-relayout";

import type { ChangeDomain, AiSlideDraft, DocumentCommand } from "./command-types";
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

import { isVisualAssetRole, planManualVisualAssetLayout } from "./visual-asset";
import { HEX_COLOR_PATTERN, imageFrame } from "./ai-draft-helpers";

import { applyDocumentCommand } from "./apply-document-command";
import { applyElementCommand } from "./apply-element-command";
export { directionContentFingerprint } from "./ai-draft-helpers";
export {
  inspectAiDesignedDraftCompilation,
  type DesignDraftCompileReport,
  type SlideDesignCompileReport,
} from "./ai-designed-draft";
export { toAiBlocks } from "./command-helpers";

import {
  copyElementForPaste,
  markContentChanged,
  slideDesignOf,
  pruneGroups,
  findMetricBlock,
  findTableBlock,
  textEditTouchesContent,
  syncMetricText,
  cloneElement,
  toAiBlocks,
  assertTextRange,
  assertTextStyle,
  assertShapeStyle,
  normalizedToEmuRect,
  fitImageIntoBox,
  makeRoomForAsset,
  normalizeElementName,
} from "./command-helpers";

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
    case "set-text-hyperlink": {
      if (!document) return "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const targets = slide?.elements.filter(
        (item): item is TextElement => command.elementIds.includes(item.id) && item.type === "text" && !item.locked,
      );
      if (!targets || targets.length === 0) return "design";
      const url = command.url?.trim() ?? null;
      const range = command.range;
      if (range && command.elementIds.length !== 1) return "design";
      const changed = targets.some((target) => {
        // Linking empty copy has nothing to attach to; it is a no-op, not a
        // reason to create an undo entry. A range on empty copy is invalid and
        // is left to the command guard below.
        if (!range && target.text.length === 0) return false;
        const start = range?.start ?? 0;
        const end = range?.end ?? target.text.length;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end <= start ||
          end > target.text.length
        )
          return true;
        // Fragments include the plain gaps, so a single linked fragment is not
        // enough: every character in the range must already carry the URL.
        const fragments = textFragments(target.text, target.runs).filter(
          (fragment) => fragment.start < end && fragment.end > start,
        );
        return fragments.some((fragment) => fragment.style.hyperlinkUrl !== (url ?? undefined));
      });
      return changed ? "design" : null;
    }
    case "set-text-style":
    case "set-text-style-elements":
    case "clear-text-format":
    case "fit-text":
    case "set-text-emphasis":
    case "clear-text-emphasis":
    case "set-shape-style":
    case "set-shape-styles":
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
    case "rename-element": {
      // A name is design metadata, never content. Re-typing the same name (or
      // clearing an already absent one) must not leave an undo entry.
      if (!document) return "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const element = slide?.elements.find((item) => item.id === command.elementId);
      return normalizeElementName(element?.name ?? "") === normalizeElementName(command.name) ? null : "design";
    }
    case "set-elements-hidden": {
      // Setting every target to the state it already has is not an edit.
      if (!document) return "design";
      const slide = document.slides.find((item) => item.id === command.slideId);
      const targets = slide?.elements.filter((item) => command.elementIds.includes(item.id)) ?? [];
      if (targets.length === 0) return "design";
      return targets.some((item) => (item.hidden === true) !== command.hidden) ? "design" : null;
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
    case "apply-slide-layout":
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

function relayoutSlide(document: PresentationDocument, slide: Slide, targetLayout?: SlideLayoutSpec): void {
  const context = inferRelayoutContext(slide, document, targetLayout);
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
  if (targetLayout) {
    // The target is already a layout of this document. Writing its stable id is
    // what lets the exporter keep the deck's master structure; the temporary
    // render must not fork a second layout with the same name.
    slide.layoutId = targetLayout.id;
    return;
  }
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
  if (applyDocumentCommand(document, command)) return;
  if (!("slideId" in command)) throw new Error("UNKNOWN_COMMAND");

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

  if (command.type === "rename-element") {
    // Naming is metadata; a locked object can still be renamed from the layer
    // list so a locked background can be labelled without unlocking it.
    const target = slide.elements.find((element) => element.id === command.elementId);
    if (!target) throw new Error("ELEMENT_NOT_FOUND");
    const name = normalizeElementName(command.name);
    if (name.length > ELEMENT_NAME_MAX_LENGTH) throw new Error("ELEMENT_NAME_TOO_LONG");
    if (name) target.name = name;
    else delete target.name;
    return;
  }

  if (command.type === "set-elements-hidden") {
    // Visibility is editor state; hiding a locked object is allowed, otherwise a
    // locked object could never be taken off the page or brought back.
    const targets = slide.elements.filter((element) => command.elementIds.includes(element.id));
    if (targets.length === 0) throw new Error("ELEMENT_NOT_FOUND");
    for (const target of targets) {
      if (command.hidden) target.hidden = true;
      else delete target.hidden;
    }
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
      // The format painter replaces character emphasis, but a link is an
      // action, not a font. Keep it on the words it already addressed.
      if (command.clearRuns) target.runs = keepTextHyperlinks(target.runs);
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
    // goes away with the rest; links are actions and stay. Geometry and copy are
    // untouched.
    for (const target of targets) {
      target.style = clearedTextStyle(target.contentRef, document.theme);
      target.runs = keepTextHyperlinks(target.runs);
    }
    return;
  }
  if (command.type === "set-text-hyperlink") {
    const url = command.url?.trim() ?? null;
    if (url !== null && !isSafeTextHyperlinkUrl(url)) throw new Error("TEXT_HYPERLINK_INVALID");
    const targets = slide.elements.filter(
      (element): element is TextElement =>
        command.elementIds.includes(element.id) && element.type === "text" && !element.locked,
    );
    if (targets.length === 0) throw new Error("ELEMENT_NOT_TEXT");
    if (command.range) {
      // A range addresses characters of one text box. Applying the same offsets
      // to several boxes would link unrelated words.
      if (command.elementIds.length !== 1 || targets.length !== 1) throw new Error("TEXT_HYPERLINK_RANGE_INVALID");
      const target = targets[0]!;
      assertTextRange(target.text, command.range.start, command.range.end, "TEXT_HYPERLINK_RANGE_INVALID");
      const runs = setTextHyperlinkRange(target.runs, target.text.length, command.range.start, command.range.end, url);
      target.runs = hasTextRunStyle(runs) ? runs : undefined;
      return;
    }
    // A link is design metadata: the reviewed copy, its hash and every fragment
    // style stay as they are; only the destination attached to each character
    // changes.
    for (const target of targets) {
      const runs = setTextHyperlink(target.runs, target.text.length, url);
      // Removing the last link should leave a plain element instead of a run
      // that carries no formatting at all.
      target.runs = hasTextRunStyle(runs) ? runs : undefined;
    }
    return;
  }

  if (command.type === "set-shape-styles") {
    assertShapeStyle(command.style);
    const targets = slide.elements.filter(
      (element): element is Extract<SlideElement, { type: "shape" }> =>
        command.elementIds.includes(element.id) && element.type === "shape" && !element.locked,
    );
    // The ribbon disables the controls without an editable shape; an empty batch
    // is a programming error rather than a no-op undo entry.
    if (targets.length === 0) throw new Error("ELEMENT_NOT_SHAPE");
    for (const target of targets) {
      const next = { ...target.style, ...command.style };
      // Keep the single-object rule: a solid fill replaces the old gradient.
      if (command.style.fill !== undefined && command.style.fillGradient === undefined) delete next.fillGradient;
      target.style = next;
    }
    return;
  }

  if (command.type === "apply-slide-layout") {
    const layout = document.layouts?.find((candidate) => candidate.id === command.layoutId);
    if (!layout) throw new Error("LAYOUT_NOT_FOUND");
    if (slideLayoutApplicationIssue(document, slide, layout)) throw new Error("LAYOUT_INCOMPATIBLE");
    relayoutSlide(document, slide, layout);
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
  if (command.type === "reorder-elements") {
    // Dragging a multi-selection or a group in the layer panel is one intent:
    // the block moves in one command and therefore leaves one undo entry.
    const unique = [...new Set(command.elementIds)];
    if (unique.length === 0) throw new Error("ELEMENT_NOT_FOUND");
    const targets = unique.map((id) => slide.elements.find((item) => item.id === id));
    if (targets.some((target) => !target)) throw new Error("ELEMENT_NOT_FOUND");
    if (targets.some((target) => target!.locked)) throw new Error("ELEMENT_LOCKED");
    const remaining = slide.elements.filter((item) => !unique.includes(item.id));
    if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex > remaining.length)
      throw new Error("ELEMENT_INDEX_OUT_OF_RANGE");
    // Keep the block in its current relative order: the panel never decides
    // how the members of a group stack against each other.
    const block = slide.elements.filter((item) => unique.includes(item.id));
    slide.elements = [...remaining.slice(0, command.toIndex), ...block, ...remaining.slice(command.toIndex)];
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
  applyElementCommand(document, command, slide, element);
}
