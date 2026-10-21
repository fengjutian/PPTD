import { useEffect, useRef, useState } from "react";

const HEX_PATTERN = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalizes `#abc` / `abc` / `#aabbcc` into the `#aabbcc` form the schema and exporter accept. */
function normalizeHexColor(raw: string): string | undefined {
  const value = raw.trim();
  if (!HEX_PATTERN.test(value)) return undefined;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  const full = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  return `#${full.toLowerCase()}`;
}

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
  disabled?: boolean;
  onCommit: (value: number) => void;
}

/**
 * Numeric input that refuses to swallow bad input. Invalid values stay in the
 * field with an inline message instead of silently reverting to the old value.
 */
export function NumberField({ label, value, unit, min, max, precision = 2, disabled, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState(() => formatNumber(value, precision));
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(draft);

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

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">
        <input
          type="number"
          inputMode="decimal"
          className={error ? "invalid" : undefined}
          value={draft}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => { update(event.target.value); setError(undefined); }}
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
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

interface ColorFieldProps {
  label: string;
  value: string;
  /** Renders on its own row so the hex value stays readable in a narrow panel. */
  wide?: boolean;
  disabled?: boolean;
  onCommit: (hex: string) => void;
}

export function ColorField({ label, value, wide, disabled, onCommit }: ColorFieldProps) {
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
        <input
          className={error ? "invalid" : undefined}
          value={draft}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => { update(event.target.value); setError(undefined); }}
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
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
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
          onChange={(event) => { draftRef.current = event.target.value; setDraft(event.target.value); setDirty(true); }}
          onBlur={() => { setDirty(false); onCommit(draftRef.current); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}
