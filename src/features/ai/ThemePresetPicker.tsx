import { THEME_PRESETS } from "../../core/design/theme-presets";
import type { CSSProperties } from "react";

export interface ThemePresetPickerProps {
  /** The selected preset id. */
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * A row of visual design systems to start from when no template is imported.
 *
 * The preview is made of the preset's own colours, so the choice can be made
 * without generating a page first. It is a radio group rather than a select:
 * the palette is the decision, and a swatch shows it faster than a name.
 */
export function ThemePresetPicker({ value, onChange, disabled = false }: ThemePresetPickerProps) {
  return (
    <div
      className="theme-card-grid"
      role="radiogroup"
      aria-label="视觉主题"
    >
      {THEME_PRESETS.map((preset) => {
        const selected = preset.id === value;
        const color = (slot: string) => preset.theme.colors.find((entry) => entry.name === slot)?.value;
        const surface = color("surface") ?? "#FFFFFF";
        const accent = color("accent") ?? "#000000";
        const primary = color("primary") ?? "#000000";
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            className={`theme-card${selected ? " active" : ""}`}
            aria-checked={selected}
            aria-label={preset.name}
            disabled={disabled}
            onClick={() => onChange(preset.id)}
            style={{ "--card-accent": accent, opacity: disabled ? 0.6 : 1 } as CSSProperties}
          >
            <span className="theme-card-art" aria-hidden style={{ background: surface }}>
              <i style={{ background: primary }} />
              <i style={{ background: accent }} />
              <i style={{ background: accent }} />
            </span>
            <span className="theme-card-palette" aria-hidden>
              <span
                style={{ background: surface }}
              />
              <span style={{ background: accent }} />
              <span style={{ background: primary }} />
            </span>
            <strong>{preset.name}</strong>
            <small>{preset.description}</small>
            <span className="theme-card-fonts">
              {preset.theme.majorFont} · {preset.theme.minorFont}
            </span>
          </button>
        );
      })}
    </div>
  );
}
