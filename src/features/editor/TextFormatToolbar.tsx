import { useEffect, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Paintbrush,
  Strikethrough,
  Underline,
} from "lucide-react";
import type { DocumentCommand } from "../../core/commands";
import {
  MAX_TEXT_SIZE_PT,
  MIN_TEXT_SIZE_PT,
  nextTextSize,
  normalizeTextFormat,
  type ElementId,
  type SlideId,
  type TextElement,
  type TextElementStyle,
} from "../../core/document-model";
import { useFormatPainterStore } from "../../store/format-painter";
import { normalizeHexColor } from "./inspector-color";
import { FONT_OPTIONS } from "./font-options";

const MIN_INDENT = 0;
const MAX_INDENT = 8;

/** The same quick values PowerPoint offers before its “more spacing” dialog. */
const CHARACTER_SPACING_OPTIONS = [
  { value: "-1.5", label: "很紧" },
  { value: "-1", label: "紧密" },
  { value: "0", label: "常规" },
  { value: "1", label: "稀疏" },
  { value: "1.5", label: "很松" },
  { value: "3", label: "更松" },
] as const;

interface TextFormatToolbarProps {
  slideId: SlideId;
  /** The selected objects; the toolbar filters the text ones itself. */
  elements: TextElement[];
  execute: (command: DocumentCommand) => void;
  /**
   * `all` keeps the original two-row character + paragraph control. The Home
   * ribbon asks for `font` and `paragraph` separately so each can live in its
   * own labelled group without duplicating commands.
   */
  section?: "all" | "font" | "paragraph";
}

function shared<T>(elements: TextElement[], read: (element: TextElement) => T): { value?: T; mixed: boolean } {
  if (elements.length === 0) return { mixed: false };
  const first = read(elements[0]!);
  const mixed = elements.some((element) => read(element) !== first);
  return mixed ? { mixed } : { value: first, mixed: false };
}

/**
 * The character and paragraph controls of the “开始” ribbon.
 *
 * Every control writes through one batch command, so formatting a multi
 * selection is one undo step and a single command cannot half-apply. The
 * primary object (the last one selected) is what the controls display; when
 * the selection disagrees the control shows a mixed state and the next click
 * makes all of them agree.
 */
export function TextFormatToolbar({ slideId, elements, execute, section = "all" }: TextFormatToolbarProps) {
  const editable = elements.filter((element) => !element.locked);
  const primary = editable.at(-1);
  const disabled = !primary || editable.length === 0;
  const stateElements = editable.length > 0 ? editable : elements;

  const [sizeDraft, setSizeDraft] = useState(() => (primary ? String(primary.style.fontSizePt) : ""));
  const fontSizeValue = primary?.style.fontSizePt;
  useEffect(() => {
    setSizeDraft(fontSizeValue === undefined ? "" : String(fontSizeValue));
  }, [fontSizeValue]);

  const painter = useFormatPainterStore((state) => state.style);
  const copyFormat = useFormatPainterStore((state) => state.copy);

  const apply = (style: Partial<TextElementStyle>) => {
    if (editable.length === 0) return;
    execute({
      type: "set-text-style-elements",
      slideId,
      elementIds: editable.map((element) => element.id) as ElementId[],
      style,
    });
  };

  const bold = shared(stateElements, (element) => element.style.bold);
  const italic = shared(stateElements, (element) => element.style.italic ?? false);
  const underline = shared(stateElements, (element) => element.style.underline ?? false);
  const strike = shared(stateElements, (element) => element.style.strikethrough ?? false);
  const align = shared(stateElements, (element) => element.style.align);
  const vertical = shared(stateElements, (element) => element.style.verticalAlign ?? "top");
  const bullet = shared(stateElements, (element) => element.style.bullet ?? "none");
  const characterSpacing = shared(stateElements, (element) => element.style.letterSpacingPt);

  const fontSize = primary?.style.fontSizePt;
  const indentLevel = primary?.style.indentLevel ?? 0;
  const lineHeight = primary?.style.lineHeight;

  const fontOptions =
    primary && !(FONT_OPTIONS as readonly string[]).includes(primary.style.fontFamily)
      ? [primary.style.fontFamily, ...FONT_OPTIONS]
      : [...FONT_OPTIONS];

  const commitSize = () => {
    const next = Number(sizeDraft);
    if (!Number.isFinite(next) || next < MIN_TEXT_SIZE_PT || next > MAX_TEXT_SIZE_PT) {
      setSizeDraft(primary ? String(primary.style.fontSizePt) : "");
      return;
    }
    if (next === primary?.style.fontSizePt) return;
    apply({ fontSizePt: next });
  };

  const stepSize = (direction: "up" | "down") => {
    if (!primary) return;
    const next = nextTextSize(primary.style.fontSizePt, direction);
    if (next !== primary.style.fontSizePt) apply({ fontSizePt: next });
  };

  const button = (
    label: string,
    pressed: boolean | undefined,
    icon: ReactNode,
    onClick: () => void,
    options?: { mixed?: boolean; disabled?: boolean },
  ) => (
    <button
      type="button"
      className="text-format-toggle"
      aria-label={label}
      aria-pressed={pressed}
      title={options?.mixed ? `${label}（多值）` : label}
      data-mixed={options?.mixed || undefined}
      disabled={disabled || options?.disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  const fontFamilyControl = (
    <select
      className="text-format-select font"
      aria-label="字体"
      title="字体"
      value={primary?.style.fontFamily ?? ""}
      disabled={disabled}
      onChange={(event) => apply({ fontFamily: event.target.value })}
    >
      {!primary && <option value="">字体</option>}
      {fontOptions.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>
  );

  const sizeControl = (
    <>
      <input
        className="text-format-size"
        aria-label="字号"
        title="字号（4–400 pt）"
        type="number"
        min={MIN_TEXT_SIZE_PT}
        max={MAX_TEXT_SIZE_PT}
        step="0.5"
        value={sizeDraft}
        disabled={disabled}
        onChange={(event) => setSizeDraft(event.target.value)}
        onBlur={commitSize}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setSizeDraft(primary ? String(primary.style.fontSizePt) : "");
            event.currentTarget.blur();
          }
        }}
      />
      <div className="text-format-steppers">
        <button
          type="button"
          aria-label="增大字号"
          title="增大字号"
          disabled={disabled || !fontSize}
          onClick={() => stepSize("up")}
        >
          +
        </button>
        <button
          type="button"
          aria-label="减小字号"
          title="减小字号"
          disabled={disabled || !fontSize}
          onClick={() => stepSize("down")}
        >
          −
        </button>
      </div>
    </>
  );

  const colorControl = (
    <input
      className="text-format-color"
      aria-label="文字颜色"
      title="文字颜色"
      type="color"
      value={normalizeHexColor(primary?.style.color ?? "#000000") ?? "#000000"}
      disabled={disabled}
      onChange={(event) => apply({ color: event.target.value })}
    />
  );

  const spacingValue = characterSpacing.mixed
    ? ""
    : characterSpacing.value === undefined
      ? ""
      : String(characterSpacing.value);
  const customSpacing =
    spacingValue !== "" && !CHARACTER_SPACING_OPTIONS.some((option) => Number(option.value) === characterSpacing.value);
  const characterSpacingControl = (
    <select
      className="text-format-select character-spacing"
      aria-label="字符间距"
      title="字符间距：负值收紧，正值拉开"
      value={spacingValue}
      data-mixed={characterSpacing.mixed || undefined}
      disabled={disabled}
      onChange={(event) => {
        const value = event.target.value;
        apply({ letterSpacingPt: value === "" ? undefined : Number(value) });
      }}
    >
      {characterSpacing.mixed ? (
        <option value="">多值</option>
      ) : spacingValue === "" ? (
        <option value="">默认</option>
      ) : null}
      {customSpacing && <option value={spacingValue}>{spacingValue} pt</option>}
      {CHARACTER_SPACING_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const characterControls = (
    <>
      {button("加粗", bold.mixed ? false : bold.value, <Bold />, () => apply({ bold: !bold.value }), {
        mixed: bold.mixed,
      })}
      {button("斜体", italic.mixed ? false : italic.value, <Italic />, () => apply({ italic: !italic.value }), {
        mixed: italic.mixed,
      })}
      {button(
        "下划线",
        underline.mixed ? false : underline.value,
        <Underline />,
        () => apply({ underline: !underline.value }),
        { mixed: underline.mixed },
      )}
      {button(
        "删除线",
        strike.mixed ? false : strike.value,
        <Strikethrough />,
        () => apply({ strikethrough: !strike.value }),
        { mixed: strike.mixed },
      )}
    </>
  );

  const clearFormatControl = button("清除格式", false, <Eraser />, () => {
    if (editable.length === 0) return;
    execute({
      type: "clear-text-format",
      slideId,
      elementIds: editable.map((element) => element.id) as ElementId[],
    });
  });

  const horizontalAlignControls = (
    <div className="text-format-segmented" role="group" aria-label="水平对齐">
      {(
        [
          ["left", "左对齐", <AlignLeft key="left" />],
          ["center", "居中", <AlignCenter key="center" />],
          ["right", "右对齐", <AlignRight key="right" />],
        ] as const
      ).map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={align.value === value}
          className={align.value === value ? "active" : undefined}
          disabled={disabled}
          onClick={() => apply({ align: value })}
        >
          {icon}
        </button>
      ))}
    </div>
  );

  const verticalAlignControls = (
    <div className="text-format-segmented" role="group" aria-label="垂直对齐">
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
          aria-label={label}
          aria-pressed={vertical.value === value}
          className={vertical.value === value ? "active" : undefined}
          disabled={disabled}
          onClick={() => apply({ verticalAlign: value })}
        >
          {icon}
        </button>
      ))}
    </div>
  );

  const lineHeightControl = (
    <select
      className="text-format-select spacing"
      aria-label="行距"
      title="行距"
      value={lineHeight === undefined ? "" : String(lineHeight)}
      disabled={disabled}
      onChange={(event) => apply({ lineHeight: event.target.value === "" ? undefined : Number(event.target.value) })}
    >
      <option value="">行距</option>
      <option value="1">1.0</option>
      <option value="1.15">1.15</option>
      <option value="1.5">1.5</option>
      <option value="2">2.0</option>
    </select>
  );

  const paragraphControls = (
    <>
      {button(
        "项目符号",
        bullet.mixed ? false : bullet.value === "dot",
        <List />,
        () => apply({ bullet: bullet.value === "dot" ? "none" : "dot" }),
        { mixed: bullet.mixed },
      )}
      {button(
        "编号",
        bullet.mixed ? false : bullet.value === "number",
        <ListOrdered />,
        () => apply({ bullet: bullet.value === "number" ? "none" : "number" }),
        { mixed: bullet.mixed },
      )}
      {button(
        "减少缩进",
        false,
        <IndentDecrease />,
        () => apply({ indentLevel: Math.max(MIN_INDENT, indentLevel - 1) }),
        { disabled: indentLevel <= MIN_INDENT },
      )}
      {button(
        "增加缩进",
        false,
        <IndentIncrease />,
        () => apply({ indentLevel: Math.min(MAX_INDENT, indentLevel + 1) }),
        { disabled: indentLevel >= MAX_INDENT },
      )}
    </>
  );

  const painterControl = (
    <button
      type="button"
      className="text-format-toggle"
      aria-label="格式刷"
      aria-pressed={Boolean(painter)}
      title="格式刷：单击复制一次，双击锁定连续应用，Esc 取消"
      disabled={disabled}
      onClick={() => {
        if (!primary) return;
        copyFormat(normalizeTextFormat(primary.style), false);
      }}
      onDoubleClick={() => {
        if (!primary) return;
        copyFormat(normalizeTextFormat(primary.style), true);
      }}
    >
      <Paintbrush />
    </button>
  );

  return (
    <div
      className={`text-format-tools section-${section}`}
      role="group"
      aria-label={section === "font" ? "字符格式" : section === "paragraph" ? "段落格式" : "文本格式"}
    >
      {section === "font" ? (
        <>
          <div className="text-format-row">
            {fontFamilyControl}
            {sizeControl}
            {colorControl}
          </div>
          <div className="text-format-row">
            {characterControls}
            {characterSpacingControl}
            <span className="text-format-divider" />
            {clearFormatControl}
          </div>
        </>
      ) : section === "paragraph" ? (
        <>
          <div className="text-format-row">
            {horizontalAlignControls}
            {verticalAlignControls}
            {lineHeightControl}
          </div>
          <div className="text-format-row">{paragraphControls}</div>
        </>
      ) : (
        <>
          <div className="text-format-row">
            {fontFamilyControl}
            {sizeControl}
            <span className="text-format-divider" />
            {characterControls}
            {characterSpacingControl}
            {colorControl}
          </div>
          <div className="text-format-row">
            {horizontalAlignControls}
            {verticalAlignControls}
            {lineHeightControl}
            {paragraphControls}
            {clearFormatControl}
            {painterControl}
          </div>
        </>
      )}
    </div>
  );
}
