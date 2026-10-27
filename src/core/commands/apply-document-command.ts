import type { ElementId, PresentationDocument, SlideId } from "../document-model";
import { captureContentVersion, createSlide, inches, MAX_PAGE_SIZE_IN, MIN_PAGE_SIZE_IN } from "../document-model";

import type { DocumentCommand } from "./command-types";
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

import { toContentBlocks } from "./ai-draft-helpers";
import { applyAiDesignedDraft } from "./ai-designed-draft";
import { parseLayoutTreeDraft } from "../layout/tree";
export { directionContentFingerprint } from "./ai-draft-helpers";
export { toAiBlocks } from "./command-helpers";

import {
  cloneContentBlocks,
  markContentChanged,
  scaleElementForPage,
  findMetricBlock,
  findTableBlock,
  applyTextEdit,
  syncMetricText,
  syncContentText,
  restoreSlideBlocks,
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

export function applyDocumentCommand(document: PresentationDocument, command: DocumentCommand): boolean {
  if (command.type === "set-slide") return true;
  if (command.type === "apply-layout-plan") {
    const expected = command.expectedRevision;
    if (
      document.revisions.document !== expected.document ||
      document.revisions.content !== expected.content ||
      document.revisions.design !== expected.design
    ) {
      throw new Error("REVISION_CONFLICT");
    }
    if (command.definitions.length > 100 || command.slides.length > document.slides.length) {
      throw new Error("LAYOUT_PLAN_INVALID");
    }
    const definitionIds = new Set<string>();
    const definitionNodeIds = new Map<string, Set<string>>();
    for (const definition of command.definitions) {
      if (definition.layoutSchemaVersion !== 1 || !definition.name.trim() || definition.name.length > 120) {
        throw new Error("LAYOUT_DEFINITION_INVALID");
      }
      if (definitionIds.has(definition.id)) throw new Error("LAYOUT_DEFINITION_ID_DUPLICATE");
      definitionIds.add(definition.id);
      const parsed = parseLayoutTreeDraft(definition.tree);
      if (!parsed.ok) throw new Error("INVALID_LAYOUT_TREE");
      const nodes = new Set<string>();
      const visit = (node: typeof parsed.tree.root | (typeof parsed.tree.root.children)[number]) => {
        nodes.add(node.id);
        if (node.type !== "slot") node.children.forEach(visit);
      };
      visit(parsed.tree.root);
      definitionNodeIds.set(definition.id, nodes);
    }
    const seenSlides = new Set<string>();
    for (const update of command.slides) {
      if (seenSlides.has(update.slideId)) throw new Error("LAYOUT_PLAN_INVALID");
      seenSlides.add(update.slideId);
      const slide = document.slides.find((candidate) => candidate.id === update.slideId);
      if (!slide) throw new Error("SLIDE_NOT_FOUND");
      if (update.binding && !definitionIds.has(update.binding.definitionId)) {
        throw new Error("LAYOUT_DEFINITION_NOT_FOUND");
      }
      const nodes = update.binding ? definitionNodeIds.get(update.binding.definitionId)! : undefined;
      if (
        update.binding &&
        [
          ...Object.keys(update.binding.slotBindings),
          ...(update.binding.overrides ?? []).map((item) => item.nodeId),
        ].some((nodeId) => !nodes?.has(nodeId))
      ) {
        throw new Error("INVALID_NODE_REFERENCE");
      }
      const elementIds = new Set(slide.elements.map((element) => element.id));
      if (update.elementFrames?.some((item) => !elementIds.has(item.elementId))) {
        throw new Error("ELEMENT_NOT_FOUND");
      }
      for (const item of update.elementFrames ?? []) {
        const element = slide.elements.find((candidate) => candidate.id === item.elementId)!;
        if (element.locked) throw new Error("ELEMENT_LOCKED");
        if (
          !Number.isSafeInteger(item.frame.x) ||
          !Number.isSafeInteger(item.frame.y) ||
          !Number.isSafeInteger(item.frame.width) ||
          !Number.isSafeInteger(item.frame.height) ||
          item.frame.width <= 0 ||
          item.frame.height <= 0
        ) {
          throw new Error("INVALID_FRAME");
        }
      }
    }
    document.layoutDefinitions = structuredClone(command.definitions);
    for (const update of command.slides) {
      const slide = document.slides.find((candidate) => candidate.id === update.slideId)!;
      if (update.binding) slide.layoutBinding = structuredClone(update.binding);
      else delete slide.layoutBinding;
      for (const item of update.elementFrames ?? []) {
        const element = slide.elements.find((candidate) => candidate.id === item.elementId)!;
        element.frame = { ...item.frame };
      }
    }
    return true;
  }
  if (command.type === "rename-document") {
    const title = command.title.trim();
    if (!title || title.length > 512) throw new Error("DOCUMENT_TITLE_INVALID");
    document.title = title;
    return true;
  }
  if (command.type === "set-template-style") {
    if (command.templateStyle) document.templateStyle = structuredClone(command.templateStyle);
    else delete document.templateStyle;
    return true;
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
    return true;
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
        applyTextEdit(edit.slide, edit.element, edit.text, document.pageSize.height);
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
    return true;
  }
  if (command.type === "add-slide") {
    document.slides.push(createSlide(document.slides.length + 1));
    return true;
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
    return true;
  }
  if (command.type === "apply-ai-designed-draft") {
    applyAiDesignedDraft(document, command);
    return true;
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
    if (duplicate.layoutBinding) {
      const idMap = new Map(source.elements.map((element, index) => [element.id, duplicate.elements[index]!.id]));
      duplicate.layoutBinding = {
        ...duplicate.layoutBinding,
        slotBindings: Object.fromEntries(
          Object.entries(duplicate.layoutBinding.slotBindings).flatMap(([slotId, elementId]) => {
            const mapped = idMap.get(elementId as ElementId);
            return mapped ? [[slotId, mapped]] : [];
          }),
        ),
      };
    }
    document.slides.splice(sourceIndex + 1, 0, duplicate);
    return true;
  }
  if (command.type === "delete-slide") {
    if (document.slides.length === 1) throw new Error("LAST_SLIDE_CANNOT_BE_DELETED");
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    document.slides.splice(sourceIndex, 1);
    return true;
  }
  if (command.type === "move-slide") {
    const sourceIndex = document.slides.findIndex((item) => item.id === command.slideId);
    if (sourceIndex < 0) throw new Error("SLIDE_NOT_FOUND");
    if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= document.slides.length) {
      throw new Error("SLIDE_INDEX_OUT_OF_RANGE");
    }
    if (sourceIndex === command.toIndex) return true;
    const [slide] = document.slides.splice(sourceIndex, 1);
    document.slides.splice(command.toIndex, 0, slide!);
    return true;
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
    return true;
  }

  return false;
}
