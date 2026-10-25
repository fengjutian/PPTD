import { memo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ElementId, RectEmu, Slide, SlideAnimation, SlideElement } from "../../core/document-model";
import { emu, EMU_PER_INCH } from "../../core/document-model";
import { unionFrame } from "../../core/commands/arrange";
import { resizeEdgesOf, snapMovingFrame, snapResizedFrame } from "../../core/rendering/snap";
import { useCanvasGuidesStore } from "../../store/canvas-guides-store";
import { useEditorStore } from "../../store/editor-store";
import { useFormatPainterStore } from "../../store/format-painter";
import { useGroupDragStore } from "../../store/group-drag-store";
import { SlideElementContent, SlideElementFrame } from "./SlideScene";
import type { SnapContext } from "./use-snap-context";

type ResizeDirection = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
const MIN_ELEMENT_SIZE = emu(0.1 * EMU_PER_INCH);
const RESIZE_HANDLES: ReadonlyArray<readonly [ResizeDirection, string]> = [
  ["nw", "左上"],
  ["n", "上"],
  ["ne", "右上"],
  ["w", "左"],
  ["e", "右"],
  ["sw", "左下"],
  ["s", "下"],
  ["se", "右下"],
];

function resizeFrame(start: RectEmu, direction: ResizeDirection, dx: number, dy: number): RectEmu {
  let x: number = start.x;
  let y: number = start.y;
  let width: number = start.width;
  let height: number = start.height;
  if (direction.includes("e")) width = Math.max(MIN_ELEMENT_SIZE, start.width + dx);
  if (direction.includes("s")) height = Math.max(MIN_ELEMENT_SIZE, start.height + dy);
  if (direction.includes("w")) {
    width = Math.max(MIN_ELEMENT_SIZE, start.width - dx);
    x = start.x + start.width - width;
  }
  if (direction.includes("n")) {
    height = Math.max(MIN_ELEMENT_SIZE, start.height - dy);
    y = start.y + start.height - height;
  }
  return { x: emu(x), y: emu(y), width: emu(width), height: emu(height) };
}

function normalizeRotation(value: number): number {
  return ((Math.round(value) % 360_000) + 360_000) % 360_000;
}

/**
 * Reads the pixel size of a picture so it can be placed with its own
 * proportions. A picture that cannot be decoded is placed in the default box.
 */
export const ElementView = memo(function ElementView({
  element,
  slide,
  scale,
  selected,
  snap,
  previewAnimation,
}: {
  element: SlideElement;
  slide: Slide;
  scale: number;
  selected: boolean;
  snap: SnapContext;
  previewAnimation?: SlideAnimation;
}) {
  const execute = useEditorStore((s) => s.execute);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const toggleElement = useEditorStore((s) => s.toggleElement);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setActiveSnap = useCanvasGuidesStore((s) => s.setActiveSnap);
  const groupDrag = useGroupDragStore((s) => s.groupDrag);
  const beginGroupDrag = useGroupDragStore((s) => s.beginGroupDrag);
  const updateGroupDrag = useGroupDragStore((s) => s.updateGroupDrag);
  const endGroupDrag = useGroupDragStore((s) => s.endGroupDrag);
  const rootRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<{
    kind: "move" | "resize" | "rotate";
    direction?: ResizeDirection;
    pointerId: number;
    startX: number;
    startY: number;
    frame: RectEmu;
    rotation: number;
    startAngle?: number;
    /** 一起移动的对象，以及拖动开始时它们的外接框。 */
    groupIds?: ElementId[];
    groupUnion?: RectEmu;
  } | null>(null);
  const [previewFrame, setPreviewFrame] = useState<RectEmu | null>(null);
  const [previewRotation, setPreviewRotation] = useState<number | null>(null);
  // 跟着整组一起动的对象，用整组的位移渲染；握鼠标的那个自己画预览。
  const followerOffset =
    groupDrag && groupDrag.leaderId !== element.id && groupDrag.ids.includes(element.id)
      ? { x: groupDrag.dx, y: groupDrag.dy }
      : { x: 0, y: 0 };
  const frame = previewFrame
    ? previewFrame
    : followerOffset.x || followerOffset.y
      ? { ...element.frame, x: emu(element.frame.x + followerOffset.x), y: emu(element.frame.y + followerOffset.y) }
      : element.frame;
  const rotation = previewRotation ?? element.rotationMilliDegree;
  const style: CSSProperties & { "--pptd-animation-x"?: string; "--pptd-animation-y"?: string } = {
    left: frame.x * scale,
    top: frame.y * scale,
    width: frame.width * scale,
    height: frame.height * scale,
    transform: `rotate(${rotation / 1000}deg)`,
    touchAction: "none",
    animationDuration: previewAnimation ? `${previewAnimation.durationMs}ms` : undefined,
    animationDelay: previewAnimation ? `${previewAnimation.delayMs}ms` : undefined,
    "--pptd-animation-x":
      previewAnimation?.direction === "left" ? "-36px" : previewAnimation?.direction === "right" ? "36px" : "0",
    "--pptd-animation-y":
      previewAnimation?.direction === "top" ? "-36px" : previewAnimation?.direction === "bottom" ? "36px" : "0",
  };

  /**
   * 把一次拖拽的结果吸附到网格或参考线上。
   *
   * 吸附只在拖拽过程中发生，结束时提交的仍然是普通的设计命令：吸附不
   * 产生新的坐标类型，也不会让撤销栈多出一项。
   */
  const applyMoveSnap = (candidate: RectEmu, report: boolean) => {
    if (!snap.enabled) {
      if (report) setActiveSnap({});
      return { frame: candidate, hitX: undefined, hitY: undefined };
    }
    const snapped = snapMovingFrame(candidate, snap.targets, snap.threshold);
    if (report) setActiveSnap({ x: snapped.hitX, y: snapped.hitY });
    return snapped;
  };

  /**
   * 缩放时只吸附被拖动的那条边。
   *
   * 缩放的对象不该整体平移：那样每拖一次，位置就悄悄变了。所以这里不走
   * 移动吸附，只让被拖动的边贴到目标线上。
   */
  const applyResizeSnap = (candidate: RectEmu, direction: ResizeDirection, report: boolean) => {
    if (!snap.enabled) {
      if (report) setActiveSnap({});
      return { frame: candidate, hitX: undefined, hitY: undefined };
    }
    const snapped = snapResizedFrame(candidate, resizeEdgesOf(direction), snap.targets, snap.threshold);
    if (report) setActiveSnap({ x: snapped.hitX, y: snapped.hitY });
    return snapped;
  };

  const begin = (kind: "move" | "resize" | "rotate", event: ReactPointerEvent, direction?: ResizeDirection) => {
    event.stopPropagation();
    event.preventDefault();
    // An active format brush consumes the click instead of starting a drag: the
    // user is pointing at the target, not grabbing it.
    const painter = useFormatPainterStore.getState();
    if (kind === "move" && painter.style && element.type === "text" && !element.locked) {
      execute({
        type: "set-text-style-elements",
        slideId: activeSlideId,
        elementIds: [element.id],
        style: painter.style,
        clearRuns: true,
      });
      selectElement(element.id);
      painter.consume();
      return;
    }
    // Ctrl、Cmd 或 Shift 点选是增减选中，不该顺手拖动对象。
    if (kind === "move" && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      toggleElement(element.id);
      return;
    }
    // 拖动已经在选中的对象时，整组一起走；点未选中的对象则只选它一个。
    const groupIds =
      kind === "move" && selectedElementIds.length > 1 && selectedElementIds.includes(element.id)
        ? selectedElementIds.filter((id) => !slide.elements.find((item) => item.id === id)?.locked)
        : undefined;
    if (!groupIds || groupIds.length < 2) selectElement(element.id);
    if (element.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rootRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : event.clientX;
    const centerY = rect ? rect.top + rect.height / 2 : event.clientY;
    const groupUnion =
      groupIds && groupIds.length > 1
        ? unionFrame(slide.elements.filter((item) => groupIds.includes(item.id)).map((item) => item.frame))
        : undefined;
    if (groupUnion) beginGroupDrag(groupIds!, element.id);
    interaction.current = {
      kind,
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame: { ...element.frame },
      rotation: element.rotationMilliDegree,
      startAngle: kind === "rotate" ? Math.atan2(event.clientY - centerY, event.clientX - centerX) : undefined,
      groupIds,
      groupUnion,
    };
  };

  /**
   * 拖动中算出的位移。
   *
   * 多选时吸附的是整组的外接框：整组贴到网格线上，而不是某一个成员贴上去
   * 而其他成员留在原地。
   */
  const dragDelta = (current: NonNullable<typeof interaction.current>, event: ReactPointerEvent) => {
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    if (!current.groupUnion) return { dx, dy };
    const moved = { ...current.groupUnion, x: emu(current.groupUnion.x + dx), y: emu(current.groupUnion.y + dy) };
    const snapped = applyMoveSnap(moved, true);
    return { dx: snapped.frame.x - current.groupUnion.x, dy: snapped.frame.y - current.groupUnion.y };
  };

  const pointerMove = (event: ReactPointerEvent) => {
    const current = interaction.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    if (current.kind === "move") {
      const delta = dragDelta(current, event);
      if (current.groupIds && current.groupIds.length > 1) {
        updateGroupDrag(emu(delta.dx), emu(delta.dy));
        // 握鼠标的那个对象也要跟着动：它是这一组的预览，其余成员用整组位移跟随。
        setPreviewFrame({ ...current.frame, x: emu(current.frame.x + delta.dx), y: emu(current.frame.y + delta.dy) });
        return;
      }
      const candidate = { ...current.frame, x: emu(current.frame.x + delta.dx), y: emu(current.frame.y + delta.dy) };
      setPreviewFrame(applyMoveSnap(candidate, true).frame);
      return;
    }
    if (current.kind === "resize") {
      const resized = resizeFrame(current.frame, current.direction!, dx, dy);
      setPreviewFrame(applyResizeSnap(resized, current.direction!, true).frame);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    setPreviewRotation(normalizeRotation(current.rotation + (((angle - current.startAngle!) * 180) / Math.PI) * 1000));
  };

  const finish = (event: ReactPointerEvent, cancelled = false) => {
    const current = interaction.current;
    if (!current) return;
    interaction.current = null;
    setPreviewFrame(null);
    setPreviewRotation(null);
    setActiveSnap({});
    endGroupDrag();
    if (cancelled) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    if (current.kind === "move") {
      const delta = dragDelta(current, event);
      if (current.groupIds && current.groupIds.length > 1) {
        if (!delta.dx && !delta.dy) return;
        // 整组一起移动是一个意图，所以是一个命令、一个撤销项。
        execute({
          type: "move-elements",
          slideId: activeSlideId,
          elementIds: current.groupIds,
          dx: emu(delta.dx),
          dy: emu(delta.dy),
        });
        return;
      }
      if (!dx && !dy) return;
      const candidate = { ...current.frame, x: emu(current.frame.x + dx), y: emu(current.frame.y + dy) };
      const snapped = applyMoveSnap(candidate, false);
      if (snapped.frame.x === current.frame.x && snapped.frame.y === current.frame.y) return;
      execute({
        type: "move-element",
        slideId: activeSlideId,
        elementId: element.id,
        x: emu(snapped.frame.x),
        y: emu(snapped.frame.y),
      });
      return;
    }
    if (current.kind === "resize") {
      const resized = resizeFrame(current.frame, current.direction!, dx, dy);
      const snapped = applyResizeSnap(resized, current.direction!, false);
      if (
        snapped.frame.width === current.frame.width &&
        snapped.frame.height === current.frame.height &&
        snapped.frame.x === current.frame.x &&
        snapped.frame.y === current.frame.y
      )
        return;
      execute({
        type: "transform-element",
        slideId: activeSlideId,
        elementId: element.id,
        frame: snapped.frame,
        rotationMilliDegree: current.rotation,
      });
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    const nextRotation = rect
      ? normalizeRotation(
          current.rotation +
            (((Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) -
              current.startAngle!) *
              180) /
              Math.PI) *
              1000,
        )
      : current.rotation;
    if (nextRotation === current.rotation) return;
    execute({
      type: "transform-element",
      slideId: activeSlideId,
      elementId: element.id,
      frame: current.frame,
      rotationMilliDegree: nextRotation,
    });
  };

  return (
    <SlideElementFrame
      ref={rootRef}
      element={element}
      scale={scale}
      className={`${selected ? "selected" : ""} ${element.locked ? "locked" : ""}${previewAnimation ? ` animation-preview animation-${previewAnimation.effect}` : ""}`}
      style={style}
      onPointerDown={(event) => begin("move", event)}
      onPointerMove={pointerMove}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
    >
      <SlideElementContent element={element} slide={slide} scale={scale} />
      {selected && !element.locked && (
        <>
          {RESIZE_HANDLES.map(([direction, label]) => (
            <button
              key={direction}
              type="button"
              aria-label={`从${label}缩放`}
              className={`element-handle ${direction}`}
              onPointerDown={(event) => begin("resize", event, direction)}
            />
          ))}
          <button
            type="button"
            aria-label="旋转对象"
            className="element-rotate-handle"
            onPointerDown={(event) => begin("rotate", event)}
          />
        </>
      )}
    </SlideElementFrame>
  );
});
