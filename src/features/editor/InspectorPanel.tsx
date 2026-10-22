import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { AlignCenterHorizontal, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, BringToFront, ChevronDown, CircleAlert, Copy, ImagePlus, Layers3, Link2, Lock, LockOpen, MousePointer2, RotateCcw, SendToBack, Square, Trash2, Type, Unlink } from "lucide-react";
import { type ChartKind, type Emu, type ImageCrop, type ShapeElementStyle, type Slide, type SlideElement, type SlideId, type SupportedImageMimeType, type TextElementStyle, resolveFragmentStyle, textFragments } from "../../core/document-model";
import type { DocumentCommand } from "../../core/commands";
import { colorLuminance, contrastRatio, isLargeText, readableTextColor, requiredContrast } from "../../core/rendering/contrast";
import { isFontAvailable } from "../../core/validation/export-validation";
import { textLikelyOverflows } from "../../core/rendering/text-fit";
import { useEditorStore } from "../../store/editor-store";
import { ColorField, NumberField, SelectField, TextField } from "./inspector-fields";
import { emuToUnit, resizeWithAspectLock, unitLabel, unitToEmu, type LengthUnit } from "./inspector-geometry";
import { AlignGrid, type AlignCell } from "./AlignGrid";
import { MultiSelectionPanel } from "./MultiSelectionPanel";
import { unionFrame } from "../../core/commands/arrange";
import { ElementPreview } from "./ElementPreview";
import { paletteSwatches } from "./inspector-palette";

const FONT_OPTIONS = ["Microsoft YaHei", "Source Han Serif SC", "Noto Serif SC", "SimSun", "SimHei", "KaiTi", "FangSong", "Arial", "Calibri", "Times New Roman", "Georgia"] as const;

const ROTATION_PRESETS = [0, 90, 180, 270] as const;

const TEXT_ALIGN = [
  { align: "left", label: "左对齐", Icon: AlignLeft },
  { align: "center", label: "文字居中", Icon: AlignCenterHorizontal },
  { align: "right", label: "右对齐", Icon: AlignRight },
] as const;

function elementTypeLabel(element: SlideElement): string {
  if (element.type === "text") return "文本";
  if (element.type === "image") return "图片";
  if (element.type === "chart") return "图表";
  if (element.type === "table") return "表格";
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
  backgroundImage?: boolean;
  /** Unit the position and size fields are shown in. */
  unit: LengthUnit;
  onUnitChange: (unit: LengthUnit) => void;
  /** When on, changing one edge scales the other edge by the same ratio. */
  aspectLocked: boolean;
  onToggleAspectLock: () => void;
  /** The colors of the template, offered next to every color field. */
  palette?: readonly string[];
  onCommand: (command: DocumentCommand) => void;
}

/**
 * One group of properties.
 *
 * The groups can be folded away, because the panel of a text object is longer
 * than the window. The head of a group sticks to the top of the panel while
 * the group scrolls by, so the user always knows where the fields belong.
 */
function InspectorSection({ title, tools, children }: { title: string; tools?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`inspector-section${open ? "" : " folded"}`}>
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <ChevronDown className={open ? "" : "folded"} />
          <h4>{title}</h4>
        </button>
        {tools}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

/**
 * Presentation of the inspector for one element. It only emits commands, so the
 * same markup can be rendered without a store and asserted in tests.
 */
export function InspectorPanelView({ element, slideId, elementIndex, elementCount, background, pageSize, backgroundImage = false, unit, onUnitChange, aspectLocked, onToggleAspectLock, palette, onCommand }: InspectorPanelViewProps) {
  const [textDraft, setTextDraft] = useState<string>();
  const [fontAvailable, setFontAvailable] = useState(true);
  const [selection, setSelection] = useState<{ start: number; end: number }>();
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
    if (field === "rotation") {
      rotationMilliDegree = Math.round(value * 1000);
    } else {
      const next = unitToEmu(value, unit);
      if (field === "width" || field === "height") {
        Object.assign(frame, resizeWithAspectLock(element.frame, field, next, aspectLocked));
      } else {
        frame[field] = next;
      }
    }
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

  /**
   * The selection of the text field addresses a range of the copy, so the
   * emphasis lands on exactly the words the user picked.
   */
  const readSelection = (target: HTMLTextAreaElement) => {
    if (target.selectionStart === target.selectionEnd) {
      setSelection(undefined);
      return;
    }
    setSelection({ start: target.selectionStart, end: target.selectionEnd });
  };

  /** Whether the whole selection is already bold. */
  const selectionIsBold = element.type === "text" && selection
    ? (() => {
      const overlapping = textFragments(element.text, element.runs).filter((fragment) => fragment.start < selection.end && fragment.end > selection.start);
      if (overlapping.length === 0) return element.style.bold;
      return overlapping.every((fragment) => resolveFragmentStyle(element.style, fragment.style).bold);
    })()
    : false;

  /** The emphasised fragments, so the user can see what is already marked. */
  const emphasised = element.type === "text"
    ? textFragments(element.text, element.runs).filter((fragment) => Object.keys(fragment.style).length > 0)
    : [];

  const setShapeStyle = (style: Partial<ShapeElementStyle>) => {
    onCommand({ type: "set-shape-style", slideId, elementId: element.id, style });
  };

  const crop = element.type === "image" ? element.crop : undefined;

  /**
   * A crop cuts a fraction off one side of the source. The opposite side has to
   * leave room for it, otherwise nothing of the picture would be left.
   */
  const commitCrop = (side: keyof ImageCrop, percent: number) => {
    const current: ImageCrop = crop ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const value = Math.min(0.99, Math.max(0, percent / 100));
    const next: ImageCrop = { ...current, [side]: value };
    const opposite = side === "top" ? "bottom" : side === "bottom" ? "top" : side === "left" ? "right" : "left";
    const limit = 0.99 - value;
    if (next[opposite] > limit) next[opposite] = limit;
    onCommand({ type: "set-image-crop", slideId, elementId: element.id, crop: next });
  };

  const contrast = element.type === "text" ? contrastRatio(element.style.color, background) : undefined;
  const required = element.type === "text" ? requiredContrast(element.style.fontSizePt, element.style.bold) : 0;
  const lowContrast = contrast !== undefined && contrast < required;
  // The overflow is judged with the real font when the application registered
  // a measurer, so the warning matches what the export will look like.
  const overflows = element.type === "text" && textLikelyOverflows(element);

  return (
    <>
    <div className="property-form">
      <PageProperties slideId={slideId} background={background} pageSize={pageSize} backgroundImage={backgroundImage} unit={unit} palette={palette} onCommand={onCommand} />

      {element.type === "text" && <InspectorSection title="内容">
        <label className="field">
          <span className="field-label">文本内容</span>
          <textarea
            value={textDraft ?? element.text}
            disabled={locked}
            onChange={(event) => {
              textDraftCancelRef.current = false;
              setTextDraft(event.target.value);
            }}
            onSelect={(event) => readSelection(event.currentTarget)}
            onKeyUp={(event) => readSelection(event.currentTarget)}
            onClick={(event) => readSelection(event.currentTarget)}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                textDraftCancelRef.current = true;
                setTextDraft(undefined);
                event.currentTarget.blur();
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur();
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && selection) {
                // The usual shortcut of a text editor: bold the picked words.
                event.preventDefault();
                onCommand(selectionIsBold
                  ? { type: "clear-text-emphasis", slideId, elementId: element.id, start: selection.start, end: selection.end }
                  : { type: "set-text-emphasis", slideId, elementId: element.id, start: selection.start, end: selection.end, style: { bold: true } });
              }
            }}
          />
        </label>
        <div className="field-row">
          <button type="button" className="toggle-button" disabled={locked || !selection}
            onClick={() => {
              if (!selection) return;
              onCommand(selectionIsBold
                ? { type: "clear-text-emphasis", slideId, elementId: element.id, start: selection.start, end: selection.end }
                : { type: "set-text-emphasis", slideId, elementId: element.id, start: selection.start, end: selection.end, style: { bold: true } });
            }}>
            <Bold />{selectionIsBold ? "取消加粗" : "加粗所选"}
          </button>
          <button type="button" className="toggle-button" disabled={locked || emphasised.length === 0}
            onClick={() => onCommand({ type: "clear-text-emphasis", slideId, elementId: element.id, start: 0, end: element.text.length })}>
            清除全部强调
          </button>
        </div>
        {emphasised.length > 0 && <p className="inspector-hint">已强调 {emphasised.length} 处：{emphasised.map((fragment) => fragment.text).join(" / ")}</p>}
      </InspectorSection>}

      <InspectorSection title="位置与尺寸" tools={
        <div className="section-tools">
          <div className="segmented compact" role="group" aria-label="长度单位">
            <button type="button" className={unit === "inch" ? "active" : undefined}
              aria-pressed={unit === "inch"} onClick={() => onUnitChange("inch")}>英寸</button>
            <button type="button" className={unit === "cm" ? "active" : undefined}
              aria-pressed={unit === "cm"} onClick={() => onUnitChange("cm")}>厘米</button>
          </div>
          <button type="button" className={`icon-button ${aspectLocked ? "active" : ""}`} disabled={locked}
            title={aspectLocked ? "已锁定宽高比" : "锁定宽高比"} aria-label="锁定宽高比" aria-pressed={aspectLocked}
            onClick={onToggleAspectLock}>
            {aspectLocked ? <Unlink /> : <Link2 />}
          </button>
        </div>
      }>
        <div className="property-grid">
          <NumberField label="X" value={emuToUnit(element.frame.x, unit)} min={0} step={unit === "cm" ? 0.1 : 0.05} disabled={locked}
            onCommit={(value) => commitTransform("x", value)} />
          <NumberField label="Y" value={emuToUnit(element.frame.y, unit)} min={0} step={unit === "cm" ? 0.1 : 0.05} disabled={locked}
            onCommit={(value) => commitTransform("y", value)} />
          <NumberField label="宽度" value={emuToUnit(element.frame.width, unit)} min={0.01} step={unit === "cm" ? 0.1 : 0.05} disabled={locked}
            onCommit={(value) => commitTransform("width", value)} />
          <NumberField label="高度" value={emuToUnit(element.frame.height, unit)} min={0.01} step={unit === "cm" ? 0.1 : 0.05} disabled={locked}
            onCommit={(value) => commitTransform("height", value)} />
        </div>
        <NumberField label="旋转" unit="度" value={element.rotationMilliDegree / 1000} min={-360} max={360} precision={1} step={15} disabled={locked}
          onCommit={(value) => commitTransform("rotation", value)} />
        <div className="field-row">
          {ROTATION_PRESETS.map((degrees) => (
            <button type="button" key={degrees} className={`toggle-button ${Math.round(element.rotationMilliDegree / 1000) === degrees ? "active" : ""}`}
              disabled={locked} onClick={() => commitTransform("rotation", degrees)}>
              {degrees}°
            </button>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="对齐（相对页面）">
        <AlignGrid disabled={locked} onAlign={(cell: AlignCell) => onCommand({
          type: "align-element",
          slideId,
          elementId: element.id,
          align: cell.single
            ? (cell.horizontal === "center" ? cell.vertical : cell.horizontal)
            : { horizontal: cell.horizontal, vertical: cell.vertical },
        })} />
      </InspectorSection>

      {element.type === "text" && <InspectorSection title="文字外观">
        <SelectField label="字体" value={element.style.fontFamily} options={FONT_OPTIONS} disabled={locked}
          onCommit={(fontFamily) => setTextStyle({ fontFamily })} />
        <div className="property-grid">
          <NumberField label="字号" unit="pt" value={element.style.fontSizePt} min={4} max={400} precision={1} disabled={locked}
            onCommit={(fontSizePt) => setTextStyle({ fontSizePt })} />
          <ColorField label="颜色" value={element.style.color} wide swatches={palette} disabled={locked}
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
        {overflows && <div className="inspector-warning" role="status">
          <CircleAlert />
          <div>
            <strong>文字超出文本框</strong>
            <span>按当前字体的真实宽度量出的高度超过可用空间，导出后可能被 PowerPoint 缩小或裁切。</span>
            <button type="button" disabled={locked} onClick={() => onCommand({ type: "fit-text", slideId, elementId: element.id })}>适配文字</button>
          </div>
        </div>}
        {!fontAvailable && <div className="inspector-warning" role="status">
          <CircleAlert />
          <div>
            <strong>字体本机不可用</strong>
            <span>“{fontFamily}”在本机不可用，导出后将由查看端的替代字体渲染，版式可能变化。</span>
          </div>
        </div>}
      </InspectorSection>}

      {element.type === "shape" && <InspectorSection title="形状外观">
        <div className="property-grid">
          <ColorField label="填充" value={element.style.fill} wide swatches={palette} disabled={locked}
            onCommit={(fill) => setShapeStyle({ fill })} />
          <ColorField label="描边" value={element.style.stroke} wide swatches={palette} disabled={locked}
            onCommit={(stroke) => setShapeStyle({ stroke })} />
          <NumberField label="描边宽度" unit="pt" value={element.style.strokeWidthPt} min={0} max={100} precision={1} disabled={locked}
            onCommit={(strokeWidthPt) => setShapeStyle({ strokeWidthPt })} />
          {element.shape === "rectangle" && <NumberField label="圆角" unit="pt" value={element.style.radiusPt} min={0} max={1000} precision={1} disabled={locked}
            onCommit={(radiusPt) => setShapeStyle({ radiusPt })} />}
        </div>
      </InspectorSection>}

      {element.type === "chart" && <InspectorSection title="图表">
        <div className="property-grid">
          <SelectField label="类型" value={element.kind} disabled={locked}
            options={["column", "bar", "line", "pie"]}
            onCommit={(kind) => onCommand({ type: "set-chart-kind", slideId, elementId: element.id, kind: kind as ChartKind })} />
          <ColorField label="系列颜色" value={element.style.seriesColors[0] ?? "#3366CC"} swatches={palette} disabled={locked}
            onCommit={(color) => onCommand({ type: "set-chart-style", slideId, elementId: element.id, style: { seriesColors: [color, ...element.style.seriesColors.slice(1)] } })} />
          <NumberField label="字号" unit="pt" value={element.style.fontSizePt} min={4} max={400} precision={0} disabled={locked}
            onCommit={(fontSizePt) => onCommand({ type: "set-chart-style", slideId, elementId: element.id, style: { fontSizePt } })} />
        </div>
        <div className="field-row">
          <label><input type="checkbox" checked={element.style.showValueLabels} disabled={locked}
            onChange={(event) => onCommand({ type: "set-chart-style", slideId, elementId: element.id, style: { showValueLabels: event.target.checked } })} />显示数值</label>
          <label><input type="checkbox" checked={element.style.showLegend} disabled={locked}
            onChange={(event) => onCommand({ type: "set-chart-style", slideId, elementId: element.id, style: { showLegend: event.target.checked } })} />显示图例</label>
        </div>
        <p className="inspector-hint">图表的数值来自本页已审核的指标，导出后在 PowerPoint 中仍是可编辑的图表对象。</p>
      </InspectorSection>}

      {element.type === "table" && <InspectorSection title="表格">
        <div className="property-grid">
          <SelectField label="字体" value={element.style.fontFamily} disabled={locked}
            options={FONT_OPTIONS}
            onCommit={(fontFamily) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { fontFamily } })} />
          <NumberField label="字号" unit="pt" value={element.style.fontSizePt} min={4} max={400} precision={0} disabled={locked}
            onCommit={(fontSizePt) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { fontSizePt } })} />
          <ColorField label="表头填充" value={element.style.headerFill} wide swatches={palette} disabled={locked}
            onCommit={(headerFill) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { headerFill } })} />
          <ColorField label="表头文字" value={element.style.headerTextColor} wide swatches={palette} disabled={locked}
            onCommit={(headerTextColor) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { headerTextColor } })} />
          <ColorField label="正文文字" value={element.style.bodyTextColor} wide swatches={palette} disabled={locked}
            onCommit={(bodyTextColor) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { bodyTextColor } })} />
          <ColorField label="边框" value={element.style.borderColor} wide swatches={palette} disabled={locked}
            onCommit={(borderColor) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { borderColor } })} />
        </div>
        <div className="field-row">
          <label><input type="checkbox" checked={element.style.firstColumnBold} disabled={locked}
            onChange={(event) => onCommand({ type: "set-table-style", slideId, elementId: element.id, style: { firstColumnBold: event.target.checked } })} />首列加粗</label>
        </div>
        <p className="inspector-hint">表格的单元格来自本页已审核的表格数据，导出后在 PowerPoint 中仍是可编辑的表格对象。</p>
      </InspectorSection>}

      {element.type === "image" && <InspectorSection title="图片">
        <TextField label="替代文本" value={element.altText} maxLength={500} disabled={locked}
          onCommit={(altText) => onCommand({ type: "set-image-alt-text", slideId, elementId: element.id, altText })} />
        <div className="field-label crop-label">裁剪（源图切去的比例）</div>
        <div className="property-grid">
          <NumberField label="上" unit="%" value={(crop?.top ?? 0) * 100} min={0} max={99} precision={0} disabled={locked}
            onCommit={(percent) => commitCrop("top", percent)} />
          <NumberField label="下" unit="%" value={(crop?.bottom ?? 0) * 100} min={0} max={99} precision={0} disabled={locked}
            onCommit={(percent) => commitCrop("bottom", percent)} />
          <NumberField label="左" unit="%" value={(crop?.left ?? 0) * 100} min={0} max={99} precision={0} disabled={locked}
            onCommit={(percent) => commitCrop("left", percent)} />
          <NumberField label="右" unit="%" value={(crop?.right ?? 0) * 100} min={0} max={99} precision={0} disabled={locked}
            onCommit={(percent) => commitCrop("right", percent)} />
        </div>
        <div className="field-row">
          <button type="button" className="toggle-button" disabled={locked || !crop}
            onClick={() => onCommand({ type: "set-image-crop", slideId, elementId: element.id, crop: null })}>
            <RotateCcw />重置裁剪
          </button>
        </div>
      </InspectorSection>}

      <InspectorSection title="排列">
        <div className="element-actions arrange">
          <button disabled={locked || elementIndex >= elementCount - 1}
            onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementIndex + 1 })}>
            <ArrowUp />上移一层
          </button>
          <button disabled={locked || elementIndex <= 0}
            onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementIndex - 1 })}>
            <ArrowDown />下移一层
          </button>
          <button disabled={locked || elementIndex >= elementCount - 1}
            onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementCount - 1 })}>
            <BringToFront />置于顶层
          </button>
          <button disabled={locked || elementIndex <= 0}
            onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: 0 })}>
            <SendToBack />置于底层
          </button>
        </div>
      </InspectorSection>
    </div>
    {/*
      The actions of the selected object stay in sight: the panel of a text
      object is longer than the window, so the actions at the bottom of it
      would be out of reach.
    */}
    <div className="inspector-actions">
      <button type="button" disabled={locked}
        onClick={() => onCommand({ type: "duplicate-element", slideId, elementId: element.id })}>
        <Copy />复制
      </button>
      <button type="button" onClick={() => onCommand({ type: "set-element-lock", slideId, elementId: element.id, locked: !locked })}>
        {locked ? <LockOpen /> : <Lock />}{locked ? "解锁" : "锁定"}
      </button>
      <button type="button" className="danger" disabled={locked}
        onClick={() => onCommand({ type: "delete-element", slideId, elementId: element.id })}>
        <Trash2 />删除
      </button>
    </div>
    </>
  );
}

interface PagePropertiesProps {
  slideId: SlideId;
  background: string;
  pageSize: { width: Emu; height: Emu };
  unit: LengthUnit;
  palette?: readonly string[];
  onCommand: (command: DocumentCommand) => void;
  backgroundImage: boolean;
}

function PageProperties({ slideId, background, pageSize, backgroundImage, unit, palette, onCommand }: PagePropertiesProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const chooseBackground = (file: File | undefined) => {
    if (!file || !(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") onCommand({ type: "set-slide-background-image", slideId, dataUrl: reader.result, mimeType: file.type as SupportedImageMimeType });
    });
    reader.readAsDataURL(file);
  };
  return (
    <InspectorSection title="页面">
      <div className="field">
        <span className="field-label">幻灯片尺寸</span>
        {/* The size of the page is a property of the document, so it is read
            and not edited here. */}
        <span className="field-readonly">{`${emuToUnit(pageSize.width, unit).toFixed(2)} × ${emuToUnit(pageSize.height, unit).toFixed(2)} ${unitLabel(unit)}`}</span>
      </div>
      <ColorField label="背景色" value={background} wide swatches={palette}
        onCommit={(next) => onCommand({ type: "set-slide-background", slideId, background: next })} />
      <div className="field">
        <span className="field-label">背景图片</span>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={(event) => { chooseBackground(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        <div className="field-row">
          <button type="button" className="toggle-button" onClick={() => imageInput.current?.click()}><ImagePlus />{backgroundImage ? "替换背景图" : "选择背景图"}</button>
          {backgroundImage && <button type="button" className="toggle-button" onClick={() => onCommand({ type: "remove-slide-background-image", slideId })}><Trash2 />移除</button>}
        </div>
      </div>
    </InspectorSection>
  );
}

export interface InspectorTitleBarProps {
  element: SlideElement | undefined;
  slide: Slide;
}

/**
 * The head of the panel.
 *
 * It names the panel, tells the kind of the selected object and shows a small
 * picture of it, drawn with the code the canvas uses.
 */
export function InspectorTitleBar({ element, slide }: InspectorTitleBarProps) {
  return (
    <div className="inspector-title">
      <Layers3 size={18} />
      <span>属性</span>
      {element && <span className="type-chip">{elementTypeLabel(element)}</span>}
      {element && <ElementPreview element={element} slide={slide} label={elementTypeLabel(element)} />}
    </div>
  );
}

export const InspectorPanel = memo(function InspectorPanel() {
  const document = useEditorStore((state) => state.document);
  const activeSlideId = useEditorStore((state) => state.activeSlideId);
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds);
  const execute = useEditorStore((state) => state.execute);
  const slide = document.slides.find((item) => item.id === activeSlideId) ?? document.slides[0]!;
  const selectedElements = slide.elements.filter((element) => selectedElementIds.includes(element.id));
  // 多选时"当前对象"是最后被选中的那个：属性面板和快捷键都以它为准。
  const selected = selectedElements.length > 0 ? selectedElements[selectedElements.length - 1] : undefined;
  const multiBounds = selectedElements.length > 1 ? unionFrame(selectedElements.map((element) => element.frame)) : undefined;
  // Display preferences only. They never reach the document, so they cannot
  // change a revision or the undo stack.
  const [unit, setUnit] = useState<LengthUnit>("inch");
  const [aspectLocked, setAspectLocked] = useState(false);
  // The colors of the template are offered next to every color field. A deck
  // without a template falls back to the default colors.
  const palette = paletteSwatches(document.theme?.colors);

  return (
    <aside className="right-panel">
      {multiBounds
        ? <MultiSelectionPanel
          slideId={slide.id}
          elementIds={selectedElements.map((element) => element.id)}
          bounds={multiBounds}
          unit={unit}
          onCommand={execute}
          onDelete={() => {
            // 删除整组是一个意图，所以是一个命令、一个撤销项。
            execute({ type: "delete-elements", slideId: slide.id, elementIds: selectedElements.map((element) => element.id) });
          }}
        />
        : <>
          <InspectorTitleBar element={selected} slide={slide} />
          {selected
            ? <InspectorPanelView
              element={selected}
              slideId={slide.id}
              elementIndex={slide.elements.findIndex((item) => item.id === selected.id)}
              elementCount={slide.elements.length}
              background={slide.background}
              pageSize={document.pageSize}
              backgroundImage={slide.elements.some((element) => element.type === "image" && element.placement === "slide-background")}
              unit={unit}
              onUnitChange={setUnit}
              aspectLocked={aspectLocked}
              onToggleAspectLock={() => setAspectLocked((current) => !current)}
              palette={palette}
              onCommand={execute}
            />
            : <div className="property-form">
              <div className="empty-inspector">
                <span className="empty-inspector-mark"><MousePointer2 /></span>
                <strong>未选中对象</strong>
                <p>选择画布中的对象，这里会显示它的全部属性。</p>
                <div className="empty-inspector-actions">
                  <button type="button" onClick={() => execute({ type: "add-text", slideId: slide.id })}><Type />文本</button>
                  <button type="button" onClick={() => execute({ type: "add-shape", slideId: slide.id, shape: "rectangle" })}><Square />矩形</button>
                </div>
              </div>
              <PageProperties slideId={slide.id} background={slide.background} pageSize={document.pageSize}
                backgroundImage={slide.elements.some((element) => element.type === "image" && element.placement === "slide-background")}
                unit={unit} palette={palette} onCommand={execute} />
            </div>}
        </>}
    </aside>
  );
});
