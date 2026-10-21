import { useEffect, useRef, useState } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndVertical, AlignLeft, AlignRight, AlignStartVertical, ArrowDown, ArrowUp, Bold, CircleAlert, Copy, Layers3, Lock, LockOpen, MousePointer2, Trash2 } from "lucide-react";
import { EMU_PER_INCH, emu, type Emu, type ShapeElementStyle, type SlideElement, type SlideId, type TextElementStyle } from "../../core/document-model";
import type { DocumentCommand } from "../../core/commands";
import { colorLuminance, contrastRatio, isLargeText, readableTextColor, requiredContrast } from "../../core/rendering/contrast";
import { isFontAvailable } from "../../core/validation/export-validation";
import { useEditorStore } from "../../store/editor-store";
import { ColorField, NumberField, SelectField, TextField } from "./inspector-fields";

const FONT_OPTIONS = ["Microsoft YaHei", "SimSun", "SimHei", "KaiTi", "FangSong", "Arial", "Calibri", "Times New Roman", "Georgia"] as const;

const HORIZONTAL_ALIGN = [
  { align: "left", label: "左对齐", Icon: AlignLeft },
  { align: "center", label: "水平居中", Icon: AlignCenterHorizontal },
  { align: "right", label: "右对齐", Icon: AlignRight },
] as const;

const VERTICAL_ALIGN = [
  { align: "top", label: "顶对齐", Icon: AlignStartVertical },
  { align: "middle", label: "垂直居中", Icon: AlignCenterVertical },
  { align: "bottom", label: "底对齐", Icon: AlignEndVertical },
] as const;

const TEXT_ALIGN = [
  { align: "left", label: "左对齐", Icon: AlignLeft },
  { align: "center", label: "文字居中", Icon: AlignCenterHorizontal },
  { align: "right", label: "右对齐", Icon: AlignRight },
] as const;

function elementTypeLabel(element: SlideElement): string {
  if (element.type === "text") return "文本";
  if (element.type === "image") return "图片";
  return element.shape === "ellipse" ? "椭圆" : "矩形";
}

export interface InspectorPanelViewProps {
  element: SlideElement;
  slideId: SlideId;
  /** Position of the element inside its slide, used for the layer buttons. */
  elementIndex: number;
  elementCount: number;
  /** Page background, used to judge text readability and to offer a readable ink. */
  background: string;
  pageSize: { width: Emu; height: Emu };
  onCommand: (command: DocumentCommand) => void;
}

/**
 * Presentation of the inspector for one element. It only emits commands, so the
 * same markup can be rendered without a store and asserted in tests.
 */
export function InspectorPanelView({ element, slideId, elementIndex, elementCount, background, pageSize, onCommand }: InspectorPanelViewProps) {
  const [textDraft, setTextDraft] = useState<string>();
  const [fontAvailable, setFontAvailable] = useState(true);
  const textDraftCancelRef = useRef(false);
  const locked = element.locked;
  const fontFamily = element.type === "text" ? element.style.fontFamily : "";

  useEffect(() => {
    if (!fontFamily) return;
    let active = true;
    void isFontAvailable(fontFamily).then((available) => {
      if (active) setFontAvailable(available);
    });
    return () => { active = false; };
  }, [fontFamily]);

  const commitTransform = (field: "x" | "y" | "width" | "height" | "rotation", value: number) => {
    const frame = { ...element.frame };
    let rotationMilliDegree = element.rotationMilliDegree;
    if (field === "rotation") rotationMilliDegree = Math.round(value * 1000);
    else frame[field] = emu(value * EMU_PER_INCH);
    if (frame.width <= 0 || frame.height <= 0) return;
    if (frame.x === element.frame.x && frame.y === element.frame.y && frame.width === element.frame.width && frame.height === element.frame.height && rotationMilliDegree === element.rotationMilliDegree) return;
    onCommand({ type: "transform-element", slideId, elementId: element.id, frame, rotationMilliDegree });
  };

  const commitText = () => {
    if (element.type !== "text") return;
    if (textDraftCancelRef.current) {
      textDraftCancelRef.current = false;
      setTextDraft(undefined);
      return;
    }
    if (textDraft === undefined || textDraft === element.text) {
      setTextDraft(undefined);
      return;
    }
    onCommand({ type: "edit-text", slideId, elementId: element.id, text: textDraft });
    setTextDraft(undefined);
  };

  const setTextStyle = (style: Partial<TextElementStyle>) => {
    onCommand({ type: "set-text-style", slideId, elementId: element.id, style });
  };

  const setShapeStyle = (style: Partial<ShapeElementStyle>) => {
    onCommand({ type: "set-shape-style", slideId, elementId: element.id, style });
  };

  const contrast = element.type === "text" ? contrastRatio(element.style.color, background) : undefined;
  const required = element.type === "text" ? requiredContrast(element.style.fontSizePt, element.style.bold) : 0;
  const lowContrast = contrast !== undefined && contrast < required;

  return (
    <div className="property-form">
      {element.type === "text" && <section className="inspector-section">
        <h4>内容</h4>
        <label className="field">
          <span className="field-label">文本内容</span>
          <textarea
            value={textDraft ?? element.text}
            disabled={locked}
            onChange={(event) => {
              textDraftCancelRef.current = false;
              setTextDraft(event.target.value);
            }}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                textDraftCancelRef.current = true;
                setTextDraft(undefined);
                event.currentTarget.blur();
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </section>}

      <section className="inspector-section">
        <h4>位置与尺寸</h4>
        <div className="property-grid">
          <NumberField label="X" unit="英寸" value={element.frame.x / EMU_PER_INCH} min={0} disabled={locked} onCommit={(value) => commitTransform("x", value)} />
          <NumberField label="Y" unit="英寸" value={element.frame.y / EMU_PER_INCH} min={0} disabled={locked} onCommit={(value) => commitTransform("y", value)} />
          <NumberField label="宽度" unit="英寸" value={element.frame.width / EMU_PER_INCH} min={0.01} disabled={locked} onCommit={(value) => commitTransform("width", value)} />
          <NumberField label="高度" unit="英寸" value={element.frame.height / EMU_PER_INCH} min={0.01} disabled={locked} onCommit={(value) => commitTransform("height", value)} />
        </div>
        <NumberField label="旋转" unit="度" value={element.rotationMilliDegree / 1000} min={-360} max={360} precision={1} disabled={locked} onCommit={(value) => commitTransform("rotation", value)} />
      </section>

      <section className="inspector-section">
        <h4>对齐（相对页面）</h4>
        <div className="align-group">
          <span className="align-group-label">水平</span>
          <div className="align-actions">
            {HORIZONTAL_ALIGN.map(({ align, label, Icon }) => (
              <button type="button" key={align} title={label} aria-label={label} disabled={locked}
                onClick={() => onCommand({ type: "align-element", slideId, elementId: element.id, align })}>
                <Icon />
              </button>
            ))}
          </div>
        </div>
        <div className="align-group">
          <span className="align-group-label">垂直</span>
          <div className="align-actions">
            {VERTICAL_ALIGN.map(({ align, label, Icon }) => (
              <button type="button" key={align} title={label} aria-label={label} disabled={locked}
                onClick={() => onCommand({ type: "align-element", slideId, elementId: element.id, align })}>
                <Icon />
              </button>
            ))}
          </div>
        </div>
      </section>

      {element.type === "text" && <section className="inspector-section">
        <h4>文字外观</h4>
        <SelectField label="字体" value={element.style.fontFamily} options={FONT_OPTIONS} disabled={locked}
          onCommit={(fontFamily) => setTextStyle({ fontFamily })} />
        <div className="property-grid">
          <NumberField label="字号" unit="pt" value={element.style.fontSizePt} min={4} max={400} precision={1} disabled={locked}
            onCommit={(fontSizePt) => setTextStyle({ fontSizePt })} />
          <ColorField label="颜色" value={element.style.color} wide disabled={locked}
            onCommit={(color) => setTextStyle({ color })} />
        </div>
        <div className="field-row">
          <button type="button" className={`toggle-button ${element.style.bold ? "active" : ""}`} disabled={locked}
            aria-pressed={element.style.bold} onClick={() => setTextStyle({ bold: !element.style.bold })}>
            <Bold />加粗
          </button>
          <div className="segmented" role="group" aria-label="文字对齐">
            {TEXT_ALIGN.map(({ align, label, Icon }) => (
              <button type="button" key={align} title={label} aria-label={label}
                className={element.style.align === align ? "active" : undefined}
                disabled={locked} onClick={() => setTextStyle({ align })}>
                <Icon />
              </button>
            ))}
          </div>
        </div>
        {lowContrast && <div className="inspector-warning" role="status">
          <CircleAlert />
          <div>
            <strong>文字对比度不足</strong>
            <span>按页面背景色计算为 {contrast!.toFixed(2)}:1，需要至少 {required}:1，导出后在其他设备上可能看不清。</span>
            <button type="button" disabled={locked} onClick={() => {
              const luminance = colorLuminance(background);
              if (luminance === undefined) return;
              setTextStyle({ color: readableTextColor(element.type === "text" ? element.style.color : "#000000", luminance, isLargeText(element.type === "text" ? element.style.fontSizePt : 12, element.type === "text" ? element.style.bold : false)) });
            }}>换成可读颜色</button>
          </div>
        </div>}
        {!fontAvailable && <div className="inspector-warning" role="status">
          <CircleAlert />
          <div>
            <strong>字体本机不可用</strong>
            <span>“{fontFamily}”在本机不可用，导出后将由查看端的替代字体渲染，版式可能变化。</span>
          </div>
        </div>}
      </section>}

      {element.type === "shape" && <section className="inspector-section">
        <h4>形状外观</h4>
        <div className="property-grid">
          <ColorField label="填充" value={element.style.fill} wide disabled={locked}
            onCommit={(fill) => setShapeStyle({ fill })} />
          <ColorField label="描边" value={element.style.stroke} wide disabled={locked}
            onCommit={(stroke) => setShapeStyle({ stroke })} />
          <NumberField label="描边宽度" unit="pt" value={element.style.strokeWidthPt} min={0} max={100} precision={1} disabled={locked}
            onCommit={(strokeWidthPt) => setShapeStyle({ strokeWidthPt })} />
          {element.shape === "rectangle" && <NumberField label="圆角" unit="pt" value={element.style.radiusPt} min={0} max={1000} precision={1} disabled={locked}
            onCommit={(radiusPt) => setShapeStyle({ radiusPt })} />}
        </div>
      </section>}

      {element.type === "image" && <section className="inspector-section">
        <h4>图片</h4>
        <TextField label="替代文本" value={element.altText} maxLength={500} disabled={locked}
          onCommit={(altText) => onCommand({ type: "set-image-alt-text", slideId, elementId: element.id, altText })} />
      </section>}

      <section className="inspector-section">
        <h4>排列</h4>
        <div className="element-actions">
          <button disabled={locked || elementIndex >= elementCount - 1}
            onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementIndex + 1 })}>
            <ArrowUp />上移一层
          </button>
          <button disabled={locked || elementIndex <= 0}
            onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementIndex - 1 })}>
            <ArrowDown />下移一层
          </button>
          <button onClick={() => onCommand({ type: "set-element-lock", slideId, elementId: element.id, locked: !locked })}>
            {locked ? <LockOpen /> : <Lock />}{locked ? "解锁" : "锁定"}
          </button>
        </div>
      </section>

      <section className="inspector-section">
        <h4>操作</h4>
        <div className="element-actions">
          <button disabled={locked}
            onClick={() => onCommand({ type: "duplicate-element", slideId, elementId: element.id })}>
            <Copy />复制
          </button>
          <button className="danger" disabled={locked}
            onClick={() => onCommand({ type: "delete-element", slideId, elementId: element.id })}>
            <Trash2 />删除
          </button>
        </div>
      </section>

      <PageProperties slideId={slideId} background={background} pageSize={pageSize} onCommand={onCommand} />
    </div>
  );
}

interface PagePropertiesProps {
  slideId: SlideId;
  background: string;
  pageSize: { width: Emu; height: Emu };
  onCommand: (command: DocumentCommand) => void;
}

function PageProperties({ slideId, background, pageSize, onCommand }: PagePropertiesProps) {
  return (
    <section className="inspector-section">
      <h4>页面</h4>
      <label className="field">
        <span className="field-label">幻灯片尺寸</span>
        <span className="field-control">
          <input value={`${(pageSize.width / EMU_PER_INCH).toFixed(2)} × ${(pageSize.height / EMU_PER_INCH).toFixed(2)} 英寸`} readOnly disabled />
        </span>
      </label>
      <ColorField label="背景色" value={background} wide
        onCommit={(next) => onCommand({ type: "set-slide-background", slideId, background: next })} />
    </section>
  );
}

export function InspectorPanel() {
  const document = useEditorStore((state) => state.document);
  const activeSlideId = useEditorStore((state) => state.activeSlideId);
  const selectedElementId = useEditorStore((state) => state.selectedElementId);
  const execute = useEditorStore((state) => state.execute);
  const slide = document.slides.find((item) => item.id === activeSlideId) ?? document.slides[0]!;
  const selected = slide.elements.find((element) => element.id === selectedElementId);

  return (
    <aside className="right-panel">
      <div className="inspector-title">
        <Layers3 size={18} />
        <span>属性</span>
        {selected && <span className="type-chip">{elementTypeLabel(selected)}</span>}
      </div>
      {selected
        ? <InspectorPanelView
          element={selected}
          slideId={slide.id}
          elementIndex={slide.elements.findIndex((item) => item.id === selected.id)}
          elementCount={slide.elements.length}
          background={slide.background}
          pageSize={document.pageSize}
          onCommand={execute}
        />
        : <div className="property-form">
          <PageProperties slideId={slide.id} background={slide.background} pageSize={document.pageSize} onCommand={execute} />
          <div className="empty-inspector"><MousePointer2 /><p>选择画布中的对象<br />查看并编辑属性</p></div>
        </div>}
    </aside>
  );
}
