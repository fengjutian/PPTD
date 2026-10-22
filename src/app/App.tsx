import { ArrowDown, ArrowRight, ArrowUp, Check, Circle, CircleAlert, CircleCheck, Copy, Download, Eye, FilePlus2, FileUp, ImagePlus, Info, LayoutDashboard, MousePointer2, Palette, Plus, Redo2, Save, Settings, Sparkles, Square, Trash2, Type, Undo2, Wand2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { EMU_PER_INCH, emu, type ElementId, type RectEmu, type Slide, type SlideElement } from "../core/document-model";
import { applyCommand, type AiSlideDesign, type DocumentCommand } from "../core/commands";
import { setTextMeasurer } from "../core/rendering/text-metrics";
import { createCanvasTextMeasurer } from "../services/text-metrics-canvas";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";
import { CroppedImage } from "../features/editor/CroppedImage";
import { ChartView } from "../features/editor/ChartView";
import { RichText } from "../features/editor/RichText";
import { TableView } from "../features/editor/TableView";
import { InspectorPanel } from "../features/editor/InspectorPanel";
import { LayerList } from "../features/editor/LayerList";
import { ContentReview } from "../features/ai/ContentReview";
import { draftMetrics, reviewIssues, withSlideIds, type AiDraftSaveState } from "../features/ai/content-review";
import { bodyFromBlocks } from "../services/ai-draft-content";
import { SettingsWorkspace } from "../features/settings/SettingsDialog";
import { loadAiHistory, saveAiHistory, type AiHistoryEntry } from "../services/ai-history";
import { briefsFromDraft, cancelAiGeneration, describeAiError, endAiGeneration, generatePresentationDesign, generatePresentationDraft, listenAiGenerationProgress, mergeStreamProgress, type AiDraft, type AiGenerationProgress } from "../services/ai-service";
import { applyTheme, applyUiFont, defaultSettings, loadSettings } from "../services/settings";
import { analyzePptxTemplate, choosePptxPath, choosePptxTemplate, chooseProjectToOpen, clearRecovery, getPptxTemplatePreview, importPptxTemplate, isDesktopRuntime, listPptxTemplates, loadRecovery, projectModifiedAt, recoveryProjectPath, renderPptxTemplateLayouts, saveProject, saveRecovery, writePptx, type TemplateAnalysis, type TemplateRecord } from "../services/project-files";
import { useEditorStore } from "../store/editor-store";
import { defaultPresentationVisualGoal } from "../services/visual-alignment";
import { runDesignQualityStage, summarizeQualityIssues } from "../services/design-quality-stage";
import type { PresentationQualityIssue } from "../services/presentation-quality-gate";
import { TauriVisionReviewPort } from "../services/vision-review-port";
import { probeTemplateBackground, type TemplateBackgroundProbe } from "../services/template-background";
import type { ExportReport } from "../features/pptx-export/export-pptx";
import { resolveDocumentImages, setImageProjectPath, getImageProjectPath } from "../services/image-url-service";

const CANVAS_WIDTH = 960;
type AppView = "editor" | "ai" | "theme" | "settings";
type PageMessage = { id: number; text: string; kind: "info" | "success" | "error" };
type DesignProgress = { percent: number; label: string };
type TemplateLayoutRender = { layoutIndex: number; layoutName: string; dataUrl: string };

function matchTemplateLayoutRender(renders: TemplateLayoutRender[], layoutIndex: number, layoutName: string): TemplateLayoutRender | undefined {
  const normalizedName = layoutName.trim().toLocaleLowerCase();
  const nameMatches = renders.filter((render) => render.layoutName.trim().toLocaleLowerCase() === normalizedName);
  if (nameMatches.length > 0) return nameMatches.sort((left, right) => Math.abs(left.layoutIndex - layoutIndex) - Math.abs(right.layoutIndex - layoutIndex))[0];
  return renders.find((render) => render.layoutIndex === layoutIndex);
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button className="tool-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

type ResizeDirection = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
const MIN_ELEMENT_SIZE = emu(0.1 * EMU_PER_INCH);
const RESIZE_HANDLES: ReadonlyArray<readonly [ResizeDirection, string]> = [
  ["nw", "左上"], ["n", "上"], ["ne", "右上"],
  ["w", "左"], ["e", "右"],
  ["sw", "左下"], ["s", "下"], ["se", "右下"],
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

const ElementView = memo(function ElementView({ element, slide, scale, selected }: { element: SlideElement; slide: Slide; scale: number; selected: boolean }) {
  const execute = useEditorStore((s) => s.execute);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const selectElement = useEditorStore((s) => s.selectElement);
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
  } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [previewFrame, setPreviewFrame] = useState<RectEmu | null>(null);
  const [previewRotation, setPreviewRotation] = useState<number | null>(null);
  const frame = previewFrame ?? element.frame;
  const rotation = previewRotation ?? element.rotationMilliDegree;
  const style: React.CSSProperties = {
    left: frame.x * scale + offset.x, top: frame.y * scale + offset.y,
    width: frame.width * scale, height: frame.height * scale,
    transform: `rotate(${rotation / 1000}deg)`,
    touchAction: "none",
  };

  const begin = (kind: "move" | "resize" | "rotate", event: React.PointerEvent, direction?: ResizeDirection) => {
    event.stopPropagation();
    event.preventDefault();
    selectElement(element.id);
    if (element.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rootRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : event.clientX;
    const centerY = rect ? rect.top + rect.height / 2 : event.clientY;
    interaction.current = {
      kind,
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame: { ...element.frame },
      rotation: element.rotationMilliDegree,
      startAngle: kind === "rotate" ? Math.atan2(event.clientY - centerY, event.clientX - centerX) : undefined,
    };
  };

  const pointerMove = (event: React.PointerEvent) => {
    const current = interaction.current;
    if (!current) return;
    if (current.kind === "move") {
      setOffset({ x: event.clientX - current.startX, y: event.clientY - current.startY });
      return;
    }
    if (current.kind === "resize") {
      setPreviewFrame(resizeFrame(current.frame, current.direction!, (event.clientX - current.startX) / scale, (event.clientY - current.startY) / scale));
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    setPreviewRotation(normalizeRotation(current.rotation + ((angle - current.startAngle!) * 180) / Math.PI * 1000));
  };

  const finish = (event: React.PointerEvent, cancelled = false) => {
    const current = interaction.current;
    if (!current) return;
    interaction.current = null;
    setOffset({ x: 0, y: 0 });
    setPreviewFrame(null);
    setPreviewRotation(null);
    if (cancelled) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    if (current.kind === "move") {
      if (!dx && !dy) return;
      execute({ type: "move-element", slideId: activeSlideId, elementId: element.id, x: emu(current.frame.x + dx), y: emu(current.frame.y + dy) });
      return;
    }
    if (current.kind === "resize") {
      const frame = resizeFrame(current.frame, current.direction!, dx, dy);
      if (frame.width === current.frame.width && frame.height === current.frame.height && frame.x === current.frame.x && frame.y === current.frame.y) return;
      execute({ type: "transform-element", slideId: activeSlideId, elementId: element.id, frame, rotationMilliDegree: current.rotation });
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    const nextRotation = rect
      ? normalizeRotation(current.rotation + ((Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) - current.startAngle!) * 180) / Math.PI * 1000)
      : current.rotation;
    if (nextRotation === current.rotation) return;
    execute({ type: "transform-element", slideId: activeSlideId, elementId: element.id, frame: current.frame, rotationMilliDegree: nextRotation });
  };

  return (
    <div ref={rootRef} className={`slide-element ${selected ? "selected" : ""} ${element.locked ? "locked" : ""} ${element.type}`} style={style} onPointerDown={(event) => begin("move", event)} onPointerMove={pointerMove} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}>
      {element.type === "text" ? <RichText element={element} scale={scale} /> : element.type === "shape" ? <div className={`shape-fill ${element.shape}`} style={{ background: element.style.fill, borderColor: element.style.stroke, borderWidth: element.style.strokeWidthPt, borderRadius: element.shape === "ellipse" ? "50%" : element.style.radiusPt }} /> : element.type === "image" ? <CroppedImage element={element} className="image-fill" /> : element.type === "chart" ? <ChartView element={element} slide={slide} scale={scale} /> : <TableView element={element} slide={slide} scale={scale} />}
      {selected && !element.locked && <>
        {RESIZE_HANDLES.map(([direction, label]) => <button key={direction} type="button" aria-label={`从${label}缩放`} className={`element-handle ${direction}`} onPointerDown={(event) => begin("resize", event, direction)} />)}
        <button type="button" aria-label="旋转对象" className="element-rotate-handle" onPointerDown={(event) => begin("rotate", event)} />
      </>}
    </div>
  );
});

const SlideThumbnail = memo(function SlideThumbnail({ slide, pageWidth, pageHeight }: { slide: Slide; pageWidth: number; pageHeight: number }) {
  return <div className="thumbnail-scene">{slide.elements.map((element) => {
    const style: React.CSSProperties = {
      left: `${element.frame.x / pageWidth * 100}%`,
      top: `${element.frame.y / pageHeight * 100}%`,
      width: `${element.frame.width / pageWidth * 100}%`,
      height: `${element.frame.height / pageHeight * 100}%`,
      transform: `rotate(${element.rotationMilliDegree / 1000}deg)`,
    };
    if (element.type === "text") return <div className="thumbnail-element thumbnail-text" key={element.id} style={style}><RichText element={element} scale={0.18} /></div>;
    if (element.type === "image") return <div className="thumbnail-element thumbnail-image-frame" key={element.id} style={style}><CroppedImage element={element} className="thumbnail-image" alt="" /></div>;
    if (element.type === "chart") return <div className="thumbnail-element thumbnail-chart" key={element.id} style={style}><ChartView element={element} slide={slide} scale={0.18} compact /></div>;
    if (element.type === "table") return <div className="thumbnail-element thumbnail-table" key={element.id} style={style}><TableView element={element} slide={slide} scale={0.18} compact /></div>;
    return <div className={`thumbnail-element thumbnail-shape ${element.shape}`} key={element.id} style={{ ...style, background: element.style.fill, borderColor: element.style.stroke, borderWidth: Math.max(1, element.style.strokeWidthPt * 0.3), borderRadius: element.shape === "ellipse" ? "50%" : Math.max(0, element.style.radiusPt * 0.3) }} />;
  })}{slide.elements.length === 0 && <div className="thumbnail-fallback-title">{slide.content.title}</div>}</div>;
});

export function App() {
  const { document, activeSlideId, selectedElementId, undoStack, redoStack, execute, replaceDocument, selectSlide, selectElement, undo, redo, newDocument, loadDocument } = useEditorStore();
  const [projectPath, setProjectPath] = useState<string>();
  const [projectMtime, setProjectMtime] = useState<number>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState<PageMessage>();
  const [leftTab, setLeftTab] = useState<"slides" | "layers">("slides");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportReport, setExportReport] = useState<ExportReport>();
  const exportCancelRef = useRef<(() => void) | undefined>(undefined);
  const setTaskStatus = (text?: string) => setMessage(text ? { id: Date.now(), text, kind: /失败|错误|无效|必须|不可用/.test(text) ? "error" : /完成|成功|已保存|已添加|已打开|已新建|已恢复|已确认/.test(text) ? "success" : "info" } : undefined);
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [aiTopic, setAiTopic] = useState("");
  const [aiSlideCount, setAiSlideCount] = useState(6);
  const [aiDraft, setAiDraft] = useState<AiDraft>();
  const [activeDraftSlideIndex, setActiveDraftSlideIndex] = useState(0);
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string>();
  const [aiSaveState, setAiSaveState] = useState<AiDraftSaveState>("saved");
  const [newDraftConfirmOpen, setNewDraftConfirmOpen] = useState(false);
  const aiOriginalDraft = useRef<AiDraft | undefined>(undefined);
  /** 恢复原文前的页面快照，让整页覆盖也能撤回。 */
  const aiRestoreBackups = useRef(new Map<number, AiDraft["slides"][number]>());
  const [aiRestoreUndoIndexes, setAiRestoreUndoIndexes] = useState<number[]>([]);
  /** 关闭窗口时把最后一次编辑写盘，避免 500ms 防抖窗口内的内容丢失。 */
  const aiDraftRef = useRef<AiDraft | undefined>(undefined);
  const aiTopicRef = useRef("");
  const activeHistoryIdRef = useRef<string | undefined>(undefined);
  const aiUnsavedRef = useRef(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiGenerationProgress>();
  /** 流式汇报的实时进度：正文分批并行，这里是各批汇总后的结果。 */
  const [aiStreamProgress, setAiStreamProgress] = useState<{ pages: number; received: number }>();
  const aiRequestId = useRef(0);
  /** 后端取消用的生成任务号；一次生成任务内的所有请求共享它。 */
  const aiTaskId = useRef(0);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRecord>();
  const [templateLibrary, setTemplateLibrary] = useState<TemplateRecord[]>([]);
  const [templatePreview, setTemplatePreview] = useState<string | null>();
  const [templateAnalysis, setTemplateAnalysis] = useState<TemplateAnalysis>();
  const [templateLayoutRenders, setTemplateLayoutRenders] = useState<TemplateLayoutRender[]>([]);
  const [templatePreviewBusy, setTemplatePreviewBusy] = useState(false);
  const [templateUploadOpen, setTemplateUploadOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [designBusy, setDesignBusy] = useState(false);
  const designCancelRef = useRef(false);
  /** 设计阶段的后端取消任务号。 */
  const designTaskId = useRef(0);
  const [designProgress, setDesignProgress] = useState<DesignProgress>({ percent: 0, label: "等待开始" });
  /** 质量门未过时保留报告，让用户决定进入编辑器调整还是稍后处理。 */
  const [designQualityReport, setDesignQualityReport] = useState<{ templateName: string; issues: PresentationQualityIssue[]; notes: string[] }>();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const clipboardElementId = useRef<ElementId | null>(null);
  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]!;
  const selected = activeSlide.elements.find((element) => element.id === selectedElementId);
  const scale = (CANVAS_WIDTH / document.pageSize.width) * zoom;
  const canvasHeight = document.pageSize.height * scale;
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => `${activeSlide.elements.length} 个对象`, [activeSlide.elements.length]);
  const dirty = document.revisions.document !== savedRevision;
  useEffect(() => {
    void loadSettings()
      .then((settings) => { applyTheme(settings.theme); applyUiFont(settings.uiFont); })
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
      .then((history) => { if (active) setAiHistory(history); })
      .catch((error: unknown) => { if (active) setTaskStatus(`制作历史读取失败：${error instanceof Error ? error.message : String(error)}`); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(undefined), 4200); return () => window.clearTimeout(timer); }, [message]);
  useEffect(() => { if (isDesktopRuntime()) void listPptxTemplates().then(setTemplateLibrary).catch(() => setTaskStatus("模板库读取失败")); }, []);
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
    void loadRecovery().then((recovery) => {
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
      setTaskStatus(recovery.removedLayoutReferences > 0
        ? `已恢复自动保存快照，但 ${recovery.removedLayoutReferences} 个页面的模板引用缺失，请另存项目`
        : "已恢复自动保存快照，请另存项目");
    }).catch((error: unknown) => {
      // A snapshot that cannot be read is still the user's work. The file is
      // kept and its path is reported, so nothing is lost silently.
      void recoveryProjectPath().then((path) => {
        setTaskStatus(`恢复检查失败：${error instanceof Error ? error.message : String(error)}${path ? `。快照保留在 ${path}` : ""}`);
      });
    });
    return () => { active = false; };
  }, [loadDocument]);

  useEffect(() => {
    if (!dirty || !isDesktopRuntime()) return;
    const timer = window.setTimeout(() => {
      // The snapshot keeps the pictures of the document. They live in the asset
      // directory of the project the document belongs to, so the backend needs
      // that path to carry them into the snapshot.
      void saveRecovery(document, getImageProjectPath()).catch((error: unknown) => setTaskStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, document]);

  const handleNew = async () => {
    if (dirty && !window.confirm("当前项目还有未保存的修改，确定新建吗？")) return;
    await clearRecovery().catch(() => undefined);
    newDocument();
    setImageProjectPath(undefined);
    setProjectPath(undefined);
    setProjectMtime(undefined);
    setSavedRevision(0);
    setTaskStatus("已新建项目");
  };

  const handleOpen = async () => {
    try {
      if (dirty && !window.confirm("当前项目还有未保存的修改，确定打开其他项目吗？")) return;
      const result = await chooseProjectToOpen();
      if (!result) return;
      setImageProjectPath(result.path);
      loadDocument(result.document);
      await clearRecovery();
      setProjectPath(result.path);
      setProjectMtime(result.modifiedAt);
      setSavedRevision(result.document.revisions.document);
      setTaskStatus(result.removedLayoutReferences > 0
        ? `项目已打开，但 ${result.removedLayoutReferences} 个页面的模板引用缺失`
        : "项目已打开");
    } catch (error) { setTaskStatus(`打开失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!isDesktopRuntime()) { setTaskStatus("浏览器预览模式不支持保存项目，请使用桌面端"); return; }
    savingRef.current = true;
    setSaving(true);
    setTaskStatus("正在保存…");
    try {
      if (projectPath && isDesktopRuntime() && projectMtime !== undefined) {
        let currentMtime: number | null = null;
        try { currentMtime = await projectModifiedAt(projectPath); } catch { currentMtime = null; }
        if (currentMtime !== null && currentMtime !== projectMtime && !window.confirm("项目文件已被其他程序修改。继续保存会覆盖外部修改，是否继续？")) {
          setTaskStatus("保存已取消");
          return;
        }
      }
      const result = await saveProject(document, projectPath);
      if (!result) { setTaskStatus(undefined); return; }
      if (isDesktopRuntime()) { setProjectPath(result.path); setImageProjectPath(result.path); }
      setProjectMtime(result.modifiedAt ?? undefined);
      setSavedRevision(document.revisions.document);
      await clearRecovery();
      setTaskStatus(isDesktopRuntime() ? "项目已保存" : "浏览器草稿已保存");
    } catch (error) { setTaskStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
    finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (exportBusy) {
      exportCancelRef.current?.();
      return;
    }
    setExportBusy(true);
    setExportReport(undefined);
    setTaskStatus("正在生成 PPTX…");
    try {
      // 预检在主线程完成（含字体探测），重活交给 Worker，导出期间画布不冻结。
      const { validatePresentationForExport, isFontAvailable } = await import("../core/validation/export-validation");
      const issues = await validatePresentationForExport(document, { fontAvailable: isFontAvailable });
      const blocking = issues.filter((issue) => issue.severity === "error");
      if (blocking.length > 0) {
        throw new Error(`EXPORT_VALIDATION_FAILED: ${blocking.map((issue) => issue.message).join("；")}`);
      }
      const { buildPptxInWorker } = await import("../features/pptx-export/export-worker-client");
      // asset 引用在 Worker 里没有 IPC 可读，先在主线程解析成内嵌数据。
      const exportDocument = await resolveDocumentImages(document);
      const task = buildPptxInWorker(exportDocument, issues);
      exportCancelRef.current = task.cancel;
      const { bytes, report } = await task.promise;
      const path = await choosePptxPath(document.title);
      if (path) await writePptx(path, bytes);
      else if (!isDesktopRuntime()) {
        const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
        const url = URL.createObjectURL(blob);
        const anchor = Object.assign(globalThis.document.createElement("a"), { href: url, download: `${document.title}.pptx` });
        anchor.click();
        URL.revokeObjectURL(url);
      } else { setTaskStatus(undefined); return; }
      setExportReport(report);
      setTaskStatus(`导出完成：${report.slideCount} 页，${report.nativeObjectCount} 个原生对象${report.warnings.length ? `，${report.warnings.length} 条提示` : ""}`);
    } catch (error) {
      if (error instanceof Error && error.message === "EXPORT_CANCELLED") setTaskStatus("导出已取消");
      else setTaskStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`);
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

  const handleAiGenerate = async () => {
    if (aiBusy) {
      aiRequestId.current += 1;
      setAiBusy(false);
      setAiProgress(undefined);
      // 真正中断后端在途请求，否则模型会继续生成一份没人要的草稿。
      void cancelAiGeneration(aiTaskId.current).catch(() => undefined);
      setTaskStatus("已取消 AI 内容生成");
      return;
    }
    const requestId = aiRequestId.current + 1;
    aiRequestId.current = requestId;
    aiTaskId.current += 1;
    const taskId = aiTaskId.current;
    setAiBusy(true); setAiDraft(undefined);
    setAiProgress({ stage: "outline", completed: 0, total: 1, label: "正在准备生成…" });
    setAiStreamProgress(undefined);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    let unlisten: (() => void) | undefined;
    try {
      // 正文分批并行，各批的进度要按请求标识汇总，不能直接相加。
      const totals = new Map<string, { received: number; pages: number }>();
      unlisten = await listenAiGenerationProgress((progress) => {
        if (requestId !== aiRequestId.current || progress.taskId !== taskId) return;
        setAiStreamProgress(mergeStreamProgress(totals, progress));
      }).catch(() => undefined);
      const draft = withSlideIds(await generatePresentationDraft(aiTopic, aiSlideCount, {
        onProgress: (progress) => {
          if (requestId === aiRequestId.current) setAiProgress(progress);
        },
        isCancelled: () => requestId !== aiRequestId.current,
        taskId,
      }));
      if (requestId !== aiRequestId.current) return;
      const id = crypto.randomUUID();
      aiOriginalDraft.current = structuredClone(draft);
      setAiDraft(draft); setActiveHistoryId(id); setActiveDraftSlideIndex(0); setAiSaveState("saved");
      try {
        setAiHistory(await saveAiHistory({ id, topic: aiTopic, slideCount: aiSlideCount, draft }));
        setTaskStatus("AI 已完成 PPT 草稿生成");
      } catch (error) {
        setTaskStatus(`AI 草稿已生成，但历史保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if ("Notification" in window && Notification.permission === "granted") new Notification("PPTD · AI 生成完成", { body: `${draft.title}（${draft.slides.length} 页）` });
    }
    catch (error) {
      if (requestId !== aiRequestId.current) return;
      const detail = describeAiError(error);
      setTaskStatus(`AI 内容生成失败：${detail}`);
      if ("Notification" in window && Notification.permission === "granted") new Notification("PPTD · AI 生成失败", { body: detail });
    }
    finally {
      unlisten?.();
      void endAiGeneration(taskId).catch(() => undefined);
      if (requestId === aiRequestId.current) { setAiBusy(false); setAiProgress(undefined); setAiStreamProgress(undefined); }
    }
  };

  // Refs mirror the latest draft so the exit path can save without waiting for
  // another render, and so a close inside the debounce window is not lost.
  useEffect(() => { aiDraftRef.current = aiDraft; }, [aiDraft]);
  useEffect(() => { aiTopicRef.current = aiTopic; }, [aiTopic]);
  useEffect(() => { activeHistoryIdRef.current = activeHistoryId; }, [activeHistoryId]);

  useEffect(() => {
    if (!aiDraft || !activeHistoryId) return;
    setAiSaveState("saving");
    aiUnsavedRef.current = true;
    const timer = window.setTimeout(() => {
      void saveAiHistory({ id: activeHistoryId, topic: aiTopic, slideCount: aiDraft.slides.length, draft: aiDraft })
        .then((history) => { setAiHistory(history); setAiSaveState("saved"); aiUnsavedRef.current = false; })
        .catch((error: unknown) => {
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
    setAiSaveState("saved");
    void saveAiHistory({ id, topic: aiTopic, slideCount: draft.slides.length, draft })
      .then((history) => { setAiHistory(history); aiUnsavedRef.current = false; })
      .catch((error: unknown) => setTaskStatus(`草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`));
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
        setMessage({ id: Date.now(), text: `草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`, kind: "error" });
      }
    };
    const onExit = () => { void flush(); };
    const onVisibilityChange = () => { if (window.document.visibilityState === "hidden") onExit(); };
    window.addEventListener("pagehide", onExit);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isDesktopRuntime()) {
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const stop = await getCurrentWindow().onCloseRequested(async (event) => {
            if (!aiUnsavedRef.current) return;
            event.preventDefault();
            await flush();
            await getCurrentWindow().destroy();
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
    setAiRestoreUndoIndexes([]);
    setActiveHistoryId(entry.id); setAiTopic(entry.topic); setAiSlideCount(entry.slideCount); setAiDraft(draft); setActiveDraftSlideIndex(0); setAiSaveState("saved");
  };

  /**
   * Once a page is edited again, "undo restore" no longer describes what the
   * writer sees, so the pre-restore snapshot is dropped instead of silently
   * reverting the newer edits later.
   */
  const forgetRestoreBackup = (index: number) => {
    if (!aiRestoreBackups.current.delete(index)) return;
    setAiRestoreUndoIndexes([...aiRestoreBackups.current.keys()]);
  };

  const updateAiSlide = (index: number, field: "title" | "body" | "speakerNotes", value: string) => {
    forgetRestoreBackup(index);
    setAiDraft((draft) => draft ? { ...draft, slides: draft.slides.map((slide, slideIndex) => {
      if (slideIndex !== index) return slide;
      if (field !== "body") return { ...slide, [field]: value };
      // Body copy is only editable on legacy drafts that carry no structured
      // blocks. Deriving blocks here used to swap the textarea for the block
      // editor on the first keystroke, which dropped focus mid-sentence.
      return { ...slide, body: value };
    }) } : draft);
  };

  const updateAiBlocks = (index: number, blocks: AiDraft["slides"][number]["blocks"]) => {
    forgetRestoreBackup(index);
    setAiDraft((draft) => draft ? {
      ...draft,
      slides: draft.slides.map((slide, slideIndex) => (slideIndex === index ? { ...slide, blocks, body: bodyFromBlocks(blocks) } : slide)),
    } : draft);
  };

  const updateAiDraftTitle = (title: string) => setAiDraft((draft) => (draft ? { ...draft, title } : draft));

  const restoreAiSlide = (index: number) => {
    const original = aiOriginalDraft.current?.slides[index];
    if (!original) return;
    const current = aiDraft?.slides[index];
    if (current) {
      aiRestoreBackups.current.set(index, structuredClone(current));
      setAiRestoreUndoIndexes([...aiRestoreBackups.current.keys()]);
    }
    setAiDraft((draft) => draft ? {
      ...draft,
      slides: draft.slides.map((slide, slideIndex) => (slideIndex === index ? { ...original, id: slide.id } : slide)),
    } : draft);
    setTaskStatus(`已恢复第 ${index + 1} 页的 AI 原始内容`);
  };

  const undoRestoreAiSlide = (index: number) => {
    const backup = aiRestoreBackups.current.get(index);
    if (!backup) return;
    aiRestoreBackups.current.delete(index);
    setAiRestoreUndoIndexes([...aiRestoreBackups.current.keys()]);
    setAiDraft((draft) => draft ? {
      ...draft,
      slides: draft.slides.map((slide, slideIndex) => (slideIndex === index ? { ...backup, id: slide.id } : slide)),
    } : draft);
    setTaskStatus(`已撤销第 ${index + 1} 页的恢复操作`);
  };

  const confirmNewDraft = () => {
    persistAiDraft();
    aiOriginalDraft.current = undefined;
    aiRestoreBackups.current.clear();
    setAiRestoreUndoIndexes([]);
    setAiDraft(undefined);
    setActiveHistoryId(undefined);
    setActiveDraftSlideIndex(0);
    setAiSaveState("saved");
    setNewDraftConfirmOpen(false);
    setTaskStatus("已新建空白草稿");
  };

  const aiDraftIssues = useMemo(() => (aiDraft ? reviewIssues(aiDraft) : []), [aiDraft]);
  const aiDraftBlockingIssues = useMemo(() => aiDraftIssues.filter((issue) => issue.blocking), [aiDraftIssues]);
  const aiDraftBlockReason = !aiDraft
    ? undefined
    : !aiDraft.title.trim()
      ? "请先填写演示文稿标题"
      : aiDraftBlockingIssues.map((issue) => issue.message).join("；") || undefined;
  // The header keeps the hint to one line; the tooltip on the disabled button carries every reason.
  const aiDraftBlockHint = aiDraftBlockingIssues.length === 0
    ? undefined
    : aiDraftBlockingIssues.length === 1
      ? aiDraftBlockingIssues[0]!.message
      : `${aiDraftBlockingIssues.length} 项待补全：${aiDraftBlockingIssues[0]!.message}`;
  const aiDraftMetrics = useMemo(() => (aiDraft ? draftMetrics(aiDraft) : { characters: 0, points: 0 }), [aiDraft]);
  // 大纲阶段占一小段，正文分批阶段按已完成批次推进；流式汇报的页数更细，取两者里更靠前的。
  const aiGenerationPercent = aiProgress
    ? Math.max(
        aiProgress.stage === "outline"
          ? 12
          : 12 + Math.round((88 * aiProgress.completed) / Math.max(1, aiProgress.total)),
        aiStreamProgress
          ? 12 + Math.round((88 * aiStreamProgress.pages) / Math.max(1, aiSlideCount))
          : 0,
      )
    : 0;
  const aiGenerationLabel = aiStreamProgress && aiStreamProgress.pages > 0
    ? `正在生成正文（已写 ${aiStreamProgress.pages} 页）`
    : aiProgress?.label ?? "";

  const continueToTheme = () => {
    if (!aiDraft) return;
    setTemplatePickerOpen(true);
  };

  const generateFromDraft = async () => {
    if (!aiDraft || !selectedTemplate || !templateAnalysis) return;
    designCancelRef.current = false;
    setDesignQualityReport(undefined);
    designTaskId.current += 1;
    const taskId = designTaskId.current;
    setDesignBusy(true);
    setDesignProgress({ percent: 8, label: "正在准备内容与模板数据" });
    setTaskStatus("AI 正在依据模板生成并渲染 PPT…");
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
      const briefs = briefsFromDraft(aiDraft);
      setDesignProgress({ percent: 46, label: "正在匹配模板版式与页面意图" });
      const design = await generatePresentationDesign(aiDraft, briefs, templateAnalysis, { taskId });
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      window.clearInterval(progressTimer);
      setDesignProgress({ percent: 88, label: "正在校验 AI 设计结果" });
      const hasTemplateSize = templateAnalysis.slideWidthEmu && templateAnalysis.slideHeightEmu;
      const templateColors = new Map(templateAnalysis.themeColors.map((color) => [color.name.toLowerCase(), color.value]));
      const resolveTemplateColor = (value: string | null) => value?.startsWith("#") ? value : value ? templateColors.get(value.toLowerCase()) : undefined;
      setDesignProgress({ percent: 94, label: "正在渲染可编辑页面" });
      const templateLayoutSources = hasTemplateSize
        ? (templateAnalysis.layouts.length > 0 ? templateAnalysis.layouts : templateAnalysis.slides.map((slide) => ({ ...slide, name: slide.layout ?? slide.title })))
        : [];
      const normalizeRegion = (region: { role: "title" | "body" | "image"; x: number; y: number; width: number; height: number }) => ({
        role: region.role,
        frame: {
          x: region.x / templateAnalysis.slideWidthEmu!,
          y: region.y / templateAnalysis.slideHeightEmu!,
          width: region.width / templateAnalysis.slideWidthEmu!,
          height: region.height / templateAnalysis.slideHeightEmu!,
        },
      });
      // Measure the rendered artwork under each placeholder so the command layer
      // can tell whether the template's own ink stays readable on it.
      const backgroundProbes = new Map<number, TemplateBackgroundProbe>();
      await Promise.all(templateLayoutSources.map(async (layout) => {
        const render = matchTemplateLayoutRender(templateLayoutRenders, layout.index, layout.name);
        if (!render) return;
        try {
          backgroundProbes.set(layout.index, await probeTemplateBackground(render.dataUrl, layout.regions.map(normalizeRegion)));
        } catch {
          // A layout without a probe falls back to the page color.
        }
      }));
      const generationCommand: DocumentCommand = {
        type: "apply-ai-designed-draft",
        title: aiDraft.title,
        slides: aiDraft.slides,
        designs: design.slides,
        pageSize: hasTemplateSize ? { width: emu(templateAnalysis.slideWidthEmu!), height: emu(templateAnalysis.slideHeightEmu!) } : undefined,
        fontFamily: templateAnalysis.majorFont || templateAnalysis.minorFont || undefined,
        bodyFontFamily: templateAnalysis.minorFont || templateAnalysis.majorFont || undefined,
        templateDecorations: hasTemplateSize ? (templateAnalysis.defaultDecorations ?? []).map((item) => ({ shape: item.shape, fill: resolveTemplateColor(item.fill) ?? design.slides[0]!.accent, frame: { x: item.x / templateAnalysis.slideWidthEmu!, y: item.y / templateAnalysis.slideHeightEmu!, width: item.width / templateAnalysis.slideWidthEmu!, height: item.height / templateAnalysis.slideHeightEmu! } })) : undefined,
        templateLayouts: hasTemplateSize ? templateLayoutSources.map((layout) => ({ index: layout.index, name: layout.name, backgroundColor: resolveTemplateColor(layout.backgroundColor), backgroundImageDataUrl: matchTemplateLayoutRender(templateLayoutRenders, layout.index, layout.name)?.dataUrl, backgroundLuminance: backgroundProbes.get(layout.index), decorations: (layout.decorations ?? []).map((item) => ({ shape: item.shape, fill: resolveTemplateColor(item.fill) ?? design.slides[0]!.accent, frame: { x: item.x / templateAnalysis.slideWidthEmu!, y: item.y / templateAnalysis.slideHeightEmu!, width: item.width / templateAnalysis.slideWidthEmu!, height: item.height / templateAnalysis.slideHeightEmu! } })), regions: layout.regions.map((region) => ({ ...normalizeRegion(region), textColor: region.textColor ?? undefined, fontSizePt: region.fontSizePt ?? undefined })) })) : undefined,
        // The theme of the template travels with the design, so the exported
        // deck keeps the typography and the palette of the template.
        templateTheme: {
          name: selectedTemplate.name,
          majorFont: templateAnalysis.majorFont ?? undefined,
          minorFont: templateAnalysis.minorFont ?? undefined,
          colors: templateAnalysis.themeColors.map((color) => ({ name: color.name, value: color.value })),
        },
        backgroundRhythm: defaultPresentationVisualGoal().backgroundRhythm,
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
        contentFingerprint: () => JSON.stringify(aiDraft.slides.map((slide) => ({ title: slide.title, body: slide.body, speakerNotes: slide.speakerNotes, blocks: slide.blocks }))),
        vision: new TauriVisionReviewPort(),
        taskId,
        isCancelled: () => designCancelRef.current,
        onProgress: (label, percent) => setDesignProgress({ percent, label }),
      });
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      const finalDocument = stage.document;
      const visualNote = stage.notes.join("；");
      // 质量门未过时文档照常产出：问题被逐条列出，PPT 不会因为报错而消失。
      replaceDocument(finalDocument, "both");
      setTemplatePickerOpen(false);
      if (stage.passed) {
        setDesignQualityReport(undefined);
        setDesignProgress({ percent: 100, label: "生成完成，正在进入编辑器" });
        setActiveView("editor");
        setTaskStatus(`PPT 已按模板完成 AI 设计：${selectedTemplate.name}`);
        if (visualNote) window.setTimeout(() => setTaskStatus(visualNote), 50);
      } else {
        // 文档已经写进项目，问题只作为报告展示。界面不自动跳进编辑器，
        // 由用户决定先调整还是稍后处理。
        setDesignProgress({ percent: 100, label: "生成完成，存在待调整的排版问题" });
        setDesignQualityReport({
          templateName: selectedTemplate.name,
          issues: [...new Map(stage.issues.map((issue) => [`${issue.slideIndex}-${issue.issue}-${issue.message}`, issue])).values()],
          notes: stage.notes,
        });
        setTaskStatus(stage.issues.length > 0
          ? `PPT 已生成，存在 ${stage.issues.length} 个待调整的排版问题：${summarizeQualityIssues(stage.issues)}`
          : `PPT 已生成，但质检未完成：${stage.notes.join("；")}`);
      }
    } catch (error) {
      window.clearInterval(progressTimer);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "AI_GENERATION_CANCELLED" || message.includes("AI_REQUEST_CANCELLED")) {
        setDesignProgress({ percent: 0, label: "已取消生成" });
        setTaskStatus("已取消 AI 设计生成");
      } else {
        setDesignProgress({ percent: 0, label: "生成失败，请重试" });
        setTaskStatus(`AI 设计生成失败：${describeAiError(error)}`);
      }
    } finally {
      window.clearInterval(progressTimer);
      void endAiGeneration(taskId).catch(() => undefined);
      setDesignBusy(false);
    }
  };

  const handleChooseTemplate = async () => {
    try {
      if (!isDesktopRuntime()) { setTaskStatus("模板持久化仅在 PPTD 桌面端可用"); return; }
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

  const handleSelectTemplate = async (template: TemplateRecord) => {
    setSelectedTemplate(template);
    setTemplatePreview(undefined);
    setTemplateAnalysis(undefined);
    setTemplateLayoutRenders([]);
    if (!isDesktopRuntime()) return;
    setTemplatePreviewBusy(true);
    try {
      const [preview, analysis, renders] = await Promise.all([getPptxTemplatePreview(template.id), analyzePptxTemplate(template.id), renderPptxTemplateLayouts(template.id).catch((error) => { setTaskStatus(`复杂模板视觉层渲染不可用，将使用基础样式：${error instanceof Error ? error.message : String(error)}`); return []; })]);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
      if (shortcut === "copy-element") {
        if (!selected) return;
        event.preventDefault();
        clipboardElementId.current = selected.id;
        setTaskStatus("已复制对象，可用 Ctrl+V 粘贴");
        return;
      }
      if (shortcut === "paste-element") {
        const sourceId = clipboardElementId.current;
        if (!sourceId) {
          setTaskStatus("没有可粘贴的对象");
          return;
        }
        if (!activeSlide.elements.some((element) => element.id === sourceId)) {
          setTaskStatus("剪贴板中的对象不在当前页面");
          return;
        }
        event.preventDefault();
        execute({ type: "duplicate-element", slideId: activeSlide.id, elementId: sourceId });
        return;
      }
      if (!selected || selected.locked) return;
      event.preventDefault();
      if (shortcut === "nudge-left" || shortcut === "nudge-right" || shortcut === "nudge-up" || shortcut === "nudge-down") {
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
  }, [activeSlide, document.pageSize.height, document.pageSize.width, execute, redo, redoStack.length, selected, undo, undoStack.length]);

  return (
    <div className={`app-shell ${activeView === "editor" ? "" : "module-shell"}`}>
      {activeView === "editor" && <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><div><strong>PPTD</strong><small>{document.title}</small></div></div>
        <div className="toolbar-group">
          <ToolButton label="新建项目" onClick={handleNew}><FilePlus2 /></ToolButton><ToolButton label="打开项目" onClick={handleOpen} disabled={!isDesktopRuntime()}><FileUp /></ToolButton><ToolButton label={saving ? "正在保存" : "保存项目"} onClick={handleSave} disabled={saving}><Save /></ToolButton>
          <span className="separator" />
          <ToolButton label="撤销" onClick={undo} disabled={!undoStack.length}><Undo2 /></ToolButton><ToolButton label="重做" onClick={redo} disabled={!redoStack.length}><Redo2 /></ToolButton>
        </div>
        <div className="toolbar-group insert-tools">
          <ToolButton label="选择"><MousePointer2 /></ToolButton><ToolButton label="文本" onClick={() => execute({ type: "add-text", slideId: activeSlide.id })}><Type /></ToolButton>
          <ToolButton label="矩形" onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "rectangle" })}><Square /></ToolButton>
          <ToolButton label="椭圆" onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "ellipse" })}><Circle /></ToolButton>
          <ToolButton label="图片" onClick={() => imageInputRef.current?.click()}><ImagePlus /></ToolButton>
          <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { handleImageFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <ToolButton label="重排版式（保留手工对象）" onClick={() => { execute({ type: "relayout-slide", slideId: activeSlide.id }); setTaskStatus("已按当前内容重新应用版式，手工添加的图片、文本和锁定对象已保留"); }}><Wand2 /></ToolButton>
        </div>
        <button className="export-button" onClick={handleExport}><Download size={17} /> {exportBusy ? "取消导出" : "导出 PPTX"}</button>
      </header>}

      <nav className="nav-rail" aria-label="主功能">
        <button className={activeView === "editor" ? "active" : ""} aria-current={activeView === "editor" ? "page" : undefined} title="编辑器" onClick={() => setActiveView("editor")}><LayoutDashboard /><span>编辑</span></button>
        <button className={activeView === "ai" ? "active" : ""} aria-current={activeView === "ai" ? "page" : undefined} title="AI 生成" onClick={() => setActiveView("ai")} disabled={!isDesktopRuntime()}><Sparkles /><span>AI</span></button>
        <button className={activeView === "theme" ? "active" : ""} aria-current={activeView === "theme" ? "page" : undefined} title="PPT 模板" onClick={() => setActiveView("theme")}><Palette /><span>模板</span></button>
        <div className="nav-spacer" />
        <button className={activeView === "settings" ? "active" : ""} aria-current={activeView === "settings" ? "page" : undefined} title="设置" onClick={() => setActiveView("settings")}><Settings /><span>设置</span></button>
      </nav>

      {activeView === "editor" && <><aside className="left-panel">
        <div className="panel-heading">
          <div className="panel-tabs" role="tablist" aria-label="左侧面板">
            <button type="button" role="tab" aria-selected={leftTab === "slides"} className={`panel-tab ${leftTab === "slides" ? "active" : ""}`} onClick={() => setLeftTab("slides")}>页面</button>
            <button type="button" role="tab" aria-selected={leftTab === "layers"} className={`panel-tab ${leftTab === "layers" ? "active" : ""}`} onClick={() => setLeftTab("layers")}>图层</button>
          </div>
          {leftTab === "slides" && <button aria-label="新增页面" title="新增页面" onClick={() => execute({ type: "add-slide" })}><Plus size={16} /></button>}
        </div>
        {leftTab === "slides" ? <div className="slide-list">
          {document.slides.map((slide, index) => <div key={slide.id} className={`thumbnail-row ${slide.id === activeSlide.id ? "active" : ""}`}>
            <button className="thumbnail-select" onClick={() => selectSlide(slide.id)}><span>{index + 1}</span><div className="thumbnail"><SlideThumbnail slide={slide} pageWidth={document.pageSize.width} pageHeight={document.pageSize.height} /></div></button>
            {slide.id === activeSlide.id && <div className="thumbnail-actions">
              <button aria-label="上移页面" title="上移页面" disabled={index === 0} onClick={() => execute({ type: "move-slide", slideId: slide.id, toIndex: index - 1 })}><ArrowUp /></button>
              <button aria-label="下移页面" title="下移页面" disabled={index === document.slides.length - 1} onClick={() => execute({ type: "move-slide", slideId: slide.id, toIndex: index + 1 })}><ArrowDown /></button>
              <button aria-label="复制页面" title="复制页面" onClick={() => execute({ type: "duplicate-slide", slideId: slide.id })}><Copy /></button>
              <button aria-label="删除页面" title="删除页面" disabled={document.slides.length === 1} onClick={() => execute({ type: "delete-slide", slideId: slide.id })}><Trash2 /></button>
            </div>}
          </div>)}
        </div> : <LayerList slide={activeSlide} selectedElementId={selectedElementId} onSelect={selectElement} />}
      </aside>

      <main className="workspace" onPointerDown={() => selectElement(null)}>
        <div className="canvas-ruler">13.33 × 7.5 in</div>
        <div className="slide-canvas" style={{ width: CANVAS_WIDTH * zoom, height: canvasHeight, background: activeSlide.background }}>
          {activeSlide.elements.map((element) => <ElementView key={element.id} element={element} slide={activeSlide} scale={scale} selected={element.id === selectedElementId} />)}
        </div>
      </main>

      <InspectorPanel />
    </>}

      {activeView === "ai" && <main className="feature-workspace ai-workspace">
        <header className="feature-header"><div><Sparkles /><div><h1>AI 内容工作台</h1><p>生成并审核内容，确认后再套用 PPT 模板</p></div></div><div className="feature-header-actions"><div className="workflow-steps" aria-label="制作流程"><span className={!aiDraft ? "active" : "done"} aria-current={!aiDraft ? "step" : undefined}>{aiDraft ? <Check /> : "1"} 生成草稿</span><i /><span className={aiDraft ? "active" : ""} aria-current={aiDraft ? "step" : undefined}>2 编辑文字</span><i /><span>3 上传模板</span></div>{aiDraft && <div className="draft-header-actions">{aiDraftBlockingIssues.length > 0 && <span className="draft-blocked-hint"><CircleAlert />{aiDraftBlockHint}</span>}<button className="primary-action" title={aiDraftBlockReason} disabled={Boolean(aiDraftBlockReason)} onClick={continueToTheme}>确认内容，选择 PPT 模板<ArrowRight /></button></div>}</div></header>
        {!aiDraft ? <div className="ai-split">
          <aside className="ai-history"><div className="ai-history-heading"><strong>制作历史</strong><span>{aiHistory.length} 个草稿</span></div>{aiHistory.length === 0 ? <p className="ai-history-empty">还没有草稿</p> : aiHistory.map((entry) => <button type="button" key={entry.id} onClick={() => openAiHistory(entry)}><Sparkles /><div><strong>{entry.draft.title}</strong><span>{entry.draft.slides.length} 页 · {new Date(entry.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><p>{entry.topic}</p></div></button>)}</aside>
          <div className="feature-scroll ai-plan-pane">
          <div className="ai-compose-card">
          <div className="section-kicker">AI 内容规划</div><h2>你想制作什么演示文稿？</h2><p>描述主题、受众、场景和重点，AI 将生成演示简报、逐页计划和可编辑的结构化内容。</p>
          <label>主题与要求<textarea value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} placeholder="例如：为管理层制作一份产品战略汇报，突出增长机会和下一季度行动" /></label>
          <label className="slide-count-field">页数<input type="number" min="1" max="20" value={aiSlideCount} onChange={(event) => setAiSlideCount(Math.max(1, Math.min(20, Number(event.target.value))))} /></label>
          <button className="primary-action" disabled={!aiTopic.trim()} onClick={handleAiGenerate}>{aiBusy ? "取消生成" : "生成 PPT 草稿"}<ArrowRight /></button>
          {aiBusy && aiProgress && <div className="ai-generation-progress" role="status" aria-live="polite"><strong>{aiGenerationLabel}</strong><div className="design-progress-track" aria-label="AI 生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={aiGenerationPercent} role="progressbar"><i style={{ width: `${aiGenerationPercent}%` }} /></div><span>生成中可随时点击“取消生成”停止本次任务</span></div>}
          <small>生成结果通过结构化 Schema 校验，应用前不会修改当前文稿。</small>
          </div>
          </div>
        </div> : <div className="feature-scroll draft-mode"><ContentReview
          draft={aiDraft}
          originalDraft={aiOriginalDraft.current}
          activeIndex={activeDraftSlideIndex}
          saveState={aiSaveState}
          restoreUndoIndexes={aiRestoreUndoIndexes}
          onActiveIndexChange={setActiveDraftSlideIndex}
          onDraftTitleChange={updateAiDraftTitle}
          onSlideFieldChange={updateAiSlide}
          onSlideBlocksChange={updateAiBlocks}
          onRestoreSlide={restoreAiSlide}
          onUndoRestore={undoRestoreAiSlide}
          onNewDraft={() => setNewDraftConfirmOpen(true)}
        /></div>}
      </main>}

      {activeView === "theme" && <main className="feature-workspace theme-workspace">
        <header className="feature-header"><div><Palette /><div><h1>PPT 模板</h1><p>上传用户模板，在内容确认后提取主题、母版和页面版式</p></div></div><div className="feature-header-actions"><div className="workflow-steps"><span className="done"><Check /> 生成草稿</span><i /><span className="done"><Check /> 编辑文字</span><i /><span className="active">3 上传模板</span></div><button type="button" className="primary-action header-upload-button" onClick={() => setTemplateUploadOpen(true)}><FileUp />上传 PPT 模板</button></div></header>
        <div className="feature-scroll">
        <section className="template-content">
          <div className="template-browser">
            <div className="template-library"><div className="template-library-heading"><div><strong>已保存模板</strong><span>{templateLibrary.length} 个</span></div></div><div>{templateLibrary.map((template) => <button type="button" className={selectedTemplate?.id === template.id ? "active" : ""} key={template.id} onClick={() => void handleSelectTemplate(template)}><FileUp /><span><strong>{template.name}</strong><small>{(template.size / 1024 / 1024).toFixed(2)} MB · {new Date(template.importedAt).toLocaleString("zh-CN")}</small></span>{selectedTemplate?.id === template.id && <Check />}</button>)}</div>{templateLibrary.length === 0 && <div className="template-empty">尚未上传模板</div>}</div>
            <div className="template-preview-panel"><div className="template-preview-heading"><strong><Eye />模板预览</strong>{selectedTemplate && <span>{selectedTemplate.name}</span>}</div><div className="template-preview-stage">{templatePreviewBusy ? <span>正在解析模板…</span> : templatePreview ? <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} /> : selectedTemplate ? <span>此 PPTX 没有内嵌封面预览</span> : <span>选择左侧模板后查看预览</span>}</div>{templateAnalysis && <div className="template-analysis"><div className="template-analysis-grid"><span><b>{templateAnalysis.slideCount}</b>页面</span><span><b>{templateAnalysis.masterCount}</b>母版</span><span><b>{templateAnalysis.layoutCount}</b>版式</span><span><b>{templateAnalysis.themeCount}</b>主题</span></div><dl><div><dt>页面尺寸</dt><dd>{templateAnalysis.slideWidthEmu && templateAnalysis.slideHeightEmu ? `${(templateAnalysis.slideWidthEmu / EMU_PER_INCH).toFixed(2)} × ${(templateAnalysis.slideHeightEmu / EMU_PER_INCH).toFixed(2)} in` : "未定义"}</dd></div><div><dt>标题字体</dt><dd>{templateAnalysis.majorFont || "未定义"}</dd></div><div><dt>正文字体</dt><dd>{templateAnalysis.minorFont || "未定义"}</dd></div></dl>{templateAnalysis.themeColors.length > 0 && <div className="template-color-row" aria-label="主题色">{templateAnalysis.themeColors.map((color) => <span key={color.name} title={`${color.name} ${color.value}`} style={{ backgroundColor: color.value }} />)}</div>}<div className="template-analysis-warning">{templateAnalysis.warnings.join("；")}</div>{templateAnalysis.slides.length > 0 && <div className="template-slide-summaries"><strong>页面结构</strong><div>{templateAnalysis.slides.map((slide) => <article key={slide.index}><b>{String(slide.index).padStart(2, "0")}</b><span><strong>{slide.title}</strong><small>{slide.textCount} 文本 · {slide.imageCount} 图片 · {slide.shapeCount} 形状{slide.layout ? ` · ${slide.layout}` : ""}</small></span></article>)}</div></div>}</div>}</div>
          </div>
        </section>
        </div>
      </main>}

      {activeView === "settings" && <main className="feature-workspace settings-workspace">
        <header className="feature-header"><div><Settings /><div><h1>设置</h1><p>管理模型连接、安全凭据和 PPTD 应用外观</p></div></div></header>
        <div className="feature-scroll"><SettingsWorkspace onMessage={setTaskStatus} /></div>
      </main>}

      {templateUploadOpen && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateUploadOpen(false); }}><section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-template-title"><div className="upload-dialog-heading"><div><FileUp /><div><h2 id="upload-template-title">上传 PPT 模板</h2><p>模板将保存到 PPTD 模板库。</p></div></div><button type="button" aria-label="关闭上传窗口" onClick={() => setTemplateUploadOpen(false)}><X /></button></div><button type="button" className="template-dropzone" onClick={() => void handleChooseTemplate()}><FileUp /><strong>选择 PPTX 模板</strong><span>从电脑中选择一个 PowerPoint 模板文件</span><small>支持 .pptx，最大 512 MB</small></button><div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setTemplateUploadOpen(false)}>取消</button></div></section></div>}

      {templatePickerOpen && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!designBusy && event.target === event.currentTarget) setTemplatePickerOpen(false); }}><section className="upload-dialog template-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="template-picker-title" aria-busy={designBusy}><div className="upload-dialog-heading"><div><Palette /><div><h2 id="template-picker-title">选择 PPT 模板</h2><p>AI 将依据模板特征设计并渲染文稿，完成后进入编辑模块。</p></div></div><button type="button" aria-label="关闭模板选择窗口" disabled={designBusy} onClick={() => setTemplatePickerOpen(false)}><X /></button></div><div className="template-picker-toolbar"><strong>已保存模板</strong><button type="button" className="secondary-action" disabled={designBusy} onClick={() => setTemplateUploadOpen(true)}><FileUp />上传模板</button></div><div className="template-picker-body"><div className="template-library"><div>{templateLibrary.map((template) => <button type="button" disabled={designBusy} className={selectedTemplate?.id === template.id ? "active" : ""} key={template.id} onClick={() => void handleSelectTemplate(template)}><FileUp /><span><strong>{template.name}</strong><small>{(template.size / 1024 / 1024).toFixed(2)} MB · {new Date(template.importedAt).toLocaleString("zh-CN")}</small></span>{selectedTemplate?.id === template.id && <Check />}</button>)}</div>{templateLibrary.length === 0 && <div className="template-empty">尚未上传模板，请先上传 PPTX 模板</div>}</div><div className="template-preview-panel"><div className={`template-preview-stage ${designBusy ? "generating" : ""}`}>{designBusy ? <div className="design-progress" role="status" aria-live="polite"><Sparkles /><strong>{designProgress.label}</strong><span>{designProgress.percent}%</span><div className="design-progress-track" aria-label="AI 生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={designProgress.percent} role="progressbar"><i style={{ width: `${designProgress.percent}%` }} /></div><small>AI 生成阶段为估算进度，校验与渲染阶段按实际节点更新</small><button type="button" className="secondary-action design-cancel-action" onClick={() => { designCancelRef.current = true; setDesignProgress({ percent: 0, label: "正在取消…" }); void cancelAiGeneration(designTaskId.current).catch(() => undefined); }}>取消生成</button></div> : templatePreviewBusy ? <span>正在解析模板…</span> : templatePreview ? <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} /> : selectedTemplate ? <span>此 PPTX 没有内嵌封面预览</span> : <span>选择左侧模板后查看预览</span>}</div>{templateAnalysis && <div className="template-picker-summary"><span>{templateAnalysis.slideCount} 页面</span><span>{templateAnalysis.layoutCount} 版式</span><span>{templateAnalysis.themeCount} 主题</span></div>}</div></div><div className="upload-dialog-actions"><button type="button" className="secondary-action" disabled={designBusy} onClick={() => setTemplatePickerOpen(false)}>取消</button><button type="button" className="primary-action" disabled={!selectedTemplate || !templateAnalysis || templatePreviewBusy || designBusy} onClick={() => void generateFromDraft()}>{designBusy ? `${designProgress.percent}%` : "生成 PPT"}{!designBusy && <ArrowRight />}</button></div></section></div>}

      {designQualityReport && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDesignQualityReport(undefined); }}><section className="upload-dialog export-report-dialog design-quality-dialog" role="dialog" aria-modal="true" aria-labelledby="design-quality-title"><div className="upload-dialog-heading"><div><CircleAlert /><div><h2 id="design-quality-title">设计质检报告</h2><p>{designQualityReport.templateName} · PPT 已生成并写入当前项目，以下问题不会阻止继续编辑或导出。</p></div></div><button type="button" aria-label="关闭设计质检报告" onClick={() => setDesignQualityReport(undefined)}><X /></button></div>{designQualityReport.issues.length === 0 ? <div className="template-empty">质量门没有给出具体问题，但检查未完成。</div> : <ul className="export-report-list">{designQualityReport.issues.map((issue, index) => <li key={`${issue.issue}-${issue.slideIndex}-${index}`} className="error"><CircleAlert /><div><strong>第 {issue.slideIndex + 1} 页 · {issue.message}</strong>{issue.elementIds.length > 0 && <p>{issue.elementIds.length} 个对象需要调整</p>}</div></li>)}</ul>}{designQualityReport.notes.length > 0 && <p className="design-quality-notes">{designQualityReport.notes.join("；")}</p>}<div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setDesignQualityReport(undefined)}>稍后处理</button><button type="button" className="primary-action" onClick={() => { setDesignQualityReport(undefined); setActiveView("editor"); }}>进入编辑器调整<ArrowRight /></button></div></section></div>}

      {exportReport && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportReport(undefined); }}><section className="upload-dialog export-report-dialog" role="dialog" aria-modal="true" aria-labelledby="export-report-title"><div className="upload-dialog-heading"><div><CircleCheck /><div><h2 id="export-report-title">导出报告</h2><p>{exportReport.slideCount} 页 · {exportReport.nativeObjectCount} 个原生对象{exportReport.nativeChartCount > 0 ? ` · ${exportReport.nativeChartCount} 个原生图表` : ""}{exportReport.nativeTableCount > 0 ? ` · ${exportReport.nativeTableCount} 个原生表格` : ""} · ZIP {exportReport.package.entryCount} 个条目{exportReport.masters.length > 0 ? ` · ${exportReport.masters.length} 个母版（${exportReport.masters.join("、")}）` : ""}{exportReport.themeColors.length > 0 ? ` · 主题色 ${exportReport.themeColors.join("、")}` : ""}</p></div></div><button type="button" aria-label="关闭导出报告" onClick={() => setExportReport(undefined)}><X /></button></div>{exportReport.issues.length === 0 ? <div className="template-empty">未发现导出问题</div> : <ul className="export-report-list">{exportReport.issues.map((issue, index) => <li key={`${issue.code}-${issue.slideIndex}-${issue.elementId ?? index}`} className={issue.severity}><CircleAlert /><div><strong>{issue.severity === "error" ? "错误" : "提示"} · 第 {issue.slideIndex + 1} 页</strong><p>{issue.message}</p></div></li>)}</ul>}<div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setExportReport(undefined)}>关闭</button></div></section></div>}

      {newDraftConfirmOpen && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewDraftConfirmOpen(false); }}><section className="upload-dialog new-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="new-draft-title"><div className="upload-dialog-heading"><div><FilePlus2 /><div><h2 id="new-draft-title">新建草稿？</h2><p>当前草稿会先保存到制作历史，新草稿从空白主题开始。</p></div></div><button type="button" aria-label="关闭新建草稿窗口" onClick={() => setNewDraftConfirmOpen(false)}><X /></button></div><div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setNewDraftConfirmOpen(false)}>取消</button><button type="button" className="primary-action" onClick={confirmNewDraft}><FilePlus2 />新建空白草稿</button></div></section></div>}

      {message && <div className={`page-message ${message.kind}`} role="status" aria-live="polite">{message.kind === "success" ? <CircleCheck /> : message.kind === "error" ? <CircleAlert /> : <Info />}<span>{message.text}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}><X /></button></div>}

      <footer className="statusbar">{activeView === "ai" ? (aiDraft ? <><span>草稿第 {activeDraftSlideIndex + 1} / {aiDraft.slides.length} 页</span><span>{aiDraftMetrics.characters} 字</span><span>{aiDraftMetrics.points} 条要点</span><span className={`saved-dot ${aiSaveState === "saving" ? "dirty" : ""}`}>● {aiSaveState === "saving" ? "保存中…" : "已自动保存"}</span></> : <><span>AI 内容工作台</span><span>填写主题后生成结构化草稿</span><span className="saved-dot">● {aiHistory.length > 0 ? `${aiHistory.length} 个历史草稿` : "尚未生成草稿"}</span></>) : <><span>第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页</span><span>{countLabel}</span><span>{revisionLabel}</span><span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span><span className="zoom-controls"><button type="button" aria-label="缩小画布" onClick={() => setZoom((value) => Math.max(0.3, Math.round((value - 0.1) * 10) / 10))}>−</button><button type="button" className="zoom" title="适应窗口" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="放大画布" onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.1) * 10) / 10))}>＋</button></span></>}</footer>
    </div>
  );
}
