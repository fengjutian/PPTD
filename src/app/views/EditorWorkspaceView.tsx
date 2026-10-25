import type { AppRuntime } from "./app-runtime";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChartColumn,
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
  Images,
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
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand2,
  X,
} from "lucide-react";

import { EMU_PER_INCH, type AnimationEffect, type SlideAnimation } from "../core/document-model";

import { contrastRatio } from "../core/rendering/contrast";

import { LogPanel } from "../features/diagnostics/LogPanel";
import { InspectorPanel } from "../features/editor/InspectorPanel";
import { TextFormatToolbar } from "../features/editor/TextFormatToolbar";
import { FindReplaceBar } from "../features/editor/FindReplaceBar";
import { PageSizeControls } from "../features/editor/PageSizeControls";
import { ShapePicker } from "../features/editor/ShapePicker";
import { ArrangeToolbar } from "../features/editor/ArrangeToolbar";
import { ImportModeDialog, ImportReportDialog } from "../features/editor/PptxImportDialogs";
import {
  ANIMATION_EFFECT_LABELS,
  ANIMATION_EFFECT_OPTIONS,
  ANIMATION_PHASE_LABELS,
} from "../features/editor/animation-options";

import { ContentReviewStatus } from "../features/editor/ContentReviewStatus";
import { ContentHistory } from "../features/editor/ContentHistory";
import { LayerList } from "../features/editor/LayerList";

import { CanvasGridLayer, CanvasGuideLayer } from "../features/editor/CanvasOverlay";

import { ContentReview } from "../features/ai/ContentReview";
import { DesignDirectionDialog } from "../features/ai/DesignDirectionDialog";
import { SlideRewriteDialog } from "../features/ai/SlideRewriteDialog";
import { FactPicker } from "../features/ai/FactPicker";

import { SlideTitleDialog } from "../features/ai/SlideTitleDialog";
import { SpeakerNotesDialog } from "../features/ai/SpeakerNotesDialog";
import { SplitSlideDialog } from "../features/ai/SplitSlideDialog";
import { DeckReviewDialog } from "../features/ai/DeckReviewDialog";
import { ThemePresetPicker } from "../features/ai/ThemePresetPicker";
import { ThemeSpecimenDialog } from "../features/ai/ThemeSpecimenDialog";

import { AiImageDialog } from "../features/editor/AiImageDialog";
import { InsertTableDialog } from "../features/editor/InsertTableDialog";
import { InsertChartDialog } from "../features/editor/InsertChartDialog";

import { SettingsWorkspace } from "../features/settings/SettingsDialog";

import { removeRecentProject } from "../services/app-database";
import { cancelAiGeneration } from "../services/ai-service";

import { isDesktopRuntime } from "../services/project-files";

import { THEME_PRESETS, findThemePreset } from "../core/design/theme-presets";

import type { BuiltinIconName } from "../core/document-model";
import { IconPicker } from "../features/editor/IconPicker";

import { ElementView } from "../features/editor/ElementView";
import { SlideThumbnail } from "../features/editor/SlideThumbnail";
import { ToolButton } from "../features/editor/ToolButton";

import { ProjectHome } from "./ProjectHome";
import type { AppRuntime } from "./app-runtime";
import {
  CANVAS_WIDTH,
  themeColorRoleLabels,
  themeAudienceLabels,
  themePageTypeLabels,
  themeDensityLabels,
  visualIssueLabels,
  templateFitLabels,
  parityIssueLabel,
  reviewEvidenceLabel,
  formatElapsed,
} from "./app-shared";

export function EditorWorkspaceView({ app }: { app: AppRuntime }) {
  const { editorCanvasOpen, leftTab, setLeftTab, execute, document, activeSlide, selectSlide, selectedElementIds, selectElement, toggleElement, workspaceRef, formatPainterStyle, zoom, canvasHeight, marquee, scale, selected, snapContext, animationPreviews, startInspectorResize, editorRibbonTab, selectedAnimation, setSelectedAnimationId, previewSelectedAnimation, previewSlideAnimations, stopAnimationPreview } = app;

  return (
    <>
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
                    <p>选择画布对象，然后在上方选择进入、强调或退出效果。</p>
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
                      const effectName = ANIMATION_EFFECT_LABELS[animation.effect];
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
                                {ANIMATION_PHASE_LABELS[animation.phase]} · {startName} ·{" "}
                                {(animation.durationMs / 1000).toFixed(1)} 秒
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
    </>
  );
}
