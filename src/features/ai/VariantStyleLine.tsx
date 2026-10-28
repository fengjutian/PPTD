import { findThemePreset, themePresetSwatches } from "../../core/design/theme-presets";

/** What each swatch means, so the strip is a palette and not four colours. */
const SLOT_LABELS: Record<string, string> = {
  surface: "页面底色",
  accent: "主强调",
  accent2: "次强调",
  accent3: "第三色",
};

/**
 * Which template a candidate was laid out with.
 *
 * The batch picks a theme preset for every version, but the card only names the
 * style profile and the concept ("商务专业 · 编辑式年报"). Without the preset
 * the reader cannot tell which of the four templates they are looking at — the
 * pages alone do not say whether the colours came from 法务酒红 or 金融金.
 *
 * A gallery card is one column of a three-up grid, so it carries only the
 * palette and the template name. The enlarged preview has room for the preset's
 * own one-line description and the font pairing, which is what makes the two
 * templates with similar names ("编辑式年报" / "编辑式商务年报") tell apart.
 * Nothing is invented when the id is not a built-in preset: an AI design
 * direction has no template to name and renders no strip.
 */
export function VariantStyleLine({ presetId, detail = false }: { presetId: string; detail?: boolean }) {
  const preset = findThemePreset(presetId);
  if (!preset) return null;
  const swatches = themePresetSwatches(preset);
  return (
    <span className={`variant-style-line${detail ? " detail" : ""}`}>
      <span className="variant-style-palette" aria-hidden="true">
        {swatches.map((color) => (
          <i key={color.slot} style={{ background: color.value }} title={SLOT_LABELS[color.slot]} />
        ))}
      </span>
      <span className="variant-style-copy">
        <strong>模板「{preset.name}」</strong>
        {detail && <small>{preset.description}</small>}
      </span>
      {detail && (
        <span className="variant-style-fonts">
          标题 <b>{preset.theme.majorFont}</b> · 正文 <b>{preset.theme.minorFont}</b>
        </span>
      )}
    </span>
  );
}
