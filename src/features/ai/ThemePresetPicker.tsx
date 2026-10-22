import { THEME_PRESETS } from "../../core/design/theme-presets";

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
      role="radiogroup"
      aria-label="视觉主题"
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}
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
            aria-checked={selected}
            aria-label={preset.name}
            disabled={disabled}
            onClick={() => onChange(preset.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "10px",
              textAlign: "left",
              border: selected ? `2px solid ${accent}` : "1px solid rgba(120,130,140,0.35)",
              borderRadius: "10px",
              background: "transparent",
              color: "inherit",
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <span aria-hidden style={{ display: "flex", gap: "4px", height: "18px" }}>
              <span style={{ flex: 1, background: surface, border: "1px solid rgba(120,130,140,0.3)", borderRadius: "4px" }} />
              <span style={{ width: "22px", background: accent, borderRadius: "4px" }} />
              <span style={{ width: "22px", background: primary, borderRadius: "4px" }} />
            </span>
            <strong style={{ fontSize: "13px" }}>{preset.name}</strong>
            <small style={{ fontSize: "11px", opacity: 0.72, lineHeight: 1.4 }}>{preset.description}</small>
            <span style={{ fontSize: "10px", opacity: 0.55 }}>{preset.theme.majorFont} · {preset.theme.minorFont}</span>
          </button>
        );
      })}
    </div>
  );
}
