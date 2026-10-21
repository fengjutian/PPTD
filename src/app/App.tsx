import { ArrowDown, ArrowRight, ArrowUp, Check, Circle, CircleAlert, CircleCheck, Copy, Download, Eye, FilePlus2, FileUp, ImagePlus, Info, LayoutDashboard, MousePointer2, Palette, Plus, Redo2, Save, Settings, Sparkles, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EMU_PER_INCH, emu, type ElementId, type RectEmu, type SlideElement } from "../core/document-model";
import { applyCommand, type AiSlideDesign, type DocumentCommand } from "../core/commands";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";
import { InspectorPanel } from "../features/editor/InspectorPanel";
import { LayerList } from "../features/editor/LayerList";
import { ContentReview } from "../features/ai/ContentReview";
import { draftMetrics, missingTitleIndexes, withSlideIds, type AiDraftSaveState } from "../features/ai/content-review";
import { SettingsWorkspace } from "../features/settings/SettingsDialog";
import { loadAiHistory, saveAiHistory, type AiHistoryEntry } from "../services/ai-history";
import { briefsFromDraft, describeAiError, generatePresentationDesign, generatePresentationDraft, type AiDraft } from "../services/ai-service";
import { applyTheme, defaultSettings, loadSettings } from "../services/settings";
import { analyzePptxTemplate, choosePptxPath, choosePptxTemplate, chooseProjectToOpen, clearRecovery, getPptxTemplatePreview, importPptxTemplate, isDesktopRuntime, listPptxTemplates, loadRecovery, projectModifiedAt, renderPptxTemplateLayouts, saveProject, saveRecovery, writePptx, type TemplateAnalysis, type TemplateRecord } from "../services/project-files";
import { useEditorStore } from "../store/editor-store";
import { inspectRenderedTextContrast, renderPresentationForVisualReview, type RenderedContrastIssue } from "../services/presentation-renderer";
import { defaultPresentationVisualGoal, runVisualAlignmentLoop } from "../services/visual-alignment";
import { TauriVisionReviewPort } from "../services/vision-review-port";
import { validatePresentationVisualQuality } from "../services/presentation-quality-gate";
import { probeTemplateBackground, type TemplateBackgroundProbe } from "../services/template-background";
import { colorLuminance, contrastRatioAgainstLuminance } from "../core/rendering/contrast";
import type { ExportReport } from "../features/pptx-export/export-pptx";

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

function ElementView({ element, scale, selected, onSelect }: { element: SlideElement; scale: number; selected: boolean; onSelect: () => void }) {
  const execute = useEditorStore((s) => s.execute);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
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
    onSelect();
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
      {element.type === "text" ? <div style={{ fontFamily: element.style.fontFamily, fontSize: element.style.fontSizePt * scale * EMU_PER_INCH / 72, color: element.style.color, fontWeight: element.style.bold ? 700 : 400, textAlign: element.style.align }}>{element.text}</div> : element.type === "shape" ? <div className={`shape-fill ${element.shape}`} style={{ background: element.style.fill, borderColor: element.style.stroke, borderWidth: element.style.strokeWidthPt, borderRadius: element.shape === "ellipse" ? "50%" : element.style.radiusPt }} /> : <img className="image-fill" src={element.source.dataUrl} alt={element.altText} draggable={false} />}
      {selected && !element.locked && <>
        {RESIZE_HANDLES.map(([direction, label]) => <button key={direction} type="button" aria-label={`从${label}缩放`} className={`element-handle ${direction}`} onPointerDown={(event) => begin("resize", event, direction)} />)}
        <button type="button" aria-label="旋转对象" className="element-rotate-handle" onPointerDown={(event) => begin("rotate", event)} />
      </>}
    </div>
  );
}

function SlideThumbnail({ slide, pageWidth, pageHeight }: { slide: ReturnType<typeof useEditorStore.getState>["document"]["slides"][number]; pageWidth: number; pageHeight: number }) {
  return <div className="thumbnail-scene">{slide.elements.map((element) => {
    const style: React.CSSProperties = {
      left: `${element.frame.x / pageWidth * 100}%`,
      top: `${element.frame.y / pageHeight * 100}%`,
      width: `${element.frame.width / pageWidth * 100}%`,
      height: `${element.frame.height / pageHeight * 100}%`,
      transform: `rotate(${element.rotationMilliDegree / 1000}deg)`,
    };
    if (element.type === "text") return <div className="thumbnail-element thumbnail-text" key={element.id} style={{ ...style, color: element.style.color, fontFamily: element.style.fontFamily, fontSize: Math.max(4, element.style.fontSizePt * 0.18), fontWeight: element.style.bold ? 700 : 400, textAlign: element.style.align }}>{element.text}</div>;
    if (element.type === "image") return <img className="thumbnail-element thumbnail-image" key={element.id} style={style} src={element.source.dataUrl} alt="" />;
    return <div className={`thumbnail-element thumbnail-shape ${element.shape}`} key={element.id} style={{ ...style, background: element.style.fill, borderColor: element.style.stroke, borderWidth: Math.max(1, element.style.strokeWidthPt * 0.3), borderRadius: element.shape === "ellipse" ? "50%" : Math.max(0, element.style.radiusPt * 0.3) }} />;
  })}{slide.elements.length === 0 && <div className="thumbnail-fallback-title">{slide.content.title}</div>}</div>;
}

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
  const exportController = useRef<AbortController | undefined>(undefined);
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
  const [aiBusy, setAiBusy] = useState(false);
  const aiRequestId = useRef(0);
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
  const [designProgress, setDesignProgress] = useState<DesignProgress>({ percent: 0, label: "等待开始" });
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
      .then((settings) => applyTheme(settings.theme))
      .catch((error: unknown) => {
        applyTheme(defaultSettings().theme);
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

  useEffect(() => {
    let active = true;
    void loadRecovery().then((recovery) => {
      if (!active || !recovery) return;
      if (!window.confirm("检测到未完成的恢复快照，是否恢复？")) {
        void clearRecovery();
        return;
      }
      loadDocument(recovery);
      setProjectPath(undefined);
      setSavedRevision(-1);
      setTaskStatus("已恢复自动保存快照，请另存项目");
    }).catch((error: unknown) => setTaskStatus(`恢复检查失败：${error instanceof Error ? error.message : String(error)}`));
    return () => { active = false; };
  }, [loadDocument]);

  useEffect(() => {
    if (!dirty || !isDesktopRuntime()) return;
    const timer = window.setTimeout(() => {
      void saveRecovery(document).catch((error: unknown) => setTaskStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, document]);

  const handleNew = async () => {
    if (dirty && !window.confirm("当前项目还有未保存的修改，确定新建吗？")) return;
    await clearRecovery().catch(() => undefined);
    newDocument();
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
      loadDocument(result.document);
      await clearRecovery();
      setProjectPath(result.path);
      setProjectMtime(result.modifiedAt);
      setSavedRevision(result.document.revisions.document);
      setTaskStatus("项目已打开");
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
      if (isDesktopRuntime()) setProjectPath(result.path);
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
      exportController.current?.abort();
      return;
    }
    const controller = new AbortController();
    exportController.current = controller;
    setExportBusy(true);
    setExportReport(undefined);
    setTaskStatus("正在生成 PPTX…");
    try {
      const { buildPptx } = await import("../features/pptx-export/export-pptx");
      const { bytes, report } = await buildPptx(document, { signal: controller.signal });
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
      exportController.current = undefined;
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
      execute({ type: "add-image", slideId: activeSlide.id, dataUrl: reader.result, mimeType: file.type as "image/png" | "image/jpeg" | "image/webp", altText: file.name });
      setTaskStatus(`已添加图片：${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleAiGenerate = async () => {
    if (aiBusy) {
      aiRequestId.current += 1;
      setAiBusy(false);
      setTaskStatus("已取消 AI 内容生成");
      return;
    }
    const requestId = aiRequestId.current + 1;
    aiRequestId.current = requestId;
    setAiBusy(true); setAiDraft(undefined);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    try {
      const draft = withSlideIds(await generatePresentationDraft(aiTopic, aiSlideCount));
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
    finally { if (requestId === aiRequestId.current) setAiBusy(false); }
  };

  useEffect(() => {
    if (!aiDraft || !activeHistoryId) return;
    setAiSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveAiHistory({ id: activeHistoryId, topic: aiTopic, slideCount: aiDraft.slides.length, draft: aiDraft })
        .then((history) => { setAiHistory(history); setAiSaveState("saved"); })
        .catch((error: unknown) => {
          setAiSaveState("saved");
          setTaskStatus(`草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeHistoryId, aiDraft, aiTopic]);

  const persistAiDraft = () => {
    if (!aiDraft || !activeHistoryId) return;
    void saveAiHistory({ id: activeHistoryId, topic: aiTopic, slideCount: aiDraft.slides.length, draft: aiDraft })
      .then(setAiHistory)
      .catch((error: unknown) => setTaskStatus(`草稿历史保存失败：${error instanceof Error ? error.message : String(error)}`));
    setAiSaveState("saved");
  };

  const openAiHistory = (entry: AiHistoryEntry) => {
    persistAiDraft();
    const draft = withSlideIds(entry.draft);
    aiOriginalDraft.current = structuredClone(draft);
    setActiveHistoryId(entry.id); setAiTopic(entry.topic); setAiSlideCount(entry.slideCount); setAiDraft(draft); setActiveDraftSlideIndex(0); setAiSaveState("saved");
  };

  const updateAiSlide = (index: number, field: "title" | "body" | "speakerNotes", value: string) => {
    setAiDraft((draft) => draft ? { ...draft, slides: draft.slides.map((slide, slideIndex) => {
      if (slideIndex !== index) return slide;
      if (field !== "body") return { ...slide, [field]: value };
      const items = value.split(/\n+|(?=(?:\d+[.、]|[一二三四五六七八九十]+[、.]|[•·▪])\s*)/).map((item) => item.trim()).filter(Boolean);
      return { ...slide, body: value, blocks: items.length > 1 ? [{ type: "bullet-list" as const, items }] : value.trim() ? [{ type: "paragraph" as const, text: value.trim() }] : [] };
    }) } : draft);
  };

  const updateAiDraftTitle = (title: string) => setAiDraft((draft) => (draft ? { ...draft, title } : draft));

  const restoreAiSlide = (index: number) => {
    const original = aiOriginalDraft.current?.slides[index];
    if (!original) return;
    setAiDraft((draft) => draft ? {
      ...draft,
      slides: draft.slides.map((slide, slideIndex) => (slideIndex === index ? { ...original, id: slide.id } : slide)),
    } : draft);
    setTaskStatus(`已恢复第 ${index + 1} 页的 AI 原始内容`);
  };

  const confirmNewDraft = () => {
    persistAiDraft();
    aiOriginalDraft.current = undefined;
    setAiDraft(undefined);
    setActiveHistoryId(undefined);
    setActiveDraftSlideIndex(0);
    setAiSaveState("saved");
    setNewDraftConfirmOpen(false);
    setTaskStatus("已新建空白草稿");
  };

  const aiDraftMissingTitles = useMemo(() => (aiDraft ? missingTitleIndexes(aiDraft) : []), [aiDraft]);
  const aiDraftMetrics = useMemo(() => (aiDraft ? draftMetrics(aiDraft) : { characters: 0, points: 0 }), [aiDraft]);

  const continueToTheme = () => {
    if (!aiDraft) return;
    setTemplatePickerOpen(true);
  };

  const generateFromDraft = async () => {
    if (!aiDraft || !selectedTemplate || !templateAnalysis) return;
    designCancelRef.current = false;
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
      const design = await generatePresentationDesign(aiDraft, briefs, templateAnalysis);
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
        backgroundRhythm: defaultPresentationVisualGoal().backgroundRhythm,
      };
      let finalDesigns: AiSlideDesign[] = design.slides;
      let visualNote = "";
      try {
        const goal = defaultPresentationVisualGoal();
        const vision = new TauriVisionReviewPort();
        const makeCandidate = (designs: AiSlideDesign[]) => {
          const candidate = structuredClone(document);
          applyCommand(candidate, { ...generationCommand, designs });
          return candidate;
        };
        const aligned = await runVisualAlignmentLoop({
          initial: finalDesigns,
          goal,
          contentFingerprint: () => JSON.stringify(aiDraft.slides.map((slide) => ({ title: slide.title, body: slide.body, speakerNotes: slide.speakerNotes, blocks: slide.blocks }))),
          review: async (designs, visualGoal, iteration) => {
            if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
            setDesignProgress({ percent: 95 + iteration, label: `视觉模型正在检查第 ${iteration} 轮` });
            const render = await renderPresentationForVisualReview(makeCandidate(designs));
            const reviews = [];
            for (let start = 0; start < render.slides.length; start += 6) {
              const indexes = render.slides.slice(start, start + 6).map((_, offset) => start + offset);
              reviews.push(await vision.review(render, visualGoal, indexes));
            }
            return { overallScore: Math.min(...reviews.map((item) => item.overallScore)), hierarchyScore: Math.min(...reviews.map((item) => item.hierarchyScore)), alignmentScore: Math.min(...reviews.map((item) => item.alignmentScore)), readabilityScore: Math.min(...reviews.map((item) => item.readabilityScore)), consistencyScore: Math.min(...reviews.map((item) => item.consistencyScore)), issues: reviews.flatMap((item) => item.issues), slideGuidance: reviews.flatMap((item) => item.slideGuidance) };
          },
          repair: async (designs, review, visualGoal) => {
            const plan = await vision.planRepairs(review, visualGoal);
            const repairs = new Map(plan.repairs.map((repair) => [repair.slideIndex, repair]));
            return designs.map((slide, slideIndex) => {
              const repair = repairs.get(slideIndex);
              if (!repair) return slide;
              const backgroundTreatment: AiSlideDesign["backgroundTreatment"] = repair.backgroundAction === "keep" ? "none" : repair.backgroundAction === "simplify" ? "simplify" : "local-scrim";
              return {
                ...slide,
                layout: repair.layout ?? slide.layout,
                safeRegion: repair.safeRegion ?? slide.safeRegion,
                obstacleRegions: repair.obstacleRegions,
                hierarchyAction: repair.hierarchyAction,
                backgroundTreatment,
                elementRepairs: repair.elementActions,
              };
            });
          },
        });
        finalDesigns = aligned.value;
        visualNote = `视觉评审 ${aligned.iterations} 轮，${aligned.stopReason}`;
      } catch (visionError) {
        visualNote = `视觉评审降级：${visionError instanceof Error ? visionError.message : String(visionError)}`;
      }
      const buildFinalDocument = (designs: AiSlideDesign[]) => {
        const candidate = structuredClone(document);
        applyCommand(candidate, { ...generationCommand, designs });
        return candidate;
      };
      let finalDocument = buildFinalDocument(finalDesigns);
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      let renderedContrastIssues = await inspectRenderedTextContrast(finalDocument);
      if (renderedContrastIssues.length > 0) {
        // Repair the ink on the artwork that actually carries the text. Painting a
        // panel over the whole page erased the template design, which was the
        // main reason generated decks looked like a blank sheet.
        const affectedSlides = new Map<number, RenderedContrastIssue[]>();
        renderedContrastIssues.forEach((issue) => affectedSlides.set(issue.slideIndex, [...(affectedSlides.get(issue.slideIndex) ?? []), issue]));
        finalDesigns = finalDesigns.map((slide, slideIndex) => {
          const issues = affectedSlides.get(slideIndex);
          if (!issues) return slide;
          const luminance = colorLuminance(issues[0]!.backgroundColor) ?? 1;
          const onDark = (contrastRatioAgainstLuminance("#FFFFFF", luminance) ?? 0) >= (contrastRatioAgainstLuminance("#171A1F", luminance) ?? 0);
          // The ink has to override the one the template assigned to its
          // placeholder, otherwise the repair would be overruled by the
          // template and the page would stay unreadable.
          return { ...slide, backgroundTreatment: "none", inkOverride: true, titleColor: onDark ? "#FFFFFF" : "#171A1F", bodyColor: onDark ? "#DCE3EA" : "#3E4650" };
        });
        finalDocument = buildFinalDocument(finalDesigns);
        renderedContrastIssues = await inspectRenderedTextContrast(finalDocument);
      }
      if (renderedContrastIssues.length > 0) {
        // Still unreadable: the artwork varies too much under the text, so the
        // text block gets its own panel instead of the whole page.
        const stubborn = new Set(renderedContrastIssues.map((issue) => issue.slideIndex));
        finalDesigns = finalDesigns.map((slide, slideIndex) => stubborn.has(slideIndex) ? { ...slide, backgroundTreatment: "local-scrim" } : slide);
        finalDocument = buildFinalDocument(finalDesigns);
        renderedContrastIssues = await inspectRenderedTextContrast(finalDocument);
      }
      if (designCancelRef.current) throw new Error("AI_GENERATION_CANCELLED");
      const quality = validatePresentationVisualQuality(finalDocument, finalDesigns);
      if (!quality.passed || renderedContrastIssues.length > 0) {
        const allSlideIndexes = [...quality.issues.map((issue) => issue.slideIndex), ...renderedContrastIssues.map((issue) => issue.slideIndex)];
        const pages = [...new Set(allSlideIndexes.map((index) => index + 1))].join("、");
        throw new Error(`AI_VISUAL_QUALITY_GATE_FAILED: 第 ${pages} 页仍有 ${quality.issues.length + renderedContrastIssues.length} 个排版问题`);
      }
      replaceDocument(finalDocument, "both");
      setDesignProgress({ percent: 100, label: "生成完成，正在进入编辑器" });
      setTemplatePickerOpen(false);
      setActiveView("editor");
      if (visualNote) window.setTimeout(() => setTaskStatus(visualNote), 50);
      setTaskStatus(`PPT 已按模板完成 AI 设计：${selectedTemplate.name}`);
    } catch (error) {
      window.clearInterval(progressTimer);
      if (error instanceof Error && error.message === "AI_GENERATION_CANCELLED") {
        setDesignProgress({ percent: 0, label: "已取消生成" });
        setTaskStatus("已取消 AI 设计生成");
      } else {
        setDesignProgress({ percent: 0, label: "生成失败，请重试" });
        setTaskStatus(`AI 设计生成失败：${describeAiError(error)}`);
      }
    } finally {
      window.clearInterval(progressTimer);
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
          {activeSlide.elements.map((element) => <ElementView key={element.id} element={element} scale={scale} selected={element.id === selectedElementId} onSelect={() => selectElement(element.id)} />)}
        </div>
      </main>

      <InspectorPanel />
    </>}

      {activeView === "ai" && <main className="feature-workspace ai-workspace">
        <header className="feature-header"><div><Sparkles /><div><h1>AI 内容工作台</h1><p>生成并审核内容，确认后再套用 PPT 模板</p></div></div><div className="feature-header-actions"><div className="workflow-steps" aria-label="制作流程"><span className={!aiDraft ? "active" : "done"} aria-current={!aiDraft ? "step" : undefined}>{aiDraft ? <Check /> : "1"} 生成草稿</span><i /><span className={aiDraft ? "active" : ""} aria-current={aiDraft ? "step" : undefined}>2 编辑文字</span><i /><span>3 上传模板</span></div>{aiDraft && <div className="draft-header-actions">{aiDraftMissingTitles.length > 0 && <span className="draft-blocked-hint"><CircleAlert />{aiDraftMissingTitles.length} 页缺少标题</span>}<button className="primary-action" title={aiDraftMissingTitles.length > 0 ? "请先补全所有页面标题" : undefined} disabled={!aiDraft.title.trim() || aiDraftMissingTitles.length > 0} onClick={continueToTheme}>确认内容，选择 PPT 模板<ArrowRight /></button></div>}</div></header>
        {!aiDraft ? <div className="ai-split">
          <aside className="ai-history"><div className="ai-history-heading"><strong>制作历史</strong><span>{aiHistory.length} 个草稿</span></div>{aiHistory.length === 0 ? <p className="ai-history-empty">还没有草稿</p> : aiHistory.map((entry) => <button type="button" key={entry.id} onClick={() => openAiHistory(entry)}><Sparkles /><div><strong>{entry.draft.title}</strong><span>{entry.draft.slides.length} 页 · {new Date(entry.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><p>{entry.topic}</p></div></button>)}</aside>
          <div className="feature-scroll ai-plan-pane">
          <div className="ai-compose-card">
          <div className="section-kicker">AI 内容规划</div><h2>你想制作什么演示文稿？</h2><p>描述主题、受众、场景和重点，AI 将生成演示简报、逐页计划和可编辑的结构化内容。</p>
          <label>主题与要求<textarea value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} placeholder="例如：为管理层制作一份产品战略汇报，突出增长机会和下一季度行动" /></label>
          <label className="slide-count-field">页数<input type="number" min="1" max="20" value={aiSlideCount} onChange={(event) => setAiSlideCount(Math.max(1, Math.min(20, Number(event.target.value))))} /></label>
          <button className="primary-action" disabled={!aiTopic.trim()} onClick={handleAiGenerate}>{aiBusy ? "取消生成" : "生成 PPT 草稿"}<ArrowRight /></button>
          <small>生成结果通过结构化 Schema 校验，应用前不会修改当前文稿。</small>
          </div>
          </div>
        </div> : <div className="feature-scroll draft-mode"><ContentReview
          draft={aiDraft}
          originalDraft={aiOriginalDraft.current}
          activeIndex={activeDraftSlideIndex}
          saveState={aiSaveState}
          onActiveIndexChange={setActiveDraftSlideIndex}
          onDraftTitleChange={updateAiDraftTitle}
          onSlideFieldChange={updateAiSlide}
          onRestoreSlide={restoreAiSlide}
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

      {templatePickerOpen && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!designBusy && event.target === event.currentTarget) setTemplatePickerOpen(false); }}><section className="upload-dialog template-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="template-picker-title" aria-busy={designBusy}><div className="upload-dialog-heading"><div><Palette /><div><h2 id="template-picker-title">选择 PPT 模板</h2><p>AI 将依据模板特征设计并渲染文稿，完成后进入编辑模块。</p></div></div><button type="button" aria-label="关闭模板选择窗口" disabled={designBusy} onClick={() => setTemplatePickerOpen(false)}><X /></button></div><div className="template-picker-toolbar"><strong>已保存模板</strong><button type="button" className="secondary-action" disabled={designBusy} onClick={() => setTemplateUploadOpen(true)}><FileUp />上传模板</button></div><div className="template-picker-body"><div className="template-library"><div>{templateLibrary.map((template) => <button type="button" disabled={designBusy} className={selectedTemplate?.id === template.id ? "active" : ""} key={template.id} onClick={() => void handleSelectTemplate(template)}><FileUp /><span><strong>{template.name}</strong><small>{(template.size / 1024 / 1024).toFixed(2)} MB · {new Date(template.importedAt).toLocaleString("zh-CN")}</small></span>{selectedTemplate?.id === template.id && <Check />}</button>)}</div>{templateLibrary.length === 0 && <div className="template-empty">尚未上传模板，请先上传 PPTX 模板</div>}</div><div className="template-preview-panel"><div className={`template-preview-stage ${designBusy ? "generating" : ""}`}>{designBusy ? <div className="design-progress" role="status" aria-live="polite"><Sparkles /><strong>{designProgress.label}</strong><span>{designProgress.percent}%</span><div className="design-progress-track" aria-label="AI 生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={designProgress.percent} role="progressbar"><i style={{ width: `${designProgress.percent}%` }} /></div><small>AI 生成阶段为估算进度，校验与渲染阶段按实际节点更新</small><button type="button" className="secondary-action design-cancel-action" onClick={() => { designCancelRef.current = true; setDesignProgress({ percent: 0, label: "正在取消…" }); }}>取消生成</button></div> : templatePreviewBusy ? <span>正在解析模板…</span> : templatePreview ? <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} /> : selectedTemplate ? <span>此 PPTX 没有内嵌封面预览</span> : <span>选择左侧模板后查看预览</span>}</div>{templateAnalysis && <div className="template-picker-summary"><span>{templateAnalysis.slideCount} 页面</span><span>{templateAnalysis.layoutCount} 版式</span><span>{templateAnalysis.themeCount} 主题</span></div>}</div></div><div className="upload-dialog-actions"><button type="button" className="secondary-action" disabled={designBusy} onClick={() => setTemplatePickerOpen(false)}>取消</button><button type="button" className="primary-action" disabled={!selectedTemplate || !templateAnalysis || templatePreviewBusy || designBusy} onClick={() => void generateFromDraft()}>{designBusy ? `${designProgress.percent}%` : "生成 PPT"}{!designBusy && <ArrowRight />}</button></div></section></div>}

      {exportReport && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportReport(undefined); }}><section className="upload-dialog export-report-dialog" role="dialog" aria-modal="true" aria-labelledby="export-report-title"><div className="upload-dialog-heading"><div><CircleCheck /><div><h2 id="export-report-title">导出报告</h2><p>{exportReport.slideCount} 页 · {exportReport.nativeObjectCount} 个原生对象 · ZIP {exportReport.package.entryCount} 个条目</p></div></div><button type="button" aria-label="关闭导出报告" onClick={() => setExportReport(undefined)}><X /></button></div>{exportReport.issues.length === 0 ? <div className="template-empty">未发现导出问题</div> : <ul className="export-report-list">{exportReport.issues.map((issue, index) => <li key={`${issue.code}-${issue.slideIndex}-${issue.elementId ?? index}`} className={issue.severity}><CircleAlert /><div><strong>{issue.severity === "error" ? "错误" : "提示"} · 第 {issue.slideIndex + 1} 页</strong><p>{issue.message}</p></div></li>)}</ul>}<div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setExportReport(undefined)}>关闭</button></div></section></div>}

      {newDraftConfirmOpen && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewDraftConfirmOpen(false); }}><section className="upload-dialog new-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="new-draft-title"><div className="upload-dialog-heading"><div><FilePlus2 /><div><h2 id="new-draft-title">新建草稿？</h2><p>当前草稿会先保存到制作历史，新草稿从空白主题开始。</p></div></div><button type="button" aria-label="关闭新建草稿窗口" onClick={() => setNewDraftConfirmOpen(false)}><X /></button></div><div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setNewDraftConfirmOpen(false)}>取消</button><button type="button" className="primary-action" onClick={confirmNewDraft}><FilePlus2 />新建空白草稿</button></div></section></div>}

      {message && <div className={`page-message ${message.kind}`} role="status" aria-live="polite">{message.kind === "success" ? <CircleCheck /> : message.kind === "error" ? <CircleAlert /> : <Info />}<span>{message.text}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}><X /></button></div>}

      <footer className="statusbar">{activeView === "ai" ? (aiDraft ? <><span>草稿第 {activeDraftSlideIndex + 1} / {aiDraft.slides.length} 页</span><span>{aiDraftMetrics.characters} 字</span><span>{aiDraftMetrics.points} 条要点</span><span className={`saved-dot ${aiSaveState === "saving" ? "dirty" : ""}`}>● {aiSaveState === "saving" ? "保存中…" : "已自动保存"}</span></> : <><span>AI 内容工作台</span><span>填写主题后生成结构化草稿</span><span className="saved-dot">● {aiHistory.length > 0 ? `${aiHistory.length} 个历史草稿` : "尚未生成草稿"}</span></>) : <><span>第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页</span><span>{countLabel}</span><span>{revisionLabel}</span><span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span><span className="zoom-controls"><button type="button" aria-label="缩小画布" onClick={() => setZoom((value) => Math.max(0.3, Math.round((value - 0.1) * 10) / 10))}>−</button><button type="button" className="zoom" title="适应窗口" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="放大画布" onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.1) * 10) / 10))}>＋</button></span></>}</footer>
    </div>
  );
}
