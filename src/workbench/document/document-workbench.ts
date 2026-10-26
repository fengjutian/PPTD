import type { DocumentCommand } from "../../core/commands/command-types";
import type {
  ElementId,
  PresentationDocument,
  Revisions,
  SlideElement,
  SlideId,
  TextElementStyle,
} from "../../core/document-model";
import { layoutRectToEmu } from "../../core/layout/geometry/coordinate-system";
import type { LayoutWorkbench } from "../layout/layout-workbench";
import type { WorkbenchCallResult, WorkbenchToolDefinition } from "../contracts";

export type DocumentWorkbenchToolName =
  | "document.inspect"
  | "slide.list"
  | "slide.inspect"
  | "element.inspect"
  | "element.place"
  | "element.align"
  | "element.distribute"
  | "element.lock"
  | "element.reorder"
  | "element.text_style"
  | "plan.inspect"
  | "plan.clear";

export type PlannedDesignCommand = Extract<
  DocumentCommand,
  | { type: "transform-element" }
  | { type: "align-elements" }
  | { type: "distribute-elements" }
  | { type: "set-elements-lock" }
  | { type: "reorder-element" }
  | { type: "set-text-style" }
>;

export interface WorkbenchElementSnapshot {
  readonly id: ElementId;
  readonly type: SlideElement["type"];
  readonly name?: string;
  readonly frame: SlideElement["frame"];
  readonly rotationMilliDegree: number;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly origin?: SlideElement["origin"];
}

export interface WorkbenchSlideSnapshot {
  readonly id: SlideId;
  readonly index: number;
  readonly contentStatus: string;
  readonly layoutId?: string;
  readonly background: string;
  readonly elements: readonly WorkbenchElementSnapshot[];
}

export interface WorkbenchDocumentSnapshot {
  readonly id: string;
  readonly title: string;
  readonly pageSize: PresentationDocument["pageSize"];
  readonly revisions: Revisions;
  readonly slides: readonly WorkbenchSlideSnapshot[];
}

export interface DocumentWorkbench {
  readonly base: WorkbenchDocumentSnapshot;
  readonly pendingCommands: readonly PlannedDesignCommand[];
}

export type DocumentWorkbenchCommitResult =
  | { readonly ok: true; readonly baseRevisions: Revisions; readonly commands: readonly PlannedDesignCommand[] }
  | { readonly ok: false; readonly code: "REVISION_CONFLICT"; readonly baseRevisions: Revisions; readonly currentRevisions: Revisions };

const idsSchema = { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true } as const;

export const DOCUMENT_WORKBENCH_TOOLS: readonly WorkbenchToolDefinition<DocumentWorkbenchToolName>[] = [
  { name: "document.inspect", description: "读取文档尺寸、revision 和页面数量。", inputSchema: emptySchema() },
  { name: "slide.list", description: "列出页面 ID、顺序、状态和对象数量。", inputSchema: emptySchema() },
  {
    name: "slide.inspect",
    description: "读取一页的布局、背景和对象摘要，不返回可写文档。",
    inputSchema: objectSchema({ slideId: { type: "string" } }, ["slideId"]),
  },
  {
    name: "element.inspect",
    description: "读取指定对象的类型、边界、旋转、锁定和可见状态。",
    inputSchema: objectSchema({ slideId: { type: "string" }, elementId: { type: "string" } }, ["slideId", "elementId"]),
  },
  {
    name: "element.place",
    description: "把现有对象放入布局工作台生成的槽位，产生 transform-element 设计命令。",
    inputSchema: objectSchema(
      { slideId: { type: "string" }, elementId: { type: "string" }, slot: { type: "string" } },
      ["slideId", "elementId", "slot"],
    ),
  },
  {
    name: "element.align",
    description: "规划多个对象的水平或垂直对齐命令。",
    inputSchema: objectSchema(
      {
        slideId: { type: "string" },
        elementIds: idsSchema,
        horizontal: { type: "string", enum: ["left", "center", "right"] },
        vertical: { type: "string", enum: ["top", "middle", "bottom"] },
      },
      ["slideId", "elementIds"],
    ),
  },
  {
    name: "element.distribute",
    description: "规划三个及以上对象的水平或垂直均匀分布命令。",
    inputSchema: objectSchema(
      { slideId: { type: "string" }, elementIds: idsSchema, axis: { type: "string", enum: ["horizontal", "vertical"] } },
      ["slideId", "elementIds", "axis"],
    ),
  },
  {
    name: "element.lock",
    description: "规划对象锁定或解锁命令。",
    inputSchema: objectSchema(
      { slideId: { type: "string" }, elementIds: idsSchema, locked: { type: "boolean" } },
      ["slideId", "elementIds", "locked"],
    ),
  },
  {
    name: "element.reorder",
    description: "规划对象图层顺序命令，索引 0 为页面最底层。",
    inputSchema: objectSchema(
      { slideId: { type: "string" }, elementId: { type: "string" }, toIndex: { type: "integer", minimum: 0 } },
      ["slideId", "elementId", "toIndex"],
    ),
  },
  {
    name: "element.text_style",
    description: "规划文本对象的字体、字号、颜色、粗体或对齐样式；不能修改文字内容。",
    inputSchema: objectSchema(
      {
        slideId: { type: "string" },
        elementId: { type: "string" },
        fontFamily: { type: "string" },
        fontSizePt: { type: "number", minimum: 6, maximum: 96 },
        color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        bold: { type: "boolean" },
        align: { type: "string", enum: ["left", "center", "right"] },
      },
      ["slideId", "elementId"],
    ),
  },
  { name: "plan.inspect", description: "读取尚未提交的设计命令计划和基准 revision。", inputSchema: emptySchema() },
  { name: "plan.clear", description: "清空尚未提交的设计命令，不修改 PPT 文档。", inputSchema: emptySchema() },
];

function emptySchema(): Readonly<Record<string, unknown>> {
  return { type: "object", properties: {}, additionalProperties: false };
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  return { type: "object", properties, required, additionalProperties: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !id)) return;
  return [...new Set(value)];
}

function snapshotElement(element: SlideElement): WorkbenchElementSnapshot {
  return {
    id: element.id,
    type: element.type,
    ...(element.name ? { name: element.name } : {}),
    frame: { ...element.frame },
    rotationMilliDegree: element.rotationMilliDegree,
    locked: element.locked,
    hidden: element.hidden === true,
    ...(element.origin ? { origin: element.origin } : {}),
  };
}

export function createDocumentWorkbench(document: PresentationDocument): DocumentWorkbench {
  return {
    base: {
      id: document.id,
      title: document.title,
      pageSize: { ...document.pageSize },
      revisions: { ...document.revisions },
      slides: document.slides.map((slide, index) => ({
        id: slide.id,
        index,
        contentStatus: slide.content.status,
        ...(slide.layoutId ? { layoutId: slide.layoutId } : {}),
        background: slide.background,
        elements: slide.elements.map(snapshotElement),
      })),
    },
    pendingCommands: [],
  };
}

export function prepareDocumentWorkbenchCommit(
  workbench: DocumentWorkbench,
  currentRevisions: Revisions,
): DocumentWorkbenchCommitResult {
  const base = workbench.base.revisions;
  if (
    base.document !== currentRevisions.document ||
    base.content !== currentRevisions.content ||
    base.design !== currentRevisions.design
  ) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      baseRevisions: { ...base },
      currentRevisions: { ...currentRevisions },
    };
  }
  return { ok: true, baseRevisions: { ...base }, commands: [...workbench.pendingCommands] };
}

function failure(workbench: DocumentWorkbench, code: string, paths: string[], message: string): WorkbenchCallResult<DocumentWorkbench> {
  return { ok: false, workbench, issues: [{ code, paths, message }] };
}

function findSlide(workbench: DocumentWorkbench, slideId: string) {
  return workbench.base.slides.find((slide) => slide.id === slideId);
}

function findElements(slide: WorkbenchSlideSnapshot, ids: readonly string[]) {
  return ids.map((id) => slide.elements.find((element) => element.id === id)).filter((value) => value !== undefined);
}

function appendCommand(workbench: DocumentWorkbench, command: PlannedDesignCommand): WorkbenchCallResult<DocumentWorkbench> {
  const next = { ...workbench, pendingCommands: [...workbench.pendingCommands, command] };
  return { ok: true, workbench: next, value: command };
}

export function callDocumentWorkbench(
  workbench: DocumentWorkbench,
  layout: LayoutWorkbench,
  tool: DocumentWorkbenchToolName,
  input: unknown,
): WorkbenchCallResult<DocumentWorkbench> {
  if (tool === "document.inspect") {
    return { ok: true, workbench, value: { ...workbench.base, slides: workbench.base.slides.length } };
  }
  if (tool === "slide.list") {
    return {
      ok: true,
      workbench,
      value: workbench.base.slides.map(({ id, index, contentStatus, layoutId, elements }) => ({
        id,
        index,
        contentStatus,
        ...(layoutId ? { layoutId } : {}),
        elementCount: elements.length,
      })),
    };
  }
  if (tool === "plan.inspect") {
    return { ok: true, workbench, value: { baseRevisions: workbench.base.revisions, commands: workbench.pendingCommands } };
  }
  if (tool === "plan.clear") {
    const next = { ...workbench, pendingCommands: [] };
    return { ok: true, workbench: next, value: { cleared: workbench.pendingCommands.length } };
  }
  if (!isRecord(input)) return failure(workbench, "INVALID_TOOL_INPUT", [tool], "工具参数必须是对象");

  const slideId = asString(input.slideId);
  const slide = slideId ? findSlide(workbench, slideId) : undefined;
  if (!slide) return failure(workbench, "SLIDE_NOT_FOUND", [String(slideId ?? "")], "页面不存在");
  if (tool === "slide.inspect") return { ok: true, workbench, value: slide };

  const elementId = asString(input.elementId);
  if (tool === "element.inspect" || tool === "element.place" || tool === "element.reorder" || tool === "element.text_style") {
    const element = elementId ? slide.elements.find((candidate) => candidate.id === elementId) : undefined;
    if (!element) return failure(workbench, "ELEMENT_NOT_FOUND", [String(elementId ?? "")], "对象不存在");
    if (tool === "element.inspect") return { ok: true, workbench, value: element };
    if (element.locked && tool !== "element.reorder") {
      return failure(workbench, "ELEMENT_LOCKED", [element.id], "对象已锁定，不能规划此操作");
    }
    if (tool === "element.place") {
      const slot = asString(input.slot);
      const frame = slot ? layout.slots.get(slot) : undefined;
      if (!frame) return failure(workbench, "INVALID_REFERENCE", [String(slot ?? "")], "布局槽位不存在");
      return appendCommand(workbench, {
        type: "transform-element",
        slideId: slide.id,
        elementId: element.id,
        frame: layoutRectToEmu(frame, workbench.base.pageSize),
        rotationMilliDegree: element.rotationMilliDegree,
      });
    }
    if (tool === "element.reorder") {
      if (!Number.isInteger(input.toIndex) || (input.toIndex as number) < 0 || (input.toIndex as number) >= slide.elements.length) {
        return failure(workbench, "INVALID_TOOL_INPUT", ["toIndex"], "图层索引超出范围");
      }
      return appendCommand(workbench, {
        type: "reorder-element",
        slideId: slide.id,
        elementId: element.id,
        toIndex: input.toIndex as number,
      });
    }
    if (element.type !== "text") return failure(workbench, "ELEMENT_TYPE_MISMATCH", [element.id], "对象不是文本");
    const style: Partial<TextElementStyle> = {};
    if (typeof input.fontFamily === "string" && input.fontFamily.trim()) style.fontFamily = input.fontFamily.trim();
    if (typeof input.fontSizePt === "number" && input.fontSizePt >= 6 && input.fontSizePt <= 96) style.fontSizePt = input.fontSizePt;
    if (typeof input.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(input.color)) style.color = input.color.toUpperCase();
    if (typeof input.bold === "boolean") style.bold = input.bold;
    if (input.align === "left" || input.align === "center" || input.align === "right") style.align = input.align;
    if (Object.keys(style).length === 0) return failure(workbench, "INVALID_TOOL_INPUT", ["style"], "至少提供一个有效文本样式");
    return appendCommand(workbench, { type: "set-text-style", slideId: slide.id, elementId: element.id, style });
  }

  const ids = asIds(input.elementIds);
  if (!ids) return failure(workbench, "INVALID_TOOL_INPUT", ["elementIds"], "对象 ID 列表无效");
  const elements = findElements(slide, ids);
  if (elements.length !== ids.length) return failure(workbench, "ELEMENT_NOT_FOUND", ids, "一个或多个对象不存在");
  if (tool !== "element.lock" && elements.some((element) => element.locked)) {
    return failure(workbench, "ELEMENT_LOCKED", elements.filter((element) => element.locked).map((element) => element.id), "包含已锁定对象");
  }
  if (tool === "element.lock") {
    if (typeof input.locked !== "boolean") return failure(workbench, "INVALID_TOOL_INPUT", ["locked"], "locked 必须是布尔值");
    return appendCommand(workbench, { type: "set-elements-lock", slideId: slide.id, elementIds: elements.map((element) => element.id), locked: input.locked });
  }
  if (tool === "element.distribute") {
    if (elements.length < 3) return failure(workbench, "INSUFFICIENT_SELECTION", ids, "分布操作至少需要三个对象");
    if (input.axis !== "horizontal" && input.axis !== "vertical") return failure(workbench, "INVALID_TOOL_INPUT", ["axis"], "分布轴无效");
    return appendCommand(workbench, { type: "distribute-elements", slideId: slide.id, elementIds: elements.map((element) => element.id), axis: input.axis });
  }
  if (tool === "element.align") {
    const horizontal = input.horizontal;
    const vertical = input.vertical;
    if (horizontal !== undefined && horizontal !== "left" && horizontal !== "center" && horizontal !== "right") {
      return failure(workbench, "INVALID_TOOL_INPUT", ["horizontal"], "水平对齐值无效");
    }
    if (vertical !== undefined && vertical !== "top" && vertical !== "middle" && vertical !== "bottom") {
      return failure(workbench, "INVALID_TOOL_INPUT", ["vertical"], "垂直对齐值无效");
    }
    if (horizontal === undefined && vertical === undefined) return failure(workbench, "INVALID_TOOL_INPUT", ["align"], "至少提供一个对齐方向");
    return appendCommand(workbench, {
      type: "align-elements",
      slideId: slide.id,
      elementIds: elements.map((element) => element.id),
      align: {
        ...(horizontal ? { horizontal } : {}),
        ...(vertical ? { vertical } : {}),
      },
    });
  }
  return failure(workbench, "UNSUPPORTED_TOOL", [tool], "Workbench 工具未注册");
}
