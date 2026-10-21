import { Circle, Download, FilePlus2, Layers3, MousePointer2, Plus, Redo2, Save, Square, Type, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EMU_PER_INCH, emu, type SlideElement } from "../core/document-model";
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
    <div className={`slide-element ${selected ? "selected" : ""} ${element.type}`} style={style} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      {element.type === "text" ? <div style={{ fontFamily: element.style.fontFamily, fontSize: element.style.fontSizePt * 1.333, color: element.style.color, fontWeight: element.style.bold ? 700 : 400, textAlign: element.style.align }}>{element.text}</div> : <div className={`shape-fill ${element.shape}`} style={{ background: element.style.fill, borderColor: element.style.stroke, borderWidth: element.style.strokeWidthPt, borderRadius: element.shape === "ellipse" ? "50%" : element.style.radiusPt }} />}
    </div>
  );
}

export function App() {
  const { document, activeSlideId, selectedElementId, undoStack, redoStack, execute, selectSlide, selectElement, undo, redo } = useEditorStore();
  const activeSlide = document.slides.find((slide) => slide.id === activeSlideId) ?? document.slides[0]!;
  const selected = activeSlide.elements.find((element) => element.id === selectedElementId);
  const scale = CANVAS_WIDTH / document.pageSize.width;
  const canvasHeight = document.pageSize.height * scale;
  const revisionLabel = `内容 ${document.revisions.content} · 设计 ${document.revisions.design}`;
  const countLabel = useMemo(() => `${activeSlide.elements.length} 个对象`, [activeSlide.elements.length]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><div><strong>PPTD</strong><small>{document.title}</small></div></div>
        <div className="toolbar-group">
          <ToolButton label="新建项目（后续切片）" disabled><FilePlus2 /></ToolButton><ToolButton label="保存（后续切片）" disabled><Save /></ToolButton>
          <span className="separator" />
          <ToolButton label="撤销" onClick={undo} disabled={!undoStack.length}><Undo2 /></ToolButton><ToolButton label="重做" onClick={redo} disabled={!redoStack.length}><Redo2 /></ToolButton>
        </div>
        <div className="toolbar-group insert-tools">
          <ToolButton label="选择"><MousePointer2 /></ToolButton><ToolButton label="文本"><Type /></ToolButton>
          <ToolButton label="矩形" onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "rectangle" })}><Square /></ToolButton>
          <ToolButton label="椭圆" onClick={() => execute({ type: "add-shape", slideId: activeSlide.id, shape: "ellipse" })}><Circle /></ToolButton>
        </div>
        <button className="export-button" disabled title="将在 V0.1 导出切片中实现"><Download size={17} /> 导出 PPTX</button>
      </header>

      <aside className="left-panel">
        <div className="panel-heading"><span>页面</span><button onClick={() => execute({ type: "add-slide" })}><Plus size={16} /></button></div>
        <div className="slide-list">
          {document.slides.map((slide, index) => <button key={slide.id} className={`thumbnail-row ${slide.id === activeSlide.id ? "active" : ""}`} onClick={() => selectSlide(slide.id)}><span>{index + 1}</span><div className="thumbnail"><div className="thumb-title">{slide.content.title}</div><div className="thumb-accent" /></div></button>)}
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
          {selected.type === "text" && <label>文本内容<textarea value={selected.text} onChange={(event) => execute({ type: "edit-text", slideId: activeSlide.id, elementId: selected.id, text: event.target.value })} /></label>}
          <div className="property-grid"><label>X<input value={(selected.frame.x / EMU_PER_INCH).toFixed(2)} disabled /></label><label>Y<input value={(selected.frame.y / EMU_PER_INCH).toFixed(2)} disabled /></label></div>
          <div className="property-grid"><label>宽度<input value={(selected.frame.width / EMU_PER_INCH).toFixed(2)} disabled /></label><label>高度<input value={(selected.frame.height / EMU_PER_INCH).toFixed(2)} disabled /></label></div>
        </div> : <div className="empty-inspector"><MousePointer2 /><p>选择画布中的对象<br />查看并编辑属性</p></div>}
      </aside>

      <footer className="statusbar"><span>第 {document.slides.indexOf(activeSlide) + 1} / {document.slides.length} 页</span><span>{countLabel}</span><span>{revisionLabel}</span><span className="saved-dot">● 内存草稿</span><span className="zoom">75%</span></footer>
    </div>
  );
}
