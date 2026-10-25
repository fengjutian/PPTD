import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Circle,
  Copy,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Minus,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Type,
} from "lucide-react";

import type { DocumentCommand } from "../../core/commands";
import type { ElementId, Slide, SlideElement, SlideGroup } from "../../core/document-model";

import { ElementPreview } from "./ElementPreview";
import {
  arrayInsertionIndex,
  blockMoved,
  dragBlockIds,
  insertionIndex,
  layerRangeIds,
  layerRows,
  type LayerRowRect,
} from "./layer-order";
import { ICON_LABELS } from "./icon-options";

/** A pointer has to travel this far before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

const SHAPE_LABELS = {
  rectangle: "矩形",
  ellipse: "椭圆",
  triangle: "三角形",
  diamond: "菱形",
  pentagon: "五边形",
  hexagon: "六边形",
  chevron: "V 形",
  arrow: "箭头",
  star: "星形",
  parallelogram: "平行四边形",
  trapezoid: "梯形",
} as const;

function elementKind(element: SlideElement): string {
  if (element.type === "text") return "文本";
  if (element.type === "image") return "图片";
  if (element.type === "chart") return "图表";
  if (element.type === "table") return "表格";
  if (element.type === "line") return "线条";
  if (element.type === "icon") return "图标";
  return SHAPE_LABELS[element.shape];
}

/** The full name, used for the tooltip; the row itself truncates it with CSS. */
function fullElementName(element: SlideElement): string {
  if (element.type === "text") return element.text.replace(/\s+/g, " ").trim().slice(0, 80) || "文本";
  if (element.type === "image") return element.altText.trim().slice(0, 80) || "图片";
  if (element.type === "icon") return ICON_LABELS[element.name];
  return elementKind(element);
}

function ElementIcon({ element }: { element: SlideElement }) {
  if (element.type === "text") return <Type />;
  if (element.type === "image") return <ImageIcon />;
  if (element.type === "chart") return <BarChart3 />;
  if (element.type === "table") return <Table2 />;
  if (element.type === "line") return <Minus />;
  if (element.type === "icon") return <Circle />;
  return element.shape === "ellipse" ? <Circle /> : <Square />;
}

interface ActiveDrag {
  pointerId: number;
  startX: number;
  startY: number;
  elementId: ElementId;
  blockIds: ElementId[];
  /** Set once the pointer moved past the threshold; a click stays a click. */
  moved: boolean;
  /** Insertion index among the rows the block does not occupy, top-down. */
  displayInsert: number;
}

interface DragPreview {
  elementId: ElementId;
  blockIds: ElementId[];
  displayInsert: number;
}

export interface LayerListProps {
  slide: Slide;
  /** 选中的对象，可以有多个。 */
  selectedElementIds: readonly ElementId[];
  onSelect: (elementId: ElementId) => void;
  /** 增减一个对象的选中状态。 */
  onToggle: (elementId: ElementId) => void;
  /** 一次选中一组对象，用于 Shift 连选和全选。 */
  onSelectMany: (elementIds: ElementId[]) => void;
  /** Every mutation goes through a document command, so it is one undo entry. */
  onCommand: (command: DocumentCommand) => void;
}

/**
 * Layer list of the current page, topmost element first.
 *
 * Selecting stays inside the panel; every change to the document (order, lock,
 * duplicate, delete) is reported as a command. A drag therefore produces one
 * `reorder-elements` command for the whole moved block, not one per object.
 */
export const LayerList = memo(function LayerList({
  slide,
  selectedElementIds,
  onSelect,
  onToggle,
  onSelectMany,
  onCommand,
}: LayerListProps) {
  const rows = useMemo(() => layerRows(slide), [slide]);
  const groupByElement = useMemo(() => {
    const map = new Map<ElementId, SlideGroup>();
    for (const group of slide.groups ?? []) {
      for (const id of group.elementIds) map.set(id, group);
    }
    return map;
  }, [slide.groups]);
  const animatedElementIds = useMemo(
    () => new Set((slide.animations ?? []).map((animation) => animation.elementId)),
    [slide.animations],
  );
  const selectedSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const selectedGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const elementId of selectedElementIds) {
      const group = groupByElement.get(elementId);
      if (group) ids.add(group.id);
    }
    return ids;
  }, [groupByElement, selectedElementIds]);

  const [drag, setDrag] = useState<DragPreview | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<ElementId, HTMLDivElement>());
  const dragRef = useRef<ActiveDrag | null>(null);
  const anchorRef = useRef<ElementId | null>(null);
  const suppressClickRef = useRef(false);
  const detachRef = useRef<() => void>(() => undefined);
  // The pointer handlers live for the duration of one drag, so they read the
  // latest page and selection from refs instead of capturing a stale render.
  const slideRef = useRef(slide);
  slideRef.current = slide;

  useEffect(() => {
    return () => detachRef.current();
  }, []);

  // Keep the selected row in sight when the selection comes from the canvas.
  useEffect(() => {
    const focused = selectedElementIds.at(-1);
    if (!focused) return;
    rowRefs.current.get(focused)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedElementIds, slide.id]);

  const focusRow = (elementId: ElementId) => {
    // The store update re-renders the row before the focus call lands.
    window.requestAnimationFrame(() => rowRefs.current.get(elementId)?.focus());
  };

  const blockOf = (elementId: ElementId) => dragBlockIds(slide, elementId, selectedElementIds);
  const blockLocked = (elementIds: readonly ElementId[]) =>
    elementIds.every((id) => slide.elements.find((element) => element.id === id)?.locked ?? false);

  const toggleLock = (elementId: ElementId) => {
    const elementIds = blockOf(elementId);
    onCommand({ type: "set-elements-lock", slideId: slide.id, elementIds, locked: !blockLocked(elementIds) });
  };

  const duplicate = (elementId: ElementId) => {
    onCommand({ type: "duplicate-elements", slideId: slide.id, elementIds: blockOf(elementId) });
  };

  const remove = (elementId: ElementId) => {
    const elementIds = blockOf(elementId).filter(
      (id) => !(slide.elements.find((element) => element.id === id)?.locked ?? false),
    );
    if (elementIds.length === 0) return;
    onCommand({ type: "delete-elements", slideId: slide.id, elementIds });
  };

  const deleteSelection = () => {
    const elementIds = selectedElementIds.filter(
      (id) => !(slide.elements.find((element) => element.id === id)?.locked ?? false),
    );
    if (elementIds.length === 0) return;
    onCommand({ type: "delete-elements", slideId: slide.id, elementIds });
  };

  const handleRowClick = (event: React.MouseEvent, element: SlideElement) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (event.shiftKey) {
      // A Shift click extends from the last row the user picked. When the
      // selection came from the canvas, the last selected object is the anchor.
      const anchor = anchorRef.current ?? selectedElementIds.at(-1) ?? element.id;
      const range = layerRangeIds(rows, anchor, element.id);
      onSelectMany(range.length > 0 ? range : [element.id]);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      onToggle(element.id);
      anchorRef.current = element.id;
      return;
    }
    onSelect(element.id);
    anchorRef.current = element.id;
  };

  const handleRowKeyDown = (event: React.KeyboardEvent, index: number) => {
    const row = rows[index];
    if (!row) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      onSelectMany(rows.map((item) => item.id));
      return;
    }
    if (key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End") {
      event.preventDefault();
      event.stopPropagation();
      const nextIndex =
        key === "Home"
          ? 0
          : key === "End"
            ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (key === "ArrowUp" ? -1 : 1)));
      const next = rows[nextIndex];
      if (!next || next.id === row.id) return;
      if (event.shiftKey) {
        const anchor = anchorRef.current ?? row.id;
        const range = layerRangeIds(rows, anchor, next.id);
        onSelectMany(range.length > 0 ? range : [next.id]);
      } else {
        onSelect(next.id);
        anchorRef.current = next.id;
      }
      focusRow(next.id);
      return;
    }
    if (key === " " || key === "Spacebar") {
      event.preventDefault();
      onToggle(row.id);
      anchorRef.current = row.id;
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      onSelect(row.id);
      anchorRef.current = row.id;
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      deleteSelection();
      return;
    }
    if (key === "Escape") {
      // Escape stays available to the window: it also closes the find bar.
      onSelectMany([]);
    }
  };

  /**
   * Starts a possible drag. The row is selected at once so dragging an
   * unselected object moves it, but nothing is written until the drop.
   */
  const handlePointerDown = (event: React.PointerEvent, element: SlideElement) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    // Modified clicks belong to selection, never to a drag.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!selectedSet.has(element.id)) onSelect(element.id);

    const blockIds = dragBlockIds(slide, element.id, selectedSet.has(element.id) ? selectedElementIds : []);
    if (blockIds.some((id) => slide.elements.find((item) => item.id === id)?.locked)) return;

    const state: ActiveDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      elementId: element.id,
      blockIds,
      moved: false,
      displayInsert: 0,
    };
    dragRef.current = state;

    const currentRowRects = (): LayerRowRect[] => {
      const list = listRef.current;
      if (!list) return [];
      const block = new Set(state.blockIds);
      const rects: LayerRowRect[] = [];
      for (const node of list.querySelectorAll<HTMLElement>("[data-layer-id]")) {
        if (block.has(node.dataset.layerId as ElementId)) continue;
        const box = node.getBoundingClientRect();
        rects.push({ top: box.top, height: box.height });
      }
      return rects;
    };

    const detach = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", cancelDrag);
      document.body.classList.remove("layer-reordering");
      detachRef.current = () => undefined;
    };

    const cancelDrag = () => {
      detach();
      dragRef.current = null;
      setDrag(null);
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== state.pointerId) return;
      if (!state.moved) {
        const distance = Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY);
        if (distance < DRAG_THRESHOLD_PX) return;
        state.moved = true;
        document.body.classList.add("layer-reordering");
      }
      moveEvent.preventDefault();
      // Scroll while dragging near an edge, otherwise a page with more rows
      // than the panel shows could not be reordered across the fold.
      const list = listRef.current;
      if (list) {
        const box = list.getBoundingClientRect();
        if (moveEvent.clientY < box.top + 24) list.scrollTop -= 12;
        else if (moveEvent.clientY > box.bottom - 24) list.scrollTop += 12;
      }
      state.displayInsert = insertionIndex(currentRowRects(), moveEvent.clientY);
      setDrag((current) =>
        current && current.displayInsert === state.displayInsert
          ? current
          : { elementId: state.elementId, blockIds: state.blockIds, displayInsert: state.displayInsert },
      );
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== state.pointerId) return;
      detach();
      dragRef.current = null;
      setDrag(null);
      if (!state.moved) return;
      // The click that follows this pointerup is the tail of the drag, not a
      // request to change the selection.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 250);
      const current = slideRef.current;
      const remaining = current.elements.length - state.blockIds.length;
      const toIndex = arrayInsertionIndex(remaining, state.displayInsert);
      if (!blockMoved(current.elements, state.blockIds, toIndex)) return;
      onCommand({ type: "reorder-elements", slideId: current.id, elementIds: state.blockIds, toIndex });
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== state.pointerId) return;
      cancelDrag();
    };

    detachRef.current = detach;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", cancelDrag);
  };

  const dropRows = drag ? rows.filter((row) => !drag.blockIds.includes(row.id)) : [];
  const dropBeforeId = drag && drag.displayInsert < dropRows.length ? dropRows[drag.displayInsert]!.id : undefined;
  const dropAfterId =
    drag && dropRows.length > 0 && drag.displayInsert >= dropRows.length
      ? dropRows[dropRows.length - 1]!.id
      : undefined;
  const tabStopId = selectedElementIds.at(-1) ?? rows[0]?.id;

  return (
    <div className="layer-panel">
      <div className="layer-toolbar">
        <span>
          {selectedElementIds.length > 0
            ? `已选 ${selectedElementIds.length} / ${rows.length}`
            : `${rows.length} 个对象`}
        </span>
        <span className="layer-toolbar-actions">
          <button type="button" disabled={rows.length === 0} onClick={() => onSelectMany(rows.map((row) => row.id))}>
            全选
          </button>
          <button type="button" disabled={selectedElementIds.length === 0} onClick={() => onSelectMany([])}>
            取消选择
          </button>
        </span>
      </div>

      <div className="layer-list" role="listbox" aria-label="当前页图层" aria-multiselectable="true" ref={listRef}>
        {rows.length === 0 && (
          <div className="layer-empty">
            <Layers />
            <p>当前页没有对象</p>
            <span className="layer-empty-actions">
              <button type="button" onClick={() => onCommand({ type: "add-text", slideId: slide.id })}>
                <Type />
                文本
              </button>
              <button
                type="button"
                onClick={() => onCommand({ type: "add-shape", slideId: slide.id, shape: "rectangle" })}
              >
                <Square />
                矩形
              </button>
            </span>
          </div>
        )}

        {rows.map((element, index) => {
          const selected = selectedSet.has(element.id);
          const group = groupByElement.get(element.id);
          const groupMate = group !== undefined && selectedGroupIds.has(group.id) && !selected;
          const dragging = drag ? drag.blockIds.includes(element.id) : false;
          const className = [
            "layer-row",
            selected ? "active" : "",
            groupMate ? "group-mate" : "",
            element.locked ? "locked" : "",
            dragging ? "dragging" : "",
            dropBeforeId === element.id ? "drop-before" : "",
            dropAfterId === element.id ? "drop-after" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const name = fullElementName(element);
          const kind = elementKind(element);
          return (
            <div
              key={element.id}
              role="option"
              aria-selected={selected}
              aria-label={`${kind}：${name}${element.locked ? "，已锁定" : ""}${
                group ? `，与另外 ${group.elementIds.length - 1} 个对象同组` : ""
              }`}
              title={`${kind}：${name}`}
              data-layer-id={element.id}
              className={className}
              tabIndex={element.id === tabStopId ? 0 : -1}
              ref={(node) => {
                if (node) rowRefs.current.set(element.id, node);
                else rowRefs.current.delete(element.id);
              }}
              onClick={(event) => handleRowClick(event, element)}
              onKeyDown={(event) => handleRowKeyDown(event, index)}
              onPointerDown={(event) => handlePointerDown(event, element)}
            >
              <span className="layer-thumb" aria-hidden="true">
                <ElementPreview element={element} slide={slide} width={36} height={24} />
                <span className="layer-type">
                  <ElementIcon element={element} />
                </span>
              </span>

              <span className="layer-copy">
                <span className="layer-name">{name}</span>
                {(group !== undefined || animatedElementIds.has(element.id) || element.locked) && (
                  <span className="layer-meta">
                    {group && (
                      <span
                        className="layer-badge layer-badge-group"
                        title={`与另外 ${group.elementIds.length - 1} 个对象同组`}
                      >
                        <Layers />
                        {group.elementIds.length}
                      </span>
                    )}
                    {animatedElementIds.has(element.id) && (
                      <span className="layer-badge" title="有动画">
                        <Sparkles />
                      </span>
                    )}
                    {element.locked && (
                      <span className="layer-badge layer-lock" title="已锁定">
                        <Lock />
                      </span>
                    )}
                  </span>
                )}
              </span>

              <span
                className="layer-actions"
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="layer-action"
                  title={element.locked ? "解锁" : "锁定"}
                  aria-label={element.locked ? "解锁" : "锁定"}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleLock(element.id);
                  }}
                >
                  {element.locked ? <LockOpen /> : <Lock />}
                </button>
                <button
                  type="button"
                  className="layer-action"
                  title={element.locked ? "已锁定，先解锁再复制" : "复制"}
                  aria-label="复制"
                  disabled={element.locked}
                  onClick={(event) => {
                    event.stopPropagation();
                    duplicate(element.id);
                  }}
                >
                  <Copy />
                </button>
                <button
                  type="button"
                  className="layer-action danger"
                  title={element.locked ? "已锁定，先解锁再删除" : "删除"}
                  aria-label="删除"
                  disabled={element.locked}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(element.id);
                  }}
                >
                  <Trash2 />
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {rows.length > 0 && <p className="layer-hint">拖动排序 · Shift 连选 · Delete 删除</p>}
    </div>
  );
});
