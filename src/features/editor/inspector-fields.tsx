import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { normalizeHexColor } from "./inspector-color";

function formatNumber(value: number, precision: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(precision);
}

interface NumberFieldProps {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  precision?: number;
  /** When set, the field grows stepper buttons that commit the new value right away. */
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

/**
 * Numeric input that refuses to swallow bad input. Invalid values stay in the
 * field with an inline message instead of silently reverting to the old value.
 *
 * The label can be dragged sideways to change the value. The drag is kept in
 * the field until the pointer is released, so a long drag is one command and
 * one undo step instead of one per pixel.
 */
export function NumberField({
  label,
  value,
  unit,
  min,
  max,
  precision = 2,
  step,
  disabled,
  onCommit,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => formatNumber(value, precision));
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [scrubbing, setScrubbing] = useState<number>();
  const draftRef = useRef(draft);
  const scrubRef = useRef<{ startX: number; startValue: number; last: number } | null>(null);

  useEffect(() => {
    if (dirty) return;
    const next = formatNumber(value, precision);
    draftRef.current = next;
    setDraft(next);
  }, [value, precision, dirty]);

  const update = (next: string) => {
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
  };

  const commit = () => {
    const raw = draftRef.current.trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed)) {
      setError("请输入数字");
      return;
    }
    if (min !== undefined && parsed < min) {
      setError(`不能小于 ${min}`);
      return;
    }
    if (max !== undefined && parsed > max) {
      setError(`不能大于 ${max}`);
      return;
    }
    setError(undefined);
    setDirty(false);
    onCommit(parsed);
  };

  /**
   * Steppers commit straight away instead of waiting for a blur, so dragging
   * the value never leaves the document out of sync with the field.
   */
  const stepBy = (delta: number) => {
    if (step === undefined) return;
    let next = value + delta;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (next === value) return;
    const formatted = formatNumber(next, precision);
    draftRef.current = formatted;
    setDraft(formatted);
    setError(undefined);
    onCommit(next);
  };

  const beginScrub = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled || step === undefined) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = { startX: event.clientX, startValue: value, last: value };
    setScrubbing(value);
  };

  const moveScrub = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const start = scrubRef.current;
    if (!start || step === undefined) return;
    // Four pixels of drag are one step; Shift multiplies the step, Alt divides it.
    const pixels = event.clientX - start.startX;
    const steps = (Math.round(pixels / 4) * (event.shiftKey ? 10 : 1)) / (event.altKey ? 10 : 1);
    let next = start.startValue + steps * step;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    start.last = next;
    setScrubbing(next);
  };

  const endScrub = () => {
    const start = scrubRef.current;
    scrubRef.current = null;
    setScrubbing(undefined);
    if (!start || start.last === start.startValue) return;
    // One drag is one command, so one undo step takes the whole drag back.
    onCommit(start.last);
  };

  const shown = scrubbing === undefined ? draft : formatNumber(scrubbing, precision);

  return (
    <label className="field">
      <span
        className={`field-label${step === undefined ? "" : " scrubbable"}`}
        onPointerDown={step === undefined ? undefined : beginScrub}
        onPointerMove={step === undefined ? undefined : moveScrub}
        onPointerUp={step === undefined ? undefined : endScrub}
        onPointerCancel={step === undefined ? undefined : endScrub}
        title={step === undefined ? undefined : "按住左右拖动改值，Shift 加速，Alt 微调"}
      >
        {label}
      </span>
      <span className="field-control">
        {step !== undefined && (
          <button
            type="button"
            className="field-stepper"
            aria-label={`${label} 减少 ${step}`}
            disabled={disabled}
            onClick={() => stepBy(-step)}
          >
            <ChevronDown />
          </button>
        )}
        <span className={`field-input${unit ? " with-unit" : ""}`}>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            className={error ? "invalid" : undefined}
            value={shown}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              update(event.target.value);
              setError(undefined);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                const restored = formatNumber(value, precision);
                draftRef.current = restored;
                setDraft(restored);
                setError(undefined);
                setDirty(false);
                event.currentTarget.blur();
              }
            }}
          />
          {unit && <span className="field-unit">{unit}</span>}
        </span>
        {step !== undefined && (
          <button
            type="button"
            className="field-stepper"
            aria-label={`${label} 增加 ${step}`}
            disabled={disabled}
            onClick={() => stepBy(step)}
          >
            <ChevronUp />
          </button>
        )}
      </span>
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

interface ColorFieldProps {
  label: string;
  value: string;
  /** Renders on its own row so the hex value stays readable in a narrow panel. */
  wide?: boolean;
  /** The colors of the template, offered as one click. */
  swatches?: readonly string[];
  disabled?: boolean;
  onCommit: (hex: string) => void;
}

export function ColorField({ label, value, wide, swatches, disabled, onCommit }: ColorFieldProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(draft);

  useEffect(() => {
    if (dirty) return;
    draftRef.current = value;
    setDraft(value);
  }, [value, dirty]);

  const update = (next: string) => {
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
  };

  const commit = () => {
    const normalized = normalizeHexColor(draftRef.current);
    if (!normalized) {
      setError("请输入 #RRGGBB 颜色值");
      return;
    }
    setError(undefined);
    setDirty(false);
    onCommit(normalized);
  };

  const current = normalizeHexColor(value) ?? "";

  return (
    <label className={wide ? "field field-wide" : "field"}>
      <span className="field-label">{label}</span>
      <span className="field-control color-control">
        <input
          type="color"
          className="color-swatch"
          value={normalizeHexColor(value) ?? "#000000"}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.toLowerCase();
            update(next);
            setError(undefined);
            onCommit(next);
          }}
        />
        <span className="field-input">
          <input
            className={error ? "invalid" : undefined}
            value={draft}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              update(event.target.value);
              setError(undefined);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                draftRef.current = value;
                setDraft(value);
                setError(undefined);
                setDirty(false);
                event.currentTarget.blur();
              }
            }}
          />
        </span>
      </span>
      {swatches && swatches.length > 0 && (
        <span className="color-swatches">
          {swatches.map((color) => (
            <button
              type="button"
              key={color}
              className={`color-chip${color.toLowerCase() === current ? " active" : ""}`}
              style={{ background: color }}
              title={color}
              aria-label={`使用颜色 ${color}`}
              aria-pressed={color.toLowerCase() === current}
              disabled={disabled}
              onClick={() => {
                update(color);
                setError(undefined);
                onCommit(color);
              }}
            />
          ))}
        </span>
      )}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onCommit: (value: string) => void;
}

export function SelectField({ label, value, options, disabled, onCommit }: SelectFieldProps) {
  const known = options.includes(value);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">
        <select value={value} disabled={disabled} onChange={(event) => onCommit(event.target.value)}>
          {!known && <option value={value}>{value}</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  maxLength?: number;
  disabled?: boolean;
  onCommit: (value: string) => void;
}

export function TextField({ label, value, maxLength, disabled, onCommit }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(draft);

  useEffect(() => {
    if (dirty) return;
    draftRef.current = value;
    setDraft(value);
  }, [value, dirty]);

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">
        <input
          value={draft}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
            setDirty(true);
          }}
          onBlur={() => {
            setDirty(false);
            onCommit(draftRef.current);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}
