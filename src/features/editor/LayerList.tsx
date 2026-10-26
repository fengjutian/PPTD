import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Minus,
  Search,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Type,
  X,
} from "lucide-react";

import type { DocumentCommand } from "../../core/commands";
import type { ElementId, Slide, SlideElement, SlideGroup } from "../../core/document-model";

import { ElementPreview } from "./ElementPreview";
import { LayerContextMenu } from "./LayerContextMenu";
import {
  arrayInsertionIndex,
  blockMoved,
  blockMoveIndex,
  derivedElementName,
  dragBlockIds,
  elementKind,
  filterLayerRows,
  fullElementName,
  insertionIndex,
  layerRangeIds,
  layerRows,
  type LayerRowRect,
} from "./layer-order";

/** A pointer has to travel this far before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** The footprint of the context menu, used to keep it inside the window. */
const MENU_SIZE = { width: 196, height: 380 };

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
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; elementId: ElementId } | null>(null);
  const [editingId, setEditingId] = useState<ElementId | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const allRows = useMemo(() => layerRows(slide), [slide]);
  const rows = useMemo(() => filterLayerRows(allRows, query), [allRows, query]);
  const filtering = query.trim().length > 0;
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
  const searchRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // The ref is the synchronous truth for the blur that follows a commit or a
  // cancel; React state updates cannot stop that second call in time.
  const editingIdRef = useRef<ElementId | null>(null);
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

  // A rename belongs to one page and one object. Leaving the page, or deleting
  // the row from another panel, cancels it instead of writing to a stale row.
  useEffect(() => {
    editingIdRef.current = null;
    setEditingId(null);
  }, [slide.id]);
  useEffect(() => {
    if (editingId && !slide.elements.some((element) => element.id === editingId)) {
      editingIdRef.current = null;
      setEditingId(null);
    }
  }, [editingId, slide.elements]);

  const focusRow = (elementId: ElementId) => {
    // The store update re-renders the row before the focus call lands.
    window.requestAnimationFrame(() => rowRefs.current.get(elementId)?.focus());
  };

  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  const blockOf = (elementId: ElementId) => dragBlockIds(slide, elementId, selectedElementIds);
  const blockLocked = (elementIds: readonly ElementId[]) =>
    elementIds.every((id) => slide.elements.find((element) => element.id === id)?.locked ?? false);

  const toggleLock = (elementId: ElementId) => {
    const elementIds = blockOf(elementId);
    onCommand({ type: "set-elements-lock", slideId: slide.id, elementIds, locked: !blockLocked(elementIds) });
  };

  const toggleHidden = (elementId: ElementId) => {
    const elementIds = blockOf(elementId);
    const allHidden = elementIds.every((id) => slide.elements.find((element) => element.id === id)?.hidden === true);
    onCommand({ type: "set-elements-hidden", slideId: slide.id, elementIds, hidden: !allHidden });
  };

  const startRename = (element: SlideElement) => {
    editingIdRef.current = element.id;
    setEditingId(element.id);
    setNameDraft(element.name ?? "");
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  };

  const commitRename = (element: SlideElement, value: string, restoreFocus: boolean) => {
    if (editingIdRef.current !== element.id) return;
    editingIdRef.current = null;
    setEditingId(null);
    const name = value.replace(/\s+/g, " ").trim();
    if (name !== (element.name ?? "")) {
      onCommand({ type: "rename-element", slideId: slide.id, elementId: element.id, name });
    }
    if (restoreFocus) focusRow(element.id);
  };

  const cancelRename = (element: SlideElement) => {
    editingIdRef.current = null;
    setEditingId(null);
    focusRow(element.id);
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

  const openMenu = (event: React.MouseEvent, element: SlideElement) => {
    event.preventDefault();
    if (!selectedSet.has(element.id)) onSelect(element.id);
    // The row keeps the focus so Escape and the arrow keys continue from it.
    rowRefs.current.get(element.id)?.focus();
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_SIZE.width - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_SIZE.height - 8));
    setMenu({ x, y, elementId: element.id });
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
    if (key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      startRename(row);
      return;
    }
    if (event.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
      event.preventDefault();
      event.stopPropagation();
      const block = blockOf(row.id);
      // The command refuses a locked member, so the keyboard must not try.
      if (block.some((id) => slide.elements.find((element) => element.id === id)?.locked)) return;
      const toIndex = blockMoveIndex(slide.elements, block, key === "ArrowUp" ? "up" : "down");
      if (toIndex !== null) onCommand({ type: "reorder-elements", slideId: slide.id, elementIds: block, toIndex });
      return;
    }
    if (key === "ContextMenu" || (event.shiftKey && key === "F10")) {
      event.preventDefault();
      event.stopPropagation();
      const box = rowRefs.current.get(row.id)?.getBoundingClientRect();
      const x = Math.max(8, Math.min((box?.left ?? 0) + 24, window.innerWidth - MENU_SIZE.width - 8));
      const y = Math.max(8, Math.min((box?.bottom ?? 0) + 4, window.innerHeight - MENU_SIZE.height - 8));
      setMenu({ x, y, elementId: row.id });
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
    if ((event.target as HTMLElement).closest("button, input")) return;
    if (editingId === element.id) return;
    // Modified clicks belong to selection, never to a drag.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!selectedSet.has(element.id)) onSelect(element.id);
    // A filtered list has no stable neighbour to drop against, so dragging is
    // disabled until the search is cleared. Clicking still selects.
    if (filtering) return;

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
  const tabStopId = [...selectedElementIds].reverse().find((id) => rows.some((row) => row.id === id)) ?? rows[0]?.id;

  return (
    <div className={`layer-panel${filtering ? " filtering" : ""}`}>
      <div className="layer-toolbar">
        <span>
          {selectedElementIds.length > 0
            ? `已选 ${selectedElementIds.length} / ${allRows.length}`
            : `${allRows.length} 个对象`}
        </span>
        <span className="layer-toolbar-actions">
          <button
            type="button"
            disabled={rows.length === 0}
            title={filtering ? "全选匹配的图层" : "全选图层"}
            onClick={() => onSelectMany(rows.map((row) => row.id))}
          >
            全选
          </button>
          <button type="button" disabled={selectedElementIds.length === 0} onClick={() => onSelectMany([])}>
            取消选择
          </button>
        </span>
      </div>

      <div className="layer-search">
        <Search aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索图层"
          aria-label="搜索图层"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (query) {
                event.stopPropagation();
                setQuery("");
              }
              return;
            }
            if ((event.key === "Enter" || event.key === "ArrowDown") && rows[0]) {
              event.preventDefault();
              if (event.key === "Enter") {
                onSelect(rows[0].id);
                anchorRef.current = rows[0].id;
              }
              focusRow(rows[0].id);
            }
          }}
        />
        {filtering && (
          <span className="layer-search-count">
            {rows.length}/{allRows.length}
          </span>
        )}
        {filtering && (
          <button type="button" aria-label="清除搜索" title="清除搜索" onClick={clearSearch}>
            <X />
          </button>
        )}
      </div>

      <div className="layer-list" role="listbox" aria-label="当前页图层" aria-multiselectable="true" ref={listRef}>
        {rows.length === 0 &&
          (allRows.length === 0 ? (
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
          ) : (
            <div className="layer-empty">
              <Search />
              <p>没有匹配的图层</p>
              <button type="button" className="layer-clear-search" onClick={clearSearch}>
                清除搜索
              </button>
            </div>
          ))}

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
            element.hidden ? "is-hidden" : "",
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
                element.hidden ? "，已隐藏" : ""
              }${group ? `，与另外 ${group.elementIds.length - 1} 个对象同组` : ""}`}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+F10 F2"
              title={`${kind}：${name}`}
              data-layer-id={element.id}
              className={className}
              tabIndex={element.id === tabStopId ? 0 : -1}
              ref={(node) => {
                if (node) rowRefs.current.set(element.id, node);
                else rowRefs.current.delete(element.id);
              }}
              onClick={(event) => handleRowClick(event, element)}
              onContextMenu={(event) => openMenu(event, element)}
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
                {editingId === element.id ? (
                  <input
                    ref={nameInputRef}
                    className="layer-name-input"
                    value={nameDraft}
                    maxLength={80}
                    placeholder={derivedElementName(element)}
                    aria-label="图层名称"
                    onChange={(event) => setNameDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      // The row would otherwise nudge, delete or move the layer.
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(element, event.currentTarget.value, true);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename(element);
                      }
                    }}
                    onBlur={(event) => commitRename(element, event.currentTarget.value, false)}
                  />
                ) : (
                  <span
                    className="layer-name"
                    title={name}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      startRename(element);
                    }}
                  >
                    {name}
                  </span>
                )}
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
                  title={element.hidden ? "显示图层" : "隐藏图层"}
                  aria-label={element.hidden ? "显示图层" : "隐藏图层"}
                  aria-pressed={element.hidden === true}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleHidden(element.id);
                  }}
                >
                  {element.hidden ? <EyeOff /> : <Eye />}
                </button>
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

      {allRows.length > 0 && (
        <p className="layer-hint">
          {filtering ? (
            "搜索中 · 清除搜索后可拖动排序"
          ) : (
            <>
              <span>拖动排序 · Alt+↑↓ 调层级 · Shift 连选</span>
              <span>右键更多操作 · Del 删除</span>
            </>
          )}
        </p>
      )}

      {menu && (
        <LayerContextMenu
          slide={slide}
          elementId={menu.elementId}
          selectedElementIds={selectedElementIds}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={(elementId) => {
            const element = slide.elements.find((item) => item.id === elementId);
            if (element) startRename(element);
          }}
          onCommand={onCommand}
        />
      )}
    </div>
  );
});
