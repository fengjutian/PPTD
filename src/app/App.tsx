import { ArrowDown, ArrowRight, ArrowUp, Check, Circle, Copy, Download, FilePlus2, FileUp, ImagePlus, Layers3, LayoutDashboard, Lock, LockOpen, MousePointer2, Palette, Plus, Redo2, Save, Settings, Sparkles, Square, Trash2, Type, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EMU_PER_INCH, emu, type SlideElement } from "../core/document-model";
import { resolveEditorShortcut } from "../features/editor/keyboard-shortcuts";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { generateWithMiniMax, type AiDraft } from "../services/minimax";
import { applyTheme, loadSettings } from "../services/settings";
import { choosePptxPath, choosePptxTemplate, chooseProjectToOpen, clearRecovery, isDesktopRuntime, loadRecovery, saveProject, saveRecovery, writePptx } from "../services/project-files";
import { useEditorStore } from "../store/editor-store";

const CANVAS_WIDTH = 960;
type AppView = "editor" | "ai" | "theme";

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

export function App() {
  const { document, activeSlideId, selectedElementId, undoStack, redoStack, execute, selectSlide, selectElement, undo, redo, newDocument, loadDocument } = useEditorStore();
  const [projectPath, setProjectPath] = useState<string>();
  const [savedRevision, setSavedRevision] = useState(0);
  const [taskStatus, setTaskStatus] = useState<string>();
  const [activeView, setActiveView] = useState<AppView>("editor");
  const [aiTopic, setAiTopic] = useState("");
  const [aiSlideCount, setAiSlideCount] = useState(6);
  const [aiDraft, setAiDraft] = useState<AiDraft>();
  const [aiBusy, setAiBusy] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<{ name: string; size?: number; path?: string }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]!;
  const selected = activeSlide.elements.find((element) => element.id === selectedElementId);
  const scale = CANVAS_WIDTH / document.pageSize.width;
  const canvasHeight = document.pageSize.height * scale;
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => `${activeSlide.elements.length} 个对象`, [activeSlide.elements.length]);
  const dirty = document.revisions.document !== savedRevision;
  useEffect(() => { applyTheme(loadSettings().theme); }, []);

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
      void saveRecovery(document)
        .then(() => setTaskStatus("已自动保存恢复快照"))
        .catch((error: unknown) => setTaskStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`));
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
    try { setAiDraft(await generateWithMiniMax(aiTopic, aiSlideCount)); }
    catch (error) { setTaskStatus(`MiniMax 生成失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setAiBusy(false); }
  };

  const updateAiSlide = (index: number, field: "title" | "body" | "speakerNotes", value: string) => {
    setAiDraft((draft) => draft ? { ...draft, slides: draft.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, [field]: value } : slide) } : draft);
  };

  const continueToTheme = () => {
    if (!aiDraft) return;
    execute({ type: "apply-ai-draft", title: aiDraft.title, slides: aiDraft.slides });
    setActiveView("theme");
    setTaskStatus("内容草稿已确认，可以选择 PPT 模板");
  };

  const handleChooseTemplate = async () => {
    try {
      if (!isDesktopRuntime()) { templateInputRef.current?.click(); return; }
      const template = await choosePptxTemplate();
      if (template) setSelectedTemplate(template);
    } catch (error) {
      setTaskStatus(`选择模板失败：${error instanceof Error ? error.message : String(error)}`);
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
    <div className="app-shell">
      <header className="topbar">
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
      </header>

      <nav className="nav-rail" aria-label="主功能">
        <button className={activeView === "editor" ? "active" : ""} aria-current={activeView === "editor" ? "page" : undefined} title="编辑器" onClick={() => setActiveView("editor")}><LayoutDashboard /><span>编辑</span></button>
        <button className={activeView === "ai" ? "active" : ""} aria-current={activeView === "ai" ? "page" : undefined} title="MiniMax AI" onClick={() => setActiveView("ai")} disabled={!isDesktopRuntime()}><Sparkles /><span>AI</span></button>
        <button className={activeView === "theme" ? "active" : ""} aria-current={activeView === "theme" ? "page" : undefined} title="PPT 模板" onClick={() => setActiveView("theme")}><Palette /><span>模板</span></button>
        <div className="nav-spacer" />
        <button title="设置" onClick={() => setSettingsOpen(true)}><Settings /><span>设置</span></button>
      </nav>

      {activeView === "editor" && <><aside className="left-panel">
        <div className="panel-heading"><span>页面</span><button onClick={() => execute({ type: "add-slide" })}><Plus size={16} /></button></div>
        <div className="slide-list">
          {document.slides.map((slide, index) => <div key={slide.id} className={`thumbnail-row ${slide.id === activeSlide.id ? "active" : ""}`}>
            <button className="thumbnail-select" onClick={() => selectSlide(slide.id)}><span>{index + 1}</span><div className="thumbnail"><div className="thumb-title">{slide.content.title}</div><div className="thumb-accent" /></div></button>
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
        <header className="feature-header"><div><Sparkles /><div><h1>AI 内容工作台</h1><p>先生成和审核内容，再选择用户的 PPT 模板</p></div></div><div className="workflow-steps"><span className={!aiDraft ? "active" : "done"}>{aiDraft ? <Check /> : "1"} 生成草稿</span><i /><span className={aiDraft ? "active" : ""}>2 编辑文字</span><i /><span>3 上传模板</span></div></header>
        {!aiDraft ? <section className="ai-compose-card">
          <div className="section-kicker">MiniMax AI</div><h2>你想制作什么演示文稿？</h2><p>描述主题、受众、场景和重点，AI 将生成可编辑的结构化内容。</p>
          <label>主题与要求<textarea value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} placeholder="例如：为管理层制作一份产品战略汇报，突出增长机会和下一季度行动" /></label>
          <label className="slide-count-field">页数<input type="number" min="1" max="20" value={aiSlideCount} onChange={(event) => setAiSlideCount(Math.max(1, Math.min(20, Number(event.target.value))))} /></label>
          <button className="primary-action" disabled={aiBusy || !aiTopic.trim()} onClick={handleAiGenerate}>{aiBusy ? "MiniMax 正在生成…" : "生成 PPT 草稿"}<ArrowRight /></button>
          <small>生成结果通过结构化 Schema 校验，应用前不会修改当前文稿。</small>
        </section> : <section className="draft-review">
          <div className="draft-review-heading"><div><div className="section-kicker">内容草稿</div><h2>审核并编辑文字</h2><p>后续应用模板时不会静默改变这里确认的内容。</p></div><label>演示文稿标题<input value={aiDraft.title} onChange={(event) => setAiDraft({ ...aiDraft, title: event.target.value })} /></label></div>
          <div className="draft-slide-list">{aiDraft.slides.map((slide, index) => <article className="draft-slide-card" key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><label>页面标题<input value={slide.title} onChange={(event) => updateAiSlide(index, "title", event.target.value)} /></label><label>正文<textarea value={slide.body} onChange={(event) => updateAiSlide(index, "body", event.target.value)} /></label><label>演讲备注<textarea className="notes" value={slide.speakerNotes} onChange={(event) => updateAiSlide(index, "speakerNotes", event.target.value)} /></label></div></article>)}</div>
          <div className="sticky-actions"><button className="secondary-action" onClick={() => setAiDraft(undefined)}>重新生成</button><button className="primary-action" disabled={!aiDraft.title.trim() || aiDraft.slides.some((slide) => !slide.title.trim())} onClick={continueToTheme}>确认内容，选择 PPT 模板<ArrowRight /></button></div>
        </section>}
      </main>}

      {activeView === "theme" && <main className="feature-workspace theme-workspace">
        <header className="feature-header"><div><Palette /><div><h1>PPT 模板</h1><p>上传用户模板，在内容确认后提取主题、母版和页面版式</p></div></div><div className="workflow-steps"><span className="done"><Check /> 生成草稿</span><i /><span className="done"><Check /> 编辑文字</span><i /><span className="active">3 上传模板</span></div></header>
        <section className="template-content"><div><div className="section-kicker">POWERPOINT TEMPLATE</div><h2>上传 PPT 模板</h2><p>请选择 `.pptx` 文件。模板将用于后续视觉设计，不会覆盖已经确认的文字内容。</p></div>
          <button type="button" className={`template-dropzone ${selectedTemplate ? "selected" : ""}`} onClick={handleChooseTemplate}><FileUp />{selectedTemplate ? <><strong>{selectedTemplate.name}</strong><span>{selectedTemplate.size ? `${(selectedTemplate.size / 1024 / 1024).toFixed(2)} MB · ` : ""}PowerPoint 模板已选择</span><small>点击重新选择</small></> : <><strong>选择 PPTX 模板</strong><span>从电脑中选择一个 PowerPoint 模板文件</span><small>支持 .pptx</small></>}</button>
          <input ref={templateInputRef} className="visually-hidden" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => { const file = event.target.files?.[0]; if (file) setSelectedTemplate({ name: file.name, size: file.size }); event.currentTarget.value = ""; }} />
          {selectedTemplate && <div className="template-status"><Check /><div><strong>模板已就绪，等待解析</strong><span>母版、版式和兼容性报告将在模板解析器启用后生成。</span></div></div>}
          <div className="template-notice"><strong>当前能力边界</strong><p>现阶段仅完成安全选取与流程衔接，尚未解析或应用模板。不会把“已选择文件”伪装成模板已经成功套用。</p></div>
          <button type="button" className="primary-action finish-theme" onClick={() => setActiveView("editor")}>暂不使用模板，返回编辑器<ArrowRight /></button>
        </section>
      </main>}

      <footer className="statusbar"><span>第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页</span><span>{countLabel}</span><span>{revisionLabel}</span>{taskStatus && <span className="task-status">{taskStatus}</span>}<span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span><span className="zoom">75%</span></footer>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onMessage={setTaskStatus} />}
    </div>
  );
}
