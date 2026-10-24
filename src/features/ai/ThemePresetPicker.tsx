import { useEffect, useState, type CSSProperties } from "react";
import { Images, X } from "lucide-react";
import { THEME_PRESETS } from "../../core/design/theme-presets";
import { renderPresentationForVisualReview } from "../../services/presentation-renderer";
import { buildSpecimenDocument } from "../../services/theme-specimen";

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
 * real page roles. The specimen is rendered on demand — building all eleven
 * decks up front would spend a second of the user's time before they asked.
 */
export function ThemePresetPicker({ value, onChange, disabled = false }: ThemePresetPickerProps) {
  const [specimen, setSpecimen] = useState<{ presetId: string; images?: string[]; failed?: boolean }>();
  const specimenPreset = specimen ? THEME_PRESETS.find((preset) => preset.id === specimen.presetId) : undefined;

  useEffect(() => {
    if (!specimen || specimen.images || specimen.failed) return;
    let cancelled = false;
    void (async () => {
      try {
        const document = buildSpecimenDocument({ themePresetId: specimen.presetId });
        const rendered = await renderPresentationForVisualReview(document, 480);
        if (!cancelled) setSpecimen({ presetId: specimen.presetId, images: rendered.slides });
      } catch {
        // The palette card is still a usable fallback; never leave a blank modal.
        if (!cancelled) setSpecimen({ presetId: specimen.presetId, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [specimen]);

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
          onClick={() => setSpecimen({ presetId: value })}
          disabled={disabled}
        >
          <Images size={14} />
          查看「{THEME_PRESETS.find((preset) => preset.id === value)?.name ?? "当前主题"}」8 页样张
        </button>
      )}

      {specimen && (
        <div
          className="upload-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSpecimen(undefined);
          }}
        >
          <section
            className="upload-dialog theme-specimen-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="theme-specimen-title"
          >
            <div className="upload-dialog-heading">
              <div>
                <Images />
                <div>
                  <h2 id="theme-specimen-title">主题样张</h2>
                  <p>{specimenPreset?.name ?? "当前主题"} · 封面、章节、正文、指标、表格、图表、图片、结论</p>
                </div>
              </div>
              <button type="button" aria-label="关闭主题样张" onClick={() => setSpecimen(undefined)}>
                <X />
              </button>
            </div>
            {specimen.failed ? (
              <p className="field-help">样张渲染失败；仍可按色板与字体描述判断这套主题。</p>
            ) : specimen.images ? (
              <div className="theme-specimen-grid">
                {specimen.images.map((source, index) => (
                  <img
                    key={`${specimen.presetId}-${index}`}
                    src={source}
                    alt={`${specimenPreset?.name ?? "主题"} 第 ${index + 1} 页`}
                  />
                ))}
              </div>
            ) : (
              <p className="field-help">正在渲染 8 页样张…</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
