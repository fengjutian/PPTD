import { ArrowDown, ArrowUp, Circle, Copy, Download, FilePlus2, FileUp, Layers3, Lock, LockOpen, MousePointer2, Plus, Redo2, Save, Square, Trash2, Type, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EMU_PER_INCH, emu, type SlideElement } from "../core/document-model";
import { choosePptxPath, chooseProjectToOpen, isDesktopRuntime, saveProject, writePptx } from "../services/project-files";
import { useEditorStore } from "../store/editor-store";

const CANVAS_WIDTH = 960;

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
      {element.type === "text" ? <div style={{ fontFamily: element.style.fontFamily, fontSize: element.style.fontSizePt * 1.333, color: element.style.color, fontWeight: element.style.bold ? 700 : 400, textAlign: element.style.align }}>{element.text}</div> : <div className={`shape-fill ${element.shape}`} style={{ background: element.style.fill, borderColor: element.style.stroke, borderWidth: element.style.strokeWidthPt, borderRadius: element.shape === "ellipse" ? "50%" : element.style.radiusPt }} />}
    </div>
  );
}

export function App() {
  const { document, activeSlideId, selectedElementId, undoStack, redoStack, execute, selectSlide, selectElement, undo, redo, newDocument, loadDocument } = useEditorStore();
  const [projectPath, setProjectPath] = useState<string>();
  const [savedRevision, setSavedRevision] = useState(0);
  const [taskStatus, setTaskStatus] = useState<string>();
  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]!;
  const selected = activeSlide.elements.find((element) => element.id === selectedElementId);
  const scale = CANVAS_WIDTH / document.pageSize.width;
  const canvasHeight = document.pageSize.height * scale;
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => `${activeSlide.elements.length} 个对象`, [activeSlide.elements.length]);
  const dirty = document.revisions.document !== savedRevision;

  const handleNew = () => {
    if (dirty && !window.confirm("当前项目还有未保存的修改，确定新建吗？")) return;
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
        </div>
        <button className="export-button" onClick={handleExport}><Download size={17} /> 导出 PPTX</button>
      </header>

      <aside className="left-panel">
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
          <label>对象类型<input value={selected.type === "text" ? "文本" : selected.shape === "ellipse" ? "椭圆" : "矩形"} disabled /></label>
          {selected.type === "text" && <label>文本内容<textarea value={selected.text} disabled={selected.locked} onChange={(event) => execute({ type: "edit-text", slideId: activeSlide.id, elementId: selected.id, text: event.target.value })} /></label>}
          <div className="property-grid"><label>X<input value={(selected.frame.x / EMU_PER_INCH).toFixed(2)} disabled /></label><label>Y<input value={(selected.frame.y / EMU_PER_INCH).toFixed(2)} disabled /></label></div>
          <div className="property-grid"><label>宽度<input value={(selected.frame.width / EMU_PER_INCH).toFixed(2)} disabled /></label><label>高度<input value={(selected.frame.height / EMU_PER_INCH).toFixed(2)} disabled /></label></div>
          <div className="element-actions">
            <button onClick={() => execute({ type: "set-element-lock", slideId: activeSlide.id, elementId: selected.id, locked: !selected.locked })}>{selected.locked ? <LockOpen /> : <Lock />}{selected.locked ? "解锁" : "锁定"}</button>
            <button disabled={selected.locked} onClick={() => execute({ type: "duplicate-element", slideId: activeSlide.id, elementId: selected.id })}><Copy />复制</button>
            <button className="danger" disabled={selected.locked} onClick={() => execute({ type: "delete-element", slideId: activeSlide.id, elementId: selected.id })}><Trash2 />删除</button>
          </div>
        </div> : <div className="empty-inspector"><MousePointer2 /><p>选择画布中的对象<br />查看并编辑属性</p></div>}
      </aside>

      <footer className="statusbar"><span>第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页</span><span>{countLabel}</span><span>{revisionLabel}</span>{taskStatus && <span className="task-status">{taskStatus}</span>}<span className={`saved-dot ${dirty ? "dirty" : ""}`}>● {dirty ? "未保存" : "已保存"}</span><span className="zoom">75%</span></footer>
    </div>
  );
}
