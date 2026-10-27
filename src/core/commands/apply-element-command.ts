import type { Emu, PresentationDocument, Slide, SlideElement } from "../document-model";
import { BUILTIN_ICONS, hashString, inches, clearTextEmphasisRange, mergeTextRunStyle } from "../document-model";

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

export { directionContentFingerprint } from "./ai-draft-helpers";
export { toAiBlocks } from "./command-helpers";

import {
  copyElementForPaste,
  markContentChanged,
  pruneGroups,
  applyTextEdit,
  HORIZONTAL_ALIGN,
  VERTICAL_ALIGN,
  assertTextStyle,
  fittingTextSize,
  assertTextRunStyle,
  assertTextRange,
  assertShapeStyle,
  assertLineStyle,
  assertChartStyle,
  assertIconStyle,
  assertTableStyle,
  assertImageCrop,
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

export function applyElementCommand(
  document: PresentationDocument,
  command: DocumentCommand,
  slide: Slide,
  element: SlideElement,
): void {
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
    const size = fittingTextSize(element, element.style.fontSizePt);
    if (size !== element.style.fontSizePt) {
      element.style = { ...element.style, fontSizePt: size };
    }
    return;
  }
  if (command.type === "set-text-emphasis") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    assertTextRunStyle(command.style);
    assertTextRange(element.text, command.start, command.end);
    // Merge rather than replace: the command only names the property the user
    // changed, so an existing colour, underline or link stays on the words.
    element.runs = mergeTextRunStyle(element.runs, element.text.length, command.start, command.end, command.style);
    return;
  }
  if (command.type === "clear-text-emphasis") {
    if (element.type !== "text") throw new Error("ELEMENT_NOT_TEXT");
    assertTextRange(element.text, command.start, command.end);
    // A link is not emphasis. Remove bold/colour/underline only, so clearing
    // the emphasis of a linked range does not silently delete the destination.
    const remaining = clearTextEmphasisRange(element.runs, element.text.length, command.start, command.end);
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
