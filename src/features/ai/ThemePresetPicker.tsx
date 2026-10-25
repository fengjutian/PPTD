import { useState, type CSSProperties } from "react";
import { Images } from "lucide-react";
import { THEME_PRESETS } from "../../core/design/theme-presets";
import { ThemeSpecimenDialog } from "./ThemeSpecimenDialog";

export interface ThemePresetPickerProps {
  /** The selected preset id. */
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * A row of visual design systems to start from when no template is imported.
 *
 * The card shows the palette; the specimen shows what the preset does to eight
 * real page roles. The specimen is rendered on demand — building every preset
 * deck up front would spend a second of the user's time before they asked.
 */
export function ThemePresetPicker({ value, onChange, disabled = false }: ThemePresetPickerProps) {
  const [specimenPresetId, setSpecimenPresetId] = useState<string>();

  return (
    <>
      <div className="theme-card-grid" role="radiogroup" aria-label="视觉主题">
        {THEME_PRESETS.map((preset) => {
          const selected = preset.id === value;
          const color = (slot: string) => preset.theme.colors.find((entry) => entry.name === slot)?.value;
          const surface = color("surface") ?? "#FFFFFF";
          const accent = color("accent") ?? "#000000";
          const accent2 = color("accent2") ?? accent;
          const accent3 = color("accent3") ?? accent2;
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
                <span style={{ background: surface }} />
                <span style={{ background: accent }} />
                <span style={{ background: accent2 }} />
                <span style={{ background: accent3 }} />
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
      {value && (
        <button
          type="button"
          className="theme-specimen-open"
          onClick={() => setSpecimenPresetId(value)}
          disabled={disabled}
        >
          <Images size={14} />
          查看「{THEME_PRESETS.find((preset) => preset.id === value)?.name ?? "当前主题"}」8 页样张
        </button>
      )}

      {specimenPresetId && (
        <ThemeSpecimenDialog presetId={specimenPresetId} onClose={() => setSpecimenPresetId(undefined)} />
      )}
    </>
  );
}
