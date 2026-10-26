import { memo, useEffect, useRef, useState } from "react";

import { ICON_LABELS, ICON_NAMES } from "./icon-options";
import { IconGlyph } from "./IconView";
import {
  AlignCenterHorizontal,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  Bold,
  BringToFront,
  CircleAlert,
  Copy,
  Eraser,
  ExternalLink,
  EyeOff,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Layers3,
  Link2,
  List,
  ListOrdered,
  Lock,
  LockOpen,
  MousePointer2,
  SendToBack,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Unlink,
} from "lucide-react";
import {
  type AssetProvenance,
  type ContentBlock,
  type Emu,
  type ImageCrop,
  type LineDirection,
  type LineElementStyle,
  type LineEnd,
  type ShapeElementStyle,
  type Slide,
  type SlideElement,
  type SlideId,
  type SlideTransition,
  type TextElementStyle,
  isSafeTextHyperlinkUrl,
  resolveFragmentStyle,
  textFragments,
} from "../../core/document-model";
import type { DocumentCommand } from "../../core/commands";

import {
  colorLuminance,
  contrastRatio,
  isLargeText,
  readableTextColor,
  requiredContrast,
} from "../../core/rendering/contrast";
import { isFontAvailable } from "../../core/validation/export-validation";
import { textLikelyOverflows } from "../../core/rendering/text-fit";
import { useEditorStore } from "../../store/editor-store";
import { ChartInspector, ImageInspector, TableInspector } from "./InspectorDataSections";
import { PageProperties } from "./PagePropertiesPanel";
import { DirectionPanel, InspectorSection, TastePanel } from "./InspectorPanels";
import { ColorField, NumberField, SelectField } from "./inspector-fields";
import { emuToUnit, resizeWithAspectLock, unitToEmu, type LengthUnit } from "./inspector-geometry";
import { AlignGrid, type AlignCell } from "./AlignGrid";
import { type MetricFieldValue } from "./StructuredContentFields";
import { MultiSelectionPanel } from "./MultiSelectionPanel";
import { unionFrame } from "../../core/commands/arrange";
import { ElementPreview } from "./ElementPreview";
import { paletteSwatches } from "./inspector-palette";
import { FONT_OPTIONS } from "./font-options";

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
  if (element.type === "line") return "线条";
  if (element.type === "icon") return "图标";
  const shapeLabels = {
    rectangle: "矩形",
    ellipse: "椭圆",
    triangle: "三角形",
    diamond: "菱形",
    pentagon: "五边形",
    hexagon: "六边形",
    chevron: "V 形",
    arrow: "箭头",
    star: "星形",
    parallelogram: "平行四边形",
    trapezoid: "梯形",
  } as const;
  return shapeLabels[element.shape];
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
  /** Reviewed structured content of the page, for tables, charts and cards. */
  blocks?: ContentBlock[];
  /** The speaker notes of this page. */
  speakerNotes: string;
  /** Native transition into this page. Absent means no transition. */
  transition?: SlideTransition;
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

export function InspectorPanelView({
  element,
  slideId,
  elementIndex,
  elementCount,
  background,
  pageSize,
  blocks,
  speakerNotes,
  transition,
  backgroundImage = false,
  unit,
  onUnitChange,
  aspectLocked,
  onToggleAspectLock,
  palette,
  onCommand,
}: InspectorPanelViewProps) {
  const [textDraft, setTextDraft] = useState<string>();
  const [fontAvailable, setFontAvailable] = useState(true);
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  const [linkError, setLinkError] = useState<string>();
  const textDraftCancelRef = useRef(false);
  const locked = element.locked;
  const fontFamily = element.type === "text" ? element.style.fontFamily : "";

  useEffect(() => {
    // A text selection addresses a range of one specific element. Keeping it
    // when another element is selected would bold the wrong characters.
    setSelection(undefined);
    setLinkError(undefined);
    setTextDraft(undefined);
  }, [element.id]);

  useEffect(() => {
    if (!fontFamily) return;
    let active = true;
    void isFontAvailable(fontFamily).then((available) => {
      if (active) setFontAvailable(available);
    });
    return () => {
      active = false;
    };
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
    if (
      frame.x === element.frame.x &&
      frame.y === element.frame.y &&
      frame.width === element.frame.width &&
      frame.height === element.frame.height &&
      rotationMilliDegree === element.rotationMilliDegree
    )
      return;
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
  const selectionIsBold =
    element.type === "text" && selection
      ? (() => {
          const overlapping = textFragments(element.text, element.runs).filter(
            (fragment) => fragment.start < selection.end && fragment.end > selection.start,
          );
          if (overlapping.length === 0) return element.style.bold;
          return overlapping.every((fragment) => resolveFragmentStyle(element.style, fragment.style).bold);
        })()
      : false;

  /** The emphasised fragments, so the user can see what is already marked. */
  const emphasised =
    element.type === "text"
      ? textFragments(element.text, element.runs).filter((fragment) => Object.keys(fragment.style).length > 0)
      : [];

  const setShapeStyle = (style: Partial<ShapeElementStyle>) => {
    onCommand({ type: "set-shape-style", slideId, elementId: element.id, style });
  };

  const setLineStyle = (style: Partial<LineElementStyle>) => {
    onCommand({ type: "set-line-style", slideId, elementId: element.id, style });
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

  const updateProvenance = (patch: Partial<AssetProvenance>) => {
    if (element.type !== "image") return;
    const current = element.provenance;
    const next: AssetProvenance = {
      ...current,
      ...patch,
      verification: patch.verification ?? current?.verification ?? "pending",
    };
    // A picture cannot stay "verified" after its source or licence is removed.
    if (next.verification === "verified" && !(next.sourceUrl?.trim() && next.license?.trim())) {
      next.verification = "pending";
    }
    onCommand({ type: "set-image-provenance", slideId, elementId: element.id, provenance: next });
  };

  const contrast = element.type === "text" ? contrastRatio(element.style.color, background) : undefined;
  const required = element.type === "text" ? requiredContrast(element.style.fontSizePt, element.style.bold) : 0;
  const lowContrast = contrast !== undefined && contrast < required;
  // The overflow is judged with the real font when the application registered
  // a measurer, so the warning matches what the export will look like.
  const overflows = element.type === "text" && textLikelyOverflows(element);

  // Structured content is resolved by block id, never by position: a table or
  // chart may outlive a regeneration that reorders the blocks.
  const tableBlock =
    element.type === "table" && blocks
      ? blocks.find(
          (block): block is Extract<ContentBlock, { type: "table-data" }> =>
            block.id === element.contentBlockId && block.type === "table-data",
        )
      : undefined;
  const chartMetrics: MetricFieldValue[] =
    element.type === "chart" && blocks
      ? element.contentBlockIds.flatMap((id) => {
          const block = blocks.find(
            (candidate): candidate is Extract<ContentBlock, { type: "metric" }> =>
              candidate.id === id && candidate.type === "metric",
          );
          return block ? [{ blockId: block.id, label: block.label, value: block.value }] : [];
        })
      : [];
  const cardBlockRef = element.type === "text" ? element.contentBlockRef : undefined;
  const cardMetric =
    cardBlockRef && blocks
      ? blocks.find(
          (block): block is Extract<ContentBlock, { type: "metric" }> =>
            block.id === cardBlockRef.blockId && block.type === "metric",
        )
      : undefined;

  return (
    <>
      <div className="property-form">
        {element.hidden && (
          <div className="inspector-warning" role="status">
            <EyeOff />
            <div>
              <strong>图层已隐藏</strong>
              <span>画布、缩略图和导出都不会显示这个对象；图层列表中仍可找到它。</span>
              <button
                type="button"
                onClick={() =>
                  onCommand({ type: "set-elements-hidden", slideId, elementIds: [element.id], hidden: false })
                }
              >
                显示图层
              </button>
            </div>
          </div>
        )}
        <PageProperties
          slideId={slideId}
          background={background}
          pageSize={pageSize}
          speakerNotes={speakerNotes}
          transition={transition}
          backgroundImage={backgroundImage}
          unit={unit}
          palette={palette}
          onCommand={onCommand}
        />

        {element.type === "text" && (
          <InspectorSection title="内容">
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
                    onCommand(
                      selectionIsBold
                        ? {
                            type: "clear-text-emphasis",
                            slideId,
                            elementId: element.id,
                            start: selection.start,
                            end: selection.end,
                          }
                        : {
                            type: "set-text-emphasis",
                            slideId,
                            elementId: element.id,
                            start: selection.start,
                            end: selection.end,
                            style: { bold: true },
                          },
                    );
                  }
                }}
              />
            </label>
            {cardBlockRef && (
              <p className="inspector-hint">
                {cardMetric
                  ? `这段文字显示本页指标的${cardBlockRef.field === "value" ? "数值" : "名称"}；修改会同步更新内容，并把本页标记为待确认。`
                  : "这段文字引用的内容块已不存在；修改只影响当前显示。"}
              </p>
            )}
            <div className="field-row">
              <button
                type="button"
                className="toggle-button"
                disabled={locked || !selection}
                onClick={() => {
                  if (!selection) return;
                  onCommand(
                    selectionIsBold
                      ? {
                          type: "clear-text-emphasis",
                          slideId,
                          elementId: element.id,
                          start: selection.start,
                          end: selection.end,
                        }
                      : {
                          type: "set-text-emphasis",
                          slideId,
                          elementId: element.id,
                          start: selection.start,
                          end: selection.end,
                          style: { bold: true },
                        },
                  );
                }}
              >
                <Bold />
                {selectionIsBold ? "取消加粗" : "加粗所选"}
              </button>
              <button
                type="button"
                className="toggle-button"
                disabled={locked || emphasised.length === 0}
                onClick={() =>
                  onCommand({
                    type: "clear-text-emphasis",
                    slideId,
                    elementId: element.id,
                    start: 0,
                    end: element.text.length,
                  })
                }
              >
                清除全部强调
              </button>
            </div>
            {emphasised.length > 0 && (
              <p className="inspector-hint">
                已强调 {emphasised.length} 处：{emphasised.map((fragment) => fragment.text).join(" / ")}
              </p>
            )}
          </InspectorSection>
        )}

        <InspectorSection
          title="位置与尺寸"
          tools={
            <div className="section-tools">
              <div className="segmented compact" role="group" aria-label="长度单位">
                <button
                  type="button"
                  className={unit === "inch" ? "active" : undefined}
                  aria-pressed={unit === "inch"}
                  onClick={() => onUnitChange("inch")}
                >
                  英寸
                </button>
                <button
                  type="button"
                  className={unit === "cm" ? "active" : undefined}
                  aria-pressed={unit === "cm"}
                  onClick={() => onUnitChange("cm")}
                >
                  厘米
                </button>
              </div>
              <button
                type="button"
                className={`icon-button ${aspectLocked ? "active" : ""}`}
                disabled={locked}
                title={aspectLocked ? "已锁定宽高比" : "锁定宽高比"}
                aria-label="锁定宽高比"
                aria-pressed={aspectLocked}
                onClick={onToggleAspectLock}
              >
                {aspectLocked ? <Unlink /> : <Link2 />}
              </button>
            </div>
          }
        >
          <div className="property-grid">
            <NumberField
              label="X"
              value={emuToUnit(element.frame.x, unit)}
              min={0}
              step={unit === "cm" ? 0.1 : 0.05}
              disabled={locked}
              onCommit={(value) => commitTransform("x", value)}
            />
            <NumberField
              label="Y"
              value={emuToUnit(element.frame.y, unit)}
              min={0}
              step={unit === "cm" ? 0.1 : 0.05}
              disabled={locked}
              onCommit={(value) => commitTransform("y", value)}
            />
            <NumberField
              label="宽度"
              value={emuToUnit(element.frame.width, unit)}
              min={0.01}
              step={unit === "cm" ? 0.1 : 0.05}
              disabled={locked}
              onCommit={(value) => commitTransform("width", value)}
            />
            <NumberField
              label="高度"
              value={emuToUnit(element.frame.height, unit)}
              min={0.01}
              step={unit === "cm" ? 0.1 : 0.05}
              disabled={locked}
              onCommit={(value) => commitTransform("height", value)}
            />
          </div>
          <NumberField
            label="旋转"
            unit="度"
            value={element.rotationMilliDegree / 1000}
            min={-360}
            max={360}
            precision={1}
            step={15}
            disabled={locked}
            onCommit={(value) => commitTransform("rotation", value)}
          />
          <div className="field-row">
            {ROTATION_PRESETS.map((degrees) => (
              <button
                type="button"
                key={degrees}
                className={`toggle-button ${Math.round(element.rotationMilliDegree / 1000) === degrees ? "active" : ""}`}
                disabled={locked}
                onClick={() => commitTransform("rotation", degrees)}
              >
                {degrees}°
              </button>
            ))}
          </div>
        </InspectorSection>

        <InspectorSection title="对齐（相对页面）">
          <AlignGrid
            disabled={locked}
            onAlign={(cell: AlignCell) =>
              onCommand({
                type: "align-element",
                slideId,
                elementId: element.id,
                align: cell.single
                  ? cell.horizontal === "center"
                    ? cell.vertical
                    : cell.horizontal
                  : { horizontal: cell.horizontal, vertical: cell.vertical },
              })
            }
          />
        </InspectorSection>

        {element.type === "text" && (
          <InspectorSection title="文字外观">
            <SelectField
              label="字体"
              value={element.style.fontFamily}
              options={FONT_OPTIONS}
              disabled={locked}
              onCommit={(fontFamily) => setTextStyle({ fontFamily })}
            />
            <div className="property-grid">
              <NumberField
                label="字号"
                unit="pt"
                value={element.style.fontSizePt}
                min={4}
                max={400}
                precision={1}
                disabled={locked}
                onCommit={(fontSizePt) => setTextStyle({ fontSizePt })}
              />
              <ColorField
                label="颜色"
                value={element.style.color}
                wide
                swatches={palette}
                disabled={locked}
                onCommit={(color) => setTextStyle({ color })}
              />
            </div>
            <div className="field-row">
              <button
                type="button"
                className={`toggle-button ${element.style.bold ? "active" : ""}`}
                disabled={locked}
                aria-label="加粗"
                title="加粗"
                aria-pressed={element.style.bold}
                onClick={() => setTextStyle({ bold: !element.style.bold })}
              >
                <Bold />
              </button>
              <button
                type="button"
                className={`toggle-button ${element.style.italic ? "active" : ""}`}
                disabled={locked}
                aria-label="斜体"
                title="斜体"
                aria-pressed={Boolean(element.style.italic)}
                onClick={() => setTextStyle({ italic: !(element.style.italic ?? false) })}
              >
                <Italic />
              </button>
              <button
                type="button"
                className={`toggle-button ${element.style.underline ? "active" : ""}`}
                disabled={locked}
                aria-label="下划线"
                title="下划线"
                aria-pressed={Boolean(element.style.underline)}
                onClick={() => setTextStyle({ underline: !(element.style.underline ?? false) })}
              >
                <Underline />
              </button>
              <button
                type="button"
                className={`toggle-button ${element.style.strikethrough ? "active" : ""}`}
                disabled={locked}
                aria-label="删除线"
                title="删除线"
                aria-pressed={Boolean(element.style.strikethrough)}
                onClick={() => setTextStyle({ strikethrough: !(element.style.strikethrough ?? false) })}
              >
                <Strikethrough />
              </button>
            </div>
            <div className="field-row">
              <div className="segmented" role="group" aria-label="文字对齐">
                {TEXT_ALIGN.map(({ align, label, Icon }) => (
                  <button
                    type="button"
                    key={align}
                    title={label}
                    aria-label={label}
                    className={element.style.align === align ? "active" : undefined}
                    disabled={locked}
                    onClick={() => setTextStyle({ align })}
                  >
                    <Icon />
                  </button>
                ))}
              </div>
            </div>
            {lowContrast && (
              <div className="inspector-warning" role="status">
                <CircleAlert />
                <div>
                  <strong>文字对比度不足</strong>
                  <span>
                    按页面背景色计算为 {contrast!.toFixed(2)}:1，需要至少 {required}:1，导出后在其他设备上可能看不清。
                  </span>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      const luminance = colorLuminance(background);
                      if (luminance === undefined) return;
                      setTextStyle({
                        color: readableTextColor(
                          element.type === "text" ? element.style.color : "#000000",
                          luminance,
                          isLargeText(
                            element.type === "text" ? element.style.fontSizePt : 12,
                            element.type === "text" ? element.style.bold : false,
                          ),
                        ),
                      });
                    }}
                  >
                    换成可读颜色
                  </button>
                </div>
              </div>
            )}
            {overflows && (
              <div className="inspector-warning" role="status">
                <CircleAlert />
                <div>
                  <strong>文字超出文本框</strong>
                  <span>按当前字体的真实宽度量出的高度超过可用空间，导出后可能被 PowerPoint 缩小或裁切。</span>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onCommand({ type: "fit-text", slideId, elementId: element.id })}
                  >
                    适配文字
                  </button>
                </div>
              </div>
            )}
            {!fontAvailable && (
              <div className="inspector-warning" role="status">
                <CircleAlert />
                <div>
                  <strong>字体本机不可用</strong>
                  <span>“{fontFamily}”在本机不可用，导出后将由查看端的替代字体渲染，版式可能变化。</span>
                </div>
              </div>
            )}
          </InspectorSection>
        )}

        {element.type === "text" && (
          <InspectorSection title="段落">
            <div className="field">
              <span className="field-label">垂直对齐</span>
              <div className="segmented" role="group" aria-label="垂直对齐">
                {(
                  [
                    ["top", "顶端对齐", <AlignVerticalJustifyStart key="top" />],
                    ["middle", "垂直居中", <AlignVerticalJustifyCenter key="middle" />],
                    ["bottom", "底端对齐", <AlignVerticalJustifyEnd key="bottom" />],
                  ] as const
                ).map(([value, label, icon]) => (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    aria-label={label}
                    className={(element.style.verticalAlign ?? "top") === value ? "active" : undefined}
                    disabled={locked}
                    onClick={() => setTextStyle({ verticalAlign: value })}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <SelectField
              label="行距"
              value={element.style.lineHeight === undefined ? "" : String(element.style.lineHeight)}
              options={["", "1", "1.15", "1.5", "2"]}
              optionLabels={{ "": "默认", "1": "1.0", "1.15": "1.15", "1.5": "1.5", "2": "2.0" }}
              disabled={locked}
              onCommit={(value) => setTextStyle({ lineHeight: value === "" ? undefined : Number(value) })}
            />
            <div className="field-row">
              <button
                type="button"
                className={`toggle-button ${element.style.bullet === "dot" ? "active" : ""}`}
                disabled={locked}
                aria-label="项目符号"
                title="项目符号"
                aria-pressed={element.style.bullet === "dot"}
                onClick={() => setTextStyle({ bullet: element.style.bullet === "dot" ? "none" : "dot" })}
              >
                <List />
              </button>
              <button
                type="button"
                className={`toggle-button ${element.style.bullet === "number" ? "active" : ""}`}
                disabled={locked}
                aria-label="编号"
                title="编号"
                aria-pressed={element.style.bullet === "number"}
                onClick={() => setTextStyle({ bullet: element.style.bullet === "number" ? "none" : "number" })}
              >
                <ListOrdered />
              </button>
              <button
                type="button"
                className="toggle-button"
                disabled={locked || (element.style.indentLevel ?? 0) <= 0}
                aria-label="减少缩进"
                title="减少缩进"
                onClick={() => setTextStyle({ indentLevel: Math.max(0, (element.style.indentLevel ?? 0) - 1) })}
              >
                <IndentDecrease />
              </button>
              <button
                type="button"
                className="toggle-button"
                disabled={locked || (element.style.indentLevel ?? 0) >= 8}
                aria-label="增加缩进"
                title="增加缩进"
                onClick={() => setTextStyle({ indentLevel: Math.min(8, (element.style.indentLevel ?? 0) + 1) })}
              >
                <IndentIncrease />
              </button>
            </div>
            <button
              type="button"
              className="toggle-button"
              disabled={locked}
              onClick={() => onCommand({ type: "clear-text-format", slideId, elementIds: [element.id] })}
            >
              <Eraser />
              清除格式
            </button>
          </InspectorSection>
        )}

        {element.type === "shape" && (
          <InspectorSection title="形状外观">
            <div className="property-grid">
              <ColorField
                label="填充"
                value={element.style.fill}
                wide
                swatches={palette}
                disabled={locked}
                onCommit={(fill) => setShapeStyle({ fill })}
              />
              <ColorField
                label="描边"
                value={element.style.stroke}
                wide
                swatches={palette}
                disabled={locked}
                onCommit={(stroke) => setShapeStyle({ stroke })}
              />
              <NumberField
                label="描边宽度"
                unit="pt"
                value={element.style.strokeWidthPt}
                min={0}
                max={100}
                precision={1}
                disabled={locked}
                onCommit={(strokeWidthPt) => setShapeStyle({ strokeWidthPt })}
              />
              {element.shape === "rectangle" && (
                <NumberField
                  label="圆角"
                  unit="pt"
                  value={element.style.radiusPt}
                  min={0}
                  max={1000}
                  precision={1}
                  disabled={locked}
                  onCommit={(radiusPt) => setShapeStyle({ radiusPt })}
                />
              )}
            </div>
          </InspectorSection>
        )}

        {element.type === "icon" && (
          <InspectorSection title="图标">
            <div className="property-grid">
              <ColorField
                label="颜色"
                value={element.style.color}
                wide
                swatches={palette}
                disabled={locked}
                onCommit={(color) =>
                  onCommand({ type: "set-icon-style", slideId, elementId: element.id, style: { color } })
                }
              />
              <NumberField
                label="线宽"
                unit="pt"
                value={element.style.strokeWidth ?? 2}
                min={1}
                max={6}
                precision={1}
                disabled={locked}
                onCommit={(strokeWidth) =>
                  onCommand({ type: "set-icon-style", slideId, elementId: element.id, style: { strokeWidth } })
                }
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                gap: "6px",
                marginTop: "10px",
              }}
            >
              {ICON_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-label={ICON_LABELS[name]}
                  aria-pressed={element.name === name}
                  disabled={locked}
                  onClick={() => onCommand({ type: "set-icon-name", slideId, elementId: element.id, name })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "6px",
                    borderRadius: "8px",
                    border: element.name === name ? "2px solid currentColor" : "1px solid rgba(120,130,140,0.35)",
                    background: "transparent",
                    color: "inherit",
                    cursor: locked ? "default" : "pointer",
                  }}
                >
                  <span style={{ width: "18px", height: "18px" }}>
                    <IconGlyph name={name} color="currentColor" />
                  </span>
                </button>
              ))}
            </div>
          </InspectorSection>
        )}

        {element.type === "line" && (
          <InspectorSection title="线条外观">
            <div className="property-grid">
              <ColorField
                label="颜色"
                value={element.style.stroke}
                wide
                swatches={palette}
                disabled={locked}
                onCommit={(stroke) => setLineStyle({ stroke })}
              />
              <NumberField
                label="线宽"
                unit="pt"
                value={element.style.strokeWidthPt}
                min={0}
                max={100}
                precision={1}
                disabled={locked}
                onCommit={(strokeWidthPt) => setLineStyle({ strokeWidthPt })}
              />
              <SelectField
                label="方向"
                value={element.direction}
                disabled={locked}
                options={["horizontal", "vertical", "diagonal"]}
                optionLabels={{ horizontal: "水平", vertical: "垂直", diagonal: "斜线" }}
                onCommit={(direction) =>
                  onCommand({
                    type: "set-line-direction",
                    slideId,
                    elementId: element.id,
                    direction: direction as LineDirection,
                  })
                }
              />
              <SelectField
                label="起点箭头"
                value={element.style.startArrow}
                disabled={locked}
                options={["none", "arrow"]}
                optionLabels={{ none: "无", arrow: "箭头" }}
                onCommit={(startArrow) => setLineStyle({ startArrow: startArrow as LineEnd })}
              />
              <SelectField
                label="终点箭头"
                value={element.style.endArrow}
                disabled={locked}
                options={["none", "arrow"]}
                optionLabels={{ none: "无", arrow: "箭头" }}
                onCommit={(endArrow) => setLineStyle({ endArrow: endArrow as LineEnd })}
              />
              <div className="field">
                <span className="field-label">虚线</span>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={element.style.dashed}
                    disabled={locked}
                    onChange={(event) => setLineStyle({ dashed: event.target.checked })}
                  />
                  <span>使用虚线</span>
                </label>
              </div>
            </div>
          </InspectorSection>
        )}

        {element.type === "chart" && (
          <ChartInspector
            element={element}
            slideId={slideId}
            locked={locked}
            palette={palette}
            chartMetrics={chartMetrics}
            onCommand={onCommand}
          />
        )}

        {element.type === "table" && (
          <TableInspector
            element={element}
            slideId={slideId}
            locked={locked}
            tableBlock={tableBlock}
            palette={palette}
            onCommand={onCommand}
          />
        )}

        {element.type === "image" && (
          <ImageInspector
            element={element}
            slideId={slideId}
            locked={locked}
            crop={crop}
            commitCrop={commitCrop}
            updateProvenance={updateProvenance}
            onCommand={onCommand}
          />
        )}

        <InspectorSection title="排列">
          <div className="element-actions arrange">
            <button
              disabled={locked || elementIndex >= elementCount - 1}
              onClick={() =>
                onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementIndex + 1 })
              }
            >
              <ArrowUp />
              上移一层
            </button>
            <button
              disabled={locked || elementIndex <= 0}
              onClick={() =>
                onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementIndex - 1 })
              }
            >
              <ArrowDown />
              下移一层
            </button>
            <button
              disabled={locked || elementIndex >= elementCount - 1}
              onClick={() =>
                onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: elementCount - 1 })
              }
            >
              <BringToFront />
              置于顶层
            </button>
            <button
              disabled={locked || elementIndex <= 0}
              onClick={() => onCommand({ type: "reorder-element", slideId, elementId: element.id, toIndex: 0 })}
            >
              <SendToBack />
              置于底层
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
        <button
          type="button"
          disabled={locked}
          onClick={() => onCommand({ type: "duplicate-element", slideId, elementId: element.id })}
        >
          <Copy />
          复制
        </button>
        <button
          type="button"
          onClick={() => onCommand({ type: "set-element-lock", slideId, elementId: element.id, locked: !locked })}
        >
          {locked ? <LockOpen /> : <Lock />}
          {locked ? "解锁" : "锁定"}
        </button>
        <button
          type="button"
          className="danger"
          disabled={locked}
          onClick={() => onCommand({ type: "delete-element", slideId, elementId: element.id })}
        >
          <Trash2 />
          删除
        </button>
      </div>
    </>
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
  const multiBounds =
    selectedElements.length > 1 ? unionFrame(selectedElements.map((element) => element.frame)) : undefined;
  // Display preferences only. They never reach the document, so they cannot
  // change a revision or the undo stack.
  const [unit, setUnit] = useState<LengthUnit>("inch");
  const [aspectLocked, setAspectLocked] = useState(false);
  // The colors of the template are offered next to every color field. A deck
  // without a template falls back to the default colors.
  const palette = paletteSwatches(document.theme?.colors);

  return (
    <aside className="right-panel">
      <TastePanel />
      <DirectionPanel />
      {multiBounds ? (
        <MultiSelectionPanel
          slideId={slide.id}
          elementIds={selectedElements.map((element) => element.id)}
          bounds={multiBounds}
          unit={unit}
          onCommand={execute}
          onDelete={() => {
            // 删除整组是一个意图，所以是一个命令、一个撤销项。
            execute({
              type: "delete-elements",
              slideId: slide.id,
              elementIds: selectedElements.map((element) => element.id),
            });
          }}
        />
      ) : (
        <>
          <InspectorTitleBar element={selected} slide={slide} />
          {selected ? (
            <InspectorPanelView
              element={selected}
              slideId={slide.id}
              elementIndex={slide.elements.findIndex((item) => item.id === selected.id)}
              elementCount={slide.elements.length}
              background={slide.background}
              pageSize={document.pageSize}
              blocks={slide.content.blocks}
              speakerNotes={slide.content.speakerNotes}
              transition={slide.transition}
              backgroundImage={slide.elements.some(
                (element) => element.type === "image" && element.placement === "slide-background",
              )}
              unit={unit}
              onUnitChange={setUnit}
              aspectLocked={aspectLocked}
              onToggleAspectLock={() => setAspectLocked((current) => !current)}
              palette={palette}
              onCommand={execute}
            />
          ) : (
            <div className="property-form">
              <div className="empty-inspector">
                <span className="empty-inspector-mark">
                  <MousePointer2 />
                </span>
                <strong>未选中对象</strong>
                <p>选择画布中的对象，这里会显示它的全部属性。</p>
                <div className="empty-inspector-actions">
                  <button type="button" onClick={() => execute({ type: "add-text", slideId: slide.id })}>
                    <Type />
                    文本
                  </button>
                  <button
                    type="button"
                    onClick={() => execute({ type: "add-shape", slideId: slide.id, shape: "rectangle" })}
                  >
                    <Square />
                    矩形
                  </button>
                </div>
              </div>
              <PageProperties
                slideId={slide.id}
                background={slide.background}
                pageSize={document.pageSize}
                speakerNotes={slide.content.speakerNotes}
                transition={slide.transition}
                backgroundImage={slide.elements.some(
                  (element) => element.type === "image" && element.placement === "slide-background",
                )}
                unit={unit}
                palette={palette}
                onCommand={execute}
              />
            </div>
          )}
        </>
      )}
    </aside>
  );
});
