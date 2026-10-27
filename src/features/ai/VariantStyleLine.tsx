import { findThemePreset, themePresetSwatches } from "../../core/design/theme-presets";

/**
 * Which template a candidate was laid out with.
 *
 * The batch picks a theme preset for every version, but the card only names the
 * style profile and the concept ("商务专业 · 编辑式年报"). Without the preset
 * the reader cannot tell which of the four templates they are looking at — the
 * pages alone do not say whether the colours came from 法务酒红 or 金融金. The
 * name, palette and font pairing travel with each card and with the enlarged
 * preview, and are omitted when the id is not a built-in preset (an AI design
 * direction, for example, has no preset to name).
 */
export function VariantStyleLine({ presetId }: { presetId: string }) {
  const preset = findThemePreset(presetId);
  if (!preset) return null;
  const swatches = themePresetSwatches(preset);
  return (
    <span className="variant-style-line">
      <span className="variant-style-swatches" aria-hidden="true">
        {swatches.map((color) => (
          <i key={color.slot} style={{ background: color.value }} />
        ))}
      </span>
      <span className="variant-style-copy">
        模板「{preset.name}」· {preset.theme.majorFont}标题 / {preset.theme.minorFont}正文
      </span>
    </span>
  );
}
