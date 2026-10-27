import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMU_PER_INCH,
  emu,
  createDocument,
  type DesignDirectionRecord,
  type ElementId,
  type DocumentId,
  type PresentationDocument,
  type TextElement,
  type SupportedImageMimeType,
  nextTextSize,
  normalizeTextFormat,
  visibleElements,
  isElementVisible,
} from "../core/document-model";
import {
  applyCommand,
  buildDesignCandidates,
  buildDirectionPreviewPages,
  designWithRecipe,
  directionContentFingerprint,
  importedDeckToDocument,
  inspectAiDesignedDraftCompilation,
  type AiSlideDesign,
  type AiVisualAssetData,
  type DirectionPreviewCommandBase,
  type DocumentCommand,
  type ImportReport,
  type DesignDraftCompileReport,
} from "../core/commands";
import {
  CONCEPT_PRESET_LABELS,
  defaultConceptForPreset,
  defaultEditorialConcept,
  resolveDeckConcept,
  type AiDeckConcept,
  type DeckConcept,
  type RecipeId,
} from "../core/design/deck-concept";
import { RECIPE_CATALOG } from "../core/layout/recipes/catalog";
import { summarizeDesignMetrics, type DesignMetrics } from "../core/design/design-metrics";
import {
  auditThemeDirection,
  themeDirectionForPreset,
  type ThemeDirection,
  type ThemeDirectionAudit,
} from "../core/design/theme-direction";
import { setTextMeasurer } from "../core/rendering/text-metrics";
import { auditDeckLayout } from "../core/layout/deck-audit";
import { auditSlideLayout } from "../core/layout/layout-audit";

import { createCanvasTextMeasurer } from "../services/text-metrics-canvas";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";

import { useFormatPainterStore } from "../store/format-painter";

import { useSnapContext } from "../features/editor/use-snap-context";

import { useCanvasGuidesStore } from "../store/canvas-guides-store";

import { useMarqueeSelection } from "../features/editor/use-marquee-selection";
import { fitZoom } from "../core/rendering/viewport";

import { type ImagePromptAssist } from "../features/ai/ContentReview";
import { type DirectionOptionView } from "../features/ai/DesignDirectionDialog";

import { selectedFacts } from "../features/ai/facts";

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
import {
  generateDeckVisualAssets,
  planAssetTopUp,
  planVisualAssets,
  requestVisualAsset,
  type GeneratedVisualAsset,
} from "../services/ai-visual-asset";
import type { AiVisualAssetRole } from "../core/commands/visual-asset";

import { bodyFromBlocks } from "../services/ai-draft-content";

import {
  deleteAiHistoryEntry,
  loadAiHistory,
  saveAiHistory,
  saveAiPresentation,
  type AiHistoryEntry,
} from "../services/ai-history";
import { loadRecentProjects, type RecentProjectEntry } from "../services/app-database";
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
  type AiPresentationDesign,
  type AiPresentationDesignResult,
  type AiVisualAssetIntent,
  type ContentCheck,
  type DeckReviewIssue,
  type SlideRewriteSuggestion,
  type SourceFact,
  type SplitSlidePage,
} from "../services/ai-service";
import { applyTheme, applyUiFont, applyUiLanguage, defaultSettings, loadSettings } from "../services/settings";
import { DESIGN_DIRECTIONS_PROMPT_VERSION, DESIGN_PROMPT_VERSION } from "../services/ai-service";
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
import { recordAppError, recordAppLog } from "../services/app-log";
import { variantCanEnterGallery } from "../services/variant-quality-policy";
import { recordDesignCandidateEvent } from "../services/design-candidate-usage";
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
import { useDiagnostics } from "./use-diagnostics";
import { useClipboard } from "./use-clipboard";
import { useAnimationPreview } from "./use-animation-preview";
import { defaultThemePreset, findThemePreset, type ThemePreset } from "../core/design/theme-presets";
import { themePresetAiPrompt, themePresetGuidance } from "../core/design/theme-preset-guidance";
import { themePresetMetadata } from "../core/design/theme-preset-metadata";
import {
  applyStyleProfileToThemeDirection,
  findStyleProfile,
  styleConstraintForProfile,
  styleProfilesForDirections,
  STYLE_PROFILES,
  type StyleConstraint,
  type StyleProfile,
  type StyleProfileId,
} from "../core/design/style-profiles";

import {
  planThemePresetVariants,
  rankThemePresets,
  type ThemeContentSignals,
  type ThemePresetChoice,
} from "../core/design/theme-preset-ranking";
import { rankStyleProfiles } from "../core/design/style-profile-ranking";
import { defaultPresentationVisualGoal, type VisualReview } from "../services/visual-alignment";
import {
  documentContentFingerprint,
  qualityStageCanCommit,
  runDesignQualityStage,
  summarizeQualityIssues,
  type ReviewEvidence,
} from "../services/design-quality-stage";
import {
  validatePresentationVisualQuality,
  type PresentationQualityIssue,
} from "../services/presentation-quality-gate";
import { DisabledVisionReviewPort, TauriVisionReviewPort } from "../services/vision-review-port";
import { probeTemplateBackground, type TemplateBackgroundProbe } from "../services/template-background";
import type { ExportReport } from "../features/pptx-export/export-pptx";
import { renderRealPptxForReview } from "../features/pptx-export/render-real-pptx";
import { runManualVisualReview } from "../services/manual-visual-review";
import {
  applyTemplateToGoal,
  buildTemplateReviewTarget,
  templateTargetMatchesDocument,
  type TemplateFitReport,
} from "../services/template-review-target";
import { renderPresentationForVisualReview, renderPresentationPages } from "../services/presentation-renderer";
import { buildPreviewAssets } from "../services/preview-placeholder";
import {
  candidateAestheticGate,
  compositionHomogeneity,
  type AestheticScore,
} from "../services/design-aesthetic-score";
import { recoverMissingVisualAssets, variantFailureMessage } from "../services/variant-batch-recovery";
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

import { readImageSize } from "./image-size";

import {
  CANVAS_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_WIDTH_KEY,
  readInspectorWidth,
  matchTemplateLayoutRender,
  presetTemplateAnalysis,
  shouldAutoDismissPageMessage,
} from "./app-shared";
import type {
  AppView,
  DesignCandidateView,
  DesignProgress,
  DirectionChoice,
  PageMessage,
  TemplateLayoutRender,
} from "./app-shared";
import type { VariantBatchFailureView, VariantBatchProgress, VariantOptionView } from "./app-shared";
import { directionPreviewIndexes } from "./direction-preview-selection";

/** The facts the theme ranking reads. Nothing here is invented by the batch. */
function themeSignalsFromDraft(draft: AiDraft): ThemeContentSignals {
  let chartCount = 0;
  let tableCount = 0;
  let metricCount = 0;
  let imageSlotCount = 0;
  for (const slide of draft.slides) {
    for (const block of slide.blocks ?? []) {
      if (block.type === "chart") chartCount += 1;
      else if (block.type === "table-data") tableCount += 1;
      else if (block.type === "metric") metricCount += 1;
    }
    if (slide.plan?.visualAsset?.enabled) imageSlotCount += 1;
  }
  return {
    title: draft.title,
    bodyText: draft.slides.map((slide) => `${slide.title} ${slide.body}`).join(" "),
    slideCount: draft.slides.length,
    chartCount,
    tableCount,
    metricCount,
    imageSlotCount,
  };
}

/** Cover plus the first page with real copy: the two pages a variant card shows. */
function variantPreviewIndexes(draft: AiDraft): number[] {
  const contentIndex = draft.slides.findIndex((slide, index) => index > 0 && slide.body.trim().length >= 60);
  const fallback = Math.min(1, draft.slides.length - 1);
  const second = contentIndex > 0 ? contentIndex : fallback;
  return second === 0 ? [0] : [0, second];
}

/** A generated picture in the shape the document command accepts. */
function toDocumentAssets(assets: readonly GeneratedVisualAsset[]): AiVisualAssetData[] {
  return assets.map((asset) => ({
    slideIndex: asset.slideIndex,
    dataUrl: asset.dataUrl,
    mimeType:
      asset.mimeType === "image/jpeg" ? "image/jpeg" : asset.mimeType === "image/webp" ? "image/webp" : "image/png",
    naturalWidth: asset.naturalWidth,
    naturalHeight: asset.naturalHeight,
    altText: asset.altText,
    ...(asset.focalPoint ? { focalPoint: asset.focalPoint } : {}),
  }));
}

/** The preset the picker marks as recommended, for this reviewed draft. */
function recommendedPresetFor(title: string, draft?: AiDraft): ThemePresetChoice {
  return rankThemePresets(draft ? themeSignalsFromDraft(draft) : { title })[0]!;
}

/**
 * The deck-level part of the generation command a one-page candidate reuses.
 *
 * Per-page fields are omitted: the candidate supplies its own design and page
 * context. `designDirection` is also omitted because its fingerprint covers the
 * whole deck; replaying it against a one-page build would look stale.
 */
function candidateCommandBase(
  command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>,
): DirectionPreviewCommandBase {
  const {
    type: _type,
    title: _title,
    slides: _slides,
    designs: _designs,
    designConcept: _concept,
    pageContext: _pageContext,
    pageSize: _pageSize,
    designDirection: _designDirection,
    ...base
  } = command;
  return base;
}

export function useAppRuntime() {
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
  const [exportBusy, setExportBusy] = useState(false);
  const [exportReport, setExportReport] = useState<ExportReport>();
  const [exportPreflightOpen, setExportPreflightOpen] = useState(false);
  const [contentHistoryOpen, setContentHistoryOpen] = useState(false);
  const [importChoice, setImportChoice] = useState<PresentationFileSelection>();
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    document: PresentationDocument;
    report: ImportReport;
  }>();
  const [importProgress, setImportProgress] = useState<PptxImportProgress>();
  const [importRequestId, setImportRequestId] = useState<string>();
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
  /**
   * 界面语言。它只影响 PPTD 自己的文案，不属于文档状态，因此不会改变
   * revision，也不进入撤销栈。
   */
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("zh");
  const t = useMemo(() => createTranslator(uiLanguage), [uiLanguage]);
  const { diagnosticsOpen, setDiagnosticsOpen, logRecords, logLoading, logLocation, loadDiagnostics, openDiagnostics } =
    useDiagnostics();

  const [aiTopic, setAiTopic] = useState("");
  /**
   * 用户粘贴的参考素材（年报、报告、会议纪要）。
   *
   * 素材只在本机内存里用于抽取事实，不随主题历史保存：它往往比主题长得多，
   * 也可能含内部数据，存进生成历史会让"重来一次"变成一次数据留存。
   */
  const [aiMaterial, setAiMaterial] = useState("");
  /** 从素材里抽出的事实；undefined 表示还没抽过。 */
  const [aiFacts, setAiFacts] = useState<SourceFact[]>();
  /** 不参与本次生成的事实编号。默认全部参与，勾掉才是例外。 */
  const [aiExcludedFacts, setAiExcludedFacts] = useState<ReadonlySet<string>>(new Set());
  const [aiExtracting, setAiExtracting] = useState(false);
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
  /**
   * 单页重写的状态。候选版本只活在这里：用户点"替换本页"之前，草稿不会被改动。
   */
  type SlideRewriteState = {
    index: number;
    status: "editing" | "running" | "ready" | "error";
    proposal?: SlideRewriteSuggestion;
    error?: string;
    /** 从审稿问题进来时预填的改写要求；对话框关闭即丢弃。 */
    instruction?: string;
  };
  const [slideRewrite, setSlideRewrite] = useState<SlideRewriteState>();
  const slideRewriteRef = useRef<SlideRewriteState | undefined>(undefined);
  /** 让关掉对话框之后的在途响应失效。 */
  const slideRewriteRequestId = useRef(0);
  /** 后端取消本页重写用的任务号。 */
  const slideRewriteTaskId = useRef(0);
  /**
   * 换标题、写备注、拆页三个入口共用一套状态：它们都只开一个对话框，
   * 同一时间只允许一个在途请求。
   */
  type SlideAssistState =
    | { kind: "title"; index: number; status: "running" | "ready" | "error"; candidates?: string[]; error?: string }
    | { kind: "notes"; index: number; status: "running" | "ready" | "error"; proposal?: string; error?: string }
    | { kind: "split"; index: number; status: "running" | "ready" | "error"; pages?: SplitSlidePage[]; error?: string };
  const [slideAssist, setSlideAssist] = useState<SlideAssistState>();
  const slideAssistRef = useRef<SlideAssistState | undefined>(undefined);
  type DeckReviewState = {
    status: "running" | "ready" | "error";
    issues?: DeckReviewIssue[];
    error?: string;
  };
  const [deckReview, setDeckReview] = useState<DeckReviewState>();
  /** 单页 AI 操作的请求号与后端任务号；关掉对话框后在途响应作废。 */
  const assistRequestId = useRef(0);
  const assistTaskId = useRef(0);
  /** 配图描述候选是行内的，只跟着活动页走，因此用自己的请求号。 */
  const [imagePromptAssist, setImagePromptAssist] = useState<ImagePromptAssist>();
  const imagePromptRequestId = useRef(0);
  const imagePromptTaskId = useRef(0);
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
  const [themeSpecimenPresetId, setThemeSpecimenPresetId] = useState<string>();
  const [templateLibrary, setTemplateLibrary] = useState<TemplateRecord[]>([]);
  const [templatePreview, setTemplatePreview] = useState<string | null>();
  const [templateAnalysis, setTemplateAnalysis] = useState<TemplateAnalysis>();
  const [templateLayoutRenders, setTemplateLayoutRenders] = useState<TemplateLayoutRender[]>([]);
  const [templatePreviewBusy, setTemplatePreviewBusy] = useState(false);
  const [templateUploadOpen, setTemplateUploadOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateMenu, setTemplateMenu] = useState<{ template: TemplateRecord; x: number; y: number }>();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [themePresetId, setThemePresetId] = useState("");
  const [styleProfileId, setStyleProfileId] = useState<StyleProfileId | "">(() => {
    try {
      const stored = window.localStorage.getItem("pptd.style-profile");
      return STYLE_PROFILES.some((profile) => profile.id === stored) ? (stored as StyleProfileId) : "";
    } catch {
      return "";
    }
  });
  /**
   * 后台生成期间只允许预览主题详情：这里存的是抽屉里正在看的主题，
   * 与真正选中的 themePresetId 分开，避免任务浮层显示的主题和实际生成稿不一致。
   */
  const [themePreviewPresetId, setThemePreviewPresetId] = useState("");
  const [designBusy, setDesignBusy] = useState(false);
  const designBusyRef = useRef(false);
  /**
   * 批量版本：AI 挑模板，一次排完，用户只挑一版。
   *
   * 设计结果留在 ref 里而不是 state 里：八套完整版式每页都可能上千个字段，
   * 放进 React 状态只会让每次进度刷新都深比较一遍，而画廊需要的只是预览图。
   */
  const [variantOptions, setVariantOptions] = useState<VariantOptionView[]>();
  const [variantBatch, setVariantBatch] = useState<VariantBatchProgress>();
  const [variantBatchFailures, setVariantBatchFailures] = useState<VariantBatchFailureView[]>([]);
  const variantDesignsRef = useRef(
    new Map<
      string,
      {
        presetId: string;
        styleProfileId: StyleProfileId;
        concept: DeckConcept;
        design: AiPresentationDesign;
        /** The batch's pictures, reused when this version is kept. */
        visualAssets?: readonly GeneratedVisualAsset[];
      }
    >(),
  );
  /** 方向门：两个真实预览，等用户选择或跳过。 */
  const [directionOptions, setDirectionOptions] = useState<DirectionOptionView[]>();
  const [directionRegenerations, setDirectionRegenerations] = useState(0);
  const directionChoiceRef = useRef<((choice: DirectionChoice) => void) | null>(null);
  const directionPreviewRenderersRef = useRef(new Map<string, () => Promise<string[]>>());
  /** Full previews are expensive AI work. Keep both the in-flight promise and
   * its result so reopen/double-click/final selection never pay twice. */
  const directionFullDesignsRef = useRef(new Map<string, Promise<AiPresentationDesign>>());
  const directionRenderedPagesRef = useRef(new Map<string, Promise<string[]>>());
  const renderDirectionPreview = (id: string): Promise<string[]> => {
    const render = directionPreviewRenderersRef.current.get(id);
    return render ? render() : Promise.reject(new Error("DIRECTION_PREVIEW_MISSING"));
  };
  /**
   * The last design that was actually committed to this document.
   *
   * The AI design inputs live only in the generation run; they are not part of
   * the project schema yet. Keeping them in a ref makes “换一版” work for the
   * session without pretending a reopened project still has the context. The
   * signatures guard against rebuilding a page the user has edited since.
   */
  const designCandidateContextRef = useRef<
    | {
        command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }>;
        designs: AiSlideDesign[];
        concept: DeckConcept;
        fingerprint: string;
        slideSignatures: string[];
      }
    | undefined
  >(undefined);
  const [designCandidateView, setDesignCandidateView] = useState<DesignCandidateView>();
  const [designCandidateBusy, setDesignCandidateBusy] = useState(false);
  // A project opened under the same session must not inherit the previous
  // project's generation command, even if the two decks happen to look alike.
  useEffect(() => {
    designCandidateContextRef.current = undefined;
    setDesignCandidateView(undefined);
  }, [document.id]);
  const [generatingHistoryId, setGeneratingHistoryId] = useState<string>();
  const designCancelRef = useRef(false);
  /** 设计阶段的后端取消任务号。 */
  const designTaskId = useRef(0);
  const [designProgress, setDesignProgress] = useState<DesignProgress>({ percent: 0, label: "等待开始" });
  /**
   * 设计阶段的真实细节：已设计页数、配图张数、评审轮次。
   *
   * 进度条只回答“到哪一步了”，这里回答“具体在做什么”。两者分开，百分比
   * 才不会为了显得在动而编造。
   */
  const [designDetail, setDesignDetail] = useState<string>();
  /** 已用秒数，每秒刷新。进度停在同一阶段时，它也能证明任务还活着。 */
  const [designElapsed, setDesignElapsed] = useState(0);
  const designStartedAtRef = useRef(0);
  /** 质量门未过时保留报告，让用户决定进入编辑器调整还是稍后处理。 */
  const [designQualityReport, setDesignQualityReport] = useState<{
    templateName: string;
    /** The uploaded template's display name, distinct from the deck title. */
    templateTargetName?: string;
    concept?: DeckConcept;
    themeDirection?: ThemeDirection;
    themeDirectionAudit?: ThemeDirectionAudit;
    /** 设计计划实际采用、替换或拒绝了哪些配方。 */
    compileReport?: DesignDraftCompileReport;
    /** 编译报告的扁平计数，供报告摘要和后续本地指标复用。 */
    designMetrics?: DesignMetrics;
    /** 产出这册设计的页面提示词版本。 */
    promptVersion?: string;
    issues: PresentationQualityIssue[];
    notes: string[];
    /** 视觉评审留下的结构化结论，用于在报告里逐条展示模型建议。 */
    visualReview?: VisualReview;
    visualReviewCoverage?: { reviewed: number; total: number };
    /** Template adherence measured on the same snapshot as the review. */
    templateFit?: TemplateFitReport;
    contactSheet?: string;
    deckReview?: VisualReview;
    reviewReuse?: { reviewed: number; reused: number };
    visualEvidence?: ReviewEvidence;
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
  /** The find-and-replace bar is a display mode, so it never enters the document. */
  const [findOpen, setFindOpen] = useState(false);
  /** Which input the ribbon's Find or Replace entry should focus when it opens. */
  const [findFocus, setFindFocus] = useState<"find" | "replace">("find");
  const openFindReplace = useCallback((mode: "find" | "replace") => {
    setFindFocus(mode);
    setFindOpen(true);
  }, []);
  /** Table/chart insertion dialogs live outside the document until confirmed. */
  const [insertTableOpen, setInsertTableOpen] = useState(false);
  const [insertChartOpen, setInsertChartOpen] = useState(false);
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

  const { clipboard, copySelection, pasteSelection } = useClipboard({
    documentId: document.id,
    activeSlide,
    selectedElementIds,
    execute,
    setTaskStatus,
  });

  const activeGuides = useCanvasGuidesStore((s) => s.guidesBySlide[activeSlideId]) ?? [];
  const addGuide = (axis: "x" | "y", position: number) => addGuideToSlide(activeSlide.id, axis, emu(position));
  const scale = (CANVAS_WIDTH / document.pageSize.width) * zoom;
  const canvasHeight = document.pageSize.height * scale;
  // 吸附目标一页只算一次，画布上的所有对象共用同一份。
  const snapContext = useSnapContext(activeSlide.id, document.pageSize.width, document.pageSize.height, scale);
  // 多选时属性面板显示这一组的公共信息，而不是某一个对象。
  const marquee = useMarqueeSelection({
    scale,
    // Hidden objects have no place on the canvas, so a marquee cannot catch them.
    elements: visibleElements(activeSlide),
    onSelect: (ids) => selectElements(ids),
    onClear: () => selectElement(null),
  });
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => {
    const total = activeSlide.elements.length;
    const hidden = activeSlide.elements.filter((element) => !isElementVisible(element)).length;
    return hidden > 0 ? `${total - hidden} 个对象 · ${hidden} 隐藏` : `${total} 个对象`;
  }, [activeSlide.elements]);
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
        applyUiLanguage(settings.uiLanguage);
        setUiLanguage(settings.uiLanguage);
      })
      .catch((error: unknown) => {
        const fallback = defaultSettings();
        applyTheme(fallback.theme);
        applyUiFont(fallback.uiFont);
        applyUiLanguage(fallback.uiLanguage);
        setUiLanguage(fallback.uiLanguage);
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
    if (!message || !shouldAutoDismissPageMessage(message)) return;
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
        (error: unknown) => {
          // 自动保存失败是数据安全事件：状态栏一句话会被下一次操作覆盖，
          // 日志里要留下失败的是哪一版。
          void recordAppError("自动保存", error, { revision: revisionAtStart });
          setTaskStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`);
        },
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
      setTaskStatus("请选择打开方式…");
      setImportChoice(selection);
    } catch (error) {
      setTaskStatus(`打开或导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleExtractTemplate = async () => {
    const selection = importChoice;
    if (!selection) return;
    setImportBusy(true);
    try {
      setTaskStatus(selection.format === "ppt" ? "正在安全转换旧版 PPT…" : "正在分析 PPTX…");
      const pptxPath = selection.format === "ppt" ? await convertLegacyPpt(selection.path) : selection.path;
      const imported = await importPptxTemplate(pptxPath);
      setSelectedTemplate(imported);
      setTemplateLibrary(await listPptxTemplates());
      await handleSelectTemplate(imported, false);
      setTemplatePickerOpen(true);
      setTaskStatus(`${selection.format.toUpperCase()} 已安全导入并完成结构分析：${selection.name}`);
    } catch (error) {
      setTaskStatus(`模板导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImportBusy(false);
      setImportChoice(undefined);
    }
  };

  const handleImportContent = async () => {
    const selection = importChoice;
    if (!selection) return;
    const requestId = crypto.randomUUID();
    setImportRequestId(requestId);
    setImportProgress({ requestId, current: 0, total: 0, stage: "slides" });
    setImportBusy(true);
    setTaskStatus("正在解析 PPTX 内容…");
    let unlisten: (() => void) | undefined;
    try {
      try {
        unlisten = await listenPptxImportProgress((progress) => {
          if (progress.requestId === requestId) setImportProgress(progress);
        });
      } catch {
        // Progress is optional; the import still works if the event bridge is unavailable.
      }
      const pptxPath = selection.format === "ppt" ? await convertLegacyPpt(selection.path) : selection.path;
      const imported = await importPptxContent(pptxPath, requestId, selection.format === "ppt" ? "ppt" : "pptx");
      const document = importedDeckToDocument(imported);
      setImportPreview({ fileName: selection.name, document, report: imported.report });
      setImportChoice(undefined);
      setTaskStatus(`已解析 ${imported.report.slideCount} 页，请确认导入报告`);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      setImportChoice(undefined);
      setTaskStatus(raw.includes("PPTX_IMPORT_CANCELLED") ? "已取消导入，当前项目未改变" : `导入失败：${raw}`);
    } finally {
      unlisten?.();
      setImportProgress(undefined);
      setImportRequestId(undefined);
      setImportBusy(false);
    }
  };

  const handleCancelImport = async () => {
    const requestId = importRequestId;
    if (!requestId) return;
    setTaskStatus("正在取消导入…");
    try {
      await cancelPptxImport(requestId);
    } catch (error) {
      setTaskStatus(`取消失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleConfirmImport = async () => {
    const preview = importPreview;
    if (!preview) return;
    await clearRecovery().catch(() => undefined);
    loadDocument(preview.document);
    setImageProjectPath(undefined);
    setProjectPath(undefined);
    setProjectMtime(undefined);
    setSavedRevision(-1);
    setEditorSurface("canvas");
    setImportPreview(undefined);
    setTaskStatus(`已导入 ${preview.fileName}；内容为待审核状态，请另存为新的 PPTD 项目`);
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
      void recordAppError("打开项目", error);
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
      void recordAppError("保存项目", error, { slides: document.slides.length });
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
      const exportSettings = await loadSettings().catch(() => defaultSettings());
      const task = buildPptxInWorker(exportDocument, issues, { tasteLint: exportSettings.tasteLintEnabled });
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
        `导出完成：${report.slideCount} 页，${report.nativeObjectCount} 个原生对象${report.nativeGroupCount > 0 ? `，${report.nativeGroupCount} 个原生组合` : ""}${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message === "EXPORT_CANCELLED") {
        setAgentWorkflow((state) => transitionAgentWorkflow(state, "cancelled"));
        setTaskStatus("导出已取消");
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        // 导出失败是复现成本最高的一类错误：项目、模板和字体都不在这里，
        // 只留阶段与计数，够定位是哪一步，不把正文带出去。
        void recordAppError("导出 PPTX", error, {
          slides: document.slides.length,
          hasTemplate: Boolean(document.templateStyle),
        });
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

  /**
   * 素材换了，事实清单就作废。
   *
   * 清单描述的是上一段原文：留着旧事实去生成，会把上一份材料的数字写进
   * 这一次的稿子，而且每一页都"有引用"，审核页反而看不出来。
   */
  const resetAiFacts = () => {
    setAiFacts(undefined);
    setAiExcludedFacts(new Set());
  };

  const handleMaterialFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      setTaskStatus("素材只支持 2 MB 以内的 .txt / .md 文件；其他格式请直接粘贴正文");
      return;
    }
    try {
      const text = await file.text();
      setAiMaterial(text.slice(0, 40000));
      resetAiFacts();
      setTaskStatus(`已导入素材 ${file.name}（${text.length} 字），可先抽取事实再生成`);
    } catch {
      setTaskStatus("素材文件读取失败");
    }
  };

  /** 只抽事实，不生成草稿：让人先看见、勾选、删掉不该进稿的条目。 */
  const handleExtractFacts = async () => {
    const material = aiMaterial.trim();
    if (!material || aiExtracting) return;
    setAiExtracting(true);
    setTaskStatus("AI 正在从素材中抽取事实…");
    try {
      const facts = await extractSourceFacts(aiTopic.trim() || "演示文稿", material, { taskId: aiTaskId.current });
      setAiFacts(facts);
      setAiExcludedFacts(new Set());
      setTaskStatus(facts.length > 0 ? `已抽取 ${facts.length} 条事实，可勾选后生成` : "素材里没有找到可核对的事实");
    } catch (error) {
      setTaskStatus(`事实抽取失败：${describeAiError(error)}`);
    } finally {
      setAiExtracting(false);
    }
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
    // 抽取还在跑时再发一次生成，会让同一份素材抽出两份清单。
    if (aiExtracting) return;
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
      // 素材先变成事实清单，再开始写稿：模型手里没有事实时，凭空写的数字最像真的。
      let facts: SourceFact[] = [];
      const material = aiMaterial.trim();
      let available = aiFacts;
      if (material && !available) {
        // 用户没有先点"抽取事实"：按一键生成的预期自动抽一次，结果仍然回填到清单里。
        setAiProgress({ stage: "outline", completed: 0, total: 1, label: "正在抽取素材事实…" });
        available = await extractSourceFacts(aiTopic.trim() || "演示文稿", material, { taskId });
        if (requestId !== aiRequestId.current) return;
        setAiFacts(available);
        setAiExcludedFacts(new Set());
      }
      if (available) {
        facts = selectedFacts(available, aiExcludedFacts);
        if (facts.length === 0 && available.length > 0) {
          setTaskStatus("所有素材事实都被排除，本次按无素材生成");
        }
      }
      setAgentWorkflow((state) => transitionAgentWorkflow(state, "generating-content"));
      const draft = withSlideIds(
        await generatePresentationDraft(aiTopic, requestedSlideCount, {
          facts,
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
      void recordAppError("AI 内容生成", error, { slideCount: requestedSlideCount });
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
          // 重新生成沿用这一稿已经抽取的事实：素材不随历史保存，重抽会丢依据。
          facts: current.sourceFacts ?? [],
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
      void recordAppError("AI 重新生成", error);
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

  /**
   * 打开单页重写。此时还没有任何请求：用户可以先写一段改写要求，再决定要不要
   * 花这一次调用。
   */
  const openSlideRewrite = (index: number) => {
    const slide = aiDraftRef.current?.slides[index];
    if (!slide || aiRegenerating) return;
    // 标题是重写的依据：没有标题就不知道该重写成什么，先让用户补标题。
    if (!slide.title.trim()) {
      setTaskStatus("先补全这一页的标题，AI 才能按标题重写正文");
      return;
    }
    setSlideRewrite({ index, status: "editing" });
  };

  /** 关掉对话框：在途请求要真正中断，否则窗口关了模型还在写。 */
  const closeSlideRewrite = () => {
    if (slideRewriteRef.current?.status === "running") {
      slideRewriteRequestId.current += 1;
      void cancelAiGeneration(slideRewriteTaskId.current).catch(() => undefined);
    }
    setSlideRewrite(undefined);
  };

  /** 这一页的排版预检结论：重写和拆页都要把它交给模型。 */
  const capacityNoteMessages = (index: number) => {
    const slide = aiDraftRef.current?.slides[index];
    return slide ? slideCapacityNotes(slide, index).map((note) => note.message) : [];
  };

  const runSlideRewriteFor = async (index: number, instruction: string) => {
    const draft = aiDraftRef.current;
    const slide = draft?.slides[index];
    if (!draft || !slide) return;
    const requestId = ++slideRewriteRequestId.current;
    const taskId = ++slideRewriteTaskId.current;
    setSlideRewrite((current) => ({ index, status: "running", error: undefined, instruction: current?.instruction }));
    setTaskStatus(`AI 正在重写第 ${index + 1} 页…`);
    try {
      const suggestion = await rewritePresentationSlide({
        // 主题优先用生成时那句需求；老数据没有主题时退回整册标题。
        topic: aiTopic.trim() || draft.title,
        deckTitle: draft.title,
        // 标题是整册的事实来源：模型据此避免与相邻页重复，但不得改写标题。
        outline: draft.slides.map((item) => item.title),
        slideIndex: index,
        slide: {
          title: slide.title,
          body: slide.body,
          speakerNotes: slide.speakerNotes,
          plan: slide.plan,
          blocks: slide.blocks,
        },
        instruction: instruction.trim() || undefined,
        capacityNotes: capacityNoteMessages(index),
        facts: draft.sourceFacts ?? [],
        taskId,
      });
      if (requestId !== slideRewriteRequestId.current) return;
      setSlideRewrite((current) => ({
        index,
        status: "ready",
        proposal: suggestion,
        instruction: current?.instruction,
      }));
      setTaskStatus(`AI 已给出第 ${index + 1} 页的新版本，对照后确认替换`);
    } catch (error) {
      if (requestId !== slideRewriteRequestId.current) return;
      setSlideRewrite((current) => ({
        index,
        status: "error",
        error: describeAiError(error),
        // 失败不该抹掉上一版候选：用户可能就想用那一版。
        proposal: current?.proposal,
        instruction: current?.instruction,
      }));
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
    }
  };

  const runSlideRewrite = async (instruction: string) => {
    const target = slideRewriteRef.current;
    if (!target) return;
    await runSlideRewriteFor(target.index, instruction);
  };

  /**
   * 审稿问题直接变成一次带要求的重写：打开重写对话框、预填要求并立即生成。
   * 结果仍然要人对照后确认，审稿本身不改任何文字。
   */
  const rewriteFromDeckReviewIssue = (issue: DeckReviewIssue) => {
    const slide = aiDraftRef.current?.slides[issue.slideIndex];
    if (!slide) return;
    if (!slide.title.trim()) {
      setTaskStatus("这一页还没有标题，先补全标题再重写");
      return;
    }
    const instruction = `按这条审稿意见重写本页，改的是内容而不只是措辞：${issue.message}`;
    setDeckReview(undefined);
    selectAiDraftSlide(issue.slideIndex);
    setSlideRewrite({ index: issue.slideIndex, status: "editing", instruction });
    void runSlideRewriteFor(issue.slideIndex, instruction);
  };

  /**
   * 用候选版本替换这一页。它走的是普通的内容编辑：一个撤销项、页面回到待审核、
   * AI 原稿仍可在"恢复 AI 原稿"里找回。
   */
  const applySlideRewrite = () => {
    const target = slideRewriteRef.current;
    const current = aiDraftRef.current;
    const proposal = target?.proposal;
    if (!target || !current || !proposal) return;
    const index = target.index;
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(
      `slide:${index}:rewrite`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide, slideIndex) =>
          slideIndex === index
            ? {
                ...slide,
                blocks: proposal.blocks,
                body: proposal.body,
                speakerNotes: proposal.speakerNotes,
                // 重写后的正文换了，引用也要跟着换成新版本给出的。
                factRefs: proposal.factRefs,
                // 正文换了，挂在旧内容上的核实标记不再成立。
                checks: undefined,
                reviewed: false,
              }
            : slide,
        ),
      }),
      false,
    );
    setSlideRewrite(undefined);
    setTaskStatus(`已替换第 ${index + 1} 页，可用撤销回到替换前的版本`);
  };

  /** 单页 AI 操作共用的上下文；标题为空时返回 undefined，连请求都不发。 */
  const slideAiContext = (index: number) => {
    const draft = aiDraftRef.current;
    const slide = draft?.slides[index];
    if (!draft || !slide || !slide.title.trim()) return undefined;
    return {
      topic: aiTopic.trim() || draft.title,
      deckTitle: draft.title,
      outline: draft.slides.map((item) => item.title),
      slideIndex: index,
      slide: {
        title: slide.title,
        body: slide.body,
        speakerNotes: slide.speakerNotes,
        plan: slide.plan,
        blocks: slide.blocks,
      },
    };
  };

  const runTitleAssist = async (index: number) => {
    const context = slideAiContext(index);
    if (!context) return;
    const requestId = ++assistRequestId.current;
    const taskId = ++assistTaskId.current;
    setSlideAssist({ kind: "title", index, status: "running" });
    setTaskStatus(`AI 正在为第 ${index + 1} 页拟标题…`);
    try {
      const candidates = await suggestSlideTitles({ ...context, taskId });
      if (requestId !== assistRequestId.current) return;
      setSlideAssist({ kind: "title", index, status: "ready", candidates });
      setTaskStatus(`AI 给了第 ${index + 1} 页 ${candidates.length} 个标题候选`);
    } catch (error) {
      if (requestId !== assistRequestId.current) return;
      setSlideAssist({ kind: "title", index, status: "error", error: describeAiError(error) });
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
    }
  };

  const runNotesAssist = async (index: number) => {
    const context = slideAiContext(index);
    if (!context) return;
    const requestId = ++assistRequestId.current;
    const taskId = ++assistTaskId.current;
    setSlideAssist({ kind: "notes", index, status: "running" });
    setTaskStatus(`AI 正在写第 ${index + 1} 页的演讲备注…`);
    try {
      const proposal = await writeSpeakerNotes({ ...context, taskId });
      if (requestId !== assistRequestId.current) return;
      setSlideAssist({ kind: "notes", index, status: "ready", proposal });
      setTaskStatus(`AI 写好了第 ${index + 1} 页的演讲备注，确认后替换`);
    } catch (error) {
      if (requestId !== assistRequestId.current) return;
      setSlideAssist({ kind: "notes", index, status: "error", error: describeAiError(error) });
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
    }
  };

  const runSplitAssist = async (index: number) => {
    const context = slideAiContext(index);
    if (!context) return;
    const requestId = ++assistRequestId.current;
    const taskId = ++assistTaskId.current;
    setSlideAssist({ kind: "split", index, status: "running" });
    setTaskStatus(`AI 正在拆分第 ${index + 1} 页…`);
    try {
      const pages = await splitSlideContent({
        ...context,
        capacityNotes: capacityNoteMessages(index),
        taskId,
      });
      if (requestId !== assistRequestId.current) return;
      setSlideAssist({ kind: "split", index, status: "ready", pages });
      setTaskStatus(`AI 把第 ${index + 1} 页拆成了两页，确认后替换`);
    } catch (error) {
      if (requestId !== assistRequestId.current) return;
      setSlideAssist({ kind: "split", index, status: "error", error: describeAiError(error) });
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
    }
  };

  /**
   * 配图描述候选走行内展示，不弹对话框：它就长在画面描述输入框下面。
   * 写入时把 source 设为 user，这样它压得住设计阶段自己的建议。
   */
  const runImagePromptAssist = async (index: number) => {
    const context = slideAiContext(index);
    if (!context) return;
    const requestId = ++imagePromptRequestId.current;
    const taskId = ++imagePromptTaskId.current;
    setImagePromptAssist({ index, status: "running" });
    setTaskStatus(`AI 正在为第 ${index + 1} 页想画面…`);
    try {
      const candidates = await suggestImagePrompts({ ...context, taskId });
      if (requestId !== imagePromptRequestId.current) return;
      setImagePromptAssist({ index, status: "ready", candidates });
      setTaskStatus(`AI 给了第 ${index + 1} 页 ${candidates.length} 个画面描述候选`);
    } catch (error) {
      if (requestId !== imagePromptRequestId.current) return;
      setImagePromptAssist({ index, status: "error", error: describeAiError(error) });
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
    }
  };

  const dismissImagePrompts = () => {
    if (imagePromptAssist?.status === "running") {
      imagePromptRequestId.current += 1;
      void cancelAiGeneration(imagePromptTaskId.current).catch(() => undefined);
    }
    setImagePromptAssist(undefined);
  };

  const runDeckReview = async () => {
    const draft = aiDraftRef.current;
    if (!draft) return;
    const requestId = ++assistRequestId.current;
    const taskId = ++assistTaskId.current;
    setDeckReview({ status: "running" });
    setTaskStatus("AI 正在通读全稿…");
    try {
      const issues = await reviewDeckContent({
        deckTitle: draft.title,
        presentationBrief: draft.presentationBrief,
        slides: draft.slides.map(({ title, body, speakerNotes }) => ({ title, body, speakerNotes })),
        taskId,
      });
      if (requestId !== assistRequestId.current) return;
      setDeckReview({ status: "ready", issues });
      setTaskStatus(issues.length > 0 ? `AI 审稿发现 ${issues.length} 处内容问题` : "AI 审稿没有发现内容层的问题");
    } catch (error) {
      if (requestId !== assistRequestId.current) return;
      setDeckReview({ status: "error", error: describeAiError(error) });
    } finally {
      void endAiGeneration(taskId).catch(() => undefined);
    }
  };

  /** 关掉单页 AI 对话框：在途请求作废，后端请求也真正中断。 */
  const cancelAssist = () => {
    assistRequestId.current += 1;
    void cancelAiGeneration(assistTaskId.current).catch(() => undefined);
  };

  const closeSlideAssist = () => {
    cancelAssist();
    setSlideAssist(undefined);
  };

  const closeDeckReview = () => {
    cancelAssist();
    setDeckReview(undefined);
  };

  const applyTitleAssist = (title: string) => {
    const assist = slideAssistRef.current;
    if (!assist || assist.kind !== "title") return;
    updateAiSlide(assist.index, "title", title);
    setSlideAssist(undefined);
    setTaskStatus(`已换用第 ${assist.index + 1} 页的标题，可用撤销回退`);
  };

  const applyNotesAssist = () => {
    const assist = slideAssistRef.current;
    if (!assist || assist.kind !== "notes" || !assist.proposal) return;
    updateAiSlide(assist.index, "speakerNotes", assist.proposal);
    setSlideAssist(undefined);
    setTaskStatus(`已写入第 ${assist.index + 1} 页的演讲备注`);
  };

  /**
   * 两页一起替换原页。第一页沿用原页 id 与配图意图，第二页是新页；
   * 两页都因为内容变了回到待审核。
   */
  const applySplitAssist = () => {
    const assist = slideAssistRef.current;
    if (!assist || assist.kind !== "split" || !assist.pages || assist.pages.length !== 2) return;
    const index = assist.index;
    const [firstPage, secondPage] = assist.pages;
    if (!firstPage || !secondPage) return;
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(
      `slide:${index}:split`,
      (draft) => {
        const source = draft.slides[index];
        if (!source) return draft;
        const slides = [...draft.slides];
        slides.splice(
          index,
          1,
          {
            ...source,
            ...firstPage,
            plan: { ...firstPage.plan, visualAsset: source.plan.visualAsset },
            // 内容重新分配之后，原来的核实标记已经不对应任何一段文字了。
            checks: undefined,
            reviewed: false,
          },
          {
            id: crypto.randomUUID(),
            ...secondPage,
            reviewed: false,
          },
        );
        return { ...draft, slides };
      },
      false,
    );
    setSlideAssist(undefined);
    setTaskStatus(`已把第 ${index + 1} 页拆成两页，可用撤销回退`);
  };

  const jumpToDeckReviewIssue = (index: number) => {
    selectAiDraftSlide(index);
    setDeckReview(undefined);
  };

  // Refs mirror the latest draft so the exit path can save without waiting for
  // another render, and so a close inside the debounce window is not lost.
  useEffect(() => {
    aiDraftRef.current = aiDraft;
  }, [aiDraft]);
  // 对话框的关闭、替换都读 ref：闭包里的状态可能还是上一帧的。
  useEffect(() => {
    slideRewriteRef.current = slideRewrite;
  }, [slideRewrite]);
  useEffect(() => {
    slideAssistRef.current = slideAssist;
  }, [slideAssist]);
  // 换页就收起配图候选：行内候选只属于当前这一页。
  useEffect(() => {
    imagePromptRequestId.current += 1;
    void cancelAiGeneration(imagePromptTaskId.current).catch(() => undefined);
    setImagePromptAssist(undefined);
  }, [activeDraftSlideIndex]);
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

  const removeAiHistoryEntry = (entry: AiHistoryEntry) => {
    if (designBusy && generatingHistoryId === entry.id) {
      setTaskStatus("这份草稿正在生成 PPT，完成后再删除");
      return;
    }
    if (!window.confirm(`删除“${entry.draft.title}”的草稿和已生成的 PPT？删除后无法恢复。`)) return;
    // 删除前先作废未落盘的自动保存：否则 500ms 后的 upsert 会把刚删掉的
    // 草稿写回历史，用户看到“删了又回来”。
    aiSaveTokenRef.current += 1;
    aiUnsavedRef.current = false;
    void deleteAiHistoryEntry(entry.id)
      .then((history) => {
        setAiHistory(history);
        if (activeHistoryId === entry.id) {
          setAiDraft(undefined);
          setActiveHistoryId(undefined);
          setAiTopic("");
        }
        setTaskStatus(`已删除“${entry.draft.title}”`);
      })
      .catch((error: unknown) => setTaskStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`));
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

  const updateAiBlocks = (
    index: number,
    blocks: AiDraft["slides"][number]["blocks"],
    separateHistory = false,
    blockRemap?: (oldIndex: number) => number | undefined,
  ) => {
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(
      `slide:${index}:blocks`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide, slideIndex) =>
          slideIndex === index
            ? {
                ...slide,
                blocks,
                body: bodyFromBlocks(blocks),
                // 块重排或删除时，挂在块上的核实标记跟着走；否则会指向别的内容。
                checks: blockRemap && slide.checks ? remapChecks(slide.checks, blockRemap) : slide.checks,
                reviewed: false,
              }
            : slide,
        ),
      }),
      !separateHistory,
    );
  };

  /**
   * 标记核实状态。
   *
   * 标记本身不改文字，但"新增一处待核实"意味着这一页还没核完，所以把它退回
   * 待审核；全部核实完则不会自动重新审核，仍要人点一次"已审核"。
   */
  const updateAiChecks = (index: number, checks: ContentCheck[]) => {
    forgetRestoreBackup(index);
    updateAiDraftWithHistory(
      `slide:${index}:checks`,
      (draft) => ({
        ...draft,
        slides: draft.slides.map((slide, slideIndex) =>
          slideIndex === index
            ? {
                ...slide,
                checks,
                reviewed: checks.some((check) => check.status === "unverified") ? false : slide.reviewed,
              }
            : slide,
        ),
      }),
      false,
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
  // The marked preset comes from the same ranking the batch uses, so the
  // recommendation the picker shows is always the batch's first card.
  const recommendedTheme = useMemo(
    () => recommendedPresetFor(aiDraft?.title.trim() || aiTopic.trim(), aiDraft),
    [aiDraft, aiTopic],
  );
  const recommendedThemePreset = findThemePreset(recommendedTheme.presetId) ?? defaultThemePreset();
  const recommendedStyle = useMemo(
    () =>
      rankStyleProfiles(
        aiDraft ? themeSignalsFromDraft(aiDraft) : { title: aiTopic.trim() },
        recommendedThemePreset.id,
      )[0]!,
    [aiDraft, aiTopic, recommendedThemePreset.id],
  );
  const recommendedStyleProfile = findStyleProfile(recommendedStyle.profileId) ?? STYLE_PROFILES[0]!;

  // 设计进度不再靠定时器"爬"：计时器只负责已用时，百分比由真实阶段和
  // 流式页数决定。任务结束时归零，下一次生成从头计时。
  useEffect(() => {
    if (!designBusy) {
      setDesignElapsed(0);
      return;
    }
    const tick = () => setDesignElapsed(Math.floor((Date.now() - designStartedAtRef.current) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [designBusy]);

  const continueToTheme = () => {
    if (!aiDraft) return;
    // Make the recommendation an actual default selection. The user can still
    // choose an uploaded template or another preset before generation.
    setStyleProfileId(recommendedStyleProfile.id);
    setThemePresetId(recommendedStyleProfile.themePresetId);
    setSelectedTemplate(undefined);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    setTemplatePickerOpen(true);
  };

  /**
   * Generates the deck for one reviewed draft.
   *
   * `prepared` is how the variant batch re-enters this pipeline without paying
   * for a second design pass: the chosen variant already has its design, so the
   * gate, the concept call and the design call are skipped and everything after
   * them (pictures, quality stage, project write) still runs unchanged. The
   * batch's pictures ride along too, so keeping a version does not pay for the
   * same photographs a second time.
   */
  const generateFromDraft = async (
    mode: "template" | "preset" = "template",
    draftOverride?: AiDraft,
    historyIdOverride?: string,
    prepared?: {
      presetId: string;
      styleProfileId: StyleProfileId;
      concept: DeckConcept;
      design: AiPresentationDesign;
      visualAssets?: readonly GeneratedVisualAsset[];
    },
    _options?: { skipDirectionGate?: boolean },
  ) => {
    const sourceDraft = draftOverride ?? aiDraft;
    if (!sourceDraft) return;
    if (mode === "template" && (!selectedTemplate || !templateAnalysis)) return;
    if (designBusyRef.current) {
      setTaskStatus("已有 PPT 正在生成，请等待当前任务完成");
      return;
    }
    const sourceRecommendedThemePreset =
      findThemePreset(recommendedPresetFor(sourceDraft.title.trim(), sourceDraft).presetId) ?? defaultThemePreset();
    const preparedPreset = prepared ? findThemePreset(prepared.presetId) : undefined;
    if (prepared && !preparedPreset) return;
    let preset = preparedPreset
      ? preparedPreset
      : mode === "preset"
        ? (findThemePreset(
            draftOverride ? sourceRecommendedThemePreset.id : themePresetId || sourceRecommendedThemePreset.id,
          ) ?? defaultThemePreset())
        : undefined;
    let analysis: TemplateAnalysis = preset ? presetTemplateAnalysis(preset) : templateAnalysis!;
    // The uploaded template already drives generation. Compile the same
    // analysis into a measurable target so the review prompt, the acceptance
    // gate, the repair plan and the report judge the deck against it too.
    const templateTarget = preset ? undefined : buildTemplateReviewTarget(analysis, selectedTemplate?.name);
    const visualGoal = templateTarget
      ? applyTemplateToGoal(defaultPresentationVisualGoal(), templateTarget)
      : defaultPresentationVisualGoal();
    let styleProfile = findStyleProfile(prepared?.styleProfileId ?? styleProfileId);
    let styleConstraint = styleConstraintForProfile(styleProfile);
    let themeDirection = applyStyleProfileToThemeDirection(
      preset ? themeDirectionForPreset(preset) : undefined,
      styleProfile,
    );
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
    designStartedAtRef.current = Date.now();
    setDesignElapsed(0);
    setDesignProgress({ percent: 6, label: "正在准备内容与模板数据" });
    setDesignDetail("整理已审核内容与模板分析数据");
    // Design generation is a background task. Closing the modal here releases
    // the workspace immediately; progress and cancellation remain available in
    // the global task card.
    setTemplatePickerOpen(false);
    setMessage(undefined);
    // 设计结果的页数要等模型流式写出来才知道。这里按"已设计几页"推进，
    // 不再用定时器把进度条爬到 82% 然后停住。
    let unlistenDesign: (() => void) | undefined;
    try {
      const totalSlides = Math.max(1, sourceDraft.slides.length);
      unlistenDesign = await listenAiGenerationProgress((progress) => {
        if (progress.taskId !== taskId || progress.phase !== "design") return;
        const designed = Math.min(progress.pages, totalSlides);
        // 设计返回后界面已经进入下一阶段，迟到的流式事件不能把进度拉回去。
        setDesignProgress((current) =>
          current.percent >= 70
            ? current
            : {
                percent: 20 + Math.round((48 * designed) / totalSlides),
                label: "正在生成逐页版式与配色",
              },
        );
        setDesignDetail(`已设计 ${designed}/${totalSlides} 页`);
      }).catch(() => undefined);
      setDesignProgress({ percent: 12, label: "正在规划逐页设计意图" });
      const briefs = briefsFromDraft(sourceDraft);
      const pageFacts = compositionFactsFromDraft(sourceDraft);
      setDesignDetail("已拆出每页的设计目的、视觉意图与信息密度");
      let concept!: DeckConcept;
      let designDirection: DesignDirectionRecord | undefined;
      let design: AiPresentationDesignResult | undefined;

      /**
       * Four directions, two real pages each, then the user decides.
       *
       * Only preset generations get the gate: a template already owns the
       * layout, so four directions would preview the same template four times.
       * A failure reports "unavailable" so the single-direction path can say
       * why; "undefined" means the gate did not apply at all.
       */
      type DirectionCandidate = {
        id: string;
        proposal: AiDeckConcept;
        concept: DeckConcept;
        images: string[];
        previewIndexes: number[];
        styleProfile: StyleProfile;
        themePreset: ThemePreset;
        analysis: TemplateAnalysis;
        styleConstraint: StyleConstraint;
        themeDirection: ThemeDirection;
      };
      type ChosenDirectionResult = {
        concept: DeckConcept;
        record: DesignDirectionRecord;
        design: AiPresentationDesign | undefined;
        direction: DirectionCandidate;
      };
      const directionGate = async (): Promise<ChosenDirectionResult | { unavailable: true } | undefined> => {
        if (mode !== "preset" || sourceDraft.slides.length === 0) return undefined;
        const gateSettings = await loadSettings().catch(() => defaultSettings());
        if (!gateSettings.designDirectionGate) return undefined;
        // The previews need a document for page numbers and section labels, but
        // not a designed one: a neutral draft document carries the reviewed copy.
        const baseline = createDocument();
        applyCommand(baseline, { type: "apply-ai-draft", title: sourceDraft.title, slides: sourceDraft.slides });
        // Local-only look fingerprints; empty when memory is disabled.
        const recentLooks = gateSettings.designMemoryEnabled ? await loadRecentLooks(3) : [];
        const preferences = gateSettings.designMemoryEnabled ? await loadDesignPreferences(5) : [];
        const recommendedPreset = gateSettings.designMemoryEnabled ? await recommendedConceptPreset() : undefined;
        let regenerations = 0;
        while (regenerations <= 2) {
          directionPreviewRenderersRef.current.clear();
          directionFullDesignsRef.current.clear();
          directionRenderedPagesRef.current.clear();
          setDesignProgress({ percent: 16, label: "正在生成四个设计方向" });
          setDesignDetail("为同一份内容准备四种版面骨架");
          let proposals: AiDeckConcept[];
          try {
            proposals = await generateDeckDirections(sourceDraft, briefs, analysis, {
              taskId,
              recentLooks,
              preferences: preferences.map(({ text, scope }) => ({ text, scope })),
            });
          } catch (error) {
            if (designCancelRef.current) throw error;
            // 方向提案失败会静默退回单方向，界面上只表现为"没有四个方向可选"。
            // 没有这条记录，就看不出是模型没按合同返回还是网络失败。
            void recordAppError("设计方向提案", error, { directions: 4 });
            return { unavailable: true };
          }
          if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
          setDesignDetail(`已收到 ${proposals.length} 个方向，正在渲染代表页`);
          const directionStyles = styleProfilesForDirections(styleProfile);
          // 四个方向各自有一次模型请求和两次本地渲染。串行执行把等待时间乘以
          // 四，是"设计阶段超时"最直接的原因；这里按方向并行，单个方向失败
          // 仍然只丢弃它自己，不影响其余三个。
          const previews = await Promise.all(
            proposals.map(async (proposal): Promise<DirectionCandidate | undefined> => {
              try {
                const directionStyle = directionStyles.get(proposal.preset);
                if (!directionStyle) throw new Error("DIRECTION_STYLE_MISSING");
                const directionPreset = findThemePreset(directionStyle.themePresetId);
                if (!directionPreset) throw new Error("DIRECTION_THEME_MISSING");
                const directionAnalysis = presetTemplateAnalysis(directionPreset);
                const directionConstraint = styleConstraintForProfile(directionStyle)!;
                const directionTheme = applyStyleProfileToThemeDirection(
                  themeDirectionForPreset(directionPreset),
                  directionStyle,
                )!;
                const styledProposal: AiDeckConcept = {
                  ...proposal,
                  name: directionStyle.name,
                  idea: directionStyle.summary,
                };
                const resolved = resolveDeckConcept({
                  concept: styledProposal,
                  pageFacts,
                  pageCount: sourceDraft.slides.length,
                }).concept;
                const previewIndexes = directionPreviewIndexes(sourceDraft, proposal.preset);
                const previewDraft = {
                  title: sourceDraft.title,
                  slides: previewIndexes.map((index) => sourceDraft.slides[index]!),
                  presentationBrief: sourceDraft.presentationBrief,
                };
                const previewBriefs = previewIndexes.map((index) => briefs[index]!);
                const previewDesign = await generatePresentationDesign(previewDraft, previewBriefs, directionAnalysis, {
                  concept: resolved,
                  taskId,
                  themeDirection: directionTheme,
                  styleConstraint: directionConstraint,
                });
                if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
                const pages = buildDirectionPreviewPages({
                  document: baseline,
                  concept: resolved,
                  pageIndexes: previewIndexes,
                  designs: previewDesign.slides,
                  commandBase: {
                    themePresetId: directionPreset.id,
                    styleConstraint: directionConstraint,
                    visualAssets: buildPreviewAssets(previewDesign.slides).map((asset) => ({
                      ...asset,
                      slideIndex: previewIndexes[asset.slideIndex] ?? asset.slideIndex,
                    })),
                  },
                  title: sourceDraft.title,
                });
                // 渲染是本机画布工作，两页之间没有依赖，没有理由排队。
                const rendered = await Promise.all(
                  pages.map(async (page) => (await renderPresentationForVisualReview(page.document, 640)).slides[0]!),
                );
                const id = crypto.randomUUID();
                directionPreviewRenderersRef.current.set(id, () => {
                  const cachedPages = directionRenderedPagesRef.current.get(id);
                  if (cachedPages) return cachedPages;
                  setDesignProgress({ percent: 52, label: `正在生成「${proposal.name}」整册设计` });
                  setDesignDetail(`AI 正在为 ${sourceDraft.slides.length} 页选择版式、构图与配色；完成后再本地渲染`);
                  let fullDesign = directionFullDesignsRef.current.get(id);
                  if (!fullDesign) {
                    fullDesign = generatePresentationDesign(sourceDraft, briefs, directionAnalysis, {
                      concept: resolved,
                      taskId,
                      themeDirection: directionTheme,
                      styleConstraint: directionConstraint,
                    });
                    directionFullDesignsRef.current.set(id, fullDesign);
                  }
                  const rendered = fullDesign.then((result) => {
                    setDesignProgress({ percent: 56, label: `正在渲染「${proposal.name}」整册预览` });
                    setDesignDetail(`AI 设计已返回，正在本机把 ${sourceDraft.slides.length} 页绘制为预览图`);
                    const preview = createDocument();
                    applyCommand(preview, {
                      type: "apply-ai-designed-draft",
                      title: sourceDraft.title,
                      slides: sourceDraft.slides,
                      designs: result.slides,
                      designConcept: resolved,
                      themePresetId: directionPreset.id,
                      styleConstraint: directionConstraint,
                      visualAssets: buildPreviewAssets(result.slides),
                      backgroundRhythm: defaultPresentationVisualGoal().backgroundRhythm,
                    });
                    return renderPresentationPages(preview, 960);
                  });
                  directionRenderedPagesRef.current.set(id, rendered);
                  void rendered.catch(() => {
                    directionRenderedPagesRef.current.delete(id);
                    directionFullDesignsRef.current.delete(id);
                  });
                  return rendered;
                });
                return {
                  id,
                  proposal: styledProposal,
                  concept: resolved,
                  images: rendered,
                  previewIndexes,
                  styleProfile: directionStyle,
                  themePreset: directionPreset,
                  analysis: directionAnalysis,
                  styleConstraint: directionConstraint,
                  themeDirection: directionTheme,
                };
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (designCancelRef.current || message.includes("CANCELLED")) throw error;
                // A direction whose preview cannot be drawn is not offered.
                // Which direction failed is the only way to tell a bad concept
                // from a renderer gap, so it goes to the diagnostic log.
                void recordAppError("设计方向预览", error, { preset: proposal.preset });
                return undefined;
              }
            }),
          );
          const candidates = previews.filter((candidate): candidate is DirectionCandidate => candidate !== undefined);
          if (candidates.length < 4) {
            // 四个方向是产品约定。不足四个说明提案或预览掉了，退回单方向，
            // 但不展示一张残缺的对比表；原因必须留下来，否则这次静默回退
            // 下次还会发生而没人知道。
            void recordAppLog({
              level: "warn",
              code: "AI_DIRECTIONS_INCOMPLETE",
              message: `四个设计方向只有 ${candidates.length} 个可以渲染`,
              context: { received: proposals.length, rendered: candidates.length },
            });
            return { unavailable: true };
          }
          setDirectionRegenerations(regenerations);
          setDirectionOptions(
            candidates.map((candidate) => ({
              id: candidate.id,
              name: candidate.proposal.name,
              idea: candidate.proposal.idea,
              rationale: candidate.proposal.rationale,
              presetLabel: CONCEPT_PRESET_LABELS[candidate.proposal.preset],
              ...(recommendedPreset === candidate.proposal.preset ? { recommended: true } : {}),
              images: candidate.images,
              pageCount: sourceDraft.slides.length,
            })),
          );
          setDesignDetail("等待你选择设计方向；已审核内容不会改变");
          const choice = await new Promise<DirectionChoice>((resolve) => {
            directionChoiceRef.current = resolve;
          });
          directionChoiceRef.current = null;
          setDirectionOptions(undefined);
          directionPreviewRenderersRef.current.clear();
          if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
          if (choice.kind === "retry") {
            if (regenerations >= 2) return { unavailable: true };
            regenerations += 1;
            continue;
          }
          const chosen =
            choice.kind === "select"
              ? (candidates.find((candidate) => candidate.id === choice.id) ?? candidates[0]!)
              : candidates[0]!;
          // If the user opened this direction's full preview, the complete
          // design already exists. Awaiting an already-resolved promise is
          // effectively free and lets final generation reuse it.
          const previewedDesign = directionFullDesignsRef.current.get(chosen.id)
            ? await directionFullDesignsRef.current.get(chosen.id)
            : undefined;
          const record: DesignDirectionRecord = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            contentRevision: document.revisions.content,
            contentFingerprint: directionContentFingerprint(sourceDraft.slides),
            proposals: candidates.map((candidate) => ({
              id: candidate.id,
              preset: candidate.proposal.preset,
              name: candidate.proposal.name,
              idea: candidate.proposal.idea,
              rationale: candidate.proposal.rationale,
              typeContrast: candidate.proposal.typeContrast,
              imagery: candidate.concept.imagery,
              previewPages: candidate.previewIndexes.map((index) => ({
                index,
                contentFingerprint: directionContentFingerprint([sourceDraft.slides[index]!]),
              })),
            })),
            selectedProposalId: chosen.id,
            selectedBy: choice.kind === "skip" ? "fallback" : "user",
            ...(choice.words?.trim() ? { userWords: choice.words.trim().slice(0, 200) } : {}),
            regenerations,
            promptVersion: DESIGN_DIRECTIONS_PROMPT_VERSION,
          };
          return { concept: chosen.concept, record, design: previewedDesign, direction: chosen };
        }
        return { unavailable: true };
      };

      if (prepared) {
        // The batch already designed this deck; keep the user's choice and go
        // straight to the part that costs images and review time.
        concept = prepared.concept;
        design = prepared.design;
        setDesignProgress({ percent: 70, label: "正在校验选中的版本" });
        setDesignDetail(`已收到 ${sourceDraft.slides.length} 页设计，正在核对页数与配色合法性`);
      } else {
        const gated = await directionGate();
        if (gated && "concept" in gated) {
          concept = gated.concept;
          designDirection = gated.record;
          design = gated.design;
          preset = gated.direction.themePreset;
          analysis = gated.direction.analysis;
          styleProfile = gated.direction.styleProfile;
          styleConstraint = gated.direction.styleConstraint;
          themeDirection = gated.direction.themeDirection;
          setStyleProfileId(styleProfile.id);
          setThemePresetId(preset.id);
          try {
            window.localStorage.setItem("pptd.style-profile", styleProfile.id);
          } catch {
            // The generated document still keeps the chosen style for this run.
          }
        } else {
          if (gated?.unavailable) {
            // The gate is an enhancement, not a prerequisite. Say so instead of
            // silently skipping a step the user expected.
            setTaskStatus("方向预览不可用，已按单方向生成");
          }
          setDesignProgress({ percent: 16, label: "正在确定整册设计方向" });
          setDesignDetail("模型在判断整册的视觉气质、配色与版面节奏");
          try {
            const aiConcept = await generateDeckConcepts(sourceDraft, briefs, analysis, {
              taskId,
              themeDirection,
              styleConstraint,
            });
            concept = resolveDeckConcept({
              concept: styleProfile ? { ...aiConcept, preset: styleProfile.preferredConcept } : aiConcept,
              pageFacts,
              pageCount: sourceDraft.slides.length,
            }).concept;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (designCancelRef.current || message.includes("CANCELLED")) throw error;
            // A direction is an enhancement, not a prerequisite. A failed concept
            // call falls back to the editorial preset and still produces the deck.
            concept = resolveDeckConcept({
              concept: styleProfile
                ? defaultConceptForPreset(styleProfile.preferredConcept)
                : defaultEditorialConcept(),
              pageFacts,
              pageCount: sourceDraft.slides.length,
            }).concept;
          }
        }
        if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
        if (!design) {
          setDesignProgress({ percent: 20, label: "正在生成逐页版式与配色" });
          setDesignDetail(`共 ${sourceDraft.slides.length} 页，等待模型写出第一页设计`);
          design = await generatePresentationDesign(sourceDraft, briefs, analysis, {
            taskId,
            concept,
            themeDirection,
            styleConstraint,
          });
        }
        if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
        setDesignProgress({ percent: 70, label: "正在校验 AI 设计结果" });
        setDesignDetail(`已收到 ${sourceDraft.slides.length} 页设计，正在核对页数与配色合法性`);
      }
      const hasTemplateSize = analysis.slideWidthEmu && analysis.slideHeightEmu;
      const templateColors = new Map(analysis.themeColors.map((color) => [color.name.toLowerCase(), color.value]));
      const resolveTemplateColor = (value: string | null) =>
        value?.startsWith("#") ? value : value ? templateColors.get(value.toLowerCase()) : undefined;
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
      const probeTargets = templateLayoutSources.filter((layout) =>
        Boolean(matchTemplateLayoutRender(templateLayoutRenders, layout.index, layout.name)),
      ).length;
      let probedLayouts = 0;
      if (probeTargets > 0) {
        setDesignProgress({ percent: 72, label: "正在测量模板底图对比度" });
        setDesignDetail(`正在检查 ${probeTargets} 个版式的底图`);
      }
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
          } finally {
            probedLayouts += 1;
            setDesignDetail(`已检查 ${probedLayouts}/${probeTargets} 个版式底图`);
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
      // The batch already bought most of these photographs. Regenerating the
      // pages it covered would charge the user twice for the same picture; the
      // pages it did not cover are topped up here.
      const preparedAssets = prepared?.visualAssets ?? [];
      const coveredPages = new Set(preparedAssets.map((asset) => asset.slideIndex));
      const topUp = planAssetTopUp({ decisions: assetPlan.decisions, covered: coveredPages });
      const assetTargets = topUp.targets;
      if (assetTargets > 0) {
        setDesignProgress({ percent: 76, label: "正在生成页面配图" });
        setDesignDetail(`配图 0/${assetTargets}`);
      }
      const visualAssets =
        assetTargets === 0
          ? [...preparedAssets]
          : [
              ...preparedAssets,
              ...(await generateDeckVisualAssets({
                decisions: topUp.decisions,
                prompts: assetPlan.prompts,
                onProgress: (completed, total) => {
                  setDesignProgress({
                    percent: 76 + Math.round((6 * completed) / Math.max(1, total)),
                    label: "正在生成页面配图",
                  });
                  setDesignDetail(`配图 ${completed}/${total}`);
                },
              })),
            ];
      setDesignProgress({ percent: 82, label: "正在准备导出与评审" });
      setDesignDetail("配图与底图测量已完成，开始导出 PPTX");
      const generationCommand: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }> = {
        type: "apply-ai-designed-draft",
        title: sourceDraft.title,
        slides: sourceDraft.slides,
        designs: design.slides,
        designConcept: concept,
        ...(design.layoutTrace ? { layoutTrace: design.layoutTrace } : {}),
        ...(styleConstraint ? { styleConstraint } : {}),
        ...(designDirection ? { designDirection } : {}),
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
        backgroundRhythm: visualGoal.backgroundRhythm,
        visualAssets: toDocumentAssets(visualAssets),
      };
      const buildFinalDocument = (designs: AiSlideDesign[]) => {
        const candidate = structuredClone(document);
        applyCommand(candidate, { ...generationCommand, designs });
        return candidate;
      };
      // 视觉评审、像素对比度和质量门都只做判断与修复。任何一步出错都只降级，
      // 不会把已经生成的 PPT 一起丢掉。
      const qualitySettings = await loadSettings().catch(() => defaultSettings());
      // 厂商声明的是“这家服务支持视觉”，不是“所选模型支持视觉”。先发一张
      // 小图探测；模型拒绝图片时本次直接跳过视觉评审，而不是等到整轮评审
      // 请求失败后才悄悄降级。
      const visionAvailable = qualitySettings.visionReviewEnabled
        ? await probeVisionCapability(qualitySettings.aiProviderId, qualitySettings.aiModel)
        : false;
      if (qualitySettings.visionReviewEnabled && !visionAvailable) {
        setTaskStatus("当前模型未通过图片输入探测，本次跳过视觉评审，只做确定性校验");
      }
      const stage = await runDesignQualityStage({
        initialDesigns: design.slides,
        buildDocument: buildFinalDocument,
        goal: visualGoal,
        ...(templateTarget === undefined ? {} : { template: templateTarget }),
        // 指纹必须来自修复后的真实文档快照。此前这里忽略了 designs，比较的
        // 始终是同一份生成时草稿，内容隔离守卫在生产里从未生效。
        contentFingerprint: (designs) => documentContentFingerprint(buildFinalDocument(designs)),
        // 视觉评审会把页面渲染图发送给模型服务。用户可以在设置里关闭这项
        // 上传；关闭后或模型不支持图片时只做确定性校验，并在报告里说明。
        vision: visionAvailable ? new TauriVisionReviewPort() : new DisabledVisionReviewPort(),
        taskId,
        isCancelled: () => designCancelRef.current,
        onProgress: (label, percent) => {
          // 同一阶段内多轮评审会让百分比重新经过同一个节点，进度条只能
          // 向前走；真正变化的是文案里的轮次和页数。
          setDesignProgress((current) => ({ percent: Math.max(current.percent, percent), label }));
          setDesignDetail(
            label.includes("修复")
              ? "只改被评审点名的页面，改完再复检"
              : label.includes("检查")
                ? "按 6 页一批并行送审"
                : label.includes("渲染")
                  ? "导出 PPTX，并用 PowerPoint 渲染真实页面"
                  : label.includes("不可用")
                    ? "当前模型未通过图片输入探测，只做确定性校验"
                    : undefined,
          );
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
      // Keep the compiled target in design state so reopening the project can
      // review against the same template without re-running template analysis.
      if (templateTarget) finalDocument.templateStyle = templateTarget;
      else delete finalDocument.templateStyle;
      const visualNote = stage.notes.join("；");
      // The review report used to live only in this session. Store its scores
      // in the document so reopening the project still shows what was reviewed.
      if (stage.visualReview) {
        const templateFitCounts = stage.templateFit
          ? Object.fromEntries(
              Object.entries(
                stage.templateFit.issues.reduce<Record<string, number>>((counts, issue) => {
                  counts[issue.code] = (counts[issue.code] ?? 0) + 1;
                  return counts;
                }, {}),
              ).filter(([, count]) => count > 0),
            )
          : undefined;
        const traceTemplate = finalDocument.templateStyle;
        finalDocument.reviewTraces = [
          ...(finalDocument.reviewTraces ?? []),
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            overallScore: stage.visualReview.overallScore,
            ...(stage.templateFit?.checked ? { templateFitScore: stage.templateFit.score } : {}),
            ...(traceTemplate === undefined
              ? {}
              : {
                  templateName: traceTemplate.name,
                  ...(traceTemplate.templateHash === undefined ? {} : { templateHash: traceTemplate.templateHash }),
                }),
            ...(templateFitCounts === undefined || Object.keys(templateFitCounts).length === 0
              ? {}
              : { templateFitCounts }),
            issueCount: stage.visualReview.issues.length,
            slides: (stage.visualReview.slideScores ?? []).map((item) => ({
              slideIndex: item.slideIndex,
              overallScore: item.overallScore,
            })),
          },
        ].slice(-20);
      }
      // 视觉评审只覆盖部分页面时不能走“完全通过”的静默路径：确定性质量门
      // 过了，也只代表看过的页没问题。报告必须留下，让用户看到覆盖范围。
      const coverage = stage.visualReviewCoverage;
      const visualCoverageIncomplete = coverage !== undefined && coverage.reviewed < coverage.total;
      // 视觉评审跑过但没达标（或整体失败）时，确定性质检通过也不代表稿子
      // 视觉上没问题。必须把报告留下，不能只闪一条状态就进入编辑器。
      const visualBelowTarget = stage.visualPassed === false;
      const qualityAccepted = qualityStageCanCommit(stage);
      const compileReport = inspectAiDesignedDraftCompilation(document, {
        ...generationCommand,
        designs: stage.designs,
      });
      const qualityReport = {
        templateName: deckName,
        ...(templateTarget === undefined ? {} : { templateTargetName: templateTarget.name }),
        concept,
        themeDirection,
        themeDirectionAudit: auditThemeDirection(themeDirection, concept),
        compileReport,
        designMetrics: summarizeDesignMetrics(compileReport, finalDocument.slides.length, design.designRepairs),
        promptVersion: DESIGN_PROMPT_VERSION,
        issues: [
          ...new Map(
            stage.issues.map((issue) => [`${issue.slideIndex}-${issue.issue}-${issue.message}`, issue]),
          ).values(),
        ],
        notes: [
          ...stage.notes,
          ...(design.designRepairs && design.designRepairs.length > 0
            ? [
                `设计合同有 ${design.designRepairs.length} 页未通过，已回退为安全版式：第 ${design.designRepairs
                  .map((repair) => repair.slideIndex + 1)
                  .join("、")} 页`,
              ]
            : []),
        ],
        visualReview: stage.visualReview,
        visualReviewCoverage: stage.visualReviewCoverage,
        templateFit: stage.templateFit,
        contactSheet: stage.contactSheet,
        deckReview: stage.deckReview,
        reviewReuse: stage.reviewReuse,
        visualEvidence: stage.visualEvidence,
        slideSignatures: finalDocument.slides.map((slide) => JSON.stringify(slide)),
        reviewedAt: Date.now(),
        reviewSource: stage.notes.some((note) => note.includes("真实渲染"))
          ? ("真实 PPTX" as const)
          : ("画布预览" as const),
      };
      // 成功稿也保留报告。Contact Sheet、整册评分和缓存命中是可审计证据，
      // 不能因为通过质量门就从界面中消失。
      setDesignQualityReport(qualityReport);
      setDesignQualityReportOpen(!qualityAccepted);
      if (qualityAccepted) {
        // The quality gate is a commit boundary: until every required check
        // passes, the generated candidate remains isolated from project state.
        replaceDocument(finalDocument, "both");
        designCandidateContextRef.current = {
          command: generationCommand,
          designs: stage.designs,
          concept,
          fingerprint: documentContentFingerprint(finalDocument),
          slideSignatures: finalDocument.slides.map((slide) => JSON.stringify(slide)),
        };
        if (designDirection) {
          void (async () => {
            try {
              const memorySettings = await loadSettings().catch(() => defaultSettings());
              if (!memorySettings.designMemoryEnabled) return;
              await recordDesignLook({
                document: finalDocument,
                direction: designDirection,
                ...(preset ? { themePresetId: preset.id } : {}),
              });
              if (designDirection.userWords) await recordDesignPreference(designDirection.userWords, "deck");
            } catch {
              // Memory is an enhancement, not part of the deliverable.
            }
          })();
        }
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
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "ready-to-export")
            ? transitionAgentWorkflow(state, "ready-to-export")
            : state,
        );
        setDesignProgress({ percent: 100, label: "生成完成，正在进入编辑器" });
        setDesignDetail(
          stage.reviewReuse && stage.reviewReuse.reused > 0
            ? `质检复用了 ${stage.reviewReuse.reused} 页的评审结论，已写入编辑器`
            : "已通过质检，可在编辑器中继续调整",
        );
        setTaskStatus(`PPT 已完成 AI 设计：${deckName}`);
        if (visualNote) window.setTimeout(() => setTaskStatus(visualNote), 50);
      } else {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "failed")
            ? transitionAgentWorkflow(state, "failed", { error: "QUALITY_GATE_REJECTED" })
            : state,
        );
        setDesignProgress({
          percent: 100,
          label: !stage.passed
            ? "候选稿未通过质量门，未写入项目"
            : visualCoverageIncomplete
              ? "视觉评审覆盖不完整，未写入项目"
              : "视觉评审未达到目标，未写入项目",
        });
        setDesignDetail(
          stage.issues.length > 0
            ? `${stage.issues.length} 处排版问题已记录在质检报告里`
            : visualCoverageIncomplete && coverage
              ? `视觉评审只覆盖 ${coverage.reviewed}/${coverage.total} 页`
              : "质检报告已保留，可随时查看",
        );
        setTaskStatus(
          stage.issues.length > 0
            ? `候选稿因 ${stage.issues.length} 个排版问题被拒绝，当前项目未改变：${summarizeQualityIssues(stage.issues)}`
            : !stage.passed
              ? `候选稿质检未完成，当前项目未改变：${stage.notes.join("；")}`
              : visualCoverageIncomplete && coverage
                ? `候选稿视觉评审只覆盖 ${coverage.reviewed}/${coverage.total} 页，当前项目未改变`
                : visualBelowTarget
                  ? stage.visualReview
                    ? `候选稿视觉评审未达到目标（${stage.visualReview.overallScore} 分），当前项目未改变`
                    : "候选稿视觉评审未完成，当前项目未改变"
                  : `候选稿质检未完成，当前项目未改变：${stage.notes.join("；")}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "AI_GENERATION_CANCELLED" || message.includes("AI_REQUEST_CANCELLED")) {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "cancelled") ? transitionAgentWorkflow(state, "cancelled") : state,
        );
        setDesignProgress({ percent: 0, label: "已取消生成" });
        setDesignDetail("在途请求已中断，未写入任何内容");
        setTaskStatus("已取消 AI 设计生成");
      } else {
        setAgentWorkflow((state) =>
          canTransitionAgentWorkflow(state.stage, "failed")
            ? transitionAgentWorkflow(state, "failed", { error: describeAiError(error) })
            : state,
        );
        void recordAppError("AI 设计生成", error, {
          slides: sourceDraft.slides.length,
          mode,
          hasTemplate: Boolean(selectedTemplate),
        });
        setDesignProgress({ percent: 0, label: "生成失败，请重试" });
        setDesignDetail(describeAiError(error));
        setTaskStatus(`AI 设计生成失败：${describeAiError(error)}`);
      }
    } finally {
      unlistenDesign?.();
      void endAiGeneration(taskId).catch(() => undefined);
      designBusyRef.current = false;
      setGeneratingHistoryId(undefined);
      setDesignBusy(false);
    }
  };

  /**
   * Builds several complete designs of the same reviewed content, then lets the
   * user keep one.
   *
   * The batch stops before pictures and the visual review: those are the two
   * expensive steps, and paying for them eight times to then throw seven decks
   * away is the wrong trade. What it does do is run the real design call and
   * real local rendering per version, so every card is a deck that exists —
   * picking one continues into the normal pipeline instead of re-generating.
   */
  const generateVariantBatch = async (count: number) => {
    const sourceDraft = aiDraft;
    if (!sourceDraft || sourceDraft.slides.length === 0) {
      setTaskStatus("先完成内容审核，再让 AI 批量排版");
      return;
    }
    if (designBusyRef.current) {
      setTaskStatus("已有 PPT 正在生成，请等待当前任务完成");
      return;
    }
    const plan = planThemePresetVariants(themeSignalsFromDraft(sourceDraft), count);
    const firstChoice = plan[0];
    if (!firstChoice) return;
    const previewIndexes = variantPreviewIndexes(sourceDraft);

    designBusyRef.current = true;
    designCancelRef.current = false;
    setGeneratingHistoryId(activeHistoryId);
    setDesignQualityReport(undefined);
    setVariantOptions(undefined);
    setVariantBatchFailures([]);
    setVariantBatch({ total: plan.length, completed: 0, failed: 0 });
    variantDesignsRef.current.clear();
    designTaskId.current += 1;
    const taskId = designTaskId.current;
    setDesignBusy(true);
    setAgentWorkflow((state) => {
      const prepared =
        state.stage === "reviewing-content" ? state : transitionAgentWorkflow(startAgentWorkflow(state), "planning");
      return transitionAgentWorkflow(prepared, "generating-design");
    });
    designStartedAtRef.current = Date.now();
    setDesignElapsed(0);
    setDesignProgress({ percent: 4, label: `正在准备 ${plan.length} 个版本的排版` });
    setDesignDetail("AI 按内容为每个版本组合主题、风格与版面骨架");
    try {
      const briefs = briefsFromDraft(sourceDraft);
      const pageFacts = compositionFactsFromDraft(sourceDraft);
      setDesignProgress({ percent: 6, label: `正在独立创作 ${plan.length} 个整册方向` });
      setDesignDetail("每个版本分别完成整册概念与逐页设计，不复用其他版本的骨架");
      // The previews need a document for page numbers and section labels, but
      // not a designed one: a neutral draft document carries the reviewed copy.
      const baseline = createDocument();
      applyCommand(baseline, { type: "apply-ai-draft", title: sourceDraft.title, slides: sourceDraft.slides });
      const variants: VariantOptionView[] = [];
      // Pass 1: the designs. Pass 2 renders cards from them, after the batch's
      // pictures exist — a card has to show the deck the user will keep, and the
      // picture is half of that page.
      const pending: Array<{
        id: string;
        presetId: string;
        styleProfile: StyleProfile;
        styleConstraint: StyleConstraint;
        concept: DeckConcept;
        design: AiPresentationDesign;
        name: string;
        description: string;
        reason: string;
        issueCount: number;
        issuePages: number[];
        visualAssets: GeneratedVisualAsset[];
        document: PresentationDocument;
        aesthetic: AestheticScore;
      }> = [];
      const failureRecords: VariantBatchFailureView[] = [];
      let failed = 0;
      let completed = 0;
      let nextIndex = 0;
      const createIndependentVariant = async (index: number) => {
        const choice = plan[index]!;
        if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
        const preset = findThemePreset(choice.presetId);
        if (!preset) throw new Error("VARIANT_THEME_MISSING");
        const styleChoice = rankStyleProfiles(themeSignalsFromDraft(sourceDraft), preset.id)[0];
        const variantStyle = styleChoice ? findStyleProfile(styleChoice.profileId) : undefined;
        if (!variantStyle) throw new Error("VARIANT_STYLE_MISSING");
        const variantConstraint = styleConstraintForProfile(variantStyle)!;
        const variantThemeDirection = applyStyleProfileToThemeDirection(themeDirectionForPreset(preset), variantStyle);
        const analysis = presetTemplateAnalysis(preset);

        // Independence starts here: every card gets its own model call for the
        // deck concept. No base concept or mechanically rotated skeleton is
        // shared with another card.
        const proposedConcept: AiDeckConcept = await generateDeckConcepts(sourceDraft, briefs, analysis, {
          taskId,
          themeDirection: variantThemeDirection,
          styleConstraint: variantConstraint,
        });
        const variantConcept = resolveDeckConcept({
          concept: proposedConcept,
          pageFacts,
          pageCount: sourceDraft.slides.length,
        }).concept;
        let design = await generatePresentationDesign(sourceDraft, briefs, analysis, {
          taskId,
          concept: variantConcept,
          themeDirection: variantThemeDirection,
          styleConstraint: variantConstraint,
        });
        if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
        const assetPlan = planVisualAssets({
          designs: design.slides,
          itemCounts: sourceDraft.slides.map((slide) => countSlidePoints(slide)),
          deterministicBlocks: sourceDraft.slides.map((slide) =>
            (slide.blocks ?? []).some(
              (block) => block.type !== "paragraph" && block.type !== "bullet-list" && block.type !== "quote",
            ),
          ),
          topic: sourceDraft.title,
          intents: sourceDraft.slides.map((slide) => slide.plan?.visualAsset),
        });
        const visualAssets = await generateDeckVisualAssets({
          decisions: assetPlan.decisions,
          prompts: assetPlan.prompts,
          concurrency: 2,
          previewScale: 0.35,
        });
        const recovered = recoverMissingVisualAssets({
          designs: design.slides,
          decisions: assetPlan.decisions,
          assets: visualAssets,
          itemCounts: sourceDraft.slides.map((slide) => countSlidePoints(slide)),
        });
        if (recovered.recoveredSlideIndexes.length > 0) {
          design = { ...design, slides: recovered.designs };
          void recordAppLog({
            level: "warn",
            code: "VARIANT_ASSET_FALLBACK",
            message: "候选配图未返回，已切换为无图布局家族",
            context: {
              preset: preset.id,
              pages: recovered.recoveredSlideIndexes.map((pageIndex) => pageIndex + 1),
            },
          });
        }
        const buildCandidate = (candidateDesign: AiPresentationDesignResult) => {
          const document = createDocument();
          applyCommand(document, {
            type: "apply-ai-designed-draft",
            title: sourceDraft.title,
            slides: sourceDraft.slides,
            designs: candidateDesign.slides,
            designConcept: variantConcept,
            themePresetId: preset.id,
            styleConstraint: variantConstraint,
            backgroundRhythm: defaultPresentationVisualGoal().backgroundRhythm,
            visualAssets: toDocumentAssets(visualAssets),
            ...(candidateDesign.layoutTrace ? { layoutTrace: candidateDesign.layoutTrace } : {}),
          });
          return document;
        };
        let candidate = buildCandidate(design);
        let quality = validatePresentationVisualQuality(candidate, design.slides);
        // The gate is a fixed list of checks; the card still has to say whether
        // the page it is about to show has a text that lost a line, an object
        // off the page or two texts on top of each other. A hard-coded zero made
        // that line claim "排版检查通过" for pages it had never measured.
        // The deck-level audit is counted in the same number: a title that left
        // the axis of its siblings is a layout problem the reader can see.
        let layoutAudit = auditSlideLayout(candidate);
        let deckAudit = auditDeckLayout(candidate);
        let aesthetic = candidateAestheticGate({ document: candidate, designs: design.slides, assets: visualAssets });

        // A weak composition is recompiled with another recipe family. This is
        // deliberately bounded and changes geometry instead of cosmetically
        // tweaking colour, type size or spacing around the same skeleton.
        for (
          let attempt = 0;
          attempt < 2 && (!quality.passed || layoutAudit.issues.length > 0 || !aesthetic.passed);
          attempt += 1
        ) {
          const problemPages = new Set([
            ...quality.issues.map((issue) => issue.slideIndex),
            ...layoutAudit.issues.map((issue) => issue.slideIndex),
            ...deckAudit.issues.map((issue) => issue.slideIndex),
            ...aesthetic.reasons.flatMap((reason) => {
              const match = reason.match(/:(\d+)$/);
              return match ? [Number(match[1])] : [];
            }),
          ]);
          if (problemPages.size === 0) design.slides.forEach((_slide, pageIndex) => problemPages.add(pageIndex));
          const nextSlides = [...design.slides];
          let changed = false;
          for (const pageIndex of problemPages) {
            const alternatives = buildDesignCandidates({
              document: candidate,
              slideIndex: pageIndex,
              design: design.slides[pageIndex]!,
              concept: variantConcept,
              recipes: variantConcept.recipes,
              limit: 1,
              commandBase: {
                themePresetId: preset.id,
                styleConstraint: variantConstraint,
                visualAssets: toDocumentAssets(visualAssets),
              },
            });
            const replacement = alternatives.candidates[0];
            if (!replacement) continue;
            nextSlides[pageIndex] = designWithRecipe(design.slides[pageIndex]!, replacement.recipe);
            changed = true;
          }
          if (!changed) break;
          design = { ...design, slides: nextSlides };
          candidate = buildCandidate(design);
          quality = validatePresentationVisualQuality(candidate, design.slides);
          layoutAudit = auditSlideLayout(candidate);
          deckAudit = auditDeckLayout(candidate);
          aesthetic = candidateAestheticGate({ document: candidate, designs: design.slides, assets: visualAssets });
        }
        const auditIssues = [...layoutAudit.issues, ...deckAudit.issues];
        if (
          !variantCanEnterGallery({
            deterministicPassed: quality.passed,
            aestheticPassed: aesthetic.passed,
          })
        ) {
          const reasons = [
            ...quality.issues.map((issue) => issue.issue),
            ...auditIssues.map((issue) => issue.kind),
            ...aesthetic.reasons,
          ];
          throw new Error(`VARIANT_QUALITY_GATE_FAILED:${[...new Set(reasons)].join(",")}`);
        }
        // Layout/deck audits are advisory (ADR 0115): keep the candidate and
        // surface these pages in the gallery instead of treating a typography
        // hint such as `text-orphan` as if the deck could not be delivered.
        const reportedIssues = [...quality.issues, ...auditIssues];
        const issuePages = [...new Set(reportedIssues.map((issue) => issue.slideIndex))].sort((a, b) => a - b);
        pending.push({
          id: crypto.randomUUID(),
          presetId: preset.id,
          styleProfile: variantStyle,
          styleConstraint: variantConstraint,
          concept: variantConcept,
          design,
          name: `${variantStyle.name} · ${variantConcept.name}`,
          description: variantConcept.idea,
          reason: `${variantConcept.rationale}；${styleChoice?.reason ?? choice.reason}`,
          issueCount: reportedIssues.length,
          issuePages,
          visualAssets,
          document: candidate,
          aesthetic: aesthetic.score,
        });
      };
      const worker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= plan.length) return;
          try {
            await createIndependentVariant(index);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (designCancelRef.current || message.includes("CANCELLED")) throw error;
            failed += 1;
            const detail = variantFailureMessage(error);
            failureRecords.push({
              presetId: plan[index]?.presetId ?? "unknown",
              presetName: findThemePreset(plan[index]?.presetId ?? "")?.name ?? `候选 ${index + 1}`,
              ...detail,
            });
            setVariantBatchFailures([...failureRecords]);
            void recordAppError("批量版本生成", error, { preset: plan[index]?.presetId, variant: index });
          } finally {
            completed += 1;
            setDesignProgress({
              percent: 8 + Math.round((78 * completed) / plan.length),
              label: `已完成 ${completed}/${plan.length} 个独立版本`,
            });
            setDesignDetail(`合格 ${pending.length} 个，质量门淘汰或失败 ${failed} 个`);
            setVariantBatch({ total: plan.length, completed, failed });
          }
        }
      };
      // Two complete model/design pipelines are enough to keep the provider
      // busy without making four long structured requests compete for timeout.
      await Promise.all(Array.from({ length: Math.min(2, plan.length) }, () => worker()));

      // A different palette around the same page skeleton is not a distinct
      // candidate. Score each deck against its peers, reject near-duplicates,
      // then rank the survivors before the gallery labels one “AI 推荐”.
      if (pending.length > 1) {
        const homogeneity = compositionHomogeneity(pending.map((entry) => entry.design.slides));
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const entry = pending[index]!;
          const gate = candidateAestheticGate({
            document: entry.document,
            designs: entry.design.slides,
            assets: entry.visualAssets,
            homogeneity: homogeneity[index],
          });
          if (!gate.passed) {
            pending.splice(index, 1);
            failed += 1;
            failureRecords.push({
              presetId: entry.presetId,
              presetName: findThemePreset(entry.presetId)?.name ?? entry.name,
              ...variantFailureMessage(
                new Error(`VARIANT_QUALITY_GATE_FAILED:${[...new Set(gate.reasons)].join(",")}`),
              ),
            });
            setVariantBatchFailures([...failureRecords]);
          } else entry.aesthetic = gate.score;
        }
        pending.sort((left, right) => right.aesthetic.overall - left.aesthetic.overall);
      }

      // Each candidate owns its low-resolution review assets; the chosen deck
      // reuses them and only tops up pages that were not covered by the preview.
      if (pending.length > 0) {
        // Pass 2: render each independent card.
        for (const [index, entry] of pending.entries()) {
          if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
          setDesignProgress({ percent: 92 + Math.round((6 * index) / pending.length), label: "正在渲染预览" });
          setDesignDetail(`渲染「${entry.name}」的封面与正文页`);
          try {
            const pages = buildDirectionPreviewPages({
              document: baseline,
              concept: entry.concept,
              pageIndexes: previewIndexes,
              designs: previewIndexes.map((pageIndex) => entry.design.slides[pageIndex]!),
              // 真实配图优先；没有图的页退回占位块，构图照样成立。
              commandBase: {
                themePresetId: entry.presetId,
                styleConstraint: entry.styleConstraint,
                visualAssets: toDocumentAssets(entry.visualAssets),
              },
              title: sourceDraft.title,
            });
            const rendered = await Promise.all(
              pages.map(async (page) => (await renderPresentationForVisualReview(page.document, 640)).slides[0]),
            );
            variantDesignsRef.current.set(entry.id, {
              presetId: entry.presetId,
              styleProfileId: entry.styleProfile.id,
              concept: entry.concept,
              design: entry.design,
              visualAssets: entry.visualAssets,
            });
            variants.push({
              id: entry.id,
              presetId: entry.presetId,
              name: entry.name,
              description: entry.description,
              reason: entry.reason,
              images: rendered.filter((image): image is string => image !== undefined),
              pageCount: sourceDraft.slides.length,
              issueCount: entry.issueCount,
              issuePages: entry.issuePages,
              aestheticScore: entry.aesthetic.overall,
              aestheticDimensions: entry.aesthetic.dimensions,
              realAssetCount: entry.visualAssets.length,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (designCancelRef.current || message.includes("CANCELLED")) throw error;
            failed += 1;
            failureRecords.push({
              presetId: entry.presetId,
              presetName: findThemePreset(entry.presetId)?.name ?? entry.name,
              ...variantFailureMessage(error),
            });
            setVariantBatchFailures([...failureRecords]);
            void recordAppError("批量版本渲染", error, { preset: entry.presetId });
          }
          // The batch is one design pass plus one render pass over the same
          // cards, so the count of finished versions must not restart at zero
          // when the second pass begins.
          setVariantBatch({ total: plan.length, completed: pending.length + failed, failed });
        }
      }
      if (variants.length === 0) {
        setDesignProgress({ percent: 0, label: "批量生成失败" });
        setDesignDetail("所有版本都没能排出来，原因已写入诊断日志");
        setTaskStatus(`批量生成失败：${plan.length} 个版本都没有产出，请改用单版本生成或稍后重试`);
        return;
      }
      setVariantOptions(variants);
      setDesignProgress({ percent: 100, label: `${variants.length} 个版本已排好` });
      setDesignDetail("挑一版继续；其余版本会丢弃，已审核内容不会改变");
      setTaskStatus(
        failed > 0
          ? `AI 排好 ${variants.length} 个版本，另有 ${failed} 个失败；选一版继续`
          : `AI 排好 ${variants.length} 个版本，选一版继续`,
      );
      setTemplatePickerOpen(false);
    } catch (error) {
      // A failed batch has nothing worth keeping; a successful one keeps its
      // designs in the map until the user picks or discards.
      variantDesignsRef.current.clear();
      const message = error instanceof Error ? error.message : String(error);
      if (message === "AI_GENERATION_CANCELLED" || message.includes("AI_REQUEST_CANCELLED")) {
        setDesignProgress({ percent: 0, label: "已取消批量生成" });
        setDesignDetail("在途请求已中断，未写入任何内容");
        setTaskStatus("已取消批量生成");
      } else {
        setDesignProgress({ percent: 0, label: "批量生成失败，请重试" });
        setDesignDetail(describeAiError(error));
        setTaskStatus(`批量生成失败：${describeAiError(error)}`);
        void recordAppError("批量版本生成", error, { variants: plan.length });
      }
    } finally {
      setVariantBatch(undefined);
      void endAiGeneration(taskId).catch(() => undefined);
      designBusyRef.current = false;
      setGeneratingHistoryId(undefined);
      setDesignBusy(false);
    }
  };

  /** Keeps the chosen variant: the design is already paid for, only the tail runs. */
  const chooseVariant = (id: string) => {
    const variant = variantDesignsRef.current.get(id);
    if (!variant) return;
    setVariantOptions(undefined);
    variantDesignsRef.current.clear();
    void generateFromDraft("preset", undefined, undefined, variant);
  };

  /** Drops the batch and returns to the picker without writing anything. */
  const discardVariantBatch = () => {
    setVariantOptions(undefined);
    variantDesignsRef.current.clear();
    setTemplatePickerOpen(true);
  };

  const cancelVariantBatch = () => {
    designCancelRef.current = true;
    setDesignProgress((current) => ({ percent: current.percent, label: "正在取消批量生成…" }));
    void cancelAiGeneration(designTaskId.current).catch(() => undefined);
  };

  /**
   * 整册预览：把这一版已经排好的设计重新应用到已审核草稿，逐页渲染。
   *
   * 只读路径。设计数据在 ref 里，重放一次比常驻八份整册文档省内存；不用预览
   * 结果写项目、不动 revision。批量已经买过的配图直接用上，缺图的页退回占位块；
   * 渲染宽度取 960：够看清版式与断行，又不至于让一册二十页的 data URL 压满内存。
   */
  const renderVariantPreview = async (id: string) => {
    const variant = variantDesignsRef.current.get(id);
    const sourceDraft = aiDraft;
    if (!variant || !sourceDraft) throw new Error("VARIANT_PREVIEW_MISSING");
    const preview = createDocument();
    applyCommand(preview, {
      type: "apply-ai-designed-draft",
      title: sourceDraft.title,
      slides: sourceDraft.slides,
      designs: variant.design.slides,
      designConcept: variant.concept,
      themePresetId: variant.presetId,
      styleConstraint: styleConstraintForProfile(findStyleProfile(variant.styleProfileId)),
      // 与批量生成、与最终保留的那一版使用同一套背景节奏。
      backgroundRhythm: defaultPresentationVisualGoal().backgroundRhythm,
      // 批量生成的真图优先；没有图的页用占位块，而不是留白。
      visualAssets:
        variant.visualAssets && variant.visualAssets.length > 0
          ? toDocumentAssets(variant.visualAssets)
          : buildPreviewAssets(variant.design.slides),
    });
    if (preview.slides.length === 0) throw new Error("VARIANT_PREVIEW_MISSING");
    return renderPresentationPages(preview, 960);
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
    setThemePreviewPresetId("");
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

  const handleRenameTemplate = async (template: TemplateRecord) => {
    setTemplateMenu(undefined);
    const suggested = template.name.replace(/\.pptx$/i, "");
    const name = window.prompt("重命名模板", suggested);
    if (!name?.trim()) return;
    try {
      const renamed = await renamePptxTemplate(template.id, name);
      setTemplateLibrary(await listPptxTemplates());
      if (selectedTemplate?.id === template.id) setSelectedTemplate(renamed);
      setTaskStatus(`模板已重命名为“${renamed.name}”`);
    } catch (error) {
      setTaskStatus(`重命名失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteTemplate = async (template: TemplateRecord) => {
    setTemplateMenu(undefined);
    if (!window.confirm(`删除模板“${template.name}”？这不会影响已经应用该模板的当前文档。`)) return;
    try {
      await deletePptxTemplate(template.id);
      setTemplateLibrary(await listPptxTemplates());
      if (selectedTemplate?.id === template.id) {
        setSelectedTemplate(undefined);
        setTemplatePreview(undefined);
        setTemplateAnalysis(undefined);
        setTemplateLayoutRenders([]);
        setThemeDrawerOpen(false);
      }
      setTaskStatus(`已删除模板“${template.name}”`);
    } catch (error) {
      setTaskStatus(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSelectThemePreset = (presetId: string, showDetails = true) => {
    // 后台生成任务在启动时就固定了主题。任务运行期间点击卡片只打开详情预览，
    // 不改选中的主题，否则任务浮层和最终生成的稿子会对不上。
    if (designBusyRef.current && showDetails) {
      setThemePreviewPresetId(presetId);
      setThemeDrawerOpen(true);
      return;
    }
    setThemePreviewPresetId("");
    setThemePresetId(presetId);
    const matchedStyle = rankStyleProfiles(
      aiDraft ? themeSignalsFromDraft(aiDraft) : { title: aiTopic.trim() },
      presetId,
    )[0];
    if (matchedStyle) setStyleProfileId(matchedStyle.profileId);
    setSelectedTemplate(undefined);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    setThemeDrawerOpen(showDetails);
  };

  const saveShortcutRef = useRef({ handleSave, handleSaveAs });
  saveShortcutRef.current = { handleSave, handleSaveAs };

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
      if (shortcut === "save-project" || shortcut === "save-project-as") {
        event.preventDefault();
        const save = saveShortcutRef.current;
        void (shortcut === "save-project" ? save.handleSave() : save.handleSaveAs());
        return;
      }
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
      if (shortcut === "find" || shortcut === "replace") {
        if (editorSurface !== "canvas") return;
        event.preventDefault();
        openFindReplace(shortcut);
        return;
      }
      if (shortcut === "select-all") {
        if (editorSurface !== "canvas") return;
        event.preventDefault();
        const ids = activeSlide.elements
          .filter((element) => !element.locked && isElementVisible(element))
          .map((element) => element.id);
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
    openFindReplace,
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
  const handleSelectStyleProfile = (profileId: StyleProfileId) => {
    if (designBusyRef.current) {
      setTaskStatus("AI 正在生成，完成后才能切换风格");
      return;
    }
    const profile = findStyleProfile(profileId);
    if (!profile) return;
    setStyleProfileId(profile.id);
    setThemePresetId(profile.themePresetId);
    setSelectedTemplate(undefined);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    try {
      window.localStorage.setItem("pptd.style-profile", profile.id);
    } catch {
      // Browser previews without storage keep the choice for this session.
    }
    setTaskStatus(
      `设计偏好已更新：已选择「${profile.name}」，并匹配主题「${findThemePreset(profile.themePresetId)?.name ?? profile.themePresetId}」；不会修改当前 PPT`,
    );
  };
  const templateTargetPreview = useMemo(
    () =>
      selectedTemplate && templateAnalysis
        ? buildTemplateReviewTarget(templateAnalysis, selectedTemplate.name)
        : undefined,
    [selectedTemplate, templateAnalysis],
  );
  const pickerThemePreset = selectedThemePreset ?? recommendedThemePreset;
  const pickerThemeGuidance = themePresetGuidance(pickerThemePreset.id);
  const pickerStyleProfile = findStyleProfile(styleProfileId) ?? recommendedStyleProfile;
  const pickerStyleReason =
    rankStyleProfiles(aiDraft ? themeSignalsFromDraft(aiDraft) : { title: aiTopic.trim() }, pickerThemePreset.id).find(
      (choice) => choice.profileId === pickerStyleProfile.id,
    )?.reason ?? recommendedStyle.reason;
  // 抽屉里展示的主题：生成中查看的是被点击的主题（预览），其余时候就是已选主题。
  const drawerThemePreset =
    (themePreviewPresetId ? findThemePreset(themePreviewPresetId) : undefined) ?? selectedThemePreset;
  const drawerThemeGuidance = drawerThemePreset ? themePresetGuidance(drawerThemePreset.id) : undefined;
  const drawerThemeMetadata = drawerThemePreset ? themePresetMetadata(drawerThemePreset.id) : undefined;
  const drawerThemeAiPrompt = drawerThemePreset ? themePresetAiPrompt(drawerThemePreset) : undefined;
  const drawerSurfaceColor = drawerThemePreset?.theme.colors.find((color) => color.name === "surface")?.value;
  /** 生成中且预览的不是已选主题：详情可看，但不能在这里切换。 */
  const themePreviewLocked = designBusy && drawerThemePreset !== undefined && drawerThemePreset.id !== themePresetId;
  const closeThemeDrawer = () => {
    setThemeDrawerOpen(false);
    setThemePreviewPresetId("");
    setThemeSpecimenPresetId(undefined);
  };
  const applyDrawerTheme = () => {
    if (themePreviewLocked) return;
    if (drawerThemePreset) {
      setThemePresetId(drawerThemePreset.id);
      setSelectedTemplate(undefined);
      setTemplatePreview(undefined);
      setTemplateAnalysis(undefined);
      setTemplateLayoutRenders([]);
      setTaskStatus(`已选择主题：${drawerThemePreset.name}`);
    } else if (selectedTemplate) {
      setTaskStatus(`已选择主题：${selectedTemplate.name}`);
    }
    closeThemeDrawer();
  };
  const refreshTemplateTarget = () => {
    const target =
      selectedTemplate && templateAnalysis
        ? buildTemplateReviewTarget(templateAnalysis, selectedTemplate.name)
        : undefined;
    if (!target) {
      setTaskStatus("请先选择模板并完成模板分析，才能重新编译验收目标");
      return;
    }
    execute({ type: "set-template-style", templateStyle: target });
    setTaskStatus(`已更新模板验收目标：${target.name}`);
  };
  const clearTemplateTarget = () => {
    execute({ type: "set-template-style" });
    setDesignQualityReport((previous) =>
      previous
        ? {
            ...previous,
            templateFit: undefined,
            templateTargetName: undefined,
            notes: [...previous.notes, "已清除模板验收目标"],
          }
        : previous,
    );
    setTaskStatus("已清除模板验收目标");
  };
  const designCandidateContextMatches = (context: NonNullable<typeof designCandidateContextRef.current>): boolean => {
    if (documentContentFingerprint(document) !== context.fingerprint) return false;
    const signatures = document.slides.map((slide) => JSON.stringify(slide));
    return (
      signatures.length === context.slideSignatures.length &&
      signatures.every((signature, index) => signature === context.slideSignatures[index])
    );
  };

  const openDesignCandidates = async () => {
    if (designCandidateBusy) return;
    const context = designCandidateContextRef.current;
    if (!context) {
      recordDesignCandidateEvent({ kind: "no-context" });
      setTaskStatus("本次会话没有可换版的设计快照；重新生成后才能换版");
      return;
    }
    if (!designCandidateContextMatches(context)) {
      recordDesignCandidateEvent({ kind: "edited" });
      setTaskStatus("页面已被修改，换版会覆盖手工调整；请重新生成后再换版");
      return;
    }
    if (activeSlideIndex < 0) {
      setTaskStatus("当前页不在文稿里，无法换版");
      return;
    }
    const design = context.designs[activeSlideIndex];
    if (!design) {
      setTaskStatus("当前页不在本次生成的设计里，无法换版");
      return;
    }
    setDesignCandidateBusy(true);
    setTaskStatus(`正在计算第 ${activeSlideIndex + 1} 页可换的版式…`);
    try {
      const result = buildDesignCandidates({
        document,
        slideIndex: activeSlideIndex,
        concept: context.concept,
        design,
        commandBase: candidateCommandBase(context.command),
      });
      if (result.reason) {
        const usage = recordDesignCandidateEvent({ kind: "no-plan" });
        setDesignCandidateView({
          slideIndex: activeSlideIndex,
          options: [],
          rejected: result.rejected.length,
          reason: result.reason,
          usage: { opened: usage.opened, picked: usage.picked },
        });
        return;
      }
      if (result.candidates.length === 0) {
        setTaskStatus("这一页没有可换的构图；内容形状可能只匹配当前配方");
        return;
      }
      const options = await Promise.all(
        result.candidates.map(async (candidate) => {
          let image: string | undefined;
          try {
            [image] = await renderPresentationPages(candidate.document, 520);
          } catch {
            // A candidate without a thumbnail is still a valid layout, but the
            // picker cannot claim it was rendered.
            image = undefined;
          }
          return {
            recipe: candidate.recipe,
            label: RECIPE_CATALOG[candidate.recipe]?.label ?? candidate.recipe,
            ...(image ? { image } : {}),
            auditCount: candidate.audit.length,
            tasteHardCount: candidate.taste.issues.filter((issue) => issue.severity === "hard").length,
          };
        }),
      );
      const usage = recordDesignCandidateEvent({ kind: "opened" });
      setDesignCandidateView({
        slideIndex: activeSlideIndex,
        options,
        rejected: result.rejected.length,
        usage: { opened: usage.opened, picked: usage.picked },
      });
    } catch (error) {
      setTaskStatus(`换版计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDesignCandidateBusy(false);
    }
  };

  const closeDesignCandidates = () => {
    if (designCandidateView && designCandidateView.options.length > 0) {
      recordDesignCandidateEvent({ kind: "abandoned" });
    }
    setDesignCandidateView(undefined);
  };

  const applyDesignCandidate = (recipe: RecipeId) => {
    const context = designCandidateContextRef.current;
    const view = designCandidateView;
    if (!context || !view) return;
    if (!designCandidateContextMatches(context)) {
      recordDesignCandidateEvent({ kind: "edited" });
      setDesignCandidateView(undefined);
      setTaskStatus("页面已被修改，换版会覆盖手工调整；请重新生成后再换版");
      return;
    }
    const nextDesigns = context.designs.map((design, index) =>
      index === view.slideIndex ? designWithRecipe(design, recipe) : design,
    );
    try {
      const next = structuredClone(document);
      applyCommand(next, { ...context.command, designs: nextDesigns });
      replaceDocument(next, "design");
      designCandidateContextRef.current = {
        ...context,
        designs: nextDesigns,
        slideSignatures: next.slides.map((slide) => JSON.stringify(slide)),
      };
      recordDesignCandidateEvent({ kind: "picked", recipe });
      setDesignCandidateView(undefined);
      setDesignQualityReport((previous) =>
        previous
          ? {
              ...previous,
              notes: [...previous.notes, `第 ${view.slideIndex + 1} 页已换版，旧评审结论对该页已过期`],
            }
          : previous,
      );
      setTaskStatus(`已把第 ${view.slideIndex + 1} 页换成「${RECIPE_CATALOG[recipe]?.label ?? recipe}」；可撤销`);
    } catch (error) {
      setTaskStatus(`换版失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

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
      const persistedTarget =
        document.templateStyle && templateTargetMatchesDocument(document.templateStyle, document)
          ? document.templateStyle
          : undefined;
      const manualTarget =
        selectedTemplate && templateAnalysis
          ? buildTemplateReviewTarget(templateAnalysis, selectedTemplate.name)
          : persistedTarget;
      const manualGoal = manualTarget
        ? applyTemplateToGoal(defaultPresentationVisualGoal(), manualTarget)
        : defaultPresentationVisualGoal();
      const result = await runManualVisualReview({
        document: structuredClone(document),
        indexes,
        goal: manualGoal,
        ...(manualTarget === undefined ? {} : { template: manualTarget }),
        vision: new TauriVisionReviewPort(),
        taskId,
        renderReal: renderRealPptxForReview,
        renderCanvas: renderPresentationForVisualReview,
      });
      if (manualReviewCancelled.current) throw new Error("AI_GENERATION_CANCELLED");
      // A fresh analysis can be newer than the contract saved in the project.
      // Persist it as a design transaction so export and later reviews use the
      // target that was actually applied.
      if (manualTarget && JSON.stringify(manualTarget) !== JSON.stringify(document.templateStyle)) {
        execute({ type: "set-template-style", templateStyle: manualTarget });
      }
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
              templateFit: result.templateFit,
              ...(manualTarget === undefined ? {} : { templateTargetName: manualTarget.name }),
              contactSheet: result.render.contactSheet,
              deckReview: result.deckReview,
              reviewReuse: {
                reviewed: result.reviewedIndexes.length,
                reused: document.slides.length - result.reviewedIndexes.length,
              },
              slideSignatures: refreshedSignatures,
              reviewedAt: Date.now(),
              reviewSource: result.source,
              visualEvidence:
                result.source === "真实 PPTX"
                  ? { renderer: "powerpoint", evidence: "final" }
                  : {
                      renderer: "canvas",
                      evidence: "layout",
                      ...(result.degradedReason ? { reason: result.degradedReason } : {}),
                    },
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
  const {
    animationPreviews,
    selectedAnimation,
    selectedAnimationIndex,
    setSelectedAnimationId,
    newAnimationEffect,
    setNewAnimationEffect,
    stopAnimationPreview,
    previewSelectedAnimation,
    previewSlideAnimations,
  } = useAnimationPreview({ activeSlide, selectedElementId });

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

  const restoreContentVersionWithDesign = (versionId: string) => {
    if (!window.confirm("恢复这个版本会同时覆盖当前文稿的内容和版式（对象、背景、动画、切换、页面尺寸）。是否继续？"))
      return;
    try {
      execute({ type: "restore-content-version", versionId, includeDesign: true });
      setContentHistoryOpen(false);
      setTaskStatus("已同时恢复内容与版式。");
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setTaskStatus(`恢复失败：${code}`);
    }
  };

  const editorCanvasOpen = activeView === "editor" && editorSurface === "canvas";
  // 重写对话框跟着页面走：草稿被换掉时 slide 可能已经不存在，此时不渲染。
  const rewriteSlide = slideRewrite && aiDraft ? aiDraft.slides[slideRewrite.index] : undefined;
  // 单页 AI 对话框都跟着页面走：草稿被换掉时页面可能已经不存在。
  const assistSlide = slideAssist && aiDraft ? aiDraft.slides[slideAssist.index] : undefined;
  const projectHomeItems = [
    ...recentProjects.map((entry) => ({ kind: "project" as const, timestamp: entry.lastOpenedAt, entry })),
    ...aiHistory.map((entry) => ({ kind: "ai" as const, timestamp: Date.parse(entry.updatedAt), entry })),
  ].sort((left, right) => right.timestamp - left.timestamp);

  return {
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
    findFocus,
    openFindReplace,
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
    selectElements,
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
    styleProfileId,
    handleSelectStyleProfile,
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
    recommendedThemeReason: recommendedTheme.reason,
    pickerStyleProfile,
    pickerStyleReason,
    designDetail,
    designElapsed,
    pickerThemePreset,
    pickerThemeGuidance,
    generateFromDraft,
    variantOptions,
    variantBatch,
    variantBatchFailures,
    generateVariantBatch,
    chooseVariant,
    discardVariantBatch,
    cancelVariantBatch,
    renderVariantPreview,
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
    designCandidateView,
    designCandidateBusy,
    openDesignCandidates,
    closeDesignCandidates,
    applyDesignCandidate,
    setDesignQualityReport,
    setActiveView,
    setEditorSurface,
    exportPreflightOpen,
    revisionLabel,
    directionOptions,
    directionRegenerations,
    directionChoiceRef,
    renderDirectionPreview,
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
  };
}
