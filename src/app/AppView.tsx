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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMU_PER_INCH,
  emu,
  inches,
  createDocument,
  type DesignDirectionRecord,
  type ElementId,
  type DocumentId,
  type AnimationEffect,
  type PresentationDocument,
  type SlideAnimation,
  type SlideElement,
  type TextElement,
  type SupportedImageMimeType,
  nextTextSize,
  normalizeTextFormat,
} from "../core/document-model";
import {
  applyCommand,
  buildDirectionPreviewPages,
  directionContentFingerprint,
  importedDeckToDocument,
  type AiSlideDesign,
  type DocumentCommand,
  type ImportReport,
} from "../core/commands";
import {
  CONCEPT_PRESET_LABELS,
  defaultEditorialConcept,
  resolveDeckConcept,
  type AiDeckConcept,
  type DeckConcept,
} from "../core/design/deck-concept";
import {
  auditThemeDirection,
  themeDirectionForPreset,
  type ThemeDirection,
  type ThemeDirectionAudit,
} from "../core/design/theme-direction";
import { setTextMeasurer } from "../core/rendering/text-metrics";
import { contrastRatio } from "../core/rendering/contrast";
import { createCanvasTextMeasurer } from "../services/text-metrics-canvas";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";
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
import { useFormatPainterStore } from "../store/format-painter";
import { ContentReviewStatus } from "../features/editor/ContentReviewStatus";
import { ContentHistory } from "../features/editor/ContentHistory";
import { LayerList } from "../features/editor/LayerList";

import { CanvasGridLayer, CanvasGuideLayer } from "../features/editor/CanvasOverlay";
import { useSnapContext } from "../features/editor/use-snap-context";

import { useCanvasGuidesStore } from "../store/canvas-guides-store";

import { useMarqueeSelection } from "../features/editor/use-marquee-selection";
import { fitZoom } from "../core/rendering/viewport";

import { ContentReview, type ImagePromptAssist } from "../features/ai/ContentReview";
import { DesignDirectionDialog, type DirectionOptionView } from "../features/ai/DesignDirectionDialog";
import { SlideRewriteDialog } from "../features/ai/SlideRewriteDialog";
import { FactPicker } from "../features/ai/FactPicker";
import { selectedFacts } from "../features/ai/facts";
import { SlideTitleDialog } from "../features/ai/SlideTitleDialog";
import { SpeakerNotesDialog } from "../features/ai/SpeakerNotesDialog";
import { SplitSlideDialog } from "../features/ai/SplitSlideDialog";
import { DeckReviewDialog } from "../features/ai/DeckReviewDialog";
import { ThemePresetPicker } from "../features/ai/ThemePresetPicker";
import { ThemeSpecimenDialog } from "../features/ai/ThemeSpecimenDialog";
import {
  countSlidePoints,
  draftMetrics,
  remapChecks,
  resolveActiveSlideIndex,
  reviewIssues,
  slideCapacityNotes,
  withSlideIds,
  type AiDraftSaveState,
} from "../features/ai/content-review";
import { generateDeckVisualAssets, planVisualAssets, requestVisualAsset } from "../services/ai-visual-asset";
import type { AiVisualAssetRole } from "../core/commands/visual-asset";
import { AiImageDialog } from "../features/editor/AiImageDialog";
import { InsertTableDialog } from "../features/editor/InsertTableDialog";
import { InsertChartDialog } from "../features/editor/InsertChartDialog";
import { bodyFromBlocks } from "../services/ai-draft-content";
import { SettingsWorkspace } from "../features/settings/SettingsDialog";
import {
  deleteAiHistoryEntry,
  loadAiHistory,
  saveAiHistory,
  saveAiPresentation,
  type AiHistoryEntry,
} from "../services/ai-history";
import { loadRecentProjects, removeRecentProject, type RecentProjectEntry } from "../services/app-database";
import {
  briefsFromDraft,
  cancelAiGeneration,
  compositionFactsFromDraft,
  describeAiError,
  endAiGeneration,
  extractSourceFacts,
  generateDeckConcepts,
  generateDeckDirections,
  generatePresentationDesign,
  generatePresentationDraft,
  listenAiGenerationProgress,
  mergeStreamProgress,
  polishPresentationTopic,
  reviewDeckContent,
  rewritePresentationSlide,
  splitSlideContent,
  suggestImagePrompts,
  suggestSlideTitles,
  writeSpeakerNotes,
  type AiDraft,
  type AiGenerationProgress,
  type AiVisualAssetIntent,
  type ContentCheck,
  type DeckReviewIssue,
  type SlideRewriteSuggestion,
  type SourceFact,
  type SplitSlidePage,
} from "../services/ai-service";
import { applyTheme, applyUiFont, applyUiLanguage, defaultSettings, loadSettings } from "../services/settings";
import { DESIGN_DIRECTIONS_PROMPT_VERSION } from "../services/ai-service";
import {
  loadDesignPreferences,
  loadRecentLooks,
  recordDesignLook,
  recordDesignPreference,
  recommendedConceptPreset,
} from "../services/design-memory";
import { probeVisionCapability } from "../services/ai-vision";
import { createTranslator, type UiLanguage } from "../services/i18n";
import { notifySystem, prepareSystemNotifications } from "../services/system-notification";
import { recordAppError, recordAppLog, appLogLocation, readAppLog, type AppLogRecord } from "../services/app-log";
import {
  analyzePptxTemplate,
  choosePresentationFile,
  convertLegacyPpt,
  choosePptxPath,
  choosePptxTemplate,
  clearRecovery,
  deletePptxTemplate,
  getPptxTemplatePreview,
  importPptxTemplate,
  isDesktopRuntime,
  listPptxTemplates,
  loadRecovery,
  openProjectAtPath,
  projectModifiedAt,
  recoveryProjectPath,
  renderPptxTemplateLayouts,
  renamePptxTemplate,
  saveProject,
  autoSave,
  writePptx,
  type PresentationFileSelection,
  type TemplateAnalysis,
  type TemplateRecord,
} from "../services/project-files";
import {
  cancelPptxImport,
  importPptxContent,
  listenPptxImportProgress,
  type PptxImportProgress,
} from "../services/pptx-import";
import { useEditorStore } from "../store/editor-store";
import { THEME_PRESETS, defaultThemePreset, findThemePreset, type ThemePreset } from "../core/design/theme-presets";
import { themePresetAiPrompt, themePresetGuidance } from "../core/design/theme-preset-guidance";
import {
  themePresetMetadata,
  type ThemeAudience,
  type ThemeContentDensity,
  type ThemePageType,
} from "../core/design/theme-preset-metadata";
import type { BuiltinIconName } from "../core/document-model";
import { IconPicker } from "../features/editor/IconPicker";
import { inferThemePresetId } from "../core/design/theme-preset-inference";
import { defaultPresentationVisualGoal, type VisualReview } from "../services/visual-alignment";
import {
  documentContentFingerprint,
  runDesignQualityStage,
  summarizeQualityIssues,
  type ReviewEvidence,
} from "../services/design-quality-stage";
import type { PresentationQualityIssue } from "../services/presentation-quality-gate";
import { DisabledVisionReviewPort, TauriVisionReviewPort } from "../services/vision-review-port";
import { probeTemplateBackground, type TemplateBackgroundProbe } from "../services/template-background";
import type { ExportReport } from "../features/pptx-export/export-pptx";
import { renderRealPptxForReview } from "../features/pptx-export/render-real-pptx";
import { runManualVisualReview } from "../services/manual-visual-review";
import {
  applyTemplateToGoal,
  buildTemplateReviewTarget,
  templateTargetMatchesDocument,
  type TemplateFitCode,
  type TemplateFitReport,
} from "../services/template-review-target";
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

import { ElementView } from "../features/editor/ElementView";
import { SlideThumbnail } from "../features/editor/SlideThumbnail";
import { ToolButton } from "../features/editor/ToolButton";
import { readImageSize } from "./image-size";

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

export function AppView({ app }: { app: AppRuntime }) {
  const {
    editorCanvasOpen,
    inspectorWidth,
    editorRibbonTab,
    setEditorRibbonTab,
    handleNew,
    handleOpenOrImport,
    setRecentProjectsOpen,
    refreshRecentProjects,
    saving,
    handleSave,
    handleSaveAs,
    handleRenameProject,
    handleDuplicateProject,
    undo,
    undoStack,
    redo,
    redoStack,
    execute,
    activeSlide,
    document,
    selectedElementIds,
    copySelection,
    clipboard,
    pasteSelection,
    setFindOpen,
    selectedTextElements,
    imageInputRef,
    setIconPickerOpen,
    setInsertTableOpen,
    setInsertChartOpen,
    setAiImageError,
    setAiImageOpen,
    aiImageBusy,
    handleImageFile,
    setTaskStatus,
    fitToWindow,
    gridEnabled,
    toggleGrid,
    gridSnapEnabled,
    toggleGridSnap,
    snapEnabled,
    toggleSnap,
    addGuide,
    clearGuidesOnSlide,
    activeGuides,
    changeActiveView,
    selected,
    selectedAnimation,
    previewSelectedAnimation,
    previewSlideAnimations,
    animationPreviews,
    stopAnimationPreview,
    newAnimationEffect,
    setNewAnimationEffect,
    setSelectedAnimationId,
    selectedAnimationIndex,
    exportBusy,
    handleExport,
    setExportPreflightOpen,
    t,
    activeView,
    diagnosticsOpen,
    openDiagnostics,
    uiLanguage,
    logRecords,
    logLoading,
    logLocation,
    loadDiagnostics,
    setDiagnosticsOpen,
    editorSurface,
    projectHomeItems,
    designBusy,
    generatingHistoryId,
    designProgress,
    openAiPresentation,
    removeAiHistoryEntry,
    handleOpenRecent,
    setRecentProjects,
    leftTab,
    setLeftTab,
    selectSlide,
    selectElement,
    toggleElement,
    workspaceRef,
    formatPainterStyle,
    zoom,
    canvasHeight,
    marquee,
    scale,
    snapContext,
    startInspectorResize,
    aiDraft,
    returnToAiStart,
    agentWorkflow,
    aiDraftBlockingIssues,
    aiDraftBlockHint,
    handleRegenerateDraft,
    aiRegenerating,
    aiDraftBlockReason,
    continueToTheme,
    aiHistory,
    openAiHistory,
    aiTopic,
    aiPolishing,
    aiBusy,
    handlePolishAiTopic,
    setAiTopic,
    aiMaterial,
    setAiMaterial,
    resetAiFacts,
    handleMaterialFile,
    aiExtracting,
    handleExtractFacts,
    aiFacts,
    aiExcludedFacts,
    setAiExcludedFacts,
    setAiFacts,
    aiSlideCount,
    setAiSlideCount,
    handleAiGenerate,
    aiProgress,
    aiGenerationLabel,
    aiGenerationPercent,
    aiOriginalDraft,
    activeDraftSlideIndex,
    aiSaveState,
    aiRestoreUndoSlideIds,
    aiContentUndo,
    aiContentRedo,
    selectAiDraftSlide,
    updateAiDraftTitle,
    updateAiSlide,
    updateAiVisualAsset,
    updateAiBlocks,
    updateAiChecks,
    updateAiSlideReviewed,
    reviewAllAiSlides,
    addAiSlide,
    duplicateAiSlide,
    deleteAiSlide,
    moveAiSlide,
    restoreAiSlide,
    undoRestoreAiSlide,
    openSlideRewrite,
    runTitleAssist,
    runNotesAssist,
    runSplitAssist,
    runDeckReview,
    imagePromptAssist,
    runImagePromptAssist,
    dismissImagePrompts,
    undoAiContent,
    redoAiContent,
    setTemplateUploadOpen,
    themePresetId,
    handleSelectThemePreset,
    templateLibrary,
    selectedTemplate,
    handleSelectTemplate,
    setTemplateMenu,
    themeDrawerOpen,
    drawerThemePreset,
    closeThemeDrawer,
    themePreviewLocked,
    drawerThemeGuidance,
    drawerThemeMetadata,
    drawerSurfaceColor,
    drawerThemeAiPrompt,
    templatePreviewBusy,
    templatePreview,
    templateAnalysis,
    templateTargetPreview,
    setThemeSpecimenPresetId,
    applyDrawerTheme,
    themeSpecimenPresetId,
    setUiLanguage,
    insertTableOpen,
    insertChartOpen,
    aiImageOpen,
    aiImageError,
    handleAiImageGenerate,
    iconPickerOpen,
    recentProjectsOpen,
    recentProjects,
    templateUploadOpen,
    handleChooseTemplate,
    templatePickerOpen,
    setTemplatePickerOpen,
    recommendedThemePreset,
    designDetail,
    designElapsed,
    pickerThemePreset,
    pickerThemeGuidance,
    generateFromDraft,
    designQualityReport,
    designQualityReportOpen,
    setDesignQualityReportOpen,
    manualReviewBusy,
    runManualReview,
    cancelManualReview,
    qualityStaleIndexes,
    openQualityTarget,
    refreshTemplateTarget,
    clearTemplateTarget,
    setDesignQualityReport,
    setActiveView,
    setEditorSurface,
    exportPreflightOpen,
    revisionLabel,
    directionOptions,
    directionRegenerations,
    directionChoiceRef,
    exportReport,
    setExportReport,
    templateMenu,
    handleRenameTemplate,
    handleDeleteTemplate,
    importChoice,
    importBusy,
    importProgress,
    handleCancelImport,
    setImportChoice,
    handleImportContent,
    handleExtractTemplate,
    importPreview,
    setImportPreview,
    handleConfirmImport,
    contentHistoryOpen,
    setContentHistoryOpen,
    restoreContentVersion,
    restoreContentVersionWithDesign,
    findOpen,
    message,
    setMessage,
    designCancelRef,
    setDesignProgress,
    designTaskId,
    activeSlideIndex,
    activeSlideVisualScore,
    activeSlideVisualIssues,
    slideRewrite,
    rewriteSlide,
    runSlideRewrite,
    applySlideRewrite,
    closeSlideRewrite,
    slideAssist,
    assistSlide,
    applyTitleAssist,
    closeSlideAssist,
    applyNotesAssist,
    applySplitAssist,
    deckReview,
    jumpToDeckReviewIssue,
    rewriteFromDeckReviewIssue,
    closeDeckReview,
    aiDraftMetrics,
    countLabel,
    missingImageCount,
    dirty,
    setZoom,
  } = app;

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
            <ShapePicker onPick={(shape) => execute({ type: "add-shape", slideId: activeSlide.id, shape })} />
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
            <ToolButton label="插入表格" caption="表格" onClick={() => setInsertTableOpen(true)}>
              <Table2 />
            </ToolButton>
            <ToolButton label="插入图表" caption="图表" onClick={() => setInsertChartOpen(true)}>
              <ChartColumn />
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
            <span className="separator" />
            <ArrangeToolbar
              slideId={activeSlide.id}
              selected={activeSlide.elements.filter((element) => selectedElementIds.includes(element.id))}
              groups={activeSlide.groups}
              execute={execute}
            />
            <span className="separator" />
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
            <div className="animation-effect-picker">
              <select
                aria-label="动画效果"
                title="选择动画效果"
                value={newAnimationEffect}
                disabled={!selected || selected.locked}
                onChange={(event) => setNewAnimationEffect(event.target.value as AnimationEffect)}
              >
                {(["entrance", "emphasis", "exit"] as const).map((phase) => (
                  <optgroup key={phase} label={ANIMATION_PHASE_LABELS[phase]}>
                    {ANIMATION_EFFECT_OPTIONS.filter((option) => option.phase === phase).map((option) => (
                      <option key={option.effect} value={option.effect}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                disabled={!selected || selected.locked}
                onClick={() => {
                  if (!selected) return;
                  const option =
                    ANIMATION_EFFECT_OPTIONS.find((candidate) => candidate.effect === newAnimationEffect) ??
                    ANIMATION_EFFECT_OPTIONS[1]!;
                  setSelectedAnimationId(undefined);
                  execute({
                    type: "add-animation",
                    slideId: activeSlide.id,
                    elementId: selected.id,
                    animation: {
                      effect: option.effect,
                      start: "on-click",
                      durationMs: option.durationMs,
                      delayMs: 0,
                      direction: option.effect === "fly-in" ? "bottom" : "none",
                    },
                  });
                }}
              >
                添加
              </button>
            </div>
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
            <ToolButton
              label="复制所选动画"
              caption="复制动画"
              disabled={!selectedAnimation}
              onClick={() => {
                if (!selectedAnimation) return;
                execute({
                  type: "duplicate-animation",
                  slideId: activeSlide.id,
                  animationId: selectedAnimation.id,
                });
              }}
            >
              <Copy />
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

      <nav className="nav-rail" aria-label={t("shell.navAria")}>
        <button
          className={activeView === "editor" ? "active" : ""}
          aria-current={activeView === "editor" ? "page" : undefined}
          title={t("shell.editorTitle")}
          onClick={() => changeActiveView("editor")}
        >
          <LayoutDashboard />
          <span>{t("shell.editor")}</span>
        </button>
        <button
          className={activeView === "ai" ? "active" : ""}
          aria-current={activeView === "ai" ? "page" : undefined}
          title={t("shell.aiTitle")}
          onClick={() => changeActiveView("ai")}
          disabled={!isDesktopRuntime()}
        >
          <Sparkles />
          <span>{t("shell.ai")}</span>
        </button>
        <button
          className={activeView === "theme" ? "active" : ""}
          aria-current={activeView === "theme" ? "page" : undefined}
          title={t("shell.themeTitle")}
          onClick={() => changeActiveView("theme")}
        >
          <Palette />
          <span>{t("shell.theme")}</span>
        </button>
        <button
          className={diagnosticsOpen ? "active" : ""}
          aria-expanded={diagnosticsOpen}
          aria-haspopup="dialog"
          title={t("shell.logTitle")}
          onClick={openDiagnostics}
        >
          <ScrollText />
          <span>{t("shell.log")}</span>
        </button>
        <div className="nav-spacer" />
        <button
          className={activeView === "settings" ? "active" : ""}
          aria-current={activeView === "settings" ? "page" : undefined}
          title={t("shell.settings")}
          onClick={() => changeActiveView("settings")}
        >
          <Settings />
          <span>{t("shell.settings")}</span>
        </button>
      </nav>

      {diagnosticsOpen && (
        <LogPanel
          language={uiLanguage}
          records={logRecords}
          loading={logLoading}
          location={logLocation}
          onRefresh={() => void loadDiagnostics()}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}

      {activeView === "editor" && editorSurface === "projects" && (
        <ProjectHome
          items={projectHomeItems}
          designBusy={designBusy}
          generatingHistoryId={generatingHistoryId}
          designProgress={designProgress}
          onOpenOrImport={() => void handleOpenOrImport()}
          onNew={() => void handleNew()}
          onOpenAi={(entry) => void openAiPresentation(entry)}
          onRemoveAi={removeAiHistoryEntry}
          onOpenRecent={(entry) => void handleOpenRecent(entry)}
          onRemoveRecent={(entry) => {
            void removeRecentProject(entry.path)
              .then(setRecentProjects)
              .catch((error: unknown) =>
                setTaskStatus(`移除失败：${error instanceof Error ? error.message : String(error)}`),
              );
          }}
        />
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
                  <label>
                    <span className="topic-field-heading">
                      <span>参考素材（可选）</span>
                      <span className="material-hint">粘贴原文，生成时逐页引用</span>
                    </span>
                    <textarea
                      className="material-input"
                      value={aiMaterial}
                      onChange={(event) => {
                        setAiMaterial(event.target.value);
                        resetAiFacts();
                      }}
                      maxLength={40000}
                      rows={5}
                      placeholder="粘贴年报、研报或会议纪要原文。AI 会先抽出可核对的事实，再按事实写稿；没有素材时不编造数字。"
                    />
                  </label>
                  <div className="material-tools">
                    <label className="link-action material-import">
                      <Upload />
                      导入 .txt / .md
                      <input
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        hidden
                        onChange={(event) => {
                          void handleMaterialFile(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="link-action"
                      disabled={!aiMaterial.trim() || aiExtracting || aiBusy}
                      onClick={() => void handleExtractFacts()}
                    >
                      <Wand2 />
                      {aiExtracting ? "抽取中…" : aiFacts ? "重新抽取事实" : "抽取事实"}
                    </button>
                  </div>
                  {aiFacts && (
                    <FactPicker
                      facts={aiFacts}
                      excluded={aiExcludedFacts}
                      onToggle={(id) =>
                        setAiExcludedFacts((current) => {
                          const next = new Set(current);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      onRemove={(id) => {
                        setAiFacts((current) => current?.filter((fact) => fact.id !== id));
                        setAiExcludedFacts((current) => {
                          const next = new Set(current);
                          next.delete(id);
                          return next;
                        });
                      }}
                    />
                  )}
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
                    disabled={!aiTopic.trim() || aiPolishing || aiSlideCount === "" || aiExtracting}
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
                onSlideChecksChange={updateAiChecks}
                onSlideReviewedChange={updateAiSlideReviewed}
                onReviewAllSlides={reviewAllAiSlides}
                onAddSlide={addAiSlide}
                onDuplicateSlide={duplicateAiSlide}
                onDeleteSlide={deleteAiSlide}
                onMoveSlide={moveAiSlide}
                onRestoreSlide={restoreAiSlide}
                onUndoRestore={undoRestoreAiSlide}
                onRewriteSlide={openSlideRewrite}
                onSuggestTitle={(index) => void runTitleAssist(index)}
                onWriteNotes={(index) => void runNotesAssist(index)}
                onSplitSlide={(index) => void runSplitAssist(index)}
                onReviewDeck={() => void runDeckReview()}
                imagePromptAssist={imagePromptAssist}
                onSuggestImagePrompts={(index) => void runImagePromptAssist(index)}
                onDismissImagePrompts={dismissImagePrompts}
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
              {/* 生成中也能点开详情：锁定的是“切换主题”，不是“查看主题”。 */}
              <ThemePresetPicker value={themePresetId} onChange={handleSelectThemePreset} />
              <div className="theme-gallery-heading extracted">
                <div>
                  <strong>从 PPT 抽取的主题</strong>
                  <span>{templateLibrary.length} 套</span>
                </div>
                <p>保留来源文件的设计语言，并展示可解析范围；右键卡片可重命名或删除</p>
              </div>
              <div className="theme-card-grid extracted-theme-grid">
                {templateLibrary.map((template) => (
                  <button
                    type="button"
                    className={`theme-card extracted${selectedTemplate?.id === template.id ? " active" : ""}`}
                    key={template.id}
                    onClick={() => void handleSelectTemplate(template)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTemplateMenu({ template, x: event.clientX, y: event.clientY });
                    }}
                    title="右键可重命名或删除"
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

      {activeView === "theme" && themeDrawerOpen && (drawerThemePreset || selectedTemplate) && (
        <div
          className="theme-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeThemeDrawer();
          }}
        >
          <aside className="theme-drawer" role="dialog" aria-modal="true" aria-labelledby="theme-drawer-title">
            <div className="theme-drawer-heading">
              <div>
                <span>{drawerThemePreset ? "内置主题" : "PPT 抽取主题"}</span>
                <h2 id="theme-drawer-title">{drawerThemePreset?.name ?? selectedTemplate?.name}</h2>
              </div>
              <button type="button" aria-label="关闭主题详情" onClick={closeThemeDrawer}>
                <X />
              </button>
            </div>
            <div className="theme-drawer-scroll">
              {themePreviewLocked && (
                <p className="theme-drawer-note">
                  AI 正在后台生成当前稿，这里可以查看主题详情；生成完成前不能切换已选主题。
                </p>
              )}
              {drawerThemePreset ? (
                <>
                  <div
                    className="theme-preset-preview"
                    style={
                      {
                        "--theme-primary": drawerThemePreset.theme.colors.find((color) => color.name === "primary")
                          ?.value,
                        "--theme-accent": drawerThemePreset.theme.colors.find((color) => color.name === "accent")
                          ?.value,
                        "--theme-muted": drawerThemePreset.theme.colors.find((color) => color.name === "muted")?.value,
                        "--theme-surface": drawerThemePreset.theme.colors.find((color) => color.name === "surface")
                          ?.value,
                        "--theme-major-font": drawerThemePreset.theme.majorFont,
                        "--theme-minor-font": drawerThemePreset.theme.minorFont,
                      } as React.CSSProperties
                    }
                  >
                    <span className="theme-preview-kicker">PPTD · THEME SYSTEM</span>
                    <div>
                      <h2>{drawerThemePreset.name}</h2>
                      <p>让内容层级、字体与色彩保持一致</p>
                    </div>
                    <div className="theme-preview-bars">
                      <i />
                      <i />
                      <i />
                    </div>
                    <small>{drawerThemePreset.description}</small>
                  </div>
                  <section className="theme-drawer-section">
                    <h3>主题说明</h3>
                    <p>{drawerThemePreset.description}</p>
                    <p>{drawerThemeGuidance?.character}</p>
                  </section>
                  <section className="theme-drawer-section theme-type-sample">
                    <h3>字体样张</h3>
                    <div
                      className="theme-type-row theme-type-display"
                      style={{ fontFamily: drawerThemePreset.theme.majorFont }}
                    >
                      <span>让内容层级、字体与色彩保持一致</span>
                      <small>
                        标题字体 {drawerThemePreset.theme.majorFont} · 封面{" "}
                        {drawerThemePreset.theme.textStyles?.display?.fontSizePt ?? "—"} pt
                      </small>
                    </div>
                    <div
                      className="theme-type-row theme-type-title"
                      style={{ fontFamily: drawerThemePreset.theme.majorFont }}
                    >
                      <span>页面标题示例 Section Title</span>
                      <small>
                        页标题 {drawerThemePreset.theme.textStyles?.title?.fontSizePt ?? "—"} pt · 字距{" "}
                        {drawerThemePreset.theme.textStyles?.title?.letterSpacingPt ?? 0} pt
                      </small>
                    </div>
                    <div
                      className="theme-type-row theme-type-body"
                      style={{ fontFamily: drawerThemePreset.theme.minorFont }}
                    >
                      <span>正文示例：主题决定字体、字号与颜色，已审核的内容结构保持不变。</span>
                      <small>
                        正文字体 {drawerThemePreset.theme.minorFont} · 正文{" "}
                        {drawerThemePreset.theme.textStyles?.body?.fontSizePt ?? "—"} pt · 行高{" "}
                        {drawerThemePreset.theme.textStyles?.body?.lineHeight ?? "—"}
                      </small>
                    </div>
                  </section>
                  <section className="theme-drawer-section theme-guidance-grid">
                    <div>
                      <h3>适用场景</h3>
                      <div className="theme-scenario-tags">
                        {drawerThemeGuidance?.scenarios.map((scenario) => (
                          <span key={scenario}>{scenario}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>页面节奏</h3>
                      <p>{drawerThemeGuidance?.pageRhythm}</p>
                    </div>
                    <div>
                      <h3>图片建议</h3>
                      <p>{drawerThemeGuidance?.imageStyle}</p>
                    </div>
                    {drawerThemeMetadata && (
                      <>
                        <div>
                          <h3>推荐页型</h3>
                          <div className="theme-tag-row">
                            {drawerThemeMetadata.recommendedPageTypes.map((page) => (
                              <span key={page}>{themePageTypeLabels[page]}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h3>适用受众</h3>
                          <div className="theme-tag-row">
                            {drawerThemeMetadata.audiences.map((audience) => (
                              <span key={audience}>{themeAudienceLabels[audience]}</span>
                            ))}
                          </div>
                        </div>
                        <div className="theme-guidance-wide">
                          <h3>信息密度与约束</h3>
                          <p>密度：{themeDensityLabels[drawerThemeMetadata.density]}</p>
                          <p>避免：{drawerThemeMetadata.forbiddenCombinations.join("；")}</p>
                        </div>
                      </>
                    )}
                  </section>
                  <section className="theme-drawer-section theme-palette-detail">
                    <div className="theme-drawer-section-heading">
                      <h3>配色与可读性</h3>
                      <p>点击色块可复制色值；对比度按页面底色计算，正文建议不低于 4.5:1。</p>
                    </div>
                    <div className="theme-palette-grid">
                      {drawerThemePreset.theme.colors.map((color) => {
                        const ratio =
                          drawerSurfaceColor && (color.name === "primary" || color.name === "muted")
                            ? contrastRatio(color.value, drawerSurfaceColor)
                            : undefined;
                        return (
                          <button
                            key={color.name}
                            type="button"
                            className="theme-palette-item"
                            title={`复制 ${color.value}`}
                            onClick={() => {
                              void navigator.clipboard.writeText(color.value).then(
                                () => setTaskStatus(`已复制色值 ${color.value}`),
                                () => setTaskStatus("复制失败，请手动选择色值"),
                              );
                            }}
                          >
                            <span className="theme-palette-swatch" style={{ backgroundColor: color.value }} />
                            <span className="theme-palette-copy">
                              <b>{themeColorRoleLabels[color.name] ?? color.name}</b>
                              <code>{color.value}</code>
                              {ratio !== undefined && <em>对比 {ratio.toFixed(1)}:1</em>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="theme-drawer-section theme-token-details">
                    <h3>设计令牌</h3>
                    <dl>
                      <div>
                        <dt>标题字体</dt>
                        <dd>{drawerThemePreset.theme.majorFont}</dd>
                      </div>
                      <div>
                        <dt>正文字体</dt>
                        <dd>{drawerThemePreset.theme.minorFont}</dd>
                      </div>
                      <div>
                        <dt>封面字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.display?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>页标题字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.title?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>副标题字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.subtitle?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>正文字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.body?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>注释字号</dt>
                        <dd>{drawerThemePreset.theme.textStyles?.caption?.fontSizePt ?? "—"} pt</dd>
                      </div>
                      <div>
                        <dt>主题 ID</dt>
                        <dd>
                          <code>{drawerThemePreset.id}</code>
                        </dd>
                      </div>
                    </dl>
                    {drawerThemeMetadata && (
                      <dl>
                        <div>
                          <dt>中文回退</dt>
                          <dd>{drawerThemeMetadata.fontFallbacks.eastAsian.join(" → ")}</dd>
                        </div>
                        <div>
                          <dt>西文回退</dt>
                          <dd>{drawerThemeMetadata.fontFallbacks.latin.join(" → ")}</dd>
                        </div>
                        <div>
                          <dt>图表色板</dt>
                          <dd>
                            <span className="theme-chart-palette" aria-hidden>
                              {drawerThemeMetadata.chartPalette.map((value) => (
                                <i key={value} style={{ backgroundColor: value }} />
                              ))}
                            </span>{" "}
                            {drawerThemeMetadata.chartPalette.join("、")}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </section>
                  <section className="theme-drawer-section theme-ai-prompt">
                    <div className="theme-ai-prompt-heading">
                      <div>
                        <h3>AI 主题提示词（复制用）</h3>
                        <p>内置生成会自动使用该主题的结构化方向；这段文本用于复制给外部 AI。</p>
                      </div>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => {
                          if (!drawerThemeAiPrompt) return;
                          void navigator.clipboard.writeText(drawerThemeAiPrompt).then(
                            () => setTaskStatus(`已复制「${drawerThemePreset.name}」AI 主题提示词`),
                            () => setTaskStatus("复制失败，请手动选择提示词"),
                          );
                        }}
                      >
                        <Copy />
                        复制提示词
                      </button>
                    </div>
                    <pre>{drawerThemeAiPrompt}</pre>
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
                  {selectedTemplate && (
                    <div className="template-analysis drawer-analysis">
                      <h3>模板验收目标</h3>
                      {templateTargetPreview ? (
                        <dl>
                          <div>
                            <dt>标题轴</dt>
                            <dd>
                              x {templateTargetPreview.grid.titleX.toFixed(3)} · y{" "}
                              {templateTargetPreview.grid.titleY.toFixed(3)}
                            </dd>
                          </div>
                          <div>
                            <dt>内容区</dt>
                            <dd>
                              x {templateTargetPreview.grid.left.toFixed(3)}–
                              {templateTargetPreview.grid.right.toFixed(3)} · y{" "}
                              {templateTargetPreview.grid.bodyTop.toFixed(3)}–
                              {templateTargetPreview.grid.bodyBottom.toFixed(3)}
                            </dd>
                          </div>
                          <div>
                            <dt>字号</dt>
                            <dd>
                              标题 {templateTargetPreview.titleSizePt ?? "未定义"}pt / 正文{" "}
                              {templateTargetPreview.bodySizePt ?? "未定义"}pt
                            </dd>
                          </div>
                          <div>
                            <dt>对齐</dt>
                            <dd>
                              标题 {templateTargetPreview.titleAlign ?? "未声明"} / 正文{" "}
                              {templateTargetPreview.bodyAlign ?? "未声明"}
                            </dd>
                          </div>
                          <div>
                            <dt>字体</dt>
                            <dd>
                              {templateTargetPreview.majorFont ?? "未定义"} /{" "}
                              {templateTargetPreview.minorFont ?? "未定义"}
                            </dd>
                          </div>
                          <div>
                            <dt>版式</dt>
                            <dd>
                              {templateTargetPreview.layouts.length} 个可用 ·
                              {templateTargetPreview.layouts.filter((layout) => layout.freeComposition).length}{" "}
                              个自由构图
                            </dd>
                          </div>
                          <div>
                            <dt>置信度</dt>
                            <dd>
                              {templateTargetPreview.confidence === "high" ? "高" : "低"} · 阈值{" "}
                              {templateTargetPreview.minimumFit}
                            </dd>
                          </div>
                          {templateTargetPreview.templateHash && (
                            <div>
                              <dt>来源指纹</dt>
                              <dd title={templateTargetPreview.templateHash}>
                                {templateTargetPreview.templateHash.slice(0, 12)}
                              </dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <div className="template-analysis-warning">
                          模板缺少可用的标题或内容占位符，无法建立可测量的验收目标。
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="theme-drawer-actions">
              {drawerThemePreset && (
                <button
                  type="button"
                  className="secondary-action theme-sample-action"
                  onClick={() => setThemeSpecimenPresetId(drawerThemePreset.id)}
                >
                  <Images />
                  查看 8 页样张
                </button>
              )}
              <button type="button" className="secondary-action" onClick={closeThemeDrawer}>
                关闭
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={applyDrawerTheme}
                disabled={themePreviewLocked}
                title={themePreviewLocked ? "AI 正在生成，完成后才能切换主题" : undefined}
              >
                <Check />
                使用此主题
              </button>
            </div>
          </aside>
        </div>
      )}

      {activeView === "theme" && themeSpecimenPresetId && (
        <ThemeSpecimenDialog
          presetId={themeSpecimenPresetId}
          aboveDrawer
          onClose={() => setThemeSpecimenPresetId(undefined)}
        />
      )}

      {activeView === "settings" && (
        <main className="feature-workspace settings-workspace">
          <header className="feature-header">
            <div>
              <Settings />
              <div>
                <h1>{t("settings.title")}</h1>
                <p>{t("settings.description")}</p>
              </div>
            </div>
          </header>
          <div className="feature-scroll">
            <SettingsWorkspace language={uiLanguage} onLanguageChange={setUiLanguage} onMessage={setTaskStatus} />
          </div>
        </main>
      )}

      {insertTableOpen && (
        <InsertTableDialog
          onClose={() => setInsertTableOpen(false)}
          onInsert={(columns, rows) => {
            execute({ type: "add-table", slideId: activeSlide.id, columns, rows });
            setInsertTableOpen(false);
            setTaskStatus(`已插入 ${rows + 1} 行 × ${columns} 列表格`);
          }}
        />
      )}

      {insertChartOpen && (
        <InsertChartDialog
          onClose={() => setInsertChartOpen(false)}
          onInsert={(kind) => {
            execute({ type: "add-chart", slideId: activeSlide.id, kind });
            setInsertChartOpen(false);
            setTaskStatus("已插入图表；可在属性面板修改示例指标");
          }}
        />
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
                      <p className="design-progress-detail">
                        {designDetail ? `${designDetail} · ` : ""}已用时 {formatElapsed(designElapsed)}
                      </p>
                      <small>设计阶段按模型流式写出的页数推进，校验与渲染按真实节点更新</small>
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
                  {designQualityReport.themeDirectionAudit && (
                    <p>
                      主题方向：
                      {designQualityReport.themeDirectionAudit.status === "sent"
                        ? "已接入"
                        : designQualityReport.themeDirectionAudit.status === "partial"
                          ? "部分生效"
                          : "未接入"}
                      · {designQualityReport.themeDirectionAudit.notes.join(" ")}
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
            {designQualityReport.templateFit && (
              <div className="design-quality-template">
                <h3>模板符合度</h3>
                <div className="design-review-toolbar">
                  <span>模板目标</span>
                  <div>
                    <button
                      type="button"
                      disabled={!selectedTemplate || !templateAnalysis}
                      onClick={refreshTemplateTarget}
                    >
                      重新编译目标
                    </button>
                    <button type="button" onClick={clearTemplateTarget}>
                      清除目标
                    </button>
                  </div>
                </div>
                {designQualityReport.templateFit.checked ? (
                  <>
                    <p className="design-quality-notes">
                      模板「{designQualityReport.templateTargetName ?? designQualityReport.templateName}」·{" "}
                      {designQualityReport.templateFit.score}/100（阈值 {designQualityReport.templateFit.threshold}）·{" "}
                      {designQualityReport.templateFit.issues.length} 处偏差 · 版式覆盖{" "}
                      {designQualityReport.templateFit.layoutCoverage}/{designQualityReport.templateFit.checkedSlides}{" "}
                      页{designQualityReport.templateFit.passed ? " · 已达标" : " · 未达标"}
                    </p>
                    {designQualityReport.templateFit.issues.length === 0 ? (
                      <div className="template-empty">标题轴线、内容区和字号都贴合上传模板。</div>
                    ) : (
                      <ul className="export-report-list">
                        {designQualityReport.templateFit.issues.map((issue, index) => (
                          <li
                            key={`${issue.code}-${issue.slideIndex}-${index}`}
                            className={issue.severity === "error" ? "error" : "warning"}
                          >
                            <CircleAlert />
                            <div>
                              <strong>
                                第 {issue.slideIndex + 1} 页 · {templateFitLabels[issue.code]}
                              </strong>
                              <p>{issue.message}</p>
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
                  </>
                ) : (
                  <p className="design-quality-warning">
                    上传模板没有可用的标题或内容占位符，模板符合度未执行；本次视觉结论不能视为已按模板验收。
                  </p>
                )}
              </div>
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
                {designQualityReport.visualEvidence && (
                  <p className="design-quality-notes">
                    评审依据：{reviewEvidenceLabel(designQualityReport.visualEvidence)}
                  </p>
                )}
                {designQualityReport.deckReview && (
                  <p className="design-quality-notes">
                    整册总览：一致性 {designQualityReport.deckReview.consistencyScore}、重复控制{" "}
                    {designQualityReport.deckReview.repetitionScore ?? "未评"}、主题匹配{" "}
                    {designQualityReport.deckReview.themeFitScore ?? "未评"}、独特性{" "}
                    {designQualityReport.deckReview.distinctivenessScore ?? "未评"}、概念{" "}
                    {designQualityReport.deckReview.conceptScore ?? "未评"}
                    {designQualityReport.deckReview.conceptCapApplied ? "（总分已封顶）" : ""}
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
                    {designQualityReport.visualReview.visualFocusScore ?? "未评"}、独特性{" "}
                    {designQualityReport.visualReview.distinctivenessScore ?? "未评"}、概念{" "}
                    {designQualityReport.visualReview.conceptScore ?? "未评"}
                    {designQualityReport.visualReview.conceptCapApplied ? "（总分已封顶）" : ""}）
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

      {directionOptions && (
        <DesignDirectionDialog
          options={directionOptions}
          regenerations={directionRegenerations}
          onSelect={(id, words) =>
            directionChoiceRef.current?.({
              kind: "select",
              id,
              ...(words?.trim() ? { words: words.trim() } : {}),
            })
          }
          onSkip={(words) =>
            directionChoiceRef.current?.({
              kind: "skip",
              ...(words?.trim() ? { words: words.trim() } : {}),
            })
          }
          onRetry={() => directionChoiceRef.current?.({ kind: "retry" })}
        />
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
                    {exportReport.themeColors.length > 0
                      ? ` · 主题色 ${exportReport.themeColors.join("、")}（${exportReport.themeColorReferences} 处对象引用）`
                      : ""}
                    {exportReport.nativeAnimationCount > 0 ? ` · ${exportReport.nativeAnimationCount} 个原生动画` : ""}
                    {exportReport.nativeAnimationSkipped > 0
                      ? ` · ${exportReport.nativeAnimationSkipped} 个动画未写入`
                      : ""}
                    {exportReport.nativeTransitionCount > 0
                      ? ` · ${exportReport.nativeTransitionCount} 页原生切换`
                      : ""}
                    {exportReport.tasteLint
                      ? ` · 体检 ${exportReport.tasteLint.hard} 硬底线 / ${exportReport.tasteLint.soft} 提示`
                      : " · 体检未执行"}
                    {exportReport.templateFit
                      ? exportReport.templateFit.checked
                        ? ` · 模板符合度 ${exportReport.templateFit.score}/100${exportReport.templateFit.passed ? "" : "（未达标）"}`
                        : " · 模板符合度未执行"
                      : ""}
                    {exportReport.parity
                      ? exportReport.parity.passed
                        ? ` · 回读 ${exportReport.parity.checked.slides} 页通过`
                        : ` · 回读 ${exportReport.parity.issues.length} 处不一致`
                      : " · 回读未执行"}
                    {exportReport.assetProvenance.verified +
                      exportReport.assetProvenance.pending +
                      exportReport.assetProvenance.user +
                      exportReport.assetProvenance.missing >
                    0
                      ? ` · 素材 已核验 ${exportReport.assetProvenance.verified} / 待核验 ${exportReport.assetProvenance.pending} / 未标注 ${exportReport.assetProvenance.missing}`
                      : ""}
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
            {exportReport.parity && !exportReport.parity.passed && (
              <ul className="export-report-list">
                {exportReport.parity.issues.slice(0, 12).map((issue, index) => (
                  <li key={`parity-${issue.slideIndex}-${issue.kind}-${index}`} className="warning">
                    <CircleAlert />
                    <div>
                      <strong>回读不一致 · 第 {issue.slideIndex + 1} 页</strong>
                      <p>
                        {parityIssueLabel(issue.kind)}：期望 {String(issue.expected)}，实际 {String(issue.actual)}
                      </p>
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

      {templateMenu && (
        <div
          className="template-menu-backdrop"
          role="presentation"
          onMouseDown={() => setTemplateMenu(undefined)}
          onContextMenu={(event) => {
            event.preventDefault();
            setTemplateMenu(undefined);
          }}
        >
          <div
            className="template-context-menu"
            role="menu"
            style={{ left: templateMenu.x, top: templateMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <strong>{templateMenu.template.name}</strong>
            <button type="button" role="menuitem" onClick={() => void handleRenameTemplate(templateMenu.template)}>
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void handleDeleteTemplate(templateMenu.template)}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {importChoice && (
        <ImportModeDialog
          fileName={importChoice.name}
          busy={importBusy}
          progress={importProgress}
          onCancelImport={importProgress ? () => void handleCancelImport() : undefined}
          onClose={() => {
            setImportChoice(undefined);
            setTaskStatus("已取消打开");
          }}
          onImportContent={() => void handleImportContent()}
          onExtractTemplate={() => void handleExtractTemplate()}
        />
      )}

      {importPreview && (
        <ImportReportDialog
          fileName={importPreview.fileName}
          report={importPreview.report}
          onCancel={() => {
            setImportPreview(undefined);
            setTaskStatus("已取消导入，当前项目未改变");
          }}
          onConfirm={() => void handleConfirmImport()}
        />
      )}

      {contentHistoryOpen && (
        <ContentHistory
          document={document}
          onClose={() => setContentHistoryOpen(false)}
          onRestore={restoreContentVersion}
          onRestoreDesign={restoreContentVersionWithDesign}
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
          <p>
            {designProgress.label}
            {designDetail ? ` · ${designDetail}` : ""} · 已用时 {formatElapsed(designElapsed)}
          </p>
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
                // A gate waiting for a choice must be released, or cancel
                // leaves the task running behind a closed dialog.
                directionChoiceRef.current?.({ kind: "skip" });
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

      {slideRewrite && rewriteSlide && (
        <SlideRewriteDialog
          slideIndex={slideRewrite.index}
          title={rewriteSlide.title}
          body={rewriteSlide.body}
          speakerNotes={rewriteSlide.speakerNotes}
          status={slideRewrite.status}
          proposal={slideRewrite.proposal}
          error={slideRewrite.error}
          defaultInstruction={slideRewrite.instruction}
          onGenerate={(instruction) => void runSlideRewrite(instruction)}
          onApply={applySlideRewrite}
          onClose={closeSlideRewrite}
        />
      )}

      {slideAssist?.kind === "title" && assistSlide && (
        <SlideTitleDialog
          slideIndex={slideAssist.index}
          currentTitle={assistSlide.title}
          status={slideAssist.status}
          candidates={slideAssist.candidates}
          error={slideAssist.error}
          onPick={applyTitleAssist}
          onRetry={() => void runTitleAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}

      {slideAssist?.kind === "notes" && assistSlide && (
        <SpeakerNotesDialog
          slideIndex={slideAssist.index}
          title={assistSlide.title}
          currentNotes={assistSlide.speakerNotes}
          status={slideAssist.status}
          proposal={slideAssist.proposal}
          error={slideAssist.error}
          onApply={applyNotesAssist}
          onRetry={() => void runNotesAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}

      {slideAssist?.kind === "split" && assistSlide && (
        <SplitSlideDialog
          slideIndex={slideAssist.index}
          title={assistSlide.title}
          status={slideAssist.status}
          pages={slideAssist.pages}
          error={slideAssist.error}
          onApply={applySplitAssist}
          onRetry={() => void runSplitAssist(slideAssist.index)}
          onClose={closeSlideAssist}
        />
      )}

      {deckReview && (
        <DeckReviewDialog
          status={deckReview.status}
          issues={deckReview.issues}
          error={deckReview.error}
          onJump={jumpToDeckReviewIssue}
          onRewriteIssue={rewriteFromDeckReviewIssue}
          onRetry={() => void runDeckReview()}
          onClose={closeDeckReview}
        />
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
