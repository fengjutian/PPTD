import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus2,
  FilePenLine,
  FolderClock,
  FileUp,
  Grid2x2,
  Grid3x3,
  ImagePlus,
  Info,
  LayoutDashboard,
  Magnet,
  Minus,
  MoveHorizontal,
  MoveVertical,
  MousePointer2,
  Palette,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  SaveAll,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMU_PER_INCH,
  emu,
  inches,
  type ElementId,
  type DocumentId,
  type RectEmu,
  type Slide,
  type SlideAnimation,
  type SlideElement,
  type TextElement,
  type SupportedImageMimeType,
  nextTextSize,
  normalizeTextFormat,
} from "../core/document-model";
import { applyCommand, type AiSlideDesign, type DocumentCommand } from "../core/commands";
import { defaultEditorialConcept, resolveDeckConcept, type DeckConcept } from "../core/design/deck-concept";
import { setTextMeasurer } from "../core/rendering/text-metrics";
import { createCanvasTextMeasurer } from "../services/text-metrics-canvas";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";
import { InspectorPanel } from "../features/editor/InspectorPanel";
import { TextFormatToolbar } from "../features/editor/TextFormatToolbar";
import { FindReplaceBar } from "../features/editor/FindReplaceBar";
import { PageSizeControls } from "../features/editor/PageSizeControls";
import { useFormatPainterStore } from "../store/format-painter";
import { ContentReviewStatus } from "../features/editor/ContentReviewStatus";
import { ContentHistory } from "../features/editor/ContentHistory";
import { LayerList } from "../features/editor/LayerList";
import { SlideElementContent, SlideElementFrame } from "../features/editor/SlideScene";
import { CanvasGridLayer, CanvasGuideLayer } from "../features/editor/CanvasOverlay";
import { useSnapContext, type SnapContext } from "../features/editor/use-snap-context";
import { resizeEdgesOf, snapMovingFrame, snapResizedFrame } from "../core/rendering/snap";
import { useCanvasGuidesStore } from "../store/canvas-guides-store";
import { useGroupDragStore } from "../store/group-drag-store";
import { unionFrame } from "../core/commands/arrange";
import { useMarqueeSelection } from "../features/editor/use-marquee-selection";
import { fitZoom } from "../core/rendering/viewport";
import { sceneScale } from "../features/editor/scene-metrics";
import { useMeasuredWidth } from "../features/editor/use-measured-width";
import { ContentReview } from "../features/ai/ContentReview";
import { ThemePresetPicker } from "../features/ai/ThemePresetPicker";
import {
  countSlidePoints,
  draftMetrics,
  resolveActiveSlideIndex,
  reviewIssues,
  withSlideIds,
  type AiDraftSaveState,
} from "../features/ai/content-review";
import { generateDeckVisualAssets, planVisualAssets, requestVisualAsset } from "../services/ai-visual-asset";
import type { AiVisualAssetRole } from "../core/commands/visual-asset";
import { AiImageDialog } from "../features/editor/AiImageDialog";
import { bodyFromBlocks } from "../services/ai-draft-content";
import { SettingsWorkspace } from "../features/settings/SettingsDialog";
import { loadAiHistory, saveAiHistory, saveAiPresentation, type AiHistoryEntry } from "../services/ai-history";
import { loadRecentProjects, removeRecentProject, type RecentProjectEntry } from "../services/app-database";
import {
  briefsFromDraft,
  cancelAiGeneration,
  compositionFactsFromDraft,
  describeAiError,
  endAiGeneration,
  generateDeckConcepts,
  generatePresentationDesign,
  generatePresentationDraft,
  listenAiGenerationProgress,
  mergeStreamProgress,
  polishPresentationTopic,
  type AiDraft,
  type AiGenerationProgress,
  type AiVisualAssetIntent,
} from "../services/ai-service";
import { applyTheme, applyUiFont, defaultSettings, loadSettings } from "../services/settings";
import { notifySystem, prepareSystemNotifications } from "../services/system-notification";
import {
  analyzePptxTemplate,
  choosePresentationFile,
  convertLegacyPpt,
  choosePptxPath,
  choosePptxTemplate,
  clearRecovery,
  getPptxTemplatePreview,
  importPptxTemplate,
  isDesktopRuntime,
  listPptxTemplates,
  loadRecovery,
  openProjectAtPath,
  projectModifiedAt,
  recoveryProjectPath,
  renderPptxTemplateLayouts,
  saveProject,
  autoSave,
  writePptx,
  type TemplateAnalysis,
  type TemplateRecord,
} from "../services/project-files";
import { useEditorStore } from "../store/editor-store";
import { THEME_PRESETS, defaultThemePreset, findThemePreset, type ThemePreset } from "../core/design/theme-presets";
import { themePresetAiPrompt, themePresetGuidance } from "../core/design/theme-preset-guidance";
import { themePresetMetadata } from "../core/design/theme-preset-metadata";
import type { BuiltinIconName } from "../core/document-model";
import { IconPicker } from "../features/editor/IconPicker";
import { inferThemePresetId } from "../core/design/theme-preset-inference";
import { defaultPresentationVisualGoal, type VisualReview } from "../services/visual-alignment";
import {
  documentContentFingerprint,
  runDesignQualityStage,
  summarizeQualityIssues,
} from "../services/design-quality-stage";
import type { PresentationQualityIssue } from "../services/presentation-quality-gate";
import { DisabledVisionReviewPort, TauriVisionReviewPort } from "../services/vision-review-port";
import { probeTemplateBackground, type TemplateBackgroundProbe } from "../services/template-background";
import type { ExportReport } from "../features/pptx-export/export-pptx";
import { renderRealPptxForReview } from "../features/pptx-export/render-real-pptx";
import { runManualVisualReview } from "../services/manual-visual-review";
import { renderPresentationForVisualReview } from "../services/presentation-renderer";
import {
  initialAgentWorkflow,
  startAgentWorkflow,
  transitionAgentWorkflow,
  canTransitionAgentWorkflow,
} from "../services/agent-workflow";
import {
  resolveDocumentImages,
  setImageProjectPath,
  getImageProjectPath,
  failedImageReferences,
  subscribeImageFailures,
} from "../services/image-url-service";

const CANVAS_WIDTH = 960;
/** 视觉评审的问题类型 → 用户能读懂的中文。 */
const visualIssueLabels: Record<VisualReview["issues"][number]["issue"], string> = {
  "weak-hierarchy": "层级不强",
  "poor-contrast": "对比度不足",
  "visual-imbalance": "构图失衡",
  "background-conflict": "背景干扰",
  misalignment: "元素未对齐",
  "excessive-empty-space": "留白过多",
  "repetitive-layout": "版式重复",
  "theme-mismatch": "主题不匹配",
  "weak-visual-focus": "视觉焦点不清",
};
/** The narrowest and the widest the property panel may be dragged to. */
const INSPECTOR_MIN_WIDTH = 220;
const INSPECTOR_MAX_WIDTH = 520;
const INSPECTOR_WIDTH_KEY = "pptd.inspector-width";

/**
 * The width of the property panel is a display preference. It is kept in the
 * local storage of the application, because it belongs to the window and not
 * to the document.
 */
function readInspectorWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= INSPECTOR_MIN_WIDTH && stored <= INSPECTOR_MAX_WIDTH) return stored;
  } catch {
    // A window without a local storage keeps the default width.
  }
  return 252;
}
type AppView = "editor" | "ai" | "theme" | "settings";
type PageMessage = { id: number; text: string; kind: "info" | "success" | "error" };
type DesignProgress = { percent: number; label: string };
type TemplateLayoutRender = { layoutIndex: number; layoutName: string; dataUrl: string };

function matchTemplateLayoutRender(
  renders: TemplateLayoutRender[],
  layoutIndex: number,
  layoutName: string,
): TemplateLayoutRender | undefined {
  const normalizedName = layoutName.trim().toLocaleLowerCase();
  const nameMatches = renders.filter((render) => render.layoutName.trim().toLocaleLowerCase() === normalizedName);
  if (nameMatches.length > 0)
    return nameMatches.sort(
      (left, right) => Math.abs(left.layoutIndex - layoutIndex) - Math.abs(right.layoutIndex - layoutIndex),
    )[0];
  return renders.find((render) => render.layoutIndex === layoutIndex);
}

function ToolButton({
  label,
  caption,
  onClick,
  disabled,
  children,
}: {
  label: string;
  caption?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button className="tool-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
      <span>{caption ?? label}</span>
    </button>
  );
}

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
async function readImageSize(dataUrl: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return undefined;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return undefined;
  }
}

const ElementView = memo(function ElementView({
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
  const style: React.CSSProperties & { "--pptd-animation-x"?: string; "--pptd-animation-y"?: string } = {
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

  const begin = (kind: "move" | "resize" | "rotate", event: React.PointerEvent, direction?: ResizeDirection) => {
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
  const dragDelta = (current: NonNullable<typeof interaction.current>, event: React.PointerEvent) => {
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    if (!current.groupUnion) return { dx, dy };
    const moved = { ...current.groupUnion, x: emu(current.groupUnion.x + dx), y: emu(current.groupUnion.y + dy) };
    const snapped = applyMoveSnap(moved, true);
    return { dx: snapped.frame.x - current.groupUnion.x, dy: snapped.frame.y - current.groupUnion.y };
  };

  const pointerMove = (event: React.PointerEvent) => {
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

  const finish = (event: React.PointerEvent, cancelled = false) => {
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

const SlideThumbnail = memo(function SlideThumbnail({
  slide,
  pageWidth,
  pageHeight,
}: {
  slide: Slide;
  pageWidth: number;
  pageHeight: number;
}) {
  // The thumbnail is the canvas drawn smaller, so it needs the size of its own
  // box: the text of a page is only the same text when it is drawn with the
  // scale of the box it is drawn in.
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const scale = sceneScale(width, pageWidth);
  return (
    <div className="thumbnail" ref={ref} style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}>
      <div className="thumbnail-scene" style={{ background: slide.background }}>
        {slide.elements.map((element) => (
          <SlideElementFrame key={element.id} element={element} scale={scale}>
            <SlideElementContent element={element} slide={slide} scale={scale} imageAlt="" />
          </SlideElementFrame>
        ))}
        {slide.elements.length === 0 && <div className="thumbnail-fallback-title">{slide.content.title}</div>}
      </div>
    </div>
  );
});

/**
 * The template context of a deck that is not built from a PPTX.
 *
 * A preset owns the palette, the fonts and the type scale, but it is not a
 * layout: the analysis is deliberately empty of slides and layouts so the
 * design stage cannot reference a placeholder that does not exist. Page size
 * matches the default 16:9 document.
 */
function presetTemplateAnalysis(preset: ThemePreset): TemplateAnalysis {
  const color = (slot: string) => preset.theme.colors.find((entry) => entry.name === slot)?.value ?? "#FFFFFF";
  return {
    slideCount: 0,
    slideWidthEmu: 12192000,
    slideHeightEmu: 6858000,
    masterCount: 0,
    layoutCount: 0,
    themeCount: 1,
    themeColors: [
      { name: "accent1", value: color("accent") },
      { name: "accent2", value: color("accent2") },
      { name: "accent3", value: color("accent3") },
      { name: "lt1", value: color("surface") },
      { name: "lt2", value: color("surfaceAlt") },
      { name: "dk1", value: color("primary") },
    ],
    majorFont: preset.theme.majorFont,
    minorFont: preset.theme.minorFont,
    defaultBackgroundColor: color("surface"),
    defaultDecorations: [],
    slides: [],
    layouts: [],
    warnings: [],
  };
}

export function App() {
  const {
    document,
    activeSlideId,
    selectedElementIds,
    undoStack,
    redoStack,
    execute,
    replaceDocument,
    selectSlide,
    selectElement,
    selectElements,
    toggleElement,
    undo,
    redo,
    newDocument,
    loadDocument,
  } = useEditorStore();
  const [projectPath, setProjectPath] = useState<string>();
  const [projectMtime, setProjectMtime] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [recentProjectsOpen, setRecentProjectsOpen] = useState(false);
  const [editorSurface, setEditorSurface] = useState<"projects" | "canvas">("projects");
  const savingRef = useRef(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [inspectorWidth, setInspectorWidth] = useState(readInspectorWidth);
  const [message, setMessage] = useState<PageMessage>();
  const [leftTab, setLeftTab] = useState<"slides" | "layers">("slides");
  const [editorRibbonTab, setEditorRibbonTab] = useState<
    "file" | "home" | "insert" | "design" | "arrange" | "animation" | "view"
  >("home");
  const [animationPreviews, setAnimationPreviews] = useState<SlideAnimation[]>([]);
  const [selectedAnimationId, setSelectedAnimationId] = useState<string>();
  const animationPreviewTimers = useRef<number[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportReport, setExportReport] = useState<ExportReport>();
  const [exportPreflightOpen, setExportPreflightOpen] = useState(false);
  const [contentHistoryOpen, setContentHistoryOpen] = useState(false);
  const exportCancelRef = useRef<(() => void) | undefined>(undefined);
  const setTaskStatus = (text?: string) =>
    setMessage(
      text
        ? {
            id: Date.now(),
            text,
            kind: /失败|错误|无效|必须|不可用/.test(text)
              ? "error"
              : /完成|成功|已保存|已添加|已打开|已新建|已恢复|已确认/.test(text)
                ? "success"
                : "info",
          }
        : undefined,
    );
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [aiTopic, setAiTopic] = useState("");
  const [aiSlideCount, setAiSlideCount] = useState<number | "">(6);
  const [aiDraft, setAiDraft] = useState<AiDraft>();
  const [activeDraftSlideIndex, setActiveDraftSlideIndex] = useState(0);
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string>();
  const [aiSaveState, setAiSaveState] = useState<AiDraftSaveState>("saved");
  type AiContentSnapshot = { draft: AiDraft; activeSlideId?: string; fallbackIndex: number };
  const aiContentUndo = useRef<AiContentSnapshot[]>([]);
  const aiContentRedo = useRef<AiContentSnapshot[]>([]);
  const aiContentCoalesce = useRef<{ key: string; at: number } | undefined>(undefined);
  const [, setAiContentHistoryRevision] = useState(0);
  const aiOriginalDraft = useRef<AiDraft | undefined>(undefined);
  /** 恢复原文前的页面快照，让整页覆盖也能撤回。 */
  const aiRestoreBackups = useRef(new Map<string, AiDraft["slides"][number]>());
  const [aiRestoreUndoSlideIds, setAiRestoreUndoSlideIds] = useState<string[]>([]);
  /** 关闭窗口时把最后一次编辑写盘，避免 500ms 防抖窗口内的内容丢失。 */
  const aiDraftRef = useRef<AiDraft | undefined>(undefined);
  const activeDraftSlideIndexRef = useRef(0);
  const aiTopicRef = useRef("");
  const activeHistoryIdRef = useRef<string | undefined>(undefined);
  const aiUnsavedRef = useRef(false);
  /** 每次保存的序号；只有最新一次保存可以清掉“未保存”标记。 */
  const aiSaveTokenRef = useRef(0);
  const [aiBusy, setAiBusy] = useState(false);
  /** 整份草稿重新生成的状态。它和开始页的生成互斥，因为两者都要占用 AI 任务号。 */
  const [aiRegenerating, setAiRegenerating] = useState(false);
  const [aiPolishing, setAiPolishing] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiGenerationProgress>();
  const [agentWorkflow, setAgentWorkflow] = useState(initialAgentWorkflow);
  /** 流式汇报的实时进度：正文分批并行，这里是各批汇总后的结果。 */
  const [aiStreamProgress, setAiStreamProgress] = useState<{ pages: number; received: number }>();
  const aiRequestId = useRef(0);
  /** 后端取消用的生成任务号；一次生成任务内的所有请求共享它。 */
  const aiTaskId = useRef(0);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRecord>();
  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false);
  const [templateLibrary, setTemplateLibrary] = useState<TemplateRecord[]>([]);
  const [templatePreview, setTemplatePreview] = useState<string | null>();
  const [templateAnalysis, setTemplateAnalysis] = useState<TemplateAnalysis>();
  const [templateLayoutRenders, setTemplateLayoutRenders] = useState<TemplateLayoutRender[]>([]);
  const [templatePreviewBusy, setTemplatePreviewBusy] = useState(false);
  const [templateUploadOpen, setTemplateUploadOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [themePresetId, setThemePresetId] = useState("");
  const [designBusy, setDesignBusy] = useState(false);
  const designBusyRef = useRef(false);
  const [generatingHistoryId, setGeneratingHistoryId] = useState<string>();
  const designCancelRef = useRef(false);
  /** 设计阶段的后端取消任务号。 */
  const designTaskId = useRef(0);
  const [designProgress, setDesignProgress] = useState<DesignProgress>({ percent: 0, label: "等待开始" });
  /** 质量门未过时保留报告，让用户决定进入编辑器调整还是稍后处理。 */
  const [designQualityReport, setDesignQualityReport] = useState<{
    templateName: string;
    concept?: DeckConcept;
    issues: PresentationQualityIssue[];
    notes: string[];
    /** 视觉评审留下的结构化结论，用于在报告里逐条展示模型建议。 */
    visualReview?: VisualReview;
    visualReviewCoverage?: { reviewed: number; total: number };
    contactSheet?: string;
    deckReview?: VisualReview;
    reviewReuse?: { reviewed: number; reused: number };
    slideSignatures: string[];
    reviewedAt: number;
    reviewSource?: "真实 PPTX" | "画布预览";
  }>();
  const [designQualityReportOpen, setDesignQualityReportOpen] = useState(false);
  const [manualReviewBusy, setManualReviewBusy] = useState(false);
  const manualReviewTaskId = useRef(10_000);
  const manualReviewCancelled = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** AI 配图对话框是否打开。 */
  const [aiImageOpen, setAiImageOpen] = useState(false);
  /** AI 配图是否正在生成。 */
  const [aiImageBusy, setAiImageBusy] = useState(false);
  /** AI 配图失败的原因，对话框里如实显示。 */
  const [aiImageError, setAiImageError] = useState<string>();
  /**
   * The in-app clipboard.
   *
   * The objects are kept as the immutable document snapshots they were copied
   * from, so a later edit cannot change the clipboard. `pastes` shifts each
   * paste further from the source instead of stacking every copy on one spot.
   */
  const [clipboard, setClipboard] = useState<{ elements: SlideElement[]; pastes: number }>({
    elements: [],
    pastes: 0,
  });
  // The clipboard belongs to one document: its objects may reference assets of
  // the project they came from. Switching projects clears it instead of letting
  // a paste create a picture whose asset is not in the new project.
  useEffect(() => {
    setClipboard({ elements: [], pastes: 0 });
  }, [document.id]);
  /** The find-and-replace bar is a display mode, so it never enters the document. */
  const [findOpen, setFindOpen] = useState(false);
  const gridEnabled = useCanvasGuidesStore((s) => s.gridEnabled);
  const gridSnapEnabled = useCanvasGuidesStore((s) => s.gridSnapEnabled);
  const snapEnabled = useCanvasGuidesStore((s) => s.snapEnabled);
  const toggleGrid = useCanvasGuidesStore((s) => s.toggleGrid);
  const toggleGridSnap = useCanvasGuidesStore((s) => s.toggleGridSnap);
  const toggleSnap = useCanvasGuidesStore((s) => s.toggleSnap);
  const addGuideToSlide = useCanvasGuidesStore((s) => s.addGuide);
  const clearGuidesOnSlide = useCanvasGuidesStore((s) => s.clearGuides);
  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]!;
  const qualityStaleIndexes = useMemo(
    () =>
      designQualityReport
        ? document.slides.flatMap((slide, index) =>
            JSON.stringify(slide) === designQualityReport.slideSignatures[index] ? [] : [index],
          )
        : [],
    [designQualityReport, document.slides],
  );
  const activeSlideIndex = document.slides.findIndex((slide) => slide.id === activeSlide.id);
  const activeSlideVisualIssues =
    designQualityReport?.visualReview?.issues.filter((issue) => issue.slideIndex === activeSlideIndex) ?? [];
  const activeSlideVisualScore = designQualityReport?.visualReview?.slideScores?.find(
    (score) => score.slideIndex === activeSlideIndex,
  );
  // 多选时"当前对象"是最后被选中的那个：属性面板和快捷键都以它为准。
  const selectedElementId = selectedElementIds.length > 0 ? selectedElementIds[selectedElementIds.length - 1]! : null;
  const selected = activeSlide.elements.find((element) => element.id === selectedElementId);
  // The format controls work on every selected text, but display the last one.
  const selectedTextElements = useMemo(
    () =>
      activeSlide.elements.filter(
        (element): element is TextElement => selectedElementIds.includes(element.id) && element.type === "text",
      ),
    [activeSlide.elements, selectedElementIds],
  );
  const formatPainterStyle = useFormatPainterStore((state) => state.style);

  /**
   * Copies the unlocked selection into the in-app clipboard. Cutting is the same
   * snapshot followed by one delete command, so the whole cut is one undo step.
   *
   * There is no system clipboard integration yet; the status message says so
   * implicitly by anchoring paste to Ctrl+V inside the editor. This is the
   * documented downgrade required by TRS 4.4.4.
   */
  const copySelection = useCallback(
    (cut = false) => {
      const elements = activeSlide.elements.filter(
        (element) => selectedElementIds.includes(element.id) && !element.locked,
      );
      if (elements.length === 0) {
        setTaskStatus("没有可复制的对象");
        return;
      }
      setClipboard({ elements, pastes: 0 });
      if (cut) {
        execute({
          type: "delete-elements",
          slideId: activeSlide.id,
          elementIds: elements.map((element) => element.id),
        });
        setTaskStatus(elements.length > 1 ? `已剪切 ${elements.length} 个对象` : "已剪切对象");
        return;
      }
      setTaskStatus(
        elements.length > 1 ? `已复制 ${elements.length} 个对象，可用 Ctrl+V 粘贴` : "已复制对象，可用 Ctrl+V 粘贴",
      );
    },
    [activeSlide.elements, activeSlide.id, execute, selectedElementIds],
  );

  const pasteSelection = useCallback(() => {
    if (clipboard.elements.length === 0) {
      setTaskStatus("剪贴板里还没有对象，先复制或剪切");
      return;
    }
    // Repeated pastes step away from the source instead of covering each other.
    const offset = emu(inches(0.2) * (clipboard.pastes + 1));
    try {
      execute({
        type: "paste-elements",
        slideId: activeSlide.id,
        elements: clipboard.elements,
        offsetEmu: offset,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setTaskStatus(
        code === "PASTE_REQUIRES_CONTENT_BLOCK" ? "表格或图表只能在包含其内容块的页面粘贴" : `粘贴失败：${code}`,
      );
      return;
    }
    setClipboard((current) => ({ ...current, pastes: current.pastes + 1 }));
    setTaskStatus(clipboard.elements.length > 1 ? `已粘贴 ${clipboard.elements.length} 个对象` : "已粘贴对象");
  }, [activeSlide.id, clipboard.elements, clipboard.pastes, execute]);

  const activeGuides = useCanvasGuidesStore((s) => s.guidesBySlide[activeSlideId]) ?? [];
  const addGuide = (axis: "x" | "y", position: number) => addGuideToSlide(activeSlide.id, axis, emu(position));
  const scale = (CANVAS_WIDTH / document.pageSize.width) * zoom;
  const canvasHeight = document.pageSize.height * scale;
  // 吸附目标一页只算一次，画布上的所有对象共用同一份。
  const snapContext = useSnapContext(activeSlide.id, document.pageSize.width, document.pageSize.height, scale);
  // 多选时属性面板显示这一组的公共信息，而不是某一个对象。
  const marquee = useMarqueeSelection({
    scale,
    elements: activeSlide.elements,
    onSelect: (ids) => selectElements(ids),
    onClear: () => selectElement(null),
  });
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => `${activeSlide.elements.length} 个对象`, [activeSlide.elements.length]);
  const dirty = document.revisions.document !== savedRevision;
  // The close handler is registered once (it must outlive re-renders), so it
  // reads the latest document/path through refs instead of a stale closure.
  const documentRef = useRef(document);
  const dirtyRef = useRef(dirty);
  const projectPathRef = useRef(projectPath);
  // The first close request is paused while pending snapshots are flushed.
  // Calling `close()` afterwards emits a second request; this flag lets that
  // request pass through instead of trapping the window in a close loop.
  const closeAfterFlushRef = useRef(false);
  documentRef.current = document;
  dirtyRef.current = dirty;
  projectPathRef.current = projectPath;

  // "适应窗口"要按容器实际大小算，不能写死 100%。
  const workspaceRef = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const measure = () => {
      // clientWidth 已经扣掉了滚动条，但 padding 还在里面，要再减一次。
      const style = window.getComputedStyle(node);
      const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const width = Math.max(node.clientWidth - paddingX, 0);
      const height = Math.max(node.clientHeight - paddingY, 0);
      setViewport((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const refreshRecentProjects = useCallback(() => {
    if (!isDesktopRuntime()) return Promise.resolve([] as RecentProjectEntry[]);
    return loadRecentProjects().then((entries) => {
      setRecentProjects(entries);
      return entries;
    });
  }, []);
  useEffect(() => {
    void refreshRecentProjects().catch(() => setTaskStatus("最近项目读取失败"));
  }, [refreshRecentProjects]);
  useEffect(() => {
    const windowTitle = `${document.title}${dirty ? " *" : ""} — PPTD`;
    if (isDesktopRuntime()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(windowTitle))
        .catch(() => undefined);
      return;
    }
    globalThis.document.title = windowTitle;
  }, [document.title, dirty]);
  const fitToWindow = useCallback(() => {
    const node = workspaceRef.current;
    const style = node ? window.getComputedStyle(node) : null;
    const paddingX = style ? Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight) : 0;
    const paddingY = style ? Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) : 0;
    const width = node ? Math.max(node.clientWidth - paddingX, 0) : viewport.width;
    const height = node ? Math.max(node.clientHeight - paddingY, 0) : viewport.height;
    setZoom(
      fitZoom({
        availableWidth: width,
        availableHeight: height,
        pageWidth: document.pageSize.width,
        pageHeight: document.pageSize.height,
        baseWidth: CANVAS_WIDTH,
      }),
    );
  }, [document.pageSize.width, document.pageSize.height, viewport.width, viewport.height]);
  useEffect(() => {
    void loadSettings()
      .then((settings) => {
        applyTheme(settings.theme);
        applyUiFont(settings.uiFont);
      })
      .catch((error: unknown) => {
        const fallback = defaultSettings();
        applyTheme(fallback.theme);
        applyUiFont(fallback.uiFont);
        setTaskStatus(`设置读取失败：${error instanceof Error ? error.message : String(error)}`);
      });
  }, []);
  useEffect(() => {
    let active = true;
    void loadAiHistory()
      .then((history) => {
        if (active) setAiHistory(history);
      })
      .catch((error: unknown) => {
        if (active) setTaskStatus(`制作历史读取失败：${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(undefined), 4200);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (isDesktopRuntime())
      void listPptxTemplates()
        .then(setTemplateLibrary)
        .catch(() => setTaskStatus("模板库读取失败"));
  }, []);
  // The document core measures text with the real font once the application
  // tells it how wide a piece of text is. Without it the core falls back to a
  // rough estimate, which is why the measurer is registered here.
  useEffect(() => {
    const measurer = createCanvasTextMeasurer();
    setTextMeasurer(measurer);
    return () => setTextMeasurer(undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void loadRecovery()
      .then((recovery) => {
        if (!active || !recovery) return;
        if (!window.confirm("检测到未完成的恢复快照，是否恢复？")) {
          void clearRecovery();
          return;
        }
        // The pictures of a snapshot live next to the recovery file, so the
        // document is read against that path until the user saves it as a
        // project of its own.
        void recoveryProjectPath().then((path) => {
          if (!active) return;
          setImageProjectPath(path ?? undefined);
        });
        loadDocument(recovery.document);
        setProjectPath(undefined);
        setSavedRevision(-1);
        setTaskStatus(
          recovery.removedLayoutReferences > 0
            ? `已恢复自动保存快照，但 ${recovery.removedLayoutReferences} 个页面的模板引用缺失，请另存项目`
            : "已恢复自动保存快照，请另存项目",
        );
      })
      .catch((error: unknown) => {
        // A snapshot that cannot be read is still the user's work. The file is
        // kept and its path is reported, so nothing is lost silently.
        void recoveryProjectPath().then((path) => {
          setTaskStatus(
            `恢复检查失败：${error instanceof Error ? error.message : String(error)}${path ? `。快照保留在 ${path}` : ""}`,
          );
        });
      });
    return () => {
      active = false;
    };
  }, [loadDocument]);

  // 读不到的图片要在状态栏里数出来。画布上的缺图块会随缩放、随滚动被忽略，
  // 状态栏这一处是整个会话都在的地方。
  const [missingImageCount, setMissingImageCount] = useState(0);
  useEffect(() => {
    const read = () => setMissingImageCount(failedImageReferences().length);
    read();
    return subscribeImageFailures(read);
  }, []);

  useEffect(() => {
    if (!dirty || !isDesktopRuntime()) return;
    const timer = window.setTimeout(() => {
      // 项目已经有路径时直接写项目本体，否则只写恢复副本。
      // 两者的图片都住在项目自己的资源目录里，所以后端要知道源路径。
      const revisionAtStart = document.revisions.document;
      void autoSave(document, projectPath, getImageProjectPath()).then(
        (result) => {
          // 自动保存失败要让用户看见，而不是继续显示"已保存"。
          if (result.report && result.report.missingAssets.length > 0) {
            setTaskStatus(`自动保存完成，但 ${result.report.missingAssets.length} 张图片资源缺失，请检查模板`);
          }
          // 落盘成功才把"已保存"标记推进到这一版。写失败时状态仍是未保存，
          // 用户才不会以为改动已经安全了。
          if (result.saved) {
            setSavedRevision((current) => (current >= revisionAtStart ? current : revisionAtStart));
            setProjectMtime(Date.now());
          }
        },
        (error: unknown) => setTaskStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`),
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, document, projectPath]);

  const handleNew = async () => {
    if (dirty && !window.confirm("当前项目还有未保存的修改，确定新建吗？")) return;
    await clearRecovery().catch(() => undefined);
    newDocument();
    setImageProjectPath(undefined);
    setProjectPath(undefined);
    setProjectMtime(undefined);
    setSavedRevision(0);
    setEditorSurface("canvas");
    setTaskStatus("已新建项目");
  };

  const handleOpenOrImport = async () => {
    try {
      if (dirty && !window.confirm("当前项目还有未保存的修改，确定打开或导入其他演示文稿吗？")) return;
      const selection = await choosePresentationFile();
      if (!selection) return;
      if (selection.format === "pptd") {
        const result = await openProjectAtPath(selection.path);
        setImageProjectPath(result.path);
        loadDocument(result.document);
        await clearRecovery();
        setProjectPath(result.path);
        setProjectMtime(result.modifiedAt);
        setSavedRevision(result.document.revisions.document);
        setEditorSurface("canvas");
        setTaskStatus("PPTD 项目已打开");
        void refreshRecentProjects();
        return;
      }
      setTaskStatus(selection.format === "ppt" ? "正在安全转换旧版 PPT…" : "正在分析 PPTX…");
      const pptxPath = selection.format === "ppt" ? await convertLegacyPpt(selection.path) : selection.path;
      const imported = await importPptxTemplate(pptxPath);
      setSelectedTemplate(imported);
      setTemplateLibrary(await listPptxTemplates());
      await handleSelectTemplate(imported, false);
      setTemplatePickerOpen(true);
      setTaskStatus(`${selection.format.toUpperCase()} 已安全导入并完成结构分析：${selection.name}`);
    } catch (error) {
      setTaskStatus(`打开或导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenRecent = async (entry: RecentProjectEntry) => {
    try {
      if (entry.missing) {
        setTaskStatus("项目文件已移动或删除，请使用“打开项目”重新选择");
        return;
      }
      if (dirty && !window.confirm("当前项目还有未保存的修改，确定打开其他项目吗？")) return;
      const result = await openProjectAtPath(entry.path);
      setImageProjectPath(result.path);
      loadDocument(result.document);
      await clearRecovery();
      setProjectPath(result.path);
      setProjectMtime(result.modifiedAt);
      setSavedRevision(result.document.revisions.document);
      setRecentProjectsOpen(false);
      setEditorSurface("canvas");
      await refreshRecentProjects();
      setTaskStatus("项目已打开");
    } catch (error) {
      setTaskStatus(`打开失败：${error instanceof Error ? error.message : String(error)}`);
      void refreshRecentProjects();
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!isDesktopRuntime()) {
      setTaskStatus("浏览器预览模式不支持保存项目，请使用桌面端");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setTaskStatus("正在保存…");
    try {
      if (projectPath && isDesktopRuntime() && projectMtime !== undefined) {
        let currentMtime: number | null = null;
        try {
          currentMtime = await projectModifiedAt(projectPath);
        } catch {
          currentMtime = null;
        }
        if (
          currentMtime !== null &&
          currentMtime !== projectMtime &&
          !window.confirm("项目文件已被其他程序修改。继续保存会覆盖外部修改，是否继续？")
        ) {
          setTaskStatus("保存已取消");
          return;
        }
      }
      const result = await saveProject(document, projectPath);
      if (!result) {
        setTaskStatus(undefined);
        return;
      }
      if (isDesktopRuntime()) {
        setProjectPath(result.path);
        setImageProjectPath(result.path);
      }
      setProjectMtime(result.modifiedAt ?? undefined);
      setSavedRevision(document.revisions.document);
      await clearRecovery();
      // 文稿存下来了，但有图片没存进去。悄悄说"已保存"等于把缺口藏起来。
      setTaskStatus(
        result.report.missingAssets.length > 0
          ? `项目已保存，但 ${result.report.missingAssets.length} 张图片资源缺失，请检查模板`
          : isDesktopRuntime()
            ? "项目已保存"
            : "浏览器草稿已保存",
      );
      void refreshRecentProjects();
    } catch (error) {
      setTaskStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveAs = async () => {
    if (savingRef.current || !isDesktopRuntime()) return;
    savingRef.current = true;
    setSaving(true);
    setTaskStatus("正在另存项目…");
    try {
      const result = await saveProject(document);
      if (!result) {
        setTaskStatus("另存为已取消");
        return;
      }
      setProjectPath(result.path);
      setImageProjectPath(result.path);
      setProjectMtime(result.modifiedAt ?? undefined);
      setSavedRevision(document.revisions.document);
      await clearRecovery();
      await refreshRecentProjects();
      setTaskStatus(
        result.report.missingAssets.length > 0
          ? `项目已另存，但 ${result.report.missingAssets.length} 张图片资源缺失，请检查模板`
          : "项目已另存",
      );
    } catch (error) {
      setTaskStatus(`另存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleRenameProject = () => {
    const title = window.prompt("输入新的项目标题", document.title)?.trim();
    if (!title || title === document.title) return;
    execute({ type: "rename-document", title });
    setTaskStatus("项目标题已修改，保存后写入项目文件");
  };

  const handleDuplicateProject = async () => {
    if (savingRef.current || !isDesktopRuntime()) return;
    const copy = structuredClone(document);
    copy.id = crypto.randomUUID() as DocumentId;
    copy.title = `${document.title} 副本`;
    savingRef.current = true;
    setSaving(true);
    setTaskStatus("正在复制项目…");
    try {
      const result = await saveProject(copy);
      if (!result) {
        setTaskStatus("复制已取消");
        return;
      }
      await refreshRecentProjects();
      setTaskStatus(
        result.report.missingAssets.length > 0
          ? `项目副本已创建，但 ${result.report.missingAssets.length} 张图片资源缺失`
          : "项目副本已创建，当前仍编辑原项目",
      );
    } catch (error) {
      setTaskStatus(`复制失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (exportBusy) {
      exportCancelRef.current?.();
      return;
    }
    setAgentWorkflow((state) => {
      const ready =
        state.stage === "ready-to-export"
          ? state
          : transitionAgentWorkflow(startAgentWorkflow(state), "ready-to-export", { label: "正在执行导出预检" });
      return transitionAgentWorkflow(ready, "exporting");
    });
    setExportBusy(true);
    setExportReport(undefined);
    setTaskStatus("正在生成 PPTX…");
    try {
      // asset 引用在 Worker 里没有 IPC 可读，先在主线程解析成内嵌数据。
      // 预检必须看解析后的文档：把 `asset://` 当成“不是内嵌 data URL”会
      // 拒绝掉每一个重新打开过的项目，而这只是存储形式，不是缺失。
      const exportDocument = await resolveDocumentImages(document);
      // 预检在主线程完成（含字体探测），重活交给 Worker，导出期间画布不冻结。
      const { validatePresentationForExport, isFontAvailable } = await import("../core/validation/export-validation");
      const issues = await validatePresentationForExport(exportDocument, { fontAvailable: isFontAvailable });
      const blocking = issues.filter((issue) => issue.severity === "error");
      if (blocking.length > 0) {
        throw new Error(`EXPORT_VALIDATION_FAILED: ${blocking.map((issue) => issue.message).join("；")}`);
      }
      const { buildPptxInWorker } = await import("../features/pptx-export/export-worker-client");
      const task = buildPptxInWorker(exportDocument, issues);
      exportCancelRef.current = task.cancel;
      const { bytes, report } = await task.promise;
      const path = await choosePptxPath(document.title);
      if (path) await writePptx(path, bytes);
      else if (!isDesktopRuntime()) {
        const blob = new Blob([bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
        const url = URL.createObjectURL(blob);
        const anchor = Object.assign(globalThis.document.createElement("a"), {
          href: url,
          download: `${document.title}.pptx`,
        });
        globalThis.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        // 同步 revoke 会在部分 WebView 里取消尚未开始的下载。
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } else {
        setAgentWorkflow((state) => transitionAgentWorkflow(state, "cancelled", { label: "已取消选择导出位置" }));
        setTaskStatus(undefined);
        return;
      }
      setExportReport(report);
      setAgentWorkflow((state) => transitionAgentWorkflow(state, "complete"));
      setTaskStatus(
        `导出完成：${report.slideCount} 页，${report.nativeObjectCount} 个原生对象${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "EXPORT_CANCELLED") {
        setAgentWorkflow((state) => transitionAgentWorkflow(state, "cancelled"));
        setTaskStatus("导出已取消");
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        setAgentWorkflow((state) => transitionAgentWorkflow(state, "failed", { error: detail }));
        setTaskStatus(`导出失败：${detail}`);
      }
    } finally {
      setExportBusy(false);
      exportCancelRef.current = undefined;
    }
  };

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 256 * 1024 * 1024) {
      setTaskStatus("图片必须是 PNG、JPEG 或 WebP，且单个文件不超过 256 MB");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setTaskStatus("图片读取失败");
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      void readImageSize(reader.result).then((size) => {
        execute({
          type: "add-image",
          slideId: activeSlide.id,
          dataUrl: reader.result as string,
          mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
          altText: file.name,
          ...(size ? { naturalWidth: size.width, naturalHeight: size.height } : {}),
        });
        setTaskStatus(`已添加图片：${file.name}`);
      });
    };
    reader.readAsDataURL(file);
  };

  /**
   * 生成一张配图并插到当前页。
   *
   * 图落在哪、多大不由这里决定：命令层按角色算出图位，正文给它让出位置。
   * 这里只负责把用户的画面描述变成一张图，以及失败时说实话。
   */
  const handleAiImageGenerate = async (prompt: string, role: AiVisualAssetRole) => {
    setAiImageBusy(true);
    setAiImageError(undefined);
    const result = await requestVisualAsset({ prompt, role });
    setAiImageBusy(false);
    if (!result.ok) {
      setAiImageError(result.error);
      return;
    }
    const mimeType: SupportedImageMimeType =
      result.asset.mimeType === "image/jpeg" || result.asset.mimeType === "image/webp"
        ? result.asset.mimeType
        : "image/png";
    execute({
      type: "add-image",
      slideId: activeSlide.id,
      dataUrl: result.asset.dataUrl,
      mimeType,
      altText: result.asset.altText,
      naturalWidth: result.asset.naturalWidth,
      naturalHeight: result.asset.naturalHeight,
      role,
    });
    setAiImageOpen(false);
    setTaskStatus("已生成配图并插入当前页");
  };

  const handleAiGenerate = async () => {
    if (aiBusy) {
      aiRequestId.current += 1;
      setAiBusy(false);
      setAiProgress(undefined);
      // 真正中断后端在途请求，否则模型会继续生成一份没人要的草稿。
      void cancelAiGeneration(aiTaskId.current).catch(() => undefined);
      setTaskStatus("已取消 AI 内容生成");
      setAgentWorkflow((state) => transitionAgentWorkflow(state, "cancelled"));
      return;
    }
    if (aiSlideCount === "" || aiSlideCount < 1) {
      setTaskStatus("页数必须是大于 0 的整数");
      return;
    }
    const requestedSlideCount = aiSlideCount;
    const requestId = aiRequestId.current + 1;
    aiRequestId.current = requestId;
    aiTaskId.current += 1;
    const taskId = aiTaskId.current;
    setAiBusy(true);
    setAgentWorkflow((state) => transitionAgentWorkflow(startAgentWorkflow(state), "planning"));
    setAiDraft(undefined);
    aiContentUndo.current = [];
    aiContentRedo.current = [];
    aiContentCoalesce.current = undefined;
    setAiContentHistoryRevision((value) => value + 1);
    setAiProgress({ stage: "outline", completed: 0, total: 1, label: "正在准备生成…" });
    setAiStreamProgress(undefined);
    void prepareSystemNotifications();
    let unlisten: (() => void) | undefined;
    try {
      // 正文分批并行，各批的进度要按请求标识汇总，不能直接相加。
      const totals = new Map<string, { received: number; pages: number }>();
      unlisten = await listenAiGenerationProgress((progress) => {
        if (requestId !== aiRequestId.current || progress.taskId !== taskId) return;
        setAiStreamProgress(mergeStreamProgress(totals, progress));
      }).catch(() => undefined);
      setAgentWorkflow((state) => transitionAgentWorkflow(state, "generating-content"));
      const draft = withSlideIds(
        await generatePresentationDraft(aiTopic, requestedSlideCount, {
          onProgress: (progress) => {
            if (requestId === aiRequestId.current) setAiProgress(progress);
          },
          isCancelled: () => requestId !== aiRequestId.current,
          taskId,
        }),
      );
      if (requestId !== aiRequestId.current) return;
      const id = crypto.randomUUID();
      aiOriginalDraft.current = structuredClone(draft);
      aiContentUndo.current = [];
      aiContentRedo.current = [];
      aiContentCoalesce.current = undefined;
      setAiContentHistoryRevision((value) => value + 1);
      setAiDraft(draft);
      setAgentWorkflow((state) => transitionAgentWorkflow(state, "reviewing-content"));
      setActiveHistoryId(id);
      selectAiDraftSlide(0);
      setAiSaveState("saved");
      try {
        setAiHistory(await saveAiHistory({ id, topic: aiTopic, slideCount: requestedSlideCount, draft }));
        setTaskStatus("AI 已完成 PPT 草稿生成");
      } catch (error) {
        setTaskStatus(`AI 草稿已生成，但历史保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
      void notifySystem({ title: "PPTD · AI 生成完成", body: `${draft.title}（${draft.slides.length} 页）` });
    } catch (error) {
      if (requestId !== aiRequestId.current) return;
      const detail = describeAiError(error);
      setAgentWorkflow((state) => transitionAgentWorkflow(state, "failed", { error: detail }));
      setTaskStatus(`AI 内容生成失败：${detail}`);
      void notifySystem({ title: "PPTD · AI 生成失败", body: detail });
    } finally {
      unlisten?.();
      void endAiGeneration(taskId).catch(() => undefined);
      if (requestId === aiRequestId.current) {
        setAiBusy(false);
        setAiProgress(undefined);
        setAiStreamProgress(undefined);
      }
    }
  };

  /**
   * 用同一个主题重新生成整份草稿。
   *
   * 审核页经常走到"这几页还行，但整册的写法不对"这一步：以前只能返回开始页
   * 重新生成，等于把已经改好、审核过的页面全部丢掉。重新生成因此按"再要一版"
   * 处理：生成期间旧草稿留在屏幕上，成功后整体替换，并把旧版本压进撤销栈，
   * 一次撤销就能回到上一版。
   */
  const handleRegenerateDraft = async () => {
    if (aiRegenerating) {
      // 取消和开始页一致：推进请求号让在途回调失效，再真正中断后端。
      aiRequestId.current += 1;
      setAiRegenerating(false);
      setAiProgress(undefined);
      setAiStreamProgress(undefined);
      void cancelAiGeneration(aiTaskId.current).catch(() => undefined);
      setTaskStatus("已取消重新生成");
      return;
    }
    const current = aiDraftRef.current;
    if (!current) return;
    // 主题就是这一册的生成依据；标题只在老数据没有主题时兜底。
    const topic = aiTopic.trim() || current.title.trim();
    if (!topic) {
      setTaskStatus("缺少生成主题：请返回初始页面填写主题后再重新生成");
      return;
    }
    // 页数以当前草稿为准：用户加过的页在重新生成时不应该被悄悄减回去。
    const slideCount = current.slides.length;
    const requestId = aiRequestId.current + 1;
    aiRequestId.current = requestId;
    aiTaskId.current += 1;
    const taskId = aiTaskId.current;
    setAiRegenerating(true);
    setAiProgress({ stage: "outline", completed: 0, total: 1, label: "正在准备重新生成…" });
    setAiStreamProgress(undefined);
    setTaskStatus("AI 正在重新生成整份草稿");
    let unlisten: (() => void) | undefined;
    try {
      const totals = new Map<string, { received: number; pages: number }>();
      unlisten = await listenAiGenerationProgress((progress) => {
        if (requestId !== aiRequestId.current || progress.taskId !== taskId) return;
        setAiStreamProgress(mergeStreamProgress(totals, progress));
      }).catch(() => undefined);
      const regenerated = withSlideIds(
        await generatePresentationDraft(topic, slideCount, {
          onProgress: (progress) => {
            if (requestId === aiRequestId.current) setAiProgress(progress);
          },
          isCancelled: () => requestId !== aiRequestId.current,
          taskId,
        }),
      );
      if (requestId !== aiRequestId.current) return;
      const previous = aiDraftRef.current;
      // 生成期间用户可能已经离开审核页；此时旧草稿仍在，但不再替换。
      if (!previous) return;
      aiContentUndo.current.push(snapshotAiContent(previous));
      if (aiContentUndo.current.length > 100) aiContentUndo.current.shift();
      aiContentRedo.current = [];
      aiContentCoalesce.current = undefined;
      // 新的生成结果成为这一版的 AI 原稿，单页"恢复 AI 原稿"也跟着更新。
      aiOriginalDraft.current = structuredClone(regenerated);
      aiRestoreBackups.current.clear();
      setAiRestoreUndoSlideIds([]);
      aiDraftRef.current = regenerated;
      setAiDraft(regenerated);
      selectAiDraftSlide(0);
      setAiContentHistoryRevision((value) => value + 1);
      setTaskStatus("已重新生成整份草稿，可用撤销回到上一版");
    } catch (error) {
      if (requestId !== aiRequestId.current) return;
      setTaskStatus(`重新生成失败：${describeAiError(error)}`);
    } finally {
      unlisten?.();
      void endAiGeneration(taskId).catch(() => undefined);
      if (requestId === aiRequestId.current) {
        setAiRegenerating(false);
        setAiProgress(undefined);
        setAiStreamProgress(undefined);
      }
    }
  };

  const handlePolishAiTopic = async () => {
    if (!aiTopic.trim() || aiPolishing || aiBusy) return;
    setAiPolishing(true);
    setTaskStatus("AI 正在润色主题与要求…");
    try {
      const polished = await polishPresentationTopic(aiTopic);
      setAiTopic(polished);
      setTaskStatus("主题与要求已润色");
    } catch (error) {
      setTaskStatus(`AI 润色失败：${describeAiError(error)}`);
    } finally {
      setAiPolishing(false);
    }
  };

  // Refs mirror the latest draft so the exit path can save without waiting for
  // another render, and so a close inside the debounce window is not lost.
  useEffect(() => {
    aiDraftRef.current = aiDraft;
  }, [aiDraft]);
  useEffect(() => {
    aiTopicRef.current = aiTopic;
  }, [aiTopic]);
  useEffect(() => {
    activeHistoryIdRef.current = activeHistoryId;
  }, [activeHistoryId]);

  useEffect(() => {
    if (!aiDraft || !activeHistoryId) return;
    setAiSaveState("saving");
    aiUnsavedRef.current = true;
    const token = (aiSaveTokenRef.current += 1);
    const timer = window.setTimeout(() => {
      void saveAiHistory({ id: activeHistoryId, topic: aiTopic, slideCount: aiDraft.slides.length, draft: aiDraft })
        .then((history) => {
          // 这次保存开始后用户又改了草稿：新的保存已经排队，旧的返回不能
          // 把“未保存”标记清掉，否则关闭窗口会跳过 flush。
          if (token !== aiSaveTokenRef.current) return;
          setAiHistory(history);
          setAiSaveState("saved");
          aiUnsavedRef.current = false;
        })
        .catch((error: unknown) => {
          if (token !== aiSaveTokenRef.current) return;
          setAiSaveState("saved");
          setTaskStatus(`草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeHistoryId, aiDraft, aiTopic]);

  const persistAiDraft = () => {
    if (!aiDraft || !activeHistoryId) return;
    const draft = aiDraft;
    const id = activeHistoryId;
    const token = (aiSaveTokenRef.current += 1);
    setAiSaveState("saved");
    void saveAiHistory({ id, topic: aiTopic, slideCount: draft.slides.length, draft })
      .then((history) => {
        if (token !== aiSaveTokenRef.current) return;
        setAiHistory(history);
        aiUnsavedRef.current = false;
      })
      .catch((error: unknown) =>
        setTaskStatus(`草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`),
      );
  };

  const changeActiveView = (view: AppView) => {
    if (activeView === "ai" && view !== "ai" && aiUnsavedRef.current) persistAiDraft();
    if (view === "editor") setEditorSurface("projects");
    setActiveView(view);
  };

  // Closing the window can land inside the 500ms debounce window. Flush the
  // pending snapshot first, then let the window close.
  useEffect(() => {
    const flush = async () => {
      const draft = aiDraftRef.current;
      const id = activeHistoryIdRef.current;
      if (!draft || !id) return;
      try {
        const history = await saveAiHistory({ id, topic: aiTopicRef.current, slideCount: draft.slides.length, draft });
        setAiHistory(history);
        setAiSaveState("saved");
        aiUnsavedRef.current = false;
      } catch (error) {
        setMessage({
          id: Date.now(),
          text: `草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`,
          kind: "error",
        });
      }
    };
    const onExit = () => {
      void flush();
    };
    const onVisibilityChange = () => {
      if (window.document.visibilityState === "hidden") onExit();
    };
    window.addEventListener("pagehide", onExit);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isDesktopRuntime()) {
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const stop = await getCurrentWindow().onCloseRequested(async (event) => {
            if (closeAfterFlushRef.current) return;
            if (!aiUnsavedRef.current && !dirtyRef.current) return;
            event.preventDefault();
            if (aiUnsavedRef.current) await flush();
            if (dirtyRef.current) {
              // The 1.5s autosave debounce may not have fired yet. Flush the
              // project/recovery snapshot before destroying the window.
              try {
                await autoSave(documentRef.current, projectPathRef.current, getImageProjectPath());
              } catch {
                // Closing must still complete; the failure is already reported
                // by the autosave status when the app is still open.
              }
            }
            try {
              closeAfterFlushRef.current = true;
              // The native close request was prevented while pending edits were
              // flushed. Destroy the window directly now; calling `close()` here
              // would emit a second close event and race React teardown/HMR.
              await getCurrentWindow().destroy();
            } catch (error) {
              closeAfterFlushRef.current = false;
              setMessage({
                id: Date.now(),
                text: `关闭窗口失败：${error instanceof Error ? error.message : String(error)}`,
                kind: "error",
              });
            }
          });
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onExit);
      window.document.removeEventListener("visibilitychange", onVisibilityChange);
      unlisten?.();
    };
  }, []);

  const openAiHistory = (entry: AiHistoryEntry) => {
    persistAiDraft();
    const draft = withSlideIds(entry.draft);
    aiOriginalDraft.current = structuredClone(draft);
    aiRestoreBackups.current.clear();
    setAiRestoreUndoSlideIds([]);
    aiContentUndo.current = [];
    aiContentRedo.current = [];
    aiContentCoalesce.current = undefined;
    setAiContentHistoryRevision((value) => value + 1);
    setActiveHistoryId(entry.id);
    setAiTopic(entry.topic);
    setAiSlideCount(entry.slideCount);
    setAiDraft(draft);
    selectAiDraftSlide(0);
    setAiSaveState("saved");
  };

  const openAiPresentation = async (entry: AiHistoryEntry) => {
    if (dirty && !window.confirm("当前项目还有未保存的修改，确定打开这份 AI 文稿吗？")) return;
    if (!entry.presentation) {
      if (designBusyRef.current) {
        setTaskStatus("已有 PPT 正在生成，请等待当前任务完成");
        return;
      }
      openAiHistory(entry);
      setTaskStatus("这份文稿还没有生成 PPT，正在开始生成…");
      await generateFromDraft("preset", entry.draft, entry.id);
      return;
    }

    const generatedDocument = structuredClone(entry.presentation);
    loadDocument(generatedDocument);
    setProjectPath(undefined);
    setProjectMtime(undefined);
    setSavedRevision(generatedDocument.revisions.document);
    setActiveView("editor");
    setEditorSurface("canvas");
    setTaskStatus("AI 生成的 PPT 已打开，可继续编辑");
  };

  const selectAiDraftSlide = (index: number) => {
    activeDraftSlideIndexRef.current = index;
    setActiveDraftSlideIndex(index);
  };

  const snapshotAiContent = (draft: AiDraft): AiContentSnapshot => {
    const fallbackIndex = activeDraftSlideIndexRef.current;
    return { draft: structuredClone(draft), activeSlideId: draft.slides[fallbackIndex]?.id, fallbackIndex };
  };

  const restoreAiContentSnapshot = (snapshot: AiContentSnapshot) => {
    aiDraftRef.current = snapshot.draft;
    setAiDraft(snapshot.draft);
    selectAiDraftSlide(resolveActiveSlideIndex(snapshot.draft, snapshot.activeSlideId, snapshot.fallbackIndex));
  };

  const updateAiDraftWithHistory = (key: string, update: (draft: AiDraft) => AiDraft, coalesce = true) => {
    // 不能在 setState 的 updater 里 push 撤销栈：React 会重复调用 updater
    // （StrictMode 下必现），一次编辑于是留下两条相同快照，按一次 Ctrl+Z
    // 看起来没有反应。用 ref 取当前值，在 updater 外完成副作用。
    const current = aiDraftRef.current;
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    const now = Date.now();
    const previous = aiContentCoalesce.current;
    if (!coalesce || !previous || previous.key !== key || now - previous.at > 750) {
      aiContentUndo.current.push(snapshotAiContent(current));
      if (aiContentUndo.current.length > 100) aiContentUndo.current.shift();
    }
    aiContentCoalesce.current = coalesce ? { key, at: now } : undefined;
    aiContentRedo.current = [];
    aiDraftRef.current = next;
    setAiDraft(next);
    setAiContentHistoryRevision((value) => value + 1);
  };

  const undoAiContent = () => {
    const previous = aiContentUndo.current.pop();
    const current = aiDraftRef.current;
    if (!previous || !current) return;
    aiContentRedo.current.push(snapshotAiContent(current));
    aiRestoreBackups.current.clear();
    setAiRestoreUndoSlideIds([]);
    aiContentCoalesce.current = undefined;
    restoreAiContentSnapshot(previous);
    setAiContentHistoryRevision((value) => value + 1);
  };

  const redoAiContent = () => {
    const next = aiContentRedo.current.pop();
    const current = aiDraftRef.current;
    if (!next || !current) return;
    aiContentUndo.current.push(snapshotAiContent(current));
    aiRestoreBackups.current.clear();
    setAiRestoreUndoSlideIds([]);
    aiContentCoalesce.current = undefined;
    restoreAiContentSnapshot(next);
    setAiContentHistoryRevision((value) => value + 1);
  };

  /**
   * Once a page is edited again, "undo restore" no longer describes what the
   * writer sees, so the pre-restore snapshot is dropped instead of silently
   * reverting the newer edits later.
   */
  const forgetRestoreBackup = (index: number) => {
    const slideId = aiDraftRef.current?.slides[index]?.id;
    if (!slideId || !aiRestoreBackups.current.delete(slideId)) return;
    setAiRestoreUndoSlideIds([...aiRestoreBackups.current.keys()]);
  };

  const updateAiSlide = (index: number, field: "title" | "body" | "speakerNotes", value: string) => {
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(`slide:${index}:${field}`, (draft) => ({
      ...draft,
      slides: draft.slides.map((slide, slideIndex) => {
        if (slideIndex !== index) return slide;
        if (field !== "body") return { ...slide, [field]: value, reviewed: false };
        // Body copy is only editable on legacy drafts that carry no structured
        // blocks. Deriving blocks here used to swap the textarea for the block
        // editor on the first keystroke, which dropped focus mid-sentence.
        return { ...slide, body: value, reviewed: false };
      }),
    }));
  };

  /**
   * 这一页的配图意图变了。
   *
   * 审核阶段是唯一还没花钱生成图片的时机：这里改一句画面描述，后面少生成一张
   * 不想要的图。改完这一页就不再是"已审核"状态，因为它变了。
   */
  const updateAiVisualAsset = (index: number, intent: AiVisualAssetIntent) => {
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(`slide:${index}:visualAsset`, (draft) => ({
      ...draft,
      slides: draft.slides.map((slide, slideIndex) =>
        slideIndex === index ? { ...slide, plan: { ...slide.plan, visualAsset: intent }, reviewed: false } : slide,
      ),
    }));
  };

  const updateAiBlocks = (index: number, blocks: AiDraft["slides"][number]["blocks"], separateHistory = false) => {
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(
      `slide:${index}:blocks`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide, slideIndex) =>
          slideIndex === index ? { ...slide, blocks, body: bodyFromBlocks(blocks), reviewed: false } : slide,
        ),
      }),
      !separateHistory,
    );
  };

  const updateAiSlideReviewed = (index: number, reviewed: boolean) => {
    updateAiDraftWithHistory(
      `slide:${index}:reviewed`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide, slideIndex) => (slideIndex === index ? { ...slide, reviewed } : slide)),
      }),
      false,
    );
  };

  const reviewAllAiSlides = () => {
    updateAiDraftWithHistory(
      "slides:review-all",
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide) => ({
          ...slide,
          reviewed: Boolean(slide.title.trim() && (slide.body.trim() || slide.blocks.length > 0)),
        })),
      }),
      false,
    );
  };

  const updateAiDraftTitle = (title: string) =>
    updateAiDraftWithHistory("draft:title", (draft) => ({ ...draft, title }));

  const addAiSlide = (afterIndex: number) => {
    const insertIndex = Math.min(afterIndex + 1, aiDraftRef.current?.slides.length ?? 0);
    const slide: AiDraft["slides"][number] = {
      id: crypto.randomUUID(),
      title: "新页面",
      body: "",
      speakerNotes: "",
      reviewed: false,
      plan: {
        purpose: "补充演示内容",
        conclusion: "请填写本页核心结论",
        visualIntent: "structured-text",
        density: "medium",
      },
      blocks: [],
    };
    updateAiDraftWithHistory(
      "slides:add",
      (draft) => ({
        ...draft,
        slides: [...draft.slides.slice(0, insertIndex), slide, ...draft.slides.slice(insertIndex)],
      }),
      false,
    );
    selectAiDraftSlide(insertIndex);
    setTaskStatus(`已新增第 ${insertIndex + 1} 页`);
  };

  const duplicateAiSlide = (index: number) => {
    const source = aiDraftRef.current?.slides[index];
    if (!source) return;
    const duplicate = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      title: `${source.title}（副本）`,
      reviewed: false,
    };
    updateAiDraftWithHistory(
      "slides:duplicate",
      (draft) => ({
        ...draft,
        slides: [...draft.slides.slice(0, index + 1), duplicate, ...draft.slides.slice(index + 1)],
      }),
      false,
    );
    selectAiDraftSlide(index + 1);
    setTaskStatus(`已复制第 ${index + 1} 页`);
  };

  const deleteAiSlide = (index: number) => {
    const current = aiDraftRef.current;
    if (!current || current.slides.length <= 1) return;
    const slideId = current.slides[index]?.id;
    if (slideId) aiRestoreBackups.current.delete(slideId);
    setAiRestoreUndoSlideIds([...aiRestoreBackups.current.keys()]);
    updateAiDraftWithHistory(
      "slides:delete",
      (draft) => ({ ...draft, slides: draft.slides.filter((_, slideIndex) => slideIndex !== index) }),
      false,
    );
    selectAiDraftSlide(Math.min(index, current.slides.length - 2));
    setTaskStatus(`已删除第 ${index + 1} 页`);
  };

  const moveAiSlide = (index: number, destination: number) => {
    const current = aiDraftRef.current;
    if (!current || destination < 0 || destination >= current.slides.length || destination === index) return;
    updateAiDraftWithHistory(
      "slides:move",
      (draft) => {
        const slides = [...draft.slides];
        const [slide] = slides.splice(index, 1);
        if (!slide) return draft;
        slides.splice(destination, 0, slide);
        return { ...draft, slides };
      },
      false,
    );
    selectAiDraftSlide(destination);
    setTaskStatus(`已将页面移动到第 ${destination + 1} 页`);
  };

  const restoreAiSlide = (index: number) => {
    const current = aiDraftRef.current?.slides[index];
    const slideId = current?.id;
    const original = slideId ? aiOriginalDraft.current?.slides.find((slide) => slide.id === slideId) : undefined;
    if (!current || !slideId || !original) return;
    aiRestoreBackups.current.set(slideId, structuredClone(current));
    setAiRestoreUndoSlideIds([...aiRestoreBackups.current.keys()]);
    updateAiDraftWithHistory(
      `slide:${index}:restore`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide) => (slide.id === slideId ? { ...original, id: slideId } : slide)),
      }),
      false,
    );
    setTaskStatus(`已恢复第 ${index + 1} 页的 AI 原始内容`);
  };

  const undoRestoreAiSlide = (index: number) => {
    const slideId = aiDraftRef.current?.slides[index]?.id;
    const backup = slideId ? aiRestoreBackups.current.get(slideId) : undefined;
    if (!backup || !slideId) return;
    aiRestoreBackups.current.delete(slideId);
    setAiRestoreUndoSlideIds([...aiRestoreBackups.current.keys()]);
    updateAiDraftWithHistory(
      `slide:${index}:undo-restore`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide) => (slide.id === slideId ? { ...backup, id: slideId } : slide)),
      }),
      false,
    );
    setTaskStatus(`已撤销第 ${index + 1} 页的恢复操作`);
  };

  const returnToAiStart = () => {
    persistAiDraft();
    // 离开审核页就放弃在途的重新生成，否则回到开始页后旧请求仍会替换草稿。
    if (aiRegenerating) {
      aiRequestId.current += 1;
      void cancelAiGeneration(aiTaskId.current).catch(() => undefined);
      setAiRegenerating(false);
      setAiProgress(undefined);
      setAiStreamProgress(undefined);
    }
    aiOriginalDraft.current = undefined;
    aiRestoreBackups.current.clear();
    setAiRestoreUndoSlideIds([]);
    aiContentUndo.current = [];
    aiContentRedo.current = [];
    aiContentCoalesce.current = undefined;
    setAiContentHistoryRevision((value) => value + 1);
    setAiDraft(undefined);
    setActiveHistoryId(undefined);
    setAiTopic("");
    selectAiDraftSlide(0);
    setAiSaveState("saved");
    setTaskStatus("当前草稿已保存到制作历史");
  };

  const aiDraftIssues = useMemo(() => (aiDraft ? reviewIssues(aiDraft) : []), [aiDraft]);
  const aiDraftBlockingIssues = useMemo(() => aiDraftIssues.filter((issue) => issue.blocking), [aiDraftIssues]);
  const aiDraftBlockReason = !aiDraft
    ? undefined
    : !aiDraft.title.trim()
      ? "请先填写演示文稿标题"
      : aiDraftBlockingIssues.map((issue) => issue.message).join("；") || undefined;
  // The header keeps the hint to one line; the tooltip on the disabled button carries every reason.
  const aiDraftBlockHint =
    aiDraftBlockingIssues.length === 0
      ? undefined
      : aiDraftBlockingIssues.length === 1
        ? aiDraftBlockingIssues[0]!.message
        : `${aiDraftBlockingIssues.length} 项待补全：${aiDraftBlockingIssues[0]!.message}`;
  const aiDraftMetrics = useMemo(() => (aiDraft ? draftMetrics(aiDraft) : { characters: 0, points: 0 }), [aiDraft]);
  // 大纲阶段占一小段，正文分批阶段按已完成批次推进；流式汇报的页数更细，取两者里更靠前的。
  // 重新生成沿用当前草稿的页数，开始页仍按用户填写的页数换算。
  const aiGenerationPageCount = aiRegenerating ? (aiDraft?.slides.length ?? aiSlideCount) : aiSlideCount;
  const aiGenerationPercent = aiProgress
    ? Math.max(
        aiProgress.stage === "outline"
          ? 12
          : 12 + Math.round((88 * aiProgress.completed) / Math.max(1, aiProgress.total)),
        aiStreamProgress
          ? 12 + Math.round((88 * aiStreamProgress.pages) / Math.max(1, Number(aiGenerationPageCount) || 1))
          : 0,
      )
    : 0;
  const aiGenerationLabel =
    aiStreamProgress && aiStreamProgress.pages > 0
      ? `正在生成正文（已写 ${aiStreamProgress.pages} 页）`
      : (aiProgress?.label ?? "");

  // Once the draft exists it is the reviewed source of truth. `aiTopic` is an
  // input-field state and may already have been cleared or replaced when the
  // user reaches the theme step; using it produced "青编" for a 岳阳楼记 deck.
  const recommendedThemePresetId = inferThemePresetId(aiDraft?.title.trim() || aiTopic.trim());
  const recommendedThemePreset = findThemePreset(recommendedThemePresetId) ?? defaultThemePreset();

  const continueToTheme = () => {
    if (!aiDraft) return;
    // Make the recommendation an actual default selection. The user can still
    // choose an uploaded template or another preset before generation.
    setThemePresetId((current) => current || recommendedThemePreset.id);
    setSelectedTemplate(undefined);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    setTemplatePickerOpen(true);
  };

  const generateFromDraft = async (
    mode: "template" | "preset" = "template",
    draftOverride?: AiDraft,
    historyIdOverride?: string,
  ) => {
    const sourceDraft = draftOverride ?? aiDraft;
    if (!sourceDraft) return;
    if (mode === "template" && (!selectedTemplate || !templateAnalysis)) return;
    if (designBusyRef.current) {
      setTaskStatus("已有 PPT 正在生成，请等待当前任务完成");
      return;
    }
    const sourceRecommendedThemePreset =
      findThemePreset(inferThemePresetId(sourceDraft.title.trim())) ?? defaultThemePreset();
    const preset =
      mode === "preset"
        ? (findThemePreset(
            draftOverride ? sourceRecommendedThemePreset.id : themePresetId || sourceRecommendedThemePreset.id,
          ) ?? defaultThemePreset())
        : undefined;
    const analysis: TemplateAnalysis = preset ? presetTemplateAnalysis(preset) : templateAnalysis!;
    const deckName = preset ? preset.name : selectedTemplate!.name;
    designBusyRef.current = true;
    setGeneratingHistoryId(historyIdOverride ?? activeHistoryId);
    designCancelRef.current = false;
    setDesignQualityReport(undefined);
    designTaskId.current += 1;
    const taskId = designTaskId.current;
    setDesignBusy(true);
    setAgentWorkflow((state) => {
      const prepared =
        state.stage === "reviewing-content" ? state : transitionAgentWorkflow(startAgentWorkflow(state), "planning");
      return transitionAgentWorkflow(prepared, "generating-design");
    });
    setDesignProgress({ percent: 8, label: "正在准备内容与模板数据" });
    // Design generation is a background task. Closing the modal here releases
    // the workspace immediately; progress and cancellation remain available in
    // the global task card.
    setTemplatePickerOpen(false);
    setMessage(undefined);
    const progressTimer = window.setInterval(() => {
      setDesignProgress((current) => {
        if (current.percent >= 82) return current;
        const next = Math.min(82, current.percent + (current.percent < 35 ? 4 : current.percent < 65 ? 2 : 1));
        const label = next < 28 ? "正在分析模板视觉特征" : next < 58 ? "AI 正在生成逐页版式" : "正在完善配色与页面层级";
        return { percent: next, label };
      });
    }, 900);
    try {
      setDesignProgress({ percent: 18, label: "正在规划逐页设计意图" });
      const briefs = briefsFromDraft(sourceDraft);
      const pageFacts = compositionFactsFromDraft(sourceDraft);
      let concept: DeckConcept;
      setDesignProgress({ percent: 28, label: "正在确定整册设计方向" });
      try {
        const aiConcept = await generateDeckConcepts(sourceDraft, briefs, analysis, { taskId });
        concept = resolveDeckConcept({
          concept: aiConcept,
          pageFacts,
          pageCount: sourceDraft.slides.length,
        }).concept;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (designCancelRef.current || message.includes("CANCELLED")) throw error;
        // A direction is an enhancement, not a prerequisite. A failed concept
        // call falls back to the editorial preset and still produces the deck.
        concept = resolveDeckConcept({
          concept: defaultEditorialConcept(),
          pageFacts,
          pageCount: sourceDraft.slides.length,
        }).concept;
      }
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      setDesignProgress({ percent: 46, label: "正在匹配模板版式与页面意图" });
      const design = await generatePresentationDesign(sourceDraft, briefs, analysis, { taskId, concept });
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      window.clearInterval(progressTimer);
      setDesignProgress({ percent: 88, label: "正在校验 AI 设计结果" });
      const hasTemplateSize = analysis.slideWidthEmu && analysis.slideHeightEmu;
      const templateColors = new Map(analysis.themeColors.map((color) => [color.name.toLowerCase(), color.value]));
      const resolveTemplateColor = (value: string | null) =>
        value?.startsWith("#") ? value : value ? templateColors.get(value.toLowerCase()) : undefined;
      setDesignProgress({ percent: 94, label: "正在渲染可编辑页面" });
      const templateLayoutSources = hasTemplateSize
        ? analysis.layouts.length > 0
          ? analysis.layouts
          : analysis.slides.map((slide) => ({ ...slide, name: slide.layout ?? slide.title }))
        : [];
      const normalizeRegion = (region: {
        role: "title" | "body" | "image";
        x: number;
        y: number;
        width: number;
        height: number;
      }) => ({
        role: region.role,
        frame: {
          x: region.x / analysis.slideWidthEmu!,
          y: region.y / analysis.slideHeightEmu!,
          width: region.width / analysis.slideWidthEmu!,
          height: region.height / analysis.slideHeightEmu!,
        },
      });
      // Measure the rendered artwork under each placeholder so the command layer
      // can tell whether the template's own ink stays readable on it.
      const backgroundProbes = new Map<number, TemplateBackgroundProbe>();
      await Promise.all(
        templateLayoutSources.map(async (layout) => {
          const render = matchTemplateLayoutRender(templateLayoutRenders, layout.index, layout.name);
          if (!render) return;
          try {
            backgroundProbes.set(
              layout.index,
              await probeTemplateBackground(render.dataUrl, layout.regions.map(normalizeRegion)),
            );
          } catch {
            // A layout without a probe falls back to the page color.
          }
        }),
      );
      // 配图：AI 说哪些页想配图，排版引擎说哪些页配得下。两边都同意的页才
      // 生成图片。图片生成失败只是少一张图，文稿照常成立。
      const assetPlan = planVisualAssets({
        designs: design.slides,
        itemCounts: sourceDraft.slides.map((slide) => countSlidePoints(slide)),
        deterministicBlocks: sourceDraft.slides.map((slide) =>
          (slide.blocks ?? []).some(
            (block) => block.type !== "paragraph" && block.type !== "bullet-list" && block.type !== "quote",
          ),
        ),
        topic: sourceDraft.title,
        // 内容阶段产出的配图意图是用户审核过的，它优先于设计阶段的建议。
        intents: sourceDraft.slides.map((slide) => slide.plan?.visualAsset),
      });
      const visualAssets = await generateDeckVisualAssets({
        decisions: assetPlan.decisions,
        prompts: assetPlan.prompts,
      });
      const generationCommand: DocumentCommand = {
        type: "apply-ai-designed-draft",
        title: sourceDraft.title,
        slides: sourceDraft.slides,
        designs: design.slides,
        designConcept: concept,
        pageSize: hasTemplateSize
          ? { width: emu(analysis.slideWidthEmu!), height: emu(analysis.slideHeightEmu!) }
          : undefined,
        fontFamily: preset ? undefined : analysis.majorFont || analysis.minorFont || undefined,
        bodyFontFamily: preset ? undefined : analysis.minorFont || analysis.majorFont || undefined,
        templateDecorations: preset
          ? undefined
          : hasTemplateSize
            ? (analysis.defaultDecorations ?? []).map((item) => ({
                shape: item.shape,
                fill: resolveTemplateColor(item.fill) ?? design.slides[0]!.accent,
                frame: {
                  x: item.x / analysis.slideWidthEmu!,
                  y: item.y / analysis.slideHeightEmu!,
                  width: item.width / analysis.slideWidthEmu!,
                  height: item.height / analysis.slideHeightEmu!,
                },
              }))
            : undefined,
        templateLayouts: preset
          ? undefined
          : hasTemplateSize
            ? templateLayoutSources.map((layout) => ({
                index: layout.index,
                name: layout.name,
                backgroundColor: resolveTemplateColor(layout.backgroundColor),
                backgroundImageDataUrl: matchTemplateLayoutRender(templateLayoutRenders, layout.index, layout.name)
                  ?.dataUrl,
                backgroundLuminance: backgroundProbes.get(layout.index),
                decorations: (layout.decorations ?? []).map((item) => ({
                  shape: item.shape,
                  fill: resolveTemplateColor(item.fill) ?? design.slides[0]!.accent,
                  frame: {
                    x: item.x / analysis.slideWidthEmu!,
                    y: item.y / analysis.slideHeightEmu!,
                    width: item.width / analysis.slideWidthEmu!,
                    height: item.height / analysis.slideHeightEmu!,
                  },
                })),
                regions: layout.regions.map((region) => ({
                  ...normalizeRegion(region),
                  textColor: region.textColor ?? undefined,
                  fontSizePt: region.fontSizePt ?? undefined,
                })),
              }))
            : undefined,
        // The theme of the template travels with the design, so the exported
        // deck keeps the typography and the palette of the template.
        // `preset` may have been inferred from the topic without the user
        // clicking the recommendation. Persist the preset actually used, not
        // only the picker state, or the generated document loses its fonts and
        // cultural visual language at this boundary.
        themePresetId: preset?.id ?? (themePresetId || undefined),
        templateTheme: preset
          ? undefined
          : {
              name: selectedTemplate!.name,
              majorFont: analysis.majorFont ?? undefined,
              minorFont: analysis.minorFont ?? undefined,
              colors: analysis.themeColors.map((color) => ({ name: color.name, value: color.value })),
            },
        backgroundRhythm: defaultPresentationVisualGoal().backgroundRhythm,
        visualAssets: visualAssets.map((asset) => ({
          slideIndex: asset.slideIndex,
          dataUrl: asset.dataUrl,
          mimeType:
            asset.mimeType === "image/jpeg"
              ? "image/jpeg"
              : asset.mimeType === "image/webp"
                ? "image/webp"
                : "image/png",
          naturalWidth: asset.naturalWidth,
          naturalHeight: asset.naturalHeight,
          altText: asset.altText,
        })),
      };
      const buildFinalDocument = (designs: AiSlideDesign[]) => {
        const candidate = structuredClone(document);
        applyCommand(candidate, { ...generationCommand, designs });
        return candidate;
      };
      // 视觉评审、像素对比度和质量门都只做判断与修复。任何一步出错都只降级，
      // 不会把已经生成的 PPT 一起丢掉。
      const stage = await runDesignQualityStage({
        initialDesigns: design.slides,
        buildDocument: buildFinalDocument,
        goal: defaultPresentationVisualGoal(),
        // 指纹必须来自修复后的真实文档快照。此前这里忽略了 designs，比较的
        // 始终是同一份生成时草稿，内容隔离守卫在生产里从未生效。
        contentFingerprint: (designs) => documentContentFingerprint(buildFinalDocument(designs)),
        // 视觉评审会把页面渲染图发送给模型服务。用户可以在设置里关闭这项
        // 上传；关闭后只做确定性校验，并在报告里说明。
        vision: (await loadSettings().catch(() => defaultSettings())).visionReviewEnabled
          ? new TauriVisionReviewPort()
          : new DisabledVisionReviewPort(),
        taskId,
        isCancelled: () => designCancelRef.current,
        onProgress: (label, percent) => {
          setDesignProgress({ percent, label });
          const stage = label.includes("修复")
            ? "repairing"
            : label.includes("视觉评审")
              ? "visual-review"
              : "deterministic-quality";
          setAgentWorkflow((state) =>
            canTransitionAgentWorkflow(state.stage, stage) ? transitionAgentWorkflow(state, stage, { label }) : state,
          );
        },
        // 评审优先看导出后的真实 PPTX。本机没有 PowerPoint 时这一项会失败，
        // 质检阶段自己降级到画布预览渲染并在报告里说明。
        renderRealPptxForReview,
      });
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      const finalDocument = stage.document;
      setAgentWorkflow((state) =>
        canTransitionAgentWorkflow(state.stage, "ready-to-export")
          ? transitionAgentWorkflow(state, "ready-to-export")
          : state,
      );
      const visualNote = stage.notes.join("；");
      // 质量门未过时文档照常产出：问题被逐条列出，PPT 不会因为报错而消失。
      replaceDocument(finalDocument, "both");
      const historyId = historyIdOverride ?? activeHistoryId;
      if (historyId) {
        const history = await saveAiPresentation(historyId, finalDocument);
        setAiHistory(history);
      }
      setTemplatePickerOpen(false);
      setProjectPath(undefined);
      setProjectMtime(undefined);
      setActiveView("editor");
      setEditorSurface("canvas");
      // 视觉评审只覆盖部分页面时不能走“完全通过”的静默路径：确定性质量门
      // 过了，也只代表看过的页没问题。报告必须留下，让用户看到覆盖范围。
      const coverage = stage.visualReviewCoverage;
      const visualCoverageIncomplete = coverage !== undefined && coverage.reviewed < coverage.total;
      // 视觉评审跑过但没达标（或整体失败）时，确定性质检通过也不代表稿子
      // 视觉上没问题。必须把报告留下，不能只闪一条状态就进入编辑器。
      const visualBelowTarget = stage.visualPassed === false;
      const qualityReport = {
        templateName: deckName,
        concept,
        issues: [
          ...new Map(
            stage.issues.map((issue) => [`${issue.slideIndex}-${issue.issue}-${issue.message}`, issue]),
          ).values(),
        ],
        notes: stage.notes,
        visualReview: stage.visualReview,
        visualReviewCoverage: stage.visualReviewCoverage,
        contactSheet: stage.contactSheet,
        deckReview: stage.deckReview,
        reviewReuse: stage.reviewReuse,
        slideSignatures: finalDocument.slides.map((slide) => JSON.stringify(slide)),
        reviewedAt: Date.now(),
        reviewSource: stage.notes.some((note) => note.includes("真实渲染"))
          ? ("真实 PPTX" as const)
          : ("画布预览" as const),
      };
      // 成功稿也保留报告。Contact Sheet、整册评分和缓存命中是可审计证据，
      // 不能因为通过质量门就从界面中消失。
      setDesignQualityReport(qualityReport);
      setDesignQualityReportOpen(false);
      if (stage.passed && !visualCoverageIncomplete && !visualBelowTarget) {
        setDesignProgress({ percent: 100, label: "生成完成，正在进入编辑器" });
        setTaskStatus(`PPT 已完成 AI 设计：${deckName}`);
        if (visualNote) window.setTimeout(() => setTaskStatus(visualNote), 50);
      } else {
        // 文档已经写进项目，问题只作为报告展示。界面不自动跳进编辑器，
        // 由用户决定先调整还是稍后处理。
        setDesignProgress({
          percent: 100,
          label: !stage.passed
            ? "生成完成，存在待调整的排版问题"
            : visualCoverageIncomplete
              ? "生成完成，视觉评审未覆盖全部页面"
              : "生成完成，视觉评审未达到目标",
        });
        setTaskStatus(
          stage.issues.length > 0
            ? `PPT 已生成，存在 ${stage.issues.length} 个待调整的排版问题：${summarizeQualityIssues(stage.issues)}`
            : !stage.passed
              ? `PPT 已生成，但质检未完成：${stage.notes.join("；")}`
              : visualCoverageIncomplete && coverage
                ? `PPT 已生成，但视觉评审只覆盖 ${coverage.reviewed}/${coverage.total} 页`
                : visualBelowTarget
                  ? stage.visualReview
                    ? `PPT 已生成，但视觉评审未达到目标（${stage.visualReview.overallScore} 分）`
                    : "PPT 已生成，但视觉评审未完成"
                  : `PPT 已生成，但质检未完成：${stage.notes.join("；")}`,
        );
      }
    } catch (error) {
      window.clearInterval(progressTimer);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "AI_GENERATION_CANCELLED" || message.includes("AI_REQUEST_CANCELLED")) {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "cancelled") ? transitionAgentWorkflow(state, "cancelled") : state,
        );
        setDesignProgress({ percent: 0, label: "已取消生成" });
        setTaskStatus("已取消 AI 设计生成");
      } else {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "failed")
            ? transitionAgentWorkflow(state, "failed", { error: describeAiError(error) })
            : state,
        );
        setDesignProgress({ percent: 0, label: "生成失败，请重试" });
        setTaskStatus(`AI 设计生成失败：${describeAiError(error)}`);
      }
    } finally {
      window.clearInterval(progressTimer);
      void endAiGeneration(taskId).catch(() => undefined);
      designBusyRef.current = false;
      setGeneratingHistoryId(undefined);
      setDesignBusy(false);
    }
  };

  const handleChooseTemplate = async () => {
    try {
      if (!isDesktopRuntime()) {
        setTaskStatus("模板持久化仅在 PPTD 桌面端可用");
        return;
      }
      const template = await choosePptxTemplate();
      if (!template) return;
      const imported = await importPptxTemplate(template.path);
      setSelectedTemplate(imported);
      setTemplateLibrary(await listPptxTemplates());
      setTemplateUploadOpen(false);
      await handleSelectTemplate(imported);
      setTaskStatus(`模板已保存：${imported.name}`);
    } catch (error) {
      setTaskStatus(`选择模板失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSelectTemplate = async (template: TemplateRecord, showDetails = true) => {
    setThemePresetId("");
    setSelectedTemplate(template);
    setThemeDrawerOpen(showDetails);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    if (!isDesktopRuntime()) return;
    setTemplatePreviewBusy(true);
    try {
      const [preview, analysis, renders] = await Promise.all([
        getPptxTemplatePreview(template.id),
        analyzePptxTemplate(template.id),
        renderPptxTemplateLayouts(template.id).catch((error) => {
          setTaskStatus(
            `复杂模板视觉层渲染不可用，将使用基础样式：${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }),
      ]);
      setTemplatePreview(preview);
      setTemplateAnalysis(analysis);
      setTemplateLayoutRenders(renders);
    } catch (error) {
      setTemplatePreview(null);
      setTaskStatus(`模板预览读取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTemplatePreviewBusy(false);
    }
  };

  const handleSelectThemePreset = (presetId: string, showDetails = true) => {
    setThemePresetId(presetId);
    setSelectedTemplate(undefined);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    setThemeDrawerOpen(showDetails);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // The format painter is a mode, so Escape leaves it from anywhere.
      if (event.key === "Escape" && useFormatPainterStore.getState().style) {
        useFormatPainterStore.getState().cancel();
        setTaskStatus("已退出格式刷");
      }
      if (event.key === "Escape" && findOpen) setFindOpen(false);
      // 编辑快捷键只在编辑器视图生效。AI 审核页、主题页和设置页里 Delete /
      // Ctrl+Z 属于它们自己的交互，不能让隐藏的画布跟着动。
      if (activeView !== "editor") return;
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const shortcut = resolveEditorShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        targetTagName: target?.tagName,
        targetIsContentEditable: target?.isContentEditable,
      });
      if (!shortcut) return;
      if (shortcut === "undo") {
        if (!undoStack.length) return;
        event.preventDefault();
        undo();
        return;
      }
      if (shortcut === "redo") {
        if (!redoStack.length) return;
        event.preventDefault();
        redo();
        return;
      }
      if (shortcut === "find") {
        if (editorSurface !== "canvas") return;
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (shortcut === "select-all") {
        if (editorSurface !== "canvas") return;
        event.preventDefault();
        const ids = activeSlide.elements.filter((element) => !element.locked).map((element) => element.id);
        selectElements(ids);
        setTaskStatus(ids.length > 0 ? `已选择 ${ids.length} 个对象` : "本页没有可选对象");
        return;
      }
      if (shortcut === "copy-element") {
        event.preventDefault();
        copySelection(false);
        return;
      }
      if (shortcut === "cut-element") {
        event.preventDefault();
        copySelection(true);
        return;
      }
      if (shortcut === "paste-element") {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if (shortcut === "copy-format") {
        const text = selectedTextElements.at(-1);
        if (!text) return;
        event.preventDefault();
        useFormatPainterStore.getState().copy(normalizeTextFormat(text.style), false);
        setTaskStatus("已复制文本格式：点击目标文本应用，Esc 取消");
        return;
      }
      if (shortcut === "apply-format") {
        const brush = useFormatPainterStore.getState();
        const targets = selectedTextElements.filter((element) => !element.locked);
        if (!brush.style || targets.length === 0) {
          setTaskStatus("先复制格式，再选择目标文本");
          return;
        }
        event.preventDefault();
        execute({
          type: "set-text-style-elements",
          slideId: activeSlide.id,
          elementIds: targets.map((element) => element.id),
          style: brush.style,
          clearRuns: true,
        });
        brush.consume();
        return;
      }
      if (
        shortcut === "toggle-bold" ||
        shortcut === "toggle-italic" ||
        shortcut === "toggle-underline" ||
        shortcut === "font-increase" ||
        shortcut === "font-decrease"
      ) {
        const targets = selectedTextElements.filter((element) => !element.locked);
        const target = targets.at(-1);
        if (!target) return;
        event.preventDefault();
        const style =
          shortcut === "toggle-bold"
            ? { bold: !target.style.bold }
            : shortcut === "toggle-italic"
              ? { italic: !(target.style.italic ?? false) }
              : shortcut === "toggle-underline"
                ? { underline: !(target.style.underline ?? false) }
                : {
                    fontSizePt: nextTextSize(target.style.fontSizePt, shortcut === "font-increase" ? "up" : "down"),
                  };
        execute({
          type: "set-text-style-elements",
          slideId: activeSlide.id,
          elementIds: targets.map((element) => element.id),
          style,
        });
        return;
      }
      if (!selected || selected.locked) return;
      event.preventDefault();
      if (
        shortcut === "nudge-left" ||
        shortcut === "nudge-right" ||
        shortcut === "nudge-up" ||
        shortcut === "nudge-down"
      ) {
        const step = emu((event.shiftKey ? 0.5 : 0.1) * EMU_PER_INCH);
        const dx = shortcut === "nudge-left" ? -step : shortcut === "nudge-right" ? step : 0;
        const dy = shortcut === "nudge-up" ? -step : shortcut === "nudge-down" ? step : 0;
        const x = Math.max(0, Math.min(document.pageSize.width - selected.frame.width, selected.frame.x + dx));
        const y = Math.max(0, Math.min(document.pageSize.height - selected.frame.height, selected.frame.y + dy));
        execute({ type: "move-element", slideId: activeSlide.id, elementId: selected.id, x: emu(x), y: emu(y) });
        return;
      }
      if (shortcut === "layer-forward" || shortcut === "layer-backward") {
        const index = activeSlide.elements.findIndex((element) => element.id === selected.id);
        const toIndex = index + (shortcut === "layer-forward" ? 1 : -1);
        if (toIndex < 0 || toIndex >= activeSlide.elements.length) return;
        execute({ type: "reorder-element", slideId: activeSlide.id, elementId: selected.id, toIndex });
        return;
      }
      execute({ type: shortcut, slideId: activeSlide.id, elementId: selected.id });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeSlide,
    activeView,
    document.pageSize.height,
    document.pageSize.width,
    execute,
    copySelection,
    pasteSelection,
    editorSurface,
    findOpen,
    selectElements,
    redo,
    redoStack.length,
    selected,
    selectedElementIds,
    selectedTextElements,
    undo,
    undoStack.length,
  ]);

  /**
   * Dragging the border of the property panel changes its width. The width is
   * a display preference of the window, so it never reaches the document.
   */
  const startInspectorResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    // `inspectorWidth` in this closure is the width at drag start. Keep the
    // last value the drag actually produced so the persisted width is not the
    // one from before the drag.
    let latestWidth = inspectorWidth;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(
        INSPECTOR_MAX_WIDTH,
        Math.max(INSPECTOR_MIN_WIDTH, startWidth - (moveEvent.clientX - startX)),
      );
      latestWidth = next;
      setInspectorWidth(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      try {
        window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(latestWidth));
      } catch {
        // A window without a local storage simply forgets the width.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const selectedThemePreset = findThemePreset(themePresetId);
  const selectedThemeGuidance = selectedThemePreset ? themePresetGuidance(selectedThemePreset.id) : undefined;
  const selectedThemeMetadata = selectedThemePreset ? themePresetMetadata(selectedThemePreset.id) : undefined;
  const selectedThemeAiPrompt = selectedThemePreset ? themePresetAiPrompt(selectedThemePreset) : undefined;
  const pickerThemePreset = selectedThemePreset ?? recommendedThemePreset;
  const pickerThemeGuidance = themePresetGuidance(pickerThemePreset.id);
  const runManualReview = async (scope: "current" | "changed" | "issues" | "all") => {
    if (manualReviewBusy || !designQualityReport) return;
    const currentSignatures = document.slides.map((slide) => JSON.stringify(slide));
    const issueIndexes = [
      ...new Set([
        ...designQualityReport.issues.map((issue) => issue.slideIndex),
        ...(designQualityReport.visualReview?.issues.map((issue) => issue.slideIndex) ?? []),
      ]),
    ];
    const indexes =
      scope === "current"
        ? [document.slides.findIndex((slide) => slide.id === activeSlideId)]
        : scope === "changed"
          ? currentSignatures.flatMap((signature, index) =>
              signature === designQualityReport.slideSignatures[index] ? [] : [index],
            )
          : scope === "issues"
            ? issueIndexes
            : document.slides.map((_, index) => index);
    if (indexes.length === 0) {
      setTaskStatus(scope === "changed" ? "上次评审后没有页面变化" : "当前范围没有可复检页面");
      return;
    }
    const settings = await loadSettings().catch(() => defaultSettings());
    if (!settings.visionReviewEnabled) {
      setTaskStatus("视觉评审已在设置中关闭，请先允许发送页面渲染图");
      return;
    }
    manualReviewTaskId.current += 1;
    const taskId = manualReviewTaskId.current;
    manualReviewCancelled.current = false;
    setManualReviewBusy(true);
    setAgentWorkflow((state) =>
      canTransitionAgentWorkflow(state.stage, "visual-review")
        ? transitionAgentWorkflow(state, "visual-review", { label: `正在复检 ${indexes.length} 页并刷新整册总览` })
        : state,
    );
    setTaskStatus(`正在复检 ${indexes.length} 页，并重新检查整册节奏…`);
    try {
      const result = await runManualVisualReview({
        document: structuredClone(document),
        indexes,
        goal: defaultPresentationVisualGoal(),
        vision: new TauriVisionReviewPort(),
        taskId,
        renderReal: renderRealPptxForReview,
        renderCanvas: renderPresentationForVisualReview,
      });
      if (manualReviewCancelled.current) throw new Error("AI_GENERATION_CANCELLED");
      const refreshedSignatures = [...designQualityReport.slideSignatures];
      result.reviewedIndexes.forEach((index) => {
        refreshedSignatures[index] = currentSignatures[index]!;
      });
      setDesignQualityReport((previous) =>
        previous
          ? {
              ...previous,
              visualReview: result.review,
              visualReviewCoverage: { reviewed: result.reviewedIndexes.length, total: document.slides.length },
              contactSheet: result.render.contactSheet,
              deckReview: result.deckReview,
              reviewReuse: {
                reviewed: result.reviewedIndexes.length,
                reused: document.slides.length - result.reviewedIndexes.length,
              },
              slideSignatures: refreshedSignatures,
              reviewedAt: Date.now(),
              reviewSource: result.source,
              notes: [
                ...previous.notes.filter((note) => !note.startsWith("手动复检")),
                `手动复检 ${result.reviewedIndexes.length} 页；整册总览已刷新${result.degradedReason ? `；真实渲染降级：${result.degradedReason}` : ""}`,
              ],
            }
          : previous,
      );
      setAgentWorkflow((state) =>
        transitionAgentWorkflow(state, "ready-to-export", { label: "复检完成，可继续编辑或导出" }),
      );
      setTaskStatus(`复检完成：检查 ${result.reviewedIndexes.length} 页，整册总览已刷新`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.includes("CANCELLED")) {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "cancelled")
            ? transitionAgentWorkflow(state, "cancelled", { label: "已取消视觉复检" })
            : state,
        );
        setTaskStatus("已取消视觉复检");
      } else {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "failed")
            ? transitionAgentWorkflow(state, "failed", { error: detail })
            : state,
        );
        setTaskStatus(`视觉复检失败：${describeAiError(error)}`);
      }
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
      setManualReviewBusy(false);
    }
  };

  const cancelManualReview = () => {
    if (!manualReviewBusy) return;
    manualReviewCancelled.current = true;
    void cancelAiGeneration(manualReviewTaskId.current).catch(() => undefined);
    setTaskStatus("正在取消视觉复检…");
  };

  const openQualityTarget = (slideIndex: number, elementIds: string[] = []) => {
    const slide = document.slides[slideIndex];
    if (!slide) return;
    setActiveView("editor");
    setEditorSurface("canvas");
    selectSlide(slide.id);
    const existing = new Set(slide.elements.map((element) => element.id));
    selectElements(elementIds.filter((id): id is ElementId => existing.has(id as ElementId)));
    setDesignQualityReportOpen(false);
  };
  const selectedAnimations = selected
    ? (activeSlide.animations ?? []).filter((animation) => animation.elementId === selected.id)
    : [];
  const selectedAnimation =
    selectedAnimations.find((animation) => animation.id === selectedAnimationId) ?? selectedAnimations.at(-1);
  const selectedAnimationIndex = selectedAnimation
    ? (activeSlide.animations ?? []).findIndex((animation) => animation.id === selectedAnimation.id)
    : -1;

  useEffect(() => {
    const nextId = selectedAnimation?.id;
    if (selectedAnimationId !== nextId) setSelectedAnimationId(nextId);
  }, [selectedAnimation?.id, selectedAnimationId]);

  const stopAnimationPreview = useCallback(() => {
    animationPreviewTimers.current.forEach((timer) => window.clearTimeout(timer));
    animationPreviewTimers.current = [];
    setAnimationPreviews([]);
  }, []);

  useEffect(() => stopAnimationPreview, [stopAnimationPreview]);

  const previewSelectedAnimation = () => {
    if (!selectedAnimation) return;
    stopAnimationPreview();
    window.requestAnimationFrame(() => {
      setAnimationPreviews([selectedAnimation]);
      animationPreviewTimers.current = [
        window.setTimeout(
          () => setAnimationPreviews([]),
          selectedAnimation.durationMs + selectedAnimation.delayMs + 120,
        ),
      ];
    });
  };

  const previewSlideAnimations = () => {
    const animations = activeSlide.animations ?? [];
    if (animations.length === 0) return;
    stopAnimationPreview();
    let previousStart = 0;
    let previousEnd = 0;
    animations.forEach((animation, index) => {
      const sequenceStart =
        index === 0
          ? 0
          : animation.start === "with-previous"
            ? previousStart
            : animation.start === "after-previous"
              ? previousEnd
              : previousEnd + 250;
      const visibleStart = sequenceStart;
      const visibleEnd = sequenceStart + animation.delayMs + animation.durationMs + 80;
      animationPreviewTimers.current.push(
        window.setTimeout(() => {
          setAnimationPreviews((current) => [
            ...current.filter((item) => item.elementId !== animation.elementId),
            animation,
          ]);
          setSelectedAnimationId(animation.id);
        }, visibleStart),
        window.setTimeout(() => {
          setAnimationPreviews((current) => current.filter((item) => item.id !== animation.id));
        }, visibleEnd),
      );
      previousStart = sequenceStart;
      previousEnd = Math.max(previousEnd, sequenceStart + animation.delayMs + animation.durationMs);
    });
    animationPreviewTimers.current.push(
      window.setTimeout(() => {
        animationPreviewTimers.current = [];
        setAnimationPreviews([]);
      }, previousEnd + 350),
    );
  };

  const restoreContentVersion = (versionId: string) => {
    if (
      !window.confirm(
        "恢复这个版本会覆盖当前文稿的标题、正文、内容块、演讲备注和页序；版式、对象和背景不会回滚。是否继续？",
      )
    )
      return;
    try {
      execute({ type: "restore-content-version", versionId });
      setContentHistoryOpen(false);
      setTaskStatus("已恢复内容版本；版式、对象和背景未改动，请确认恢复后的页面内容。");
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setTaskStatus(
        code === "CONTENT_VERSION_PAGE_SET_MISMATCH"
          ? "恢复失败：此版本与当前页面集合不同，无法只恢复内容。"
          : code === "CONTENT_VERSION_BLOCKS_INCOMPATIBLE"
            ? "恢复失败：此版本的内容块与当前对象结构不同，无法安全恢复。"
            : code === "CONTENT_VERSION_NOT_FOUND"
              ? "恢复失败：版本不存在，可能已被撤销。"
              : `恢复失败：${code}`,
      );
    }
  };

  const editorCanvasOpen = activeView === "editor" && editorSurface === "canvas";
  const projectHomeItems = [
    ...recentProjects.map((entry) => ({ kind: "project" as const, timestamp: entry.lastOpenedAt, entry })),
    ...aiHistory.map((entry) => ({ kind: "ai" as const, timestamp: Date.parse(entry.updatedAt), entry })),
  ].sort((left, right) => right.timestamp - left.timestamp);

  return (
    <div
      className={`app-shell ${editorCanvasOpen ? "" : "module-shell"}`}
      style={{ "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties}
    >
      {editorCanvasOpen && (
        <header className="topbar" data-ribbon-tab={editorRibbonTab}>
          <nav className="ribbon-tabs" aria-label="编辑功能区">
            {(
              [
                ["file", "文件"],
                ["home", "开始"],
                ["insert", "插入"],
                ["design", "设计"],
                ["arrange", "排列"],
                ["animation", "动画"],
                ["view", "视图"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={editorRibbonTab === id ? "active" : undefined}
                aria-current={editorRibbonTab === id ? "page" : undefined}
                onClick={() => setEditorRibbonTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="toolbar-group file-tools">
            <ToolButton label="新建项目" caption="新建" onClick={handleNew}>
              <FilePlus2 />
            </ToolButton>
            <ToolButton
              label="打开或导入 PPTD、PPTX、PPT"
              caption="打开"
              onClick={handleOpenOrImport}
              disabled={!isDesktopRuntime()}
            >
              <FileUp />
            </ToolButton>
            <ToolButton
              label="最近项目"
              caption="最近"
              onClick={() => {
                setRecentProjectsOpen(true);
                void refreshRecentProjects();
              }}
              disabled={!isDesktopRuntime()}
            >
              <FolderClock />
            </ToolButton>
            <ToolButton
              label={saving ? "正在保存" : "保存项目"}
              caption={saving ? "保存中" : "保存"}
              onClick={handleSave}
              disabled={saving}
            >
              <Save />
            </ToolButton>
            <ToolButton label="另存为" caption="另存" onClick={handleSaveAs} disabled={saving || !isDesktopRuntime()}>
              <SaveAll />
            </ToolButton>
            <ToolButton label="重命名项目" caption="重命名" onClick={handleRenameProject} disabled={saving}>
              <FilePenLine />
            </ToolButton>
            <ToolButton
              label="复制项目"
              caption="副本"
              onClick={handleDuplicateProject}
              disabled={saving || !isDesktopRuntime()}
            >
              <Copy />
            </ToolButton>
          </div>
          <div className="toolbar-group home-tools">
            <ToolButton label="撤销" onClick={undo} disabled={!undoStack.length}>
              <Undo2 />
            </ToolButton>
            <ToolButton label="重做" onClick={redo} disabled={!redoStack.length}>
              <Redo2 />
            </ToolButton>
            <span className="separator" />
            <ToolButton label="新建幻灯片" caption="新建页面" onClick={() => execute({ type: "add-slide" })}>
              <Plus />
            </ToolButton>
            <ToolButton
              label="复制当前幻灯片"
              caption="复制页面"
              onClick={() => execute({ type: "duplicate-slide", slideId: activeSlide.id })}
            >
              <Copy />
            </ToolButton>
            <ToolButton
              label="删除当前幻灯片"
              caption="删除页面"
              disabled={document.slides.length <= 1}
              onClick={() => execute({ type: "delete-slide", slideId: activeSlide.id })}
            >
              <Trash2 />
            </ToolButton>
            <span className="separator" />
            <div className="quick-edit-tools" role="group" aria-label="剪贴板与查找">
              <button
                type="button"
                aria-label="剪切所选对象"
                title="剪切（Ctrl+X）"
                disabled={
                  selectedElementIds.length === 0 ||
                  selectedElementIds.every((id) => activeSlide.elements.find((item) => item.id === id)?.locked)
                }
                onClick={() => copySelection(true)}
              >
                <Scissors />
              </button>
              <button
                type="button"
                aria-label="复制所选对象"
                title="复制（Ctrl+C）"
                disabled={
                  selectedElementIds.length === 0 ||
                  selectedElementIds.every((id) => activeSlide.elements.find((item) => item.id === id)?.locked)
                }
                onClick={() => copySelection(false)}
              >
                <Copy />
              </button>
              <button
                type="button"
                aria-label="粘贴剪贴板对象"
                title="粘贴（Ctrl+V）"
                disabled={clipboard.elements.length === 0}
                onClick={pasteSelection}
              >
                <ClipboardPaste />
              </button>
              <button
                type="button"
                aria-label="查找和替换"
                title="查找和替换（Ctrl+F）"
                onClick={() => setFindOpen(true)}
              >
                <Search />
              </button>
            </div>
            <ToolButton
              label="删除所选对象"
              caption="删除对象"
              disabled={
                selectedElementIds.length === 0 ||
                selectedElementIds.every((id) => activeSlide.elements.find((item) => item.id === id)?.locked)
              }
              onClick={() => {
                const elementIds = selectedElementIds.filter(
                  (id) => !activeSlide.elements.find((item) => item.id === id)?.locked,
                );
                if (elementIds.length) execute({ type: "delete-elements", slideId: activeSlide.id, elementIds });
              }}
            >
              <Trash2 />
            </ToolButton>
            <span className="separator" />
            <TextFormatToolbar slideId={activeSlide.id} elements={selectedTextElements} execute={execute} />
          </div>
          <div className="toolbar-group insert-tools">
            <ToolButton label="选择">
              <MousePointer2 />
            </ToolButton>
            <ToolButton label="文本" onClick={() => execute({ type: "add-text", slideId: activeSlide.id })}>
              <Type />
            </ToolButton>
            <ToolButton
              label="矩形"
              onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "rectangle" })}
            >
              <Square />
            </ToolButton>
            <ToolButton
              label="椭圆"
              onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "ellipse" })}
            >
              <Circle />
            </ToolButton>
            <ToolButton
              label="直线"
              onClick={() => execute({ type: "add-line", slideId: activeSlide.id, direction: "horizontal" })}
            >
              <Minus />
            </ToolButton>
            <ToolButton
              label="箭头"
              onClick={() => execute({ type: "add-line", slideId: activeSlide.id, direction: "diagonal" })}
            >
              <ArrowRight />
            </ToolButton>
            <ToolButton label="图片" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus />
            </ToolButton>
            <ToolButton label="图标" onClick={() => setIconPickerOpen(true)}>
              <Sparkles />
            </ToolButton>
            <ToolButton
              label="AI 配图"
              onClick={() => {
                setAiImageError(undefined);
                setAiImageOpen(true);
              }}
              disabled={aiImageBusy}
            >
              <Sparkles />
            </ToolButton>
            <input
              ref={imageInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                handleImageFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <ToolButton
              label="重排版式（保留手工对象/配图）"
              onClick={() => {
                execute({ type: "relayout-slide", slideId: activeSlide.id });
                setTaskStatus("已按当前内容重新应用版式，手工对象、配图和锁定对象已保留");
              }}
            >
              <Wand2 />
            </ToolButton>
          </div>
          <div className="toolbar-group assist-tools">
            <ToolButton label="适应窗口" onClick={fitToWindow}>
              <LayoutDashboard />
            </ToolButton>
            <ToolButton label={gridEnabled ? "关闭网格" : "显示网格"} onClick={toggleGrid}>
              <Grid3x3 />
            </ToolButton>
            <ToolButton label={gridSnapEnabled ? "关闭网格吸附" : "吸附到网格"} onClick={toggleGridSnap}>
              <Grid2x2 />
            </ToolButton>
            <ToolButton label={snapEnabled ? "关闭吸附" : "开启吸附"} onClick={toggleSnap}>
              <Magnet />
            </ToolButton>
            <ToolButton label="添加垂直参考线" onClick={() => addGuide("x", document.pageSize.width / 2)}>
              <MoveVertical />
            </ToolButton>
            <ToolButton label="添加水平参考线" onClick={() => addGuide("y", document.pageSize.height / 2)}>
              <MoveHorizontal />
            </ToolButton>
            <ToolButton
              label="清除本页参考线"
              onClick={() => clearGuidesOnSlide(activeSlide.id)}
              disabled={!activeGuides.length}
            >
              <Trash2 />
            </ToolButton>
          </div>
          <div className="toolbar-group design-tools">
            <ToolButton label="选择主题" onClick={() => changeActiveView("theme")}>
              <Palette />
            </ToolButton>
            <ToolButton
              label="重排当前页面"
              onClick={() => execute({ type: "relayout-slide", slideId: activeSlide.id })}
            >
              <Wand2 />
            </ToolButton>
            <span className="separator" />
            <PageSizeControls
              pageSize={document.pageSize}
              elements={document.slides.flatMap((slide) => slide.elements)}
              execute={execute}
            />
          </div>
          <div className="toolbar-group arrange-tools">
            <ToolButton
              label="复制所选对象"
              disabled={!selected || selected.locked}
              onClick={() =>
                selected && execute({ type: "duplicate-element", slideId: activeSlide.id, elementId: selected.id })
              }
            >
              <Copy />
            </ToolButton>
            <ToolButton
              label="上移一层"
              disabled={
                !selected ||
                selected.locked ||
                activeSlide.elements.indexOf(selected) >= activeSlide.elements.length - 1
              }
              onClick={() =>
                selected &&
                execute({
                  type: "reorder-element",
                  slideId: activeSlide.id,
                  elementId: selected.id,
                  toIndex: activeSlide.elements.indexOf(selected) + 1,
                })
              }
            >
              <ArrowUp />
            </ToolButton>
            <ToolButton
              label="下移一层"
              disabled={!selected || selected.locked || activeSlide.elements.indexOf(selected) <= 0}
              onClick={() =>
                selected &&
                execute({
                  type: "reorder-element",
                  slideId: activeSlide.id,
                  elementId: selected.id,
                  toIndex: activeSlide.elements.indexOf(selected) - 1,
                })
              }
            >
              <ArrowDown />
            </ToolButton>
            <ToolButton
              label="置于顶层"
              disabled={
                !selected ||
                selected.locked ||
                activeSlide.elements.indexOf(selected) >= activeSlide.elements.length - 1
              }
              onClick={() =>
                selected &&
                execute({
                  type: "reorder-element",
                  slideId: activeSlide.id,
                  elementId: selected.id,
                  toIndex: activeSlide.elements.length - 1,
                })
              }
            >
              <ArrowUp />
            </ToolButton>
            <ToolButton
              label="置于底层"
              disabled={!selected || selected.locked || activeSlide.elements.indexOf(selected) <= 0}
              onClick={() =>
                selected &&
                execute({ type: "reorder-element", slideId: activeSlide.id, elementId: selected.id, toIndex: 0 })
              }
            >
              <ArrowDown />
            </ToolButton>
            <ToolButton
              label="删除所选对象"
              disabled={!selected || selected.locked}
              onClick={() =>
                selected && execute({ type: "delete-element", slideId: activeSlide.id, elementId: selected.id })
              }
            >
              <Trash2 />
            </ToolButton>
          </div>
          <div className="toolbar-group animation-tools">
            <ToolButton
              label="预览当前动画"
              caption="预览"
              disabled={!selectedAnimation}
              onClick={previewSelectedAnimation}
            >
              <MousePointer2 />
            </ToolButton>
            <ToolButton
              label="按顺序预览本页动画"
              caption="播放全部"
              disabled={!activeSlide.animations?.length}
              onClick={previewSlideAnimations}
            >
              <Play />
            </ToolButton>
            <ToolButton
              label="停止动画预览"
              caption="停止"
              disabled={!animationPreviews.length}
              onClick={stopAnimationPreview}
            >
              <Square />
            </ToolButton>
            <span className="separator" />
            {(
              [
                ["appear", "出现"],
                ["fade", "淡化"],
                ["fly-in", "飞入"],
              ] as const
            ).map(([effect, label]) => (
              <ToolButton
                key={effect}
                label={`添加${label}动画`}
                caption={label}
                disabled={!selected || selected.locked}
                onClick={() => {
                  if (!selected) return;
                  setSelectedAnimationId(undefined);
                  execute({
                    type: "add-animation",
                    slideId: activeSlide.id,
                    elementId: selected.id,
                    animation: {
                      effect,
                      start: "on-click",
                      durationMs: effect === "appear" ? 300 : 600,
                      delayMs: 0,
                      direction: effect === "fly-in" ? "bottom" : "none",
                    },
                  });
                }}
              >
                <Sparkles />
              </ToolButton>
            ))}
            <span className="separator" />
            <ToolButton
              label="删除所选对象的最后一个动画"
              caption="删除动画"
              disabled={
                !selected || !(activeSlide.animations ?? []).some((animation) => animation.elementId === selected.id)
              }
              onClick={() => {
                if (!selected) return;
                const animation = [...(activeSlide.animations ?? [])]
                  .reverse()
                  .find((item) => item.elementId === selected.id);
                if (animation)
                  execute({ type: "remove-animation", slideId: activeSlide.id, animationId: animation.id });
              }}
            >
              <Trash2 />
            </ToolButton>
            {selectedAnimation && (
              <div className="animation-timing-controls" aria-label="动画计时与顺序">
                <label>
                  开始
                  <select
                    value={selectedAnimation.start}
                    onChange={(event) =>
                      execute({
                        type: "set-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        changes: { start: event.target.value as typeof selectedAnimation.start },
                      })
                    }
                  >
                    <option value="on-click">单击时</option>
                    <option value="with-previous">与上一动画同时</option>
                    <option value="after-previous">上一动画之后</option>
                  </select>
                </label>
                <label>
                  时长
                  <input
                    type="number"
                    min="0.1"
                    max="60"
                    step="0.1"
                    value={selectedAnimation.durationMs / 1000}
                    onChange={(event) =>
                      execute({
                        type: "set-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        changes: { durationMs: Math.round(Number(event.target.value) * 1000) },
                      })
                    }
                  />
                </label>
                <label>
                  延迟
                  <input
                    type="number"
                    min="0"
                    max="60"
                    step="0.1"
                    value={selectedAnimation.delayMs / 1000}
                    onChange={(event) =>
                      execute({
                        type: "set-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        changes: { delayMs: Math.round(Number(event.target.value) * 1000) },
                      })
                    }
                  />
                </label>
                {selectedAnimation.effect === "fly-in" && (
                  <label>
                    方向
                    <select
                      value={selectedAnimation.direction}
                      onChange={(event) =>
                        execute({
                          type: "set-animation",
                          slideId: activeSlide.id,
                          animationId: selectedAnimation.id,
                          changes: { direction: event.target.value as SlideAnimation["direction"] },
                        })
                      }
                    >
                      <option value="left">从左侧</option>
                      <option value="right">从右侧</option>
                      <option value="top">从顶部</option>
                      <option value="bottom">从底部</option>
                    </select>
                  </label>
                )}
                <div className="animation-order-controls" aria-label="调整动画顺序">
                  <button
                    type="button"
                    title="动画前移"
                    disabled={selectedAnimationIndex <= 0}
                    onClick={() =>
                      execute({
                        type: "move-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        toIndex: selectedAnimationIndex - 1,
                      })
                    }
                  >
                    <ArrowUp />
                  </button>
                  <button
                    type="button"
                    title="动画后移"
                    disabled={
                      selectedAnimationIndex < 0 || selectedAnimationIndex >= (activeSlide.animations?.length ?? 0) - 1
                    }
                    onClick={() =>
                      execute({
                        type: "move-animation",
                        slideId: activeSlide.id,
                        animationId: selectedAnimation.id,
                        toIndex: selectedAnimationIndex + 1,
                      })
                    }
                  >
                    <ArrowDown />
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className="export-button"
            onClick={() => (exportBusy ? void handleExport() : setExportPreflightOpen(true))}
          >
            <Download size={17} /> {exportBusy ? "取消导出" : "导出 PPTX"}
          </button>
        </header>
      )}

      <nav className="nav-rail" aria-label="主功能">
        <button
          className={activeView === "editor" ? "active" : ""}
          aria-current={activeView === "editor" ? "page" : undefined}
          title="编辑器"
          onClick={() => changeActiveView("editor")}
        >
          <LayoutDashboard />
          <span>编辑</span>
        </button>
        <button
          className={activeView === "ai" ? "active" : ""}
          aria-current={activeView === "ai" ? "page" : undefined}
          title="AI 生成"
          onClick={() => changeActiveView("ai")}
          disabled={!isDesktopRuntime()}
        >
          <Sparkles />
          <span>AI</span>
        </button>
        <button
          className={activeView === "theme" ? "active" : ""}
          aria-current={activeView === "theme" ? "page" : undefined}
          title="主题模板"
          onClick={() => changeActiveView("theme")}
        >
          <Palette />
          <span>主题</span>
        </button>
        <div className="nav-spacer" />
        <button
          className={activeView === "settings" ? "active" : ""}
          aria-current={activeView === "settings" ? "page" : undefined}
          title="设置"
          onClick={() => changeActiveView("settings")}
        >
          <Settings />
          <span>设置</span>
        </button>
      </nav>

      {activeView === "editor" && editorSurface === "projects" && (
        <main className="feature-workspace project-home">
          <header className="feature-header project-home-header">
            <div>
              <LayoutDashboard />
              <div>
                <h1>我的演示文稿</h1>
                <p>继续编辑最近的项目，或创建一份新的演示文稿</p>
              </div>
            </div>
            <div className="project-home-actions">
              <button type="button" className="secondary-action" onClick={() => void handleOpenOrImport()}>
                <FileUp />
                打开项目
              </button>
              <button type="button" className="primary-action" onClick={() => void handleNew()}>
                <FilePlus2 />
                新建项目
              </button>
            </div>
          </header>
          <div className="feature-scroll project-home-scroll">
            {projectHomeItems.length === 0 ? (
              <section className="project-home-empty">
                <LayoutDashboard />
                <h2>还没有编辑过的演示文稿</h2>
                <p>保存、打开或使用 AI 生成文稿后，它们会以卡片形式显示在这里。</p>
                <button type="button" className="primary-action" onClick={() => void handleNew()}>
                  <FilePlus2 />
                  创建第一份演示文稿
                </button>
              </section>
            ) : (
              <section className="project-gallery" aria-label="最近编辑的演示文稿">
                <div className="project-gallery-heading">
                  <div>
                    <h2>最近编辑</h2>
                    <p>上一次编辑的项目已排在最前面</p>
                  </div>
                  <span>{projectHomeItems.length} 个项目</span>
                </div>
                <div className="project-card-grid">
                  {projectHomeItems.map((item, index) => {
                    if (item.kind === "ai") {
                      const entry = item.entry;
                      const isGenerating = designBusy && generatingHistoryId === entry.id;
                      return (
                        <article key={`ai:${entry.id}`} className={`project-card ai ${index === 0 ? "featured" : ""}`}>
                          <button
                            type="button"
                            className="project-card-open"
                            title={entry.topic}
                            disabled={designBusy && !entry.presentation}
                            onClick={() => void openAiPresentation(entry)}
                          >
                            <span className="project-card-preview ai" aria-hidden="true">
                              <span className="project-card-preview-brand">
                                <Sparkles />
                                {entry.presentation ? "AI PPT" : isGenerating ? "生成中" : "待生成"}
                              </span>
                              <strong>{entry.draft.title}</strong>
                              <small>{entry.slideCount} 页演示文稿</small>
                            </span>
                            <span className="project-card-copy">
                              <span className="project-card-title-row">
                                <strong>{entry.draft.title}</strong>
                                <em>
                                  {entry.presentation
                                    ? index === 0
                                      ? "上次编辑"
                                      : "PPT"
                                    : isGenerating
                                      ? `${designProgress.percent}%`
                                      : "待生成"}
                                </em>
                              </span>
                              <span>{entry.topic}</span>
                              <small>
                                {entry.slideCount} 页 · 最后编辑
                                {new Date(entry.updatedAt).toLocaleString("zh-CN", {
                                  month: "numeric",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </small>
                            </span>
                          </button>
                        </article>
                      );
                    }
                    const entry = item.entry;
                    return (
                      <article key={entry.path} className={`project-card ${index === 0 ? "featured" : ""}`}>
                        <button
                          type="button"
                          className="project-card-open"
                          disabled={entry.missing}
                          title={entry.path}
                          onClick={() => void handleOpenRecent(entry)}
                        >
                          <span className="project-card-preview" aria-hidden="true">
                            <span>{entry.title.slice(0, 1).toUpperCase()}</span>
                          </span>
                          <span className="project-card-copy">
                            <span className="project-card-title-row">
                              <strong>{entry.title}</strong>
                              {index === 0 && !entry.missing && <em>上次编辑</em>}
                            </span>
                            <span>{entry.missing ? "文件已移动或删除" : entry.path}</span>
                            <small>
                              {entry.missing
                                ? "请移除此记录后重新打开文件"
                                : `最后打开 ${new Date(entry.lastOpenedAt).toLocaleString("zh-CN", {
                                    month: "numeric",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}`}
                            </small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="project-card-remove"
                          aria-label={`从首页移除 ${entry.title}`}
                          title="仅移除记录，不删除项目文件"
                          onClick={() => {
                            void removeRecentProject(entry.path)
                              .then(setRecentProjects)
                              .catch((error: unknown) =>
                                setTaskStatus(`移除失败：${error instanceof Error ? error.message : String(error)}`),
                              );
                          }}
                        >
                          <Trash2 />
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </main>
      )}

      {editorCanvasOpen && (
        <>
          <aside className="left-panel">
            <div className="panel-heading">
              <div className="panel-tabs" role="tablist" aria-label="左侧面板">
                <button
                  type="button"
                  role="tab"
                  aria-selected={leftTab === "slides"}
                  className={`panel-tab ${leftTab === "slides" ? "active" : ""}`}
                  onClick={() => setLeftTab("slides")}
                >
                  页面
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={leftTab === "layers"}
                  className={`panel-tab ${leftTab === "layers" ? "active" : ""}`}
                  onClick={() => setLeftTab("layers")}
                >
                  图层
                </button>
              </div>
              {leftTab === "slides" && (
                <button aria-label="新增页面" title="新增页面" onClick={() => execute({ type: "add-slide" })}>
                  <Plus size={16} />
                </button>
              )}
            </div>
            {leftTab === "slides" ? (
              <div className="slide-list">
                {document.slides.map((slide, index) => (
                  <div key={slide.id} className={`thumbnail-row ${slide.id === activeSlide.id ? "active" : ""}`}>
                    <button className="thumbnail-select" onClick={() => selectSlide(slide.id)}>
                      <span>{index + 1}</span>
                      <SlideThumbnail
                        slide={slide}
                        pageWidth={document.pageSize.width}
                        pageHeight={document.pageSize.height}
                      />
                    </button>
                    {slide.id === activeSlide.id && (
                      <div className="thumbnail-actions">
                        <button
                          aria-label="上移页面"
                          title="上移页面"
                          disabled={index === 0}
                          onClick={() => execute({ type: "move-slide", slideId: slide.id, toIndex: index - 1 })}
                        >
                          <ArrowUp />
                        </button>
                        <button
                          aria-label="下移页面"
                          title="下移页面"
                          disabled={index === document.slides.length - 1}
                          onClick={() => execute({ type: "move-slide", slideId: slide.id, toIndex: index + 1 })}
                        >
                          <ArrowDown />
                        </button>
                        <button
                          aria-label="复制页面"
                          title="复制页面"
                          onClick={() => execute({ type: "duplicate-slide", slideId: slide.id })}
                        >
                          <Copy />
                        </button>
                        <button
                          aria-label="删除页面"
                          title="删除页面"
                          disabled={document.slides.length === 1}
                          onClick={() => execute({ type: "delete-slide", slideId: slide.id })}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <LayerList
                slide={activeSlide}
                selectedElementIds={selectedElementIds}
                onSelect={selectElement}
                onToggle={toggleElement}
              />
            )}
          </aside>

          <main className="workspace" ref={workspaceRef}>
            <div className="canvas-ruler">13.33 × 7.5 in</div>
            <div
              className={`slide-canvas${formatPainterStyle ? " format-painter-active" : ""}`}
              style={{ width: CANVAS_WIDTH * zoom, height: canvasHeight, background: activeSlide.background }}
              onPointerDown={marquee.onPointerDown}
            >
              <CanvasGridLayer scale={scale} />
              {activeSlide.elements.map((element) => (
                <ElementView
                  key={element.id}
                  element={element}
                  slide={activeSlide}
                  scale={scale}
                  selected={selectedElementIds.includes(element.id)}
                  snap={snapContext}
                  previewAnimation={animationPreviews.find((animation) => animation.elementId === element.id)}
                />
              ))}
              <CanvasGuideLayer
                slideId={activeSlide.id}
                pageWidth={document.pageSize.width}
                pageHeight={document.pageSize.height}
                scale={scale}
              />
              {marquee.band && (
                <div
                  className="canvas-marquee"
                  aria-hidden="true"
                  style={{
                    left: marquee.band.x * scale,
                    top: marquee.band.y * scale,
                    width: marquee.band.width * scale,
                    height: marquee.band.height * scale,
                  }}
                />
              )}
            </div>
          </main>

          <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整属性面板宽度"
            onPointerDown={startInspectorResize}
          />

          {editorRibbonTab === "animation" ? (
            <aside className="right-panel animation-pane" aria-label="动画窗格">
              <div className="inspector-title">
                <span>动画窗格</span>
                <strong>{activeSlide.animations?.length ?? 0}</strong>
              </div>
              <div className="animation-pane-body">
                {(activeSlide.animations?.length ?? 0) === 0 ? (
                  <div className="animation-pane-empty">
                    <Sparkles />
                    <strong>本页还没有动画</strong>
                    <p>选择画布对象，然后在上方添加出现、淡化或飞入效果。</p>
                  </div>
                ) : (
                  <ol className="animation-sequence-list">
                    {activeSlide.animations!.map((animation, index) => {
                      const target = activeSlide.elements.find((element) => element.id === animation.elementId);
                      const targetName =
                        target?.type === "text"
                          ? target.text.trim().slice(0, 18) || "文本框"
                          : target?.type === "image"
                            ? "图片"
                            : target?.type === "chart"
                              ? "图表"
                              : target?.type === "table"
                                ? "表格"
                                : target?.type === "line"
                                  ? "线条"
                                  : target?.type === "icon"
                                    ? "图标"
                                    : "形状";
                      const effectName =
                        animation.effect === "appear" ? "出现" : animation.effect === "fade" ? "淡化" : "飞入";
                      const startName =
                        animation.start === "on-click"
                          ? "单击时"
                          : animation.start === "with-previous"
                            ? "与上一动画同时"
                            : "上一动画之后";
                      return (
                        <li key={animation.id}>
                          <button
                            type="button"
                            className={`${selectedAnimation?.id === animation.id ? "active" : ""} ${animationPreviews.some((item) => item.id === animation.id) ? "playing" : ""}`}
                            onClick={() => {
                              setSelectedAnimationId(animation.id);
                              selectElement(animation.elementId);
                            }}
                          >
                            <span className="animation-order-badge">{index + 1}</span>
                            <span className="animation-sequence-copy">
                              <strong>
                                {effectName} · {targetName}
                              </strong>
                              <small>
                                {startName} · {(animation.durationMs / 1000).toFixed(1)} 秒
                                {animation.delayMs ? ` · 延迟 ${(animation.delayMs / 1000).toFixed(1)} 秒` : ""}
                              </small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
              <div className="animation-pane-footer">
                <div className="animation-preview-actions">
                  <button type="button" disabled={!selectedAnimation} onClick={previewSelectedAnimation}>
                    预览所选
                  </button>
                  <button type="button" disabled={!activeSlide.animations?.length} onClick={previewSlideAnimations}>
                    播放全部
                  </button>
                  <button type="button" disabled={!animationPreviews.length} onClick={stopAnimationPreview}>
                    停止
                  </button>
                </div>
                <button
                  type="button"
                  className="danger"
                  disabled={!activeSlide.animations?.length}
                  onClick={() => execute({ type: "clear-slide-animations", slideId: activeSlide.id })}
                >
                  清除本页动画
                </button>
              </div>
            </aside>
          ) : (
            <InspectorPanel />
          )}
        </>
      )}

      {activeView === "ai" && (
        <main className="feature-workspace ai-workspace">
          <header className="feature-header">
            <div>
              {aiDraft && (
                <button
                  type="button"
                  className="header-back-button"
                  aria-label="返回初始页面"
                  title="返回初始页面"
                  onClick={returnToAiStart}
                >
                  <ArrowLeft />
                </button>
              )}
              <Sparkles />
              <div>
                <h1>AI 内容工作台</h1>
                <p>生成并审核内容，确认后再套用 PPT 模板</p>
              </div>
            </div>
            <div className="feature-header-actions">
              <div className="workflow-steps" aria-label="制作流程">
                <span className={!aiDraft ? "active" : "done"} aria-current={!aiDraft ? "step" : undefined}>
                  {aiDraft ? <Check /> : "1"} 生成草稿
                </span>
                <i />
                <span className={aiDraft ? "active" : ""} aria-current={aiDraft ? "step" : undefined}>
                  2 编辑文字
                </span>
                <i />
                <span>3 上传模板</span>
              </div>
              <span className="agent-workflow-status" aria-live="polite">
                {agentWorkflow.label}
              </span>
              {aiDraft && (
                <div className="draft-header-actions">
                  {aiDraftBlockingIssues.length > 0 && (
                    <span className="draft-blocked-hint">
                      <CircleAlert />
                      {aiDraftBlockHint}
                    </span>
                  )}
                  <button
                    type="button"
                    className="secondary-action draft-regenerate-action"
                    title="用同一个主题重新生成整份草稿；生成期间当前内容不变，完成后可用撤销回到上一版"
                    onClick={() => void handleRegenerateDraft()}
                  >
                    {aiRegenerating ? <X /> : <RotateCcw />}
                    {aiRegenerating ? "取消重新生成" : "重新生成草稿"}
                  </button>
                  <button
                    className="primary-action"
                    title={aiRegenerating ? "正在重新生成整份草稿，完成后再确认内容" : aiDraftBlockReason}
                    disabled={Boolean(aiDraftBlockReason) || aiRegenerating}
                    onClick={continueToTheme}
                  >
                    确认内容，选择 PPT 模板
                    <ArrowRight />
                  </button>
                </div>
              )}
            </div>
          </header>
          {!aiDraft ? (
            <div className="ai-split">
              <aside className="ai-history">
                <div className="ai-history-heading">
                  <strong>制作历史</strong>
                  <span>{aiHistory.length} 个草稿</span>
                </div>
                {aiHistory.length === 0 ? (
                  <p className="ai-history-empty">还没有草稿</p>
                ) : (
                  aiHistory.map((entry) => (
                    <button type="button" key={entry.id} onClick={() => openAiHistory(entry)}>
                      <Sparkles />
                      <div>
                        <strong>{entry.draft.title}</strong>
                        <span>
                          {entry.draft.slides.length} 页 ·{" "}
                          {new Date(entry.updatedAt).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <p>{entry.topic}</p>
                      </div>
                    </button>
                  ))
                )}
              </aside>
              <div className="feature-scroll ai-plan-pane">
                <div className="ai-compose-card">
                  <div className="section-kicker">AI 内容规划</div>
                  <h2>你想制作什么演示文稿？</h2>
                  <p>描述主题、受众、场景和重点，AI 将生成演示简报、逐页计划和可编辑的结构化内容。</p>
                  <label>
                    <span className="topic-field-heading">
                      <span>主题与要求</span>
                      <button
                        type="button"
                        className="link-action topic-polish-action"
                        disabled={!aiTopic.trim() || aiPolishing || aiBusy}
                        onClick={() => void handlePolishAiTopic()}
                      >
                        <Wand2 />
                        {aiPolishing ? "润色中…" : "AI 润色"}
                      </button>
                    </span>
                    <textarea
                      value={aiTopic}
                      onChange={(event) => setAiTopic(event.target.value)}
                      placeholder="例如：为管理层制作一份产品战略汇报，突出增长机会和下一季度行动"
                    />
                  </label>
                  <label className="slide-count-field">
                    页数
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={aiSlideCount}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAiSlideCount(value === "" ? "" : Math.max(1, Math.trunc(Number(value)) || 1));
                      }}
                      onBlur={() => {
                        if (aiSlideCount === "") setAiSlideCount(1);
                      }}
                    />
                  </label>
                  <button
                    className="primary-action"
                    disabled={!aiTopic.trim() || aiPolishing || aiSlideCount === ""}
                    onClick={handleAiGenerate}
                  >
                    {aiBusy ? "取消生成" : "生成 PPT 草稿"}
                    <ArrowRight />
                  </button>
                  {aiBusy && aiProgress && (
                    <div className="ai-generation-progress" role="status" aria-live="polite">
                      <strong>{aiGenerationLabel}</strong>
                      <div
                        className="design-progress-track"
                        aria-label="AI 生成进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={aiGenerationPercent}
                        role="progressbar"
                      >
                        <i style={{ width: `${aiGenerationPercent}%` }} />
                      </div>
                      <span>生成中可随时点击“取消生成”停止本次任务</span>
                    </div>
                  )}
                  <small>生成结果通过结构化 Schema 校验，应用前不会修改当前文稿。</small>
                </div>
              </div>
            </div>
          ) : (
            <div className="feature-scroll draft-mode">
              <ContentReview
                draft={aiDraft}
                originalDraft={aiOriginalDraft.current}
                activeIndex={activeDraftSlideIndex}
                saveState={aiSaveState}
                restoreUndoSlideIds={aiRestoreUndoSlideIds}
                canUndo={aiContentUndo.current.length > 0}
                canRedo={aiContentRedo.current.length > 0}
                regenerating={aiRegenerating}
                regenerateProgress={aiProgress ? { label: aiGenerationLabel, percent: aiGenerationPercent } : undefined}
                onActiveIndexChange={selectAiDraftSlide}
                onDraftTitleChange={updateAiDraftTitle}
                onSlideFieldChange={updateAiSlide}
                onSlideVisualAssetChange={updateAiVisualAsset}
                onSlideBlocksChange={updateAiBlocks}
                onSlideReviewedChange={updateAiSlideReviewed}
                onReviewAllSlides={reviewAllAiSlides}
                onAddSlide={addAiSlide}
                onDuplicateSlide={duplicateAiSlide}
                onDeleteSlide={deleteAiSlide}
                onMoveSlide={moveAiSlide}
                onRestoreSlide={restoreAiSlide}
                onUndoRestore={undoRestoreAiSlide}
                onUndo={undoAiContent}
                onRedo={redoAiContent}
              />
            </div>
          )}
        </main>
      )}

      {activeView === "theme" && (
        <main className="feature-workspace theme-workspace">
          <header className="feature-header">
            <div>
              <Palette />
              <div>
                <h1>主题模板</h1>
                <p>选择内置主题，或从已有 PPT 中抽取配色、字体、母版和版式</p>
              </div>
            </div>
            <div className="feature-header-actions">
              <div className="workflow-steps">
                <span className="done">
                  <Check /> 生成草稿
                </span>
                <i />
                <span className="done">
                  <Check /> 编辑文字
                </span>
                <i />
                <span className="active">3 选择主题</span>
              </div>
              <span className="agent-workflow-status" aria-live="polite">
                {agentWorkflow.label}
              </span>
              <button
                type="button"
                className="primary-action header-upload-button"
                onClick={() => setTemplateUploadOpen(true)}
              >
                <FileUp />从 PPT 抽取主题
              </button>
            </div>
          </header>
          <div className="feature-scroll">
            <section className="template-content">
              <div className="theme-gallery-heading">
                <div>
                  <strong>内置主题</strong>
                  <span>{THEME_PRESETS.length} 套可用</span>
                </div>
                <p>点击卡片查看完整配色、字体和适用场景</p>
              </div>
              <ThemePresetPicker value={themePresetId} onChange={handleSelectThemePreset} disabled={designBusy} />
              <div className="theme-gallery-heading extracted">
                <div>
                  <strong>从 PPT 抽取的主题</strong>
                  <span>{templateLibrary.length} 套</span>
                </div>
                <p>保留来源文件的设计语言，并展示可解析范围</p>
              </div>
              <div className="theme-card-grid extracted-theme-grid">
                {templateLibrary.map((template) => (
                  <button
                    type="button"
                    className={`theme-card extracted${selectedTemplate?.id === template.id ? " active" : ""}`}
                    key={template.id}
                    onClick={() => void handleSelectTemplate(template)}
                  >
                    <span className="theme-card-art extracted-art">
                      <FileUp />
                      <i />
                      <i />
                    </span>
                    <strong>{template.name}</strong>
                    <small>从 PPTX 抽取的主题、母版与版式</small>
                    <span className="theme-card-fonts">
                      {(template.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                      {new Date(template.importedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="theme-card theme-upload-card"
                  onClick={() => setTemplateUploadOpen(true)}
                >
                  <span className="theme-card-art upload-art">
                    <FileUp />
                  </span>
                  <strong>从 PPT 抽取主题</strong>
                  <small>上传 PPTX，提取主题色、字体、母版和页面版式</small>
                  <span className="theme-card-fonts">支持 .pptx · 最大 512 MB</span>
                </button>
              </div>
            </section>
          </div>
        </main>
      )}

      {activeView === "theme" && themeDrawerOpen && (selectedThemePreset || selectedTemplate) && (
        <div
          className="theme-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setThemeDrawerOpen(false);
          }}
        >
          <aside className="theme-drawer" role="dialog" aria-modal="true" aria-labelledby="theme-drawer-title">
            <div className="theme-drawer-heading">
              <div>
                <span>{selectedThemePreset ? "内置主题" : "PPT 抽取主题"}</span>
                <h2 id="theme-drawer-title">{selectedThemePreset?.name ?? selectedTemplate?.name}</h2>
              </div>
              <button type="button" aria-label="关闭主题详情" onClick={() => setThemeDrawerOpen(false)}>
                <X />
              </button>
            </div>
            <div className="theme-drawer-scroll">
              {selectedThemePreset ? (
                <>
                  <div
                    className="theme-preset-preview"
                    style={
                      {
                        "--theme-primary": selectedThemePreset.theme.colors.find((color) => color.name === "primary")
                          ?.value,
                        "--theme-accent": selectedThemePreset.theme.colors.find((color) => color.name === "accent")
                          ?.value,
                        "--theme-muted": selectedThemePreset.theme.colors.find((color) => color.name === "muted")
                          ?.value,
                        "--theme-surface": selectedThemePreset.theme.colors.find((color) => color.name === "surface")
                          ?.value,
                        "--theme-major-font": selectedThemePreset.theme.majorFont,
                        "--theme-minor-font": selectedThemePreset.theme.minorFont,
                      } as React.CSSProperties
                    }
                  >
                    <span className="theme-preview-kicker">PPTD · THEME SYSTEM</span>
                    <div>
                      <h2>{selectedThemePreset.name}</h2>
                      <p>让内容层级、字体与色彩保持一致</p>
                    </div>
                    <div className="theme-preview-bars">
                      <i />
                      <i />
                      <i />
                    </div>
                    <small>{selectedThemePreset.description}</small>
                  </div>
                  <section className="theme-drawer-section">
                    <h3>主题说明</h3>
                    <p>{selectedThemePreset.description}</p>
                    <p>{selectedThemeGuidance?.character}</p>
                  </section>
                  <section className="theme-drawer-section theme-guidance-grid">
                    <div>
                      <h3>适用场景</h3>
                      <div className="theme-scenario-tags">
                        {selectedThemeGuidance?.scenarios.map((scenario) => (
                          <span key={scenario}>{scenario}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>页面节奏</h3>
                      <p>{selectedThemeGuidance?.pageRhythm}</p>
                    </div>
                    <div>
                      <h3>图片建议</h3>
                      <p>{selectedThemeGuidance?.imageStyle}</p>
                    </div>
                    {selectedThemeMetadata && (
                      <div>
                        <h3>设计约束</h3>
                        <p>
                          密度 {selectedThemeMetadata.density}；推荐页面：
                          {selectedThemeMetadata.recommendedPageTypes.join("、")}
                        </p>
                        <p>避免：{selectedThemeMetadata.forbiddenCombinations.join("；")}</p>
                      </div>
                    )}
                  </section>
                  <section className="theme-drawer-section theme-token-details">
                    <h3>设计令牌</h3>
                    <dl>
                      <div>
                        <dt>标题字体</dt>
                        <dd>{selectedThemePreset.theme.majorFont}</dd>
                      </div>
                      <div>
                        <dt>正文字体</dt>
                        <dd>{selectedThemePreset.theme.minorFont}</dd>
                      </div>
                      <div>
                        <dt>封面字号</dt>
                        <dd>{selectedThemePreset.theme.textStyles?.display?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>页标题字号</dt>
                        <dd>{selectedThemePreset.theme.textStyles?.title?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>正文字号</dt>
                        <dd>{selectedThemePreset.theme.textStyles?.body?.fontSizePt ?? "—"} pt</dd>
                      </div>
                    </dl>
                    <div className="theme-color-spec" aria-label="主题色">
                      {selectedThemePreset.theme.colors.map((color) => (
                        <div key={color.name} title={`${color.name} ${color.value}`}>
                          <span style={{ backgroundColor: color.value }} />
                          <small>{color.name}</small>
                          <code>{color.value}</code>
                        </div>
                      ))}
                    </div>
                    {selectedThemeMetadata && (
                      <dl>
                        <div>
                          <dt>中文回退</dt>
                          <dd>{selectedThemeMetadata.fontFallbacks.eastAsian.join(" → ")}</dd>
                        </div>
                        <div>
                          <dt>西文回退</dt>
                          <dd>{selectedThemeMetadata.fontFallbacks.latin.join(" → ")}</dd>
                        </div>
                        <div>
                          <dt>图表色板</dt>
                          <dd>{selectedThemeMetadata.chartPalette.join("、")}</dd>
                        </div>
                      </dl>
                    )}
                  </section>
                  <section className="theme-drawer-section theme-ai-prompt">
                    <div className="theme-ai-prompt-heading">
                      <div>
                        <h3>AI 主题提示词</h3>
                        <p>可复制给设计 AI，约束字体、色板、页面节奏与内容边界。</p>
                      </div>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => {
                          if (!selectedThemeAiPrompt) return;
                          void navigator.clipboard.writeText(selectedThemeAiPrompt).then(
                            () => setTaskStatus(`已复制「${selectedThemePreset.name}」AI 主题提示词`),
                            () => setTaskStatus("复制失败，请手动选择提示词"),
                          );
                        }}
                      >
                        <Copy />
                        复制提示词
                      </button>
                    </div>
                    <pre>{selectedThemeAiPrompt}</pre>
                  </section>
                </>
              ) : (
                <>
                  <div className="template-preview-stage drawer-preview">
                    {templatePreviewBusy ? (
                      <span>正在解析 PPT 主题…</span>
                    ) : templatePreview ? (
                      <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} />
                    ) : (
                      <span>此 PPTX 没有内嵌封面预览</span>
                    )}
                  </div>
                  {templateAnalysis && (
                    <div className="template-analysis drawer-analysis">
                      <div className="template-analysis-grid">
                        <span>
                          <b>{templateAnalysis.slideCount}</b>页面
                        </span>
                        <span>
                          <b>{templateAnalysis.masterCount}</b>母版
                        </span>
                        <span>
                          <b>{templateAnalysis.layoutCount}</b>版式
                        </span>
                        <span>
                          <b>{templateAnalysis.themeCount}</b>主题
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>页面尺寸</dt>
                          <dd>
                            {templateAnalysis.slideWidthEmu && templateAnalysis.slideHeightEmu
                              ? `${(templateAnalysis.slideWidthEmu / EMU_PER_INCH).toFixed(2)} × ${(templateAnalysis.slideHeightEmu / EMU_PER_INCH).toFixed(2)} in`
                              : "未定义"}
                          </dd>
                        </div>
                        <div>
                          <dt>标题字体</dt>
                          <dd>{templateAnalysis.majorFont || "未定义"}</dd>
                        </div>
                        <div>
                          <dt>正文字体</dt>
                          <dd>{templateAnalysis.minorFont || "未定义"}</dd>
                        </div>
                      </dl>
                      {templateAnalysis.themeColors.length > 0 && (
                        <div className="template-color-row" aria-label="主题色">
                          {templateAnalysis.themeColors.map((color) => (
                            <span
                              key={color.name}
                              title={`${color.name} ${color.value}`}
                              style={{ backgroundColor: color.value }}
                            />
                          ))}
                        </div>
                      )}
                      {templateAnalysis.warnings.length > 0 && (
                        <div className="template-analysis-warning">{templateAnalysis.warnings.join("；")}</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="theme-drawer-actions">
              <button type="button" className="secondary-action" onClick={() => setThemeDrawerOpen(false)}>
                关闭
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setThemeDrawerOpen(false);
                  setTaskStatus(`已选择主题：${selectedThemePreset?.name ?? selectedTemplate?.name}`);
                }}
              >
                <Check />
                使用此主题
              </button>
            </div>
          </aside>
        </div>
      )}

      {activeView === "settings" && (
        <main className="feature-workspace settings-workspace">
          <header className="feature-header">
            <div>
              <Settings />
              <div>
                <h1>设置</h1>
                <p>管理模型连接、安全凭据和 PPTD 应用外观</p>
              </div>
            </div>
          </header>
          <div className="feature-scroll">
            <SettingsWorkspace onMessage={setTaskStatus} />
          </div>
        </main>
      )}

      {aiImageOpen && (
        <AiImageDialog
          busy={aiImageBusy}
          error={aiImageError}
          onClose={() => setAiImageOpen(false)}
          onGenerate={(prompt, role) => void handleAiImageGenerate(prompt, role)}
        />
      )}

      {iconPickerOpen && (
        <IconPicker
          onClose={() => setIconPickerOpen(false)}
          onPick={(name: BuiltinIconName) => {
            execute({ type: "add-icon", slideId: activeSlide.id, name });
            setIconPickerOpen(false);
          }}
        />
      )}

      {recentProjectsOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRecentProjectsOpen(false);
          }}
        >
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="recent-projects-title">
            <div className="upload-dialog-heading">
              <div>
                <FolderClock />
                <div>
                  <h2 id="recent-projects-title">最近项目</h2>
                  <p>项目文件仍保存在原位置；这里仅保存最近访问记录。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭最近项目" onClick={() => setRecentProjectsOpen(false)}>
                <X />
              </button>
            </div>
            {recentProjects.length === 0 ? (
              <div className="template-empty">还没有保存或打开过项目</div>
            ) : (
              <div className="ai-history">
                {recentProjects.map((entry) => (
                  <div key={entry.path} className="recent-project-row">
                    <button
                      type="button"
                      className="recent-project-open"
                      disabled={entry.missing}
                      title={entry.path}
                      onClick={() => void handleOpenRecent(entry)}
                    >
                      <FolderClock />
                      <div>
                        <strong>{entry.title}</strong>
                        <span>{entry.missing ? "文件已移动或删除" : entry.path}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="recent-project-remove"
                      aria-label={`从最近项目移除 ${entry.title}`}
                      title="仅从最近项目移除，不删除文件"
                      onClick={() => {
                        void removeRecentProject(entry.path)
                          .then(setRecentProjects)
                          .catch((error: unknown) =>
                            setTaskStatus(`移除失败：${error instanceof Error ? error.message : String(error)}`),
                          );
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {templateUploadOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTemplateUploadOpen(false);
          }}
        >
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-template-title">
            <div className="upload-dialog-heading">
              <div>
                <FileUp />
                <div>
                  <h2 id="upload-template-title">从 PPT 抽取主题</h2>
                  <p>PPTD 将解析主题色、字体、母版和版式，并保存为可复用主题。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭上传窗口" onClick={() => setTemplateUploadOpen(false)}>
                <X />
              </button>
            </div>
            <button type="button" className="template-dropzone" onClick={() => void handleChooseTemplate()}>
              <FileUp />
              <strong>选择 PPTX 文件</strong>
              <span>从电脑中选择一份设计风格参考</span>
              <small>支持 .pptx，最大 512 MB</small>
            </button>
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setTemplateUploadOpen(false)}>
                取消
              </button>
            </div>
          </section>
        </div>
      )}

      {templatePickerOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (!designBusy && event.target === event.currentTarget) setTemplatePickerOpen(false);
          }}
        >
          <section
            className="upload-dialog template-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-picker-title"
            aria-busy={designBusy}
          >
            <div className="upload-dialog-heading">
              <div>
                <Palette />
                <div>
                  <h2 id="template-picker-title">选择主题模板</h2>
                  <p>使用内置主题，或从已有 PPT 抽取设计语言，AI 不会改动已确认内容。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭模板选择窗口" onClick={() => setTemplatePickerOpen(false)}>
                <X />
              </button>
            </div>
            <div className="template-picker-toolbar">
              <strong>主题来源</strong>
              <span>
                {themePresetId
                  ? `内置 · ${findThemePreset(themePresetId)?.name ?? "主题"}${themePresetId === recommendedThemePreset.id ? "（内容匹配）" : ""}`
                  : "已上传 PPT"}
              </span>
            </div>
            <div className="template-picker-body">
              <div className="template-picker-sources">
                <section>
                  <div className="template-picker-section-heading">
                    <strong>内置主题</strong>
                    <span>{THEME_PRESETS.length} 套</span>
                  </div>
                  <div className="template-picker-preset-list">
                    {THEME_PRESETS.map((preset) => {
                      const color = (slot: string) => preset.theme.colors.find((item) => item.name === slot)?.value;
                      return (
                        <button
                          type="button"
                          disabled={designBusy}
                          className={`template-picker-preset${themePresetId === preset.id ? " active" : ""}`}
                          key={preset.id}
                          onClick={() => handleSelectThemePreset(preset.id, false)}
                          style={{ "--preset-accent": color("accent") } as React.CSSProperties}
                        >
                          <span className="template-picker-preset-colors" aria-hidden>
                            {["surface", "accent", "accent2", "accent3"].map((slot) => (
                              <i key={slot} style={{ background: color(slot) }} />
                            ))}
                          </span>
                          <span>
                            <strong>{preset.name}</strong>
                            <small>{preset.description}</small>
                          </span>
                          {preset.id === recommendedThemePreset.id && <em>内容匹配</em>}
                          {themePresetId === preset.id && <Check />}
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section>
                  <div className="template-picker-section-heading">
                    <strong>从 PPT 抽取</strong>
                    <span>{templateLibrary.length} 套</span>
                  </div>
                  <div className="template-picker-upload-list">
                    {templateLibrary.map((template) => (
                      <button
                        type="button"
                        disabled={designBusy}
                        className={`template-card${selectedTemplate?.id === template.id ? " active" : ""}`}
                        key={template.id}
                        onClick={() => void handleSelectTemplate(template, false)}
                      >
                        <FileUp />
                        <span>
                          <strong>{template.name}</strong>
                          <small>
                            {(template.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                            {new Date(template.importedAt).toLocaleString("zh-CN")}
                          </small>
                        </span>
                        {selectedTemplate?.id === template.id && <Check />}
                      </button>
                    ))}
                    {templateLibrary.length === 0 && <div className="template-empty">尚未抽取 PPT 主题</div>}
                  </div>
                </section>
              </div>
              <div className="template-preview-panel">
                <div
                  className={`template-preview-stage ${designBusy ? "generating" : ""}${themePresetId ? " preset-selected" : ""}`}
                >
                  {designBusy ? (
                    <div className="design-progress" role="status" aria-live="polite">
                      <Sparkles />
                      <strong>{designProgress.label}</strong>
                      <span>{designProgress.percent}%</span>
                      <div
                        className="design-progress-track"
                        aria-label="AI 生成进度"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={designProgress.percent}
                        role="progressbar"
                      >
                        <i style={{ width: `${designProgress.percent}%` }} />
                      </div>
                      <small>AI 生成阶段为估算进度，校验与渲染阶段按实际节点更新</small>
                      <small>任务已在后台执行，可以关闭此窗口并继续编辑。</small>
                    </div>
                  ) : themePresetId ? (
                    <div
                      className="theme-preset-preview picker-preset-preview"
                      style={
                        {
                          "--theme-primary": pickerThemePreset.theme.colors.find((color) => color.name === "primary")
                            ?.value,
                          "--theme-accent": pickerThemePreset.theme.colors.find((color) => color.name === "accent")
                            ?.value,
                          "--theme-muted": pickerThemePreset.theme.colors.find((color) => color.name === "muted")
                            ?.value,
                          "--theme-surface": pickerThemePreset.theme.colors.find((color) => color.name === "surface")
                            ?.value,
                          "--theme-major-font": pickerThemePreset.theme.majorFont,
                          "--theme-minor-font": pickerThemePreset.theme.minorFont,
                        } as React.CSSProperties
                      }
                    >
                      <span className="theme-preview-kicker">PPTD · {pickerThemePreset.name}</span>
                      <div>
                        <h2>{aiDraft?.title ?? pickerThemePreset.name}</h2>
                        <p>{pickerThemeGuidance.character}</p>
                      </div>
                      <div className="theme-preview-bars">
                        <i />
                        <i />
                        <i />
                      </div>
                      <small>{pickerThemeGuidance.pageRhythm}</small>
                    </div>
                  ) : templatePreviewBusy ? (
                    <span>正在解析模板…</span>
                  ) : templatePreview ? (
                    <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} />
                  ) : selectedTemplate ? (
                    <span>此 PPTX 没有内嵌封面预览</span>
                  ) : (
                    <span>选择左侧模板后查看预览</span>
                  )}
                </div>
                {themePresetId ? (
                  <div className="picker-theme-details">
                    <div className="theme-scenario-tags">
                      {pickerThemeGuidance.scenarios.map((scenario) => (
                        <span key={scenario}>{scenario}</span>
                      ))}
                    </div>
                    <p>
                      <strong>图片建议：</strong>
                      {pickerThemeGuidance.imageStyle}
                    </p>
                    <p>
                      <strong>AI 设计：</strong>将使用该主题的 7 色色板、字体层级和页面节奏，且不会改动已审核内容。
                    </p>
                  </div>
                ) : (
                  templateAnalysis && (
                    <div className="template-picker-summary">
                      <span>{templateAnalysis.slideCount} 页面</span>
                      <span>{templateAnalysis.layoutCount} 版式</span>
                      <span>{templateAnalysis.themeCount} 主题</span>
                    </div>
                  )
                )}
              </div>
            </div>
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setTemplatePickerOpen(false)}>
                {designBusy ? "转至后台" : "取消"}
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={
                  (!themePresetId && (!selectedTemplate || !templateAnalysis)) || templatePreviewBusy || designBusy
                }
                onClick={() => void generateFromDraft(themePresetId ? "preset" : "template")}
              >
                {designBusy
                  ? `${designProgress.percent}%`
                  : `使用${themePresetId ? `「${pickerThemePreset.name}」` : "抽取主题"}生成 PPT`}
                {!designBusy && <ArrowRight />}
              </button>
            </div>
          </section>
        </div>
      )}

      {designQualityReport && designQualityReportOpen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDesignQualityReportOpen(false);
          }}
        >
          <section
            className="upload-dialog export-report-dialog design-quality-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-quality-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <CircleAlert />
                <div>
                  <h2 id="design-quality-title">设计质检报告</h2>
                  <p>{designQualityReport.templateName} · PPT 已生成并写入当前项目，以下问题不会阻止继续编辑或导出。</p>
                  {designQualityReport.concept && (
                    <p>
                      设计方向：{designQualityReport.concept.name} · {designQualityReport.concept.idea}
                    </p>
                  )}
                </div>
              </div>
              <button type="button" aria-label="关闭设计质检报告" onClick={() => setDesignQualityReportOpen(false)}>
                <X />
              </button>
            </div>
            {designQualityReport.visualReviewCoverage &&
              designQualityReport.visualReviewCoverage.reviewed < designQualityReport.visualReviewCoverage.total && (
                <p className="design-quality-warning">
                  视觉评审未覆盖全部页面，下面的评分和建议只代表已评审页；未评审页不能视为通过。
                </p>
              )}
            <div className="design-review-toolbar" aria-label="视觉复检范围">
              <span>
                上次评审：{new Date(designQualityReport.reviewedAt).toLocaleString("zh-CN")} ·{" "}
                {designQualityReport.reviewSource ?? "来源未记录"}
              </span>
              <div>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("current")}>
                  复检当前页
                </button>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("changed")}>
                  复检变化页
                </button>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("issues")}>
                  复检问题页
                </button>
                <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("all")}>
                  复检整册
                </button>
                {manualReviewBusy && (
                  <button type="button" className="danger" onClick={cancelManualReview}>
                    停止复检
                  </button>
                )}
              </div>
              {manualReviewBusy && <small>正在导出真实 PPTX、检查指定页面并刷新整册总览…</small>}
              {!manualReviewBusy && qualityStaleIndexes.length > 0 && (
                <small className="warning">
                  上次评审后有 {qualityStaleIndexes.length} 页发生变化，建议复检变化页。
                </small>
              )}
            </div>
            {designQualityReport.issues.length === 0 ? (
              <div className="template-empty">
                {designQualityReport.visualReview
                  ? "确定性质量门没有列出问题，视觉评审结论见下方。"
                  : "质量门没有给出具体问题，但检查未完成。"}
              </div>
            ) : (
              <ul className="export-report-list">
                {designQualityReport.issues.map((issue, index) => (
                  <li key={`${issue.issue}-${issue.slideIndex}-${index}`} className="error">
                    <CircleAlert />
                    <div>
                      <strong>
                        第 {issue.slideIndex + 1} 页 · {issue.message}
                      </strong>
                      {issue.elementIds.length > 0 && <p>{issue.elementIds.length} 个对象需要调整</p>}
                      <button
                        type="button"
                        className="quality-target-button"
                        onClick={() => openQualityTarget(issue.slideIndex, issue.elementIds)}
                      >
                        打开第 {issue.slideIndex + 1} 页
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {designQualityReport.visualReview && (
              <div className="design-quality-visual">
                <h3>视觉评审建议</h3>
                {designQualityReport.contactSheet && (
                  <figure className="design-quality-contact-sheet">
                    <div className="contact-sheet-image-wrap">
                      <img src={designQualityReport.contactSheet} alt="整册页面缩略图总览" />
                      <div
                        className="contact-sheet-page-map"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(4, document.slides.length)}, 1fr)`,
                        }}
                      >
                        {document.slides.map((slide, slideIndex) => {
                          const issueCount =
                            designQualityReport.visualReview?.issues.filter((issue) => issue.slideIndex === slideIndex)
                              .length ?? 0;
                          const score = designQualityReport.visualReview?.slideScores?.find(
                            (item) => item.slideIndex === slideIndex,
                          );
                          return (
                            <button
                              key={slide.id}
                              type="button"
                              className={
                                qualityStaleIndexes.includes(slideIndex)
                                  ? "stale"
                                  : issueCount > 0
                                    ? "has-issues"
                                    : score
                                      ? "reviewed"
                                      : "unreviewed"
                              }
                              aria-label={`打开第 ${slideIndex + 1} 页：${slide.content.title}`}
                              title={`${slide.content.title}${score ? ` · ${score.overallScore} 分` : " · 未逐页评分"}`}
                              onClick={() => openQualityTarget(slideIndex)}
                            >
                              <span>{slideIndex + 1}</span>
                              {score && <em>{score.overallScore}</em>}
                              {issueCount > 0 && <strong>{issueCount}</strong>}
                              {qualityStaleIndexes.includes(slideIndex) && <b>待复检</b>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <figcaption>整册 Contact Sheet · 检查页面节奏、深浅分布、主题一致性、重复版式与前后跳变</figcaption>
                  </figure>
                )}
                {designQualityReport.deckReview && (
                  <p className="design-quality-notes">
                    整册总览：一致性 {designQualityReport.deckReview.consistencyScore}、重复控制{" "}
                    {designQualityReport.deckReview.repetitionScore ?? "未评"}、主题匹配{" "}
                    {designQualityReport.deckReview.themeFitScore ?? "未评"}
                  </p>
                )}
                {designQualityReport.reviewReuse && (
                  <p className="design-quality-notes">
                    本轮定点复检 {designQualityReport.reviewReuse.reviewed} 页，复用{" "}
                    {designQualityReport.reviewReuse.reused} 页既有评审结论
                  </p>
                )}
                {designQualityReport.visualReviewCoverage && (
                  <p className="design-quality-notes">
                    已评审 {designQualityReport.visualReviewCoverage.reviewed}/
                    {designQualityReport.visualReviewCoverage.total} 页 · 总分{" "}
                    {designQualityReport.visualReview.overallScore}（层级{" "}
                    {designQualityReport.visualReview.hierarchyScore}、对齐{" "}
                    {designQualityReport.visualReview.alignmentScore}、可读性{" "}
                    {designQualityReport.visualReview.readabilityScore}、一致性{" "}
                    {designQualityReport.visualReview.consistencyScore}、重复控制{" "}
                    {designQualityReport.visualReview.repetitionScore ?? "未评"}、主题匹配{" "}
                    {designQualityReport.visualReview.themeFitScore ?? "未评"}、视觉焦点{" "}
                    {designQualityReport.visualReview.visualFocusScore ?? "未评"}）
                  </p>
                )}
                {designQualityReport.visualReview.issues.length === 0 ? (
                  <div className="template-empty">视觉评审没有留下需要调整的建议。</div>
                ) : (
                  <ul className="export-report-list">
                    {designQualityReport.visualReview.issues.map((issue, index) => {
                      const score = designQualityReport.visualReview?.slideScores?.find(
                        (item) => item.slideIndex === issue.slideIndex,
                      );
                      return (
                        <li
                          key={`${issue.issue}-${issue.slideIndex}-${index}`}
                          className={issue.severity === "error" ? "error" : "warning"}
                        >
                          <CircleAlert />
                          <div>
                            <strong>
                              第 {issue.slideIndex + 1} 页 · {visualIssueLabels[issue.issue]}
                            </strong>
                            <p>{issue.suggestion}</p>
                            {score && (
                              <p>
                                本页 {score.overallScore} 分（层级 {score.hierarchyScore}、对齐 {score.alignmentScore}、
                                可读性 {score.readabilityScore}）
                              </p>
                            )}
                            <button
                              type="button"
                              className="quality-target-button"
                              onClick={() => openQualityTarget(issue.slideIndex, issue.elementIds)}
                            >
                              打开并定位
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {designQualityReport.notes.length > 0 && (
              <p className="design-quality-notes">{designQualityReport.notes.join("；")}</p>
            )}
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setDesignQualityReport(undefined)}>
                稍后处理
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setDesignQualityReport(undefined);
                  setActiveView("editor");
                  setEditorSurface("canvas");
                }}
              >
                进入编辑器调整
                <ArrowRight />
              </button>
            </div>
          </section>
        </div>
      )}

      {exportPreflightOpen && !exportBusy && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExportPreflightOpen(false);
          }}
        >
          <section
            className="upload-dialog export-preflight-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-preflight-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <Download />
                <div>
                  <h2 id="export-preflight-title">导出前摘要</h2>
                  <p>本次导出将读取当前不可变文档快照，不会修改项目或撤销栈。</p>
                </div>
              </div>
              <button type="button" aria-label="关闭导出前摘要" onClick={() => setExportPreflightOpen(false)}>
                <X />
              </button>
            </div>
            <dl className="export-preflight-summary">
              <div>
                <dt>文档版本</dt>
                <dd>{revisionLabel}</dd>
              </div>
              <div>
                <dt>内容审核</dt>
                <dd>
                  {document.slides.filter((slide) => slide.content.status === "approved").length}/
                  {document.slides.length} 页已确认
                </dd>
              </div>
              <div>
                <dt>视觉覆盖</dt>
                <dd>
                  {designQualityReport?.visualReviewCoverage
                    ? `${designQualityReport.visualReviewCoverage.reviewed}/${designQualityReport.visualReviewCoverage.total} 页`
                    : "未执行"}
                </dd>
              </div>
              <div>
                <dt>待复检页面</dt>
                <dd>{qualityStaleIndexes.length} 页</dd>
              </div>
              <div>
                <dt>视觉问题</dt>
                <dd>{designQualityReport?.visualReview?.issues.length ?? 0} 条</dd>
              </div>
              <div>
                <dt>确定性问题</dt>
                <dd>{designQualityReport?.issues.length ?? 0} 条</dd>
              </div>
            </dl>
            {qualityStaleIndexes.length > 0 && (
              <p className="design-quality-warning">
                有 {qualityStaleIndexes.length} 页在上次视觉评审后发生变化。可以继续导出，但建议先复检变化页。
              </p>
            )}
            {!designQualityReport?.visualReview && (
              <p className="design-quality-warning">当前没有可追溯的视觉评审结论；导出仍会执行字体、越界和结构预检。</p>
            )}
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setExportPreflightOpen(false)}>
                返回编辑
              </button>
              {designQualityReport && qualityStaleIndexes.length > 0 && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setExportPreflightOpen(false);
                    setDesignQualityReportOpen(true);
                  }}
                >
                  先复检变化页
                </button>
              )}
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  setExportPreflightOpen(false);
                  void handleExport();
                }}
              >
                继续导出 PPTX
              </button>
            </div>
          </section>
        </div>
      )}

      {exportReport && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExportReport(undefined);
          }}
        >
          <section
            className="upload-dialog export-report-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-report-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <CircleCheck />
                <div>
                  <h2 id="export-report-title">导出报告</h2>
                  <p>
                    {exportReport.slideCount} 页 · {exportReport.nativeObjectCount} 个原生对象
                    {exportReport.nativeChartCount > 0 ? ` · ${exportReport.nativeChartCount} 个原生图表` : ""}
                    {exportReport.nativeTableCount > 0 ? ` · ${exportReport.nativeTableCount} 个原生表格` : ""} · ZIP{" "}
                    {exportReport.package.entryCount} 个条目
                    {exportReport.masters.length > 0
                      ? ` · ${exportReport.masters.length} 个母版（${exportReport.masters.join("、")}）`
                      : ""}
                    {exportReport.themeColors.length > 0 ? ` · 主题色 ${exportReport.themeColors.join("、")}` : ""}
                  </p>
                </div>
              </div>
              <button type="button" aria-label="关闭导出报告" onClick={() => setExportReport(undefined)}>
                <X />
              </button>
            </div>
            {exportReport.issues.length === 0 ? (
              <div className="template-empty">未发现导出问题</div>
            ) : (
              <ul className="export-report-list">
                {exportReport.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.slideIndex}-${issue.elementId ?? index}`} className={issue.severity}>
                    <CircleAlert />
                    <div>
                      <strong>
                        {issue.severity === "error" ? "错误" : "提示"} · 第 {issue.slideIndex + 1} 页
                      </strong>
                      <p>{issue.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="upload-dialog-actions">
              <button type="button" className="secondary-action" onClick={() => setExportReport(undefined)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}

      {contentHistoryOpen && (
        <ContentHistory
          document={document}
          onClose={() => setContentHistoryOpen(false)}
          onRestore={restoreContentVersion}
        />
      )}

      {editorCanvasOpen && findOpen && <FindReplaceBar onClose={() => setFindOpen(false)} />}

      {message && (
        <div className={`page-message ${message.kind}`} role="status" aria-live="polite">
          {message.kind === "success" ? <CircleCheck /> : message.kind === "error" ? <CircleAlert /> : <Info />}
          <span>{message.text}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}>
            <X />
          </button>
        </div>
      )}

      {designBusy && !templatePickerOpen && (
        <aside className="background-task-card" role="status" aria-live="polite" aria-label="AI 设计后台任务">
          <div className="background-task-heading">
            <span>
              <Sparkles />
              <strong>AI 正在后台生成 PPT</strong>
            </span>
            <b>{designProgress.percent}%</b>
          </div>
          <p>{designProgress.label}</p>
          <div
            className="background-task-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={designProgress.percent}
          >
            <i style={{ width: `${designProgress.percent}%` }} />
          </div>
          <div className="background-task-actions">
            <button type="button" onClick={() => setTemplatePickerOpen(true)}>
              查看任务
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                designCancelRef.current = true;
                setDesignProgress({ percent: designProgress.percent, label: "正在取消任务…" });
                void cancelAiGeneration(designTaskId.current).catch(() => undefined);
              }}
            >
              取消任务
            </button>
          </div>
        </aside>
      )}

      {designQualityReport && !designQualityReportOpen && !designBusy && (
        <aside className="background-task-card complete" role="status" aria-live="polite">
          <div className="background-task-heading">
            <span>
              <CircleCheck />
              <strong>PPT 已生成，质检报告可查看</strong>
            </span>
          </div>
          <p>生成结果已保留，当前操作不会被打断。</p>
          <div className="background-task-actions">
            <button type="button" onClick={() => setDesignQualityReportOpen(true)}>
              查看质检报告
            </button>
            <button type="button" onClick={() => setDesignQualityReport(undefined)}>
              稍后处理
            </button>
          </div>
        </aside>
      )}

      {editorCanvasOpen && designQualityReport && !designQualityReportOpen && (
        <aside className="current-slide-quality-card" aria-label="当前页视觉质检">
          <div>
            <strong>第 {activeSlideIndex + 1} 页质检</strong>
            <span>
              {qualityStaleIndexes.includes(activeSlideIndex)
                ? "结果已过期"
                : activeSlideVisualScore
                  ? `${activeSlideVisualScore.overallScore} 分`
                  : "未逐页评分"}
            </span>
          </div>
          <p>
            {activeSlideVisualIssues.length > 0
              ? `${activeSlideVisualIssues.length} 条视觉建议：${activeSlideVisualIssues
                  .slice(0, 2)
                  .map((issue) => visualIssueLabels[issue.issue])
                  .join("、")}`
              : qualityStaleIndexes.includes(activeSlideIndex)
                ? "本页在上次评审后发生变化。"
                : "本页没有未解决的视觉建议。"}
          </p>
          <div>
            <button type="button" disabled={manualReviewBusy} onClick={() => void runManualReview("current")}>
              复检本页
            </button>
            <button type="button" onClick={() => setDesignQualityReportOpen(true)}>
              查看整册报告
            </button>
          </div>
        </aside>
      )}

      <footer className="statusbar">
        {activeView === "editor" && editorSurface === "projects" ? (
          <>
            <span>项目首页</span>
            <span>{projectHomeItems.length > 0 ? `${projectHomeItems.length} 个最近项目` : "尚无最近项目"}</span>
            <span className="saved-dot">● 最近编辑项目优先</span>
          </>
        ) : activeView === "ai" ? (
          aiDraft ? (
            <>
              <span>
                草稿第 {activeDraftSlideIndex + 1} / {aiDraft.slides.length} 页
              </span>
              <span>{aiDraftMetrics.characters} 字</span>
              <span>{aiDraftMetrics.points} 条要点</span>
              <span className={`saved-dot ${aiSaveState === "saving" ? "dirty" : ""}`}>
                ● {aiSaveState === "saving" ? "保存中…" : "已自动保存"}
              </span>
            </>
          ) : (
            <>
              <span>AI 内容工作台</span>
              <span>填写主题后生成结构化草稿</span>
              <span className="saved-dot">
                ● {aiHistory.length > 0 ? `${aiHistory.length} 个历史草稿` : "尚未生成草稿"}
              </span>
            </>
          )
        ) : (
          <>
            <span>
              第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页
            </span>
            {activeView === "editor" && (
              <ContentReviewStatus slideId={activeSlide.id} status={activeSlide.content.status} onCommand={execute} />
            )}
            {activeView === "editor" && (
              <button
                type="button"
                className="content-history-open"
                title="查看已确认内容版本，并与当前内容逐页对比"
                onClick={() => setContentHistoryOpen(true)}
              >
                内容版本 {document.contentVersions?.length ?? 0}
              </button>
            )}
            <span>{countLabel}</span>
            <span>{revisionLabel}</span>
            {missingImageCount > 0 && (
              <span className="missing-assets" title="这些图片读不出来，画布上以斜纹块占位">
                ⚠ {missingImageCount} 张图片资源缺失
              </span>
            )}
            <span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span>
            <span className="zoom-controls">
              <button
                type="button"
                aria-label="缩小画布"
                onClick={() => setZoom((value) => Math.max(0.3, Math.round((value - 0.1) * 10) / 10))}
              >
                −
              </button>
              <button type="button" className="zoom" title="适应窗口" onClick={fitToWindow}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="放大画布"
                onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.1) * 10) / 10))}
              >
                ＋
              </button>
            </span>
          </>
        )}
      </footer>
    </div>
  );
}
