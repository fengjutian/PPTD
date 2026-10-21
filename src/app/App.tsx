import { ArrowDown, ArrowRight, ArrowUp, Check, Circle, CircleAlert, CircleCheck, Copy, Download, Eye, FilePlus2, FileUp, ImagePlus, Info, Layers3, LayoutDashboard, Lock, LockOpen, MousePointer2, Palette, Plus, Redo2, Save, Settings, Sparkles, Square, Trash2, Type, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EMU_PER_INCH, emu, type SlideElement } from "../core/document-model";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";
import { SettingsWorkspace } from "../features/settings/SettingsDialog";
import { loadAiHistory, saveAiHistory, type AiHistoryEntry } from "../services/ai-history";
import { generateWithMiniMax, type AiDraft } from "../services/minimax";
import { applyTheme, loadSettings } from "../services/settings";
import { analyzePptxTemplate, choosePptxPath, choosePptxTemplate, chooseProjectToOpen, clearRecovery, getPptxTemplatePreview, importPptxTemplate, isDesktopRuntime, listPptxTemplates, loadRecovery, saveProject, saveRecovery, writePptx, type TemplateAnalysis, type TemplateRecord } from "../services/project-files";
import { useEditorStore } from "../store/editor-store";

const CANVAS_WIDTH = 960;
type AppView = "editor" | "ai" | "theme" | "settings";
type PageMessage = { id: number; text: string; kind: "info" | "success" | "error" };

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button className="tool-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function ElementView({ element, scale, selected, onSelect }: { element: SlideElement; scale: number; selected: boolean; onSelect: () => void }) {
  const execute = useEditorStore((s) => s.execute);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frame = element.frame;
  const style: React.CSSProperties = {
    left: frame.x * scale + offset.x, top: frame.y * scale + offset.y,
    width: frame.width * scale, height: frame.height * scale,
    transform: `rotate(${element.rotationMilliDegree / 1000}deg)`,
  };

  const pointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    onSelect();
    if (element.locked) return;
    start.current = { x: event.clientX, y: event.clientY, left: frame.x, top: frame.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent) => {
    if (!start.current) return;
    setOffset({ x: event.clientX - start.current.x, y: event.clientY - start.current.y });
  };
  const pointerUp = (event: React.PointerEvent) => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    start.current = null;
    setOffset({ x: 0, y: 0 });
    if (dx || dy) execute({ type: "move-element", slideId: activeSlideId, elementId: element.id, x: emu(frame.x + dx / scale), y: emu(frame.y + dy / scale) });
  };

  return (
    <div className={`slide-element ${selected ? "selected" : ""} ${element.locked ? "locked" : ""} ${element.type}`} style={style} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      {element.type === "text" ? <div style={{ fontFamily: element.style.fontFamily, fontSize: element.style.fontSizePt * 1.333, color: element.style.color, fontWeight: element.style.bold ? 700 : 400, textAlign: element.style.align }}>{element.text}</div> : element.type === "shape" ? <div className={`shape-fill ${element.shape}`} style={{ background: element.style.fill, borderColor: element.style.stroke, borderWidth: element.style.strokeWidthPt, borderRadius: element.shape === "ellipse" ? "50%" : element.style.radiusPt }} /> : <img className="image-fill" src={element.source.dataUrl} alt={element.altText} draggable={false} />}
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
  const { document, activeSlideId, selectedElementId, undoStack, redoStack, execute, selectSlide, selectElement, undo, redo, newDocument, loadDocument } = useEditorStore();
  const [projectPath, setProjectPath] = useState<string>();
  const [savedRevision, setSavedRevision] = useState(0);
  const [message, setMessage] = useState<PageMessage>();
  const setTaskStatus = (text?: string) => setMessage(text ? { id: Date.now(), text, kind: /失败|错误|无效|必须|不可用/.test(text) ? "error" : /完成|成功|已保存|已添加|已打开|已新建|已恢复|已确认/.test(text) ? "success" : "info" } : undefined);
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [aiTopic, setAiTopic] = useState("");
  const [aiSlideCount, setAiSlideCount] = useState(6);
  const [aiDraft, setAiDraft] = useState<AiDraft>();
  const [activeDraftSlideIndex, setActiveDraftSlideIndex] = useState(0);
  const [aiHistory, setAiHistory] = useState<AiHistoryEntry[]>(loadAiHistory);
  const [activeHistoryId, setActiveHistoryId] = useState<string>();
  const [aiBusy, setAiBusy] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRecord>();
  const [templateLibrary, setTemplateLibrary] = useState<TemplateRecord[]>([]);
  const [templatePreview, setTemplatePreview] = useState<string | null>();
  const [templateAnalysis, setTemplateAnalysis] = useState<TemplateAnalysis>();
  const [templatePreviewBusy, setTemplatePreviewBusy] = useState(false);
  const [templateUploadOpen, setTemplateUploadOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]!;
  const selected = activeSlide.elements.find((element) => element.id === selectedElementId);
  const scale = CANVAS_WIDTH / document.pageSize.width;
  const canvasHeight = document.pageSize.height * scale;
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => `${activeSlide.elements.length} 个对象`, [activeSlide.elements.length]);
  const dirty = document.revisions.document !== savedRevision;
  useEffect(() => { applyTheme(loadSettings().theme); }, []);
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
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void saveRecovery(document).catch((error: unknown) => setTaskStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, document]);

  const commitTransform = (field: "x" | "y" | "width" | "height" | "rotation", rawValue: string) => {
    if (!selected) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const frame = { ...selected.frame };
    let rotationMilliDegree = selected.rotationMilliDegree;
    if (field === "rotation") rotationMilliDegree = Math.round(value * 1000);
    else frame[field] = emu(value * EMU_PER_INCH);
    if (frame.width <= 0 || frame.height <= 0) return;
    if (frame.x === selected.frame.x && frame.y === selected.frame.y && frame.width === selected.frame.width && frame.height === selected.frame.height && rotationMilliDegree === selected.rotationMilliDegree) return;
    execute({ type: "transform-element", slideId: activeSlide.id, elementId: selected.id, frame, rotationMilliDegree });
  };

  const handleNew = async () => {
    if (dirty && !window.confirm("当前项目还有未保存的修改，确定新建吗？")) return;
    await clearRecovery().catch(() => undefined);
    newDocument();
    setProjectPath(undefined);
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
      setSavedRevision(result.document.revisions.document);
      setTaskStatus("项目已打开");
    } catch (error) { setTaskStatus(`打开失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleSave = async () => {
    setTaskStatus("正在保存…");
    try {
      const path = await saveProject(document, projectPath);
      if (!path) { setTaskStatus(undefined); return; }
      if (isDesktopRuntime()) setProjectPath(path);
      setSavedRevision(document.revisions.document);
      await clearRecovery();
      setTaskStatus(isDesktopRuntime() ? "项目已保存" : "浏览器草稿已保存");
    } catch (error) { setTaskStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleExport = async () => {
    setTaskStatus("正在生成 PPTX…");
    try {
      const { buildPptx } = await import("../features/pptx-export/export-pptx");
      const { bytes, report } = await buildPptx(document);
      const path = await choosePptxPath(document.title);
      if (path) await writePptx(path, bytes);
      else if (!isDesktopRuntime()) {
        const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
        const url = URL.createObjectURL(blob);
        const anchor = Object.assign(globalThis.document.createElement("a"), { href: url, download: `${document.title}.pptx` });
        anchor.click();
        URL.revokeObjectURL(url);
      } else { setTaskStatus(undefined); return; }
      setTaskStatus(`导出完成：${report.slideCount} 页，${report.nativeObjectCount} 个原生对象`);
    } catch (error) { setTaskStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`); }
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
    setAiBusy(true); setAiDraft(undefined);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    try {
      const draft = await generateWithMiniMax(aiTopic, aiSlideCount);
      const id = crypto.randomUUID();
      setAiDraft(draft); setActiveHistoryId(id); setActiveDraftSlideIndex(0);
      setAiHistory(saveAiHistory({ id, topic: aiTopic, slideCount: aiSlideCount, draft }));
      setTaskStatus("MiniMax 已完成 PPT 草稿生成");
      if ("Notification" in window && Notification.permission === "granted") new Notification("PPTD · AI 生成完成", { body: `${draft.title}（${draft.slides.length} 页）` });
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setTaskStatus(`MiniMax 生成失败：${detail}`);
      if ("Notification" in window && Notification.permission === "granted") new Notification("PPTD · AI 生成失败", { body: detail });
    }
    finally { setAiBusy(false); }
  };

  useEffect(() => {
    if (!aiDraft || !activeHistoryId) return;
    const timer = window.setTimeout(() => setAiHistory(saveAiHistory({ id: activeHistoryId, topic: aiTopic, slideCount: aiDraft.slides.length, draft: aiDraft })), 500);
    return () => window.clearTimeout(timer);
  }, [activeHistoryId, aiDraft, aiTopic]);

  const openAiHistory = (entry: AiHistoryEntry) => {
    setActiveHistoryId(entry.id); setAiTopic(entry.topic); setAiSlideCount(entry.slideCount); setAiDraft(entry.draft); setActiveDraftSlideIndex(0);
  };

  const updateAiSlide = (index: number, field: "title" | "body" | "speakerNotes", value: string) => {
    setAiDraft((draft) => draft ? { ...draft, slides: draft.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, [field]: value } : slide) } : draft);
  };

  const continueToTheme = () => {
    if (!aiDraft) return;
    setTemplatePickerOpen(true);
  };

  const generateFromDraft = () => {
    if (!aiDraft || !selectedTemplate) return;
    execute({ type: "apply-ai-draft", title: aiDraft.title, slides: aiDraft.slides });
    setTemplatePickerOpen(false);
    setActiveView("editor");
    setTaskStatus(`PPT 已生成，已使用模板：${selectedTemplate.name}`);
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
    if (!isDesktopRuntime()) return;
    setTemplatePreviewBusy(true);
    try {
      const [preview, analysis] = await Promise.all([getPptxTemplatePreview(template.id), analyzePptxTemplate(template.id)]);
      setTemplatePreview(preview);
      setTemplateAnalysis(analysis);
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
      if (!selected || selected.locked) return;
      event.preventDefault();
      execute({ type: shortcut, slideId: activeSlide.id, elementId: selected.id });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSlide.id, execute, redo, redoStack.length, selected, undo, undoStack.length]);

  return (
    <div className={`app-shell ${activeView === "editor" ? "" : "module-shell"}`}>
      {activeView === "editor" && <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><div><strong>PPTD</strong><small>{document.title}</small></div></div>
        <div className="toolbar-group">
          <ToolButton label="新建项目" onClick={handleNew}><FilePlus2 /></ToolButton><ToolButton label="打开项目" onClick={handleOpen} disabled={!isDesktopRuntime()}><FileUp /></ToolButton><ToolButton label="保存项目" onClick={handleSave}><Save /></ToolButton>
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
        <button className="export-button" onClick={handleExport}><Download size={17} /> 导出 PPTX</button>
      </header>}

      <nav className="nav-rail" aria-label="主功能">
        <button className={activeView === "editor" ? "active" : ""} aria-current={activeView === "editor" ? "page" : undefined} title="编辑器" onClick={() => setActiveView("editor")}><LayoutDashboard /><span>编辑</span></button>
        <button className={activeView === "ai" ? "active" : ""} aria-current={activeView === "ai" ? "page" : undefined} title="MiniMax AI" onClick={() => setActiveView("ai")} disabled={!isDesktopRuntime()}><Sparkles /><span>AI</span></button>
        <button className={activeView === "theme" ? "active" : ""} aria-current={activeView === "theme" ? "page" : undefined} title="PPT 模板" onClick={() => setActiveView("theme")}><Palette /><span>模板</span></button>
        <div className="nav-spacer" />
        <button className={activeView === "settings" ? "active" : ""} aria-current={activeView === "settings" ? "page" : undefined} title="设置" onClick={() => setActiveView("settings")}><Settings /><span>设置</span></button>
      </nav>

      {activeView === "editor" && <><aside className="left-panel">
        <div className="panel-heading"><span>页面</span><button onClick={() => execute({ type: "add-slide" })}><Plus size={16} /></button></div>
        <div className="slide-list">
          {document.slides.map((slide, index) => <div key={slide.id} className={`thumbnail-row ${slide.id === activeSlide.id ? "active" : ""}`}>
            <button className="thumbnail-select" onClick={() => selectSlide(slide.id)}><span>{index + 1}</span><div className="thumbnail"><SlideThumbnail slide={slide} pageWidth={document.pageSize.width} pageHeight={document.pageSize.height} /></div></button>
            {slide.id === activeSlide.id && <div className="thumbnail-actions">
              <button aria-label="上移页面" title="上移页面" disabled={index === 0} onClick={() => execute({ type: "move-slide", slideId: slide.id, toIndex: index - 1 })}><ArrowUp /></button>
              <button aria-label="下移页面" title="下移页面" disabled={index === document.slides.length - 1} onClick={() => execute({ type: "move-slide", slideId: slide.id, toIndex: index + 1 })}><ArrowDown /></button>
              <button aria-label="复制页面" title="复制页面" onClick={() => execute({ type: "duplicate-slide", slideId: slide.id })}><Copy /></button>
              <button aria-label="删除页面" title="删除页面" disabled={document.slides.length === 1} onClick={() => execute({ type: "delete-slide", slideId: slide.id })}><Trash2 /></button>
            </div>}
          </div>)}
        </div>
      </aside>

      <main className="workspace" onPointerDown={() => selectElement(null)}>
        <div className="canvas-ruler">13.33 × 7.5 in</div>
        <div className="slide-canvas" style={{ width: CANVAS_WIDTH, height: canvasHeight, background: activeSlide.background }}>
          {activeSlide.elements.map((element) => <ElementView key={element.id} element={element} scale={scale} selected={element.id === selectedElementId} onSelect={() => selectElement(element.id)} />)}
        </div>
      </main>

      <aside className="right-panel">
        <div className="inspector-title"><Layers3 size={18} /><span>属性</span></div>
        {selected ? <div className="property-form">
          <label>对象类型<input value={selected.type === "text" ? "文本" : selected.type === "image" ? "图片" : selected.shape === "ellipse" ? "椭圆" : "矩形"} disabled /></label>
          {selected.type === "text" && <label>文本内容<textarea value={selected.text} disabled={selected.locked} onChange={(event) => execute({ type: "edit-text", slideId: activeSlide.id, elementId: selected.id, text: event.target.value })} /></label>}
          <div className="property-grid"><label>X（英寸）<input key={`${selected.id}-x-${selected.frame.x}`} defaultValue={(selected.frame.x / EMU_PER_INCH).toFixed(2)} disabled={selected.locked} onBlur={(event) => commitTransform("x", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label><label>Y（英寸）<input key={`${selected.id}-y-${selected.frame.y}`} defaultValue={(selected.frame.y / EMU_PER_INCH).toFixed(2)} disabled={selected.locked} onBlur={(event) => commitTransform("y", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label></div>
          <div className="property-grid"><label>宽度（英寸）<input key={`${selected.id}-w-${selected.frame.width}`} defaultValue={(selected.frame.width / EMU_PER_INCH).toFixed(2)} disabled={selected.locked} onBlur={(event) => commitTransform("width", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label><label>高度（英寸）<input key={`${selected.id}-h-${selected.frame.height}`} defaultValue={(selected.frame.height / EMU_PER_INCH).toFixed(2)} disabled={selected.locked} onBlur={(event) => commitTransform("height", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label></div>
          <label>旋转（度）<input key={`${selected.id}-r-${selected.rotationMilliDegree}`} defaultValue={(selected.rotationMilliDegree / 1000).toFixed(1)} disabled={selected.locked} onBlur={(event) => commitTransform("rotation", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
          <div className="element-actions">
            <button onClick={() => execute({ type: "set-element-lock", slideId: activeSlide.id, elementId: selected.id, locked: !selected.locked })}>{selected.locked ? <LockOpen /> : <Lock />}{selected.locked ? "解锁" : "锁定"}</button>
            <button disabled={selected.locked} onClick={() => execute({ type: "duplicate-element", slideId: activeSlide.id, elementId: selected.id })}><Copy />复制</button>
            <button className="danger" disabled={selected.locked} onClick={() => execute({ type: "delete-element", slideId: activeSlide.id, elementId: selected.id })}><Trash2 />删除</button>
          </div>
        </div> : <div className="empty-inspector"><MousePointer2 /><p>选择画布中的对象<br />查看并编辑属性</p></div>}
      </aside></>}

      {activeView === "ai" && <main className="feature-workspace ai-workspace">
        <header className="feature-header"><div><Sparkles /><div><h1>AI 内容工作台</h1><p>先生成和审核内容，再选择用户的 PPT 模板</p></div></div><div className="feature-header-actions"><div className="workflow-steps"><span className={!aiDraft ? "active" : "done"}>{aiDraft ? <Check /> : "1"} 生成草稿</span><i /><span className={aiDraft ? "active" : ""}>2 编辑文字</span><i /><span>3 上传模板</span></div>{aiDraft && <div className="draft-header-actions"><button className="secondary-action" onClick={() => { setAiDraft(undefined); setActiveHistoryId(undefined); setActiveDraftSlideIndex(0); }}>新建草稿</button><button className="primary-action" disabled={!aiDraft.title.trim() || aiDraft.slides.some((slide) => !slide.title.trim())} onClick={continueToTheme}>确认内容，选择 PPT 模板<ArrowRight /></button></div>}</div></header>
        <div className={`feature-scroll ${aiDraft ? "draft-mode" : ""}`}>
        {!aiDraft ? <section className={`ai-start ${aiHistory.length ? "with-history" : ""}`}>
          {aiHistory.length > 0 && <aside className="ai-history"><div className="ai-history-heading"><strong>制作历史</strong><span>{aiHistory.length} 个草稿</span></div>{aiHistory.map((entry) => <button type="button" key={entry.id} onClick={() => openAiHistory(entry)}><Sparkles /><div><strong>{entry.draft.title}</strong><span>{entry.draft.slides.length} 页 · {new Date(entry.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><p>{entry.topic}</p></div></button>)}</aside>}
          <div className="ai-compose-card">
          <div className="section-kicker">MiniMax AI</div><h2>你想制作什么演示文稿？</h2><p>描述主题、受众、场景和重点，AI 将生成可编辑的结构化内容。</p>
          <label>主题与要求<textarea value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} placeholder="例如：为管理层制作一份产品战略汇报，突出增长机会和下一季度行动" /></label>
          <label className="slide-count-field">页数<input type="number" min="1" max="20" value={aiSlideCount} onChange={(event) => setAiSlideCount(Math.max(1, Math.min(20, Number(event.target.value))))} /></label>
          <button className="primary-action" disabled={aiBusy || !aiTopic.trim()} onClick={handleAiGenerate}>{aiBusy ? "MiniMax 正在生成…" : "生成 PPT 草稿"}<ArrowRight /></button>
          <small>生成结果通过结构化 Schema 校验，应用前不会修改当前文稿。</small>
          </div>
        </section> : <section className="draft-review">
          <aside className="draft-outline" aria-label="PPT 内容大纲"><div className="draft-outline-title"><strong>PPT 内容</strong><span>{aiDraft.slides.length} 页</span></div><div className="draft-outline-list">{aiDraft.slides.map((slide, index) => <button type="button" className={activeDraftSlideIndex === index ? "active" : ""} aria-current={activeDraftSlideIndex === index ? "page" : undefined} key={index} onClick={() => setActiveDraftSlideIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{slide.title || "未命名页面"}</strong><p>{slide.body || "暂无正文"}</p></div></button>)}</div></aside>
          <div className="draft-review-main"><div className="draft-review-heading"><div><div className="section-kicker">内容草稿</div><h2>审核并编辑文字</h2><p>后续应用模板时不会静默改变这里确认的内容。</p></div><label>演示文稿标题<input value={aiDraft.title} onChange={(event) => setAiDraft({ ...aiDraft, title: event.target.value })} /></label></div>
          <div className="draft-slide-list">{aiDraft.slides.map((slide, index) => index === activeDraftSlideIndex && <article id={`draft-slide-${index}`} className="draft-slide-card" key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><label>页面标题<input value={slide.title} onChange={(event) => updateAiSlide(index, "title", event.target.value)} /></label><label>正文<textarea rows={Math.max(3, slide.body.split("\n").length + 1)} value={slide.body} onChange={(event) => updateAiSlide(index, "body", event.target.value)} /></label><label>演讲备注<textarea rows={Math.max(2, slide.speakerNotes.split("\n").length + 1)} className="notes" value={slide.speakerNotes} onChange={(event) => updateAiSlide(index, "speakerNotes", event.target.value)} /></label></div></article>)}</div>
          </div>
        </section>}
        </div>
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

      {templatePickerOpen && <div className="upload-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplatePickerOpen(false); }}><section className="upload-dialog template-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="template-picker-title"><div className="upload-dialog-heading"><div><Palette /><div><h2 id="template-picker-title">选择 PPT 模板</h2><p>选择模板后生成演示文稿，并直接进入编辑模块。</p></div></div><button type="button" aria-label="关闭模板选择窗口" onClick={() => setTemplatePickerOpen(false)}><X /></button></div><div className="template-picker-toolbar"><strong>已保存模板</strong><button type="button" className="secondary-action" onClick={() => setTemplateUploadOpen(true)}><FileUp />上传模板</button></div><div className="template-picker-body"><div className="template-library"><div>{templateLibrary.map((template) => <button type="button" className={selectedTemplate?.id === template.id ? "active" : ""} key={template.id} onClick={() => void handleSelectTemplate(template)}><FileUp /><span><strong>{template.name}</strong><small>{(template.size / 1024 / 1024).toFixed(2)} MB · {new Date(template.importedAt).toLocaleString("zh-CN")}</small></span>{selectedTemplate?.id === template.id && <Check />}</button>)}</div>{templateLibrary.length === 0 && <div className="template-empty">尚未上传模板，请先上传 PPTX 模板</div>}</div><div className="template-preview-panel"><div className="template-preview-stage">{templatePreviewBusy ? <span>正在解析模板…</span> : templatePreview ? <img src={templatePreview} alt={`${selectedTemplate?.name ?? "PPT"} 封面预览`} /> : selectedTemplate ? <span>此 PPTX 没有内嵌封面预览</span> : <span>选择左侧模板后查看预览</span>}</div>{templateAnalysis && <div className="template-picker-summary"><span>{templateAnalysis.slideCount} 页面</span><span>{templateAnalysis.layoutCount} 版式</span><span>{templateAnalysis.themeCount} 主题</span></div>}</div></div><div className="upload-dialog-actions"><button type="button" className="secondary-action" onClick={() => setTemplatePickerOpen(false)}>取消</button><button type="button" className="primary-action" disabled={!selectedTemplate || templatePreviewBusy} onClick={generateFromDraft}>生成 PPT<ArrowRight /></button></div></section></div>}

      {message && <div className={`page-message ${message.kind}`} role="status" aria-live="polite">{message.kind === "success" ? <CircleCheck /> : message.kind === "error" ? <CircleAlert /> : <Info />}<span>{message.text}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}><X /></button></div>}

      <footer className="statusbar"><span>第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页</span><span>{countLabel}</span><span>{revisionLabel}</span><span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span><span className="zoom">75%</span></footer>
    </div>
  );
}
