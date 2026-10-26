import { colorLuminance, contrastRatio } from "../rendering/contrast";
import { mixHex } from "./shape-gradient";

/**
 * The colours a native chart is drawn with on one page.
 *
 * A chart bar is a *fill*, not an ink. Reusing the page's accent ink — which is
 * light on a dark page — painted white bars on navy, and the accent-ink rule was
 * written for marks like a rule or a numeral. The series colour therefore comes
 * from the background: a deep accent on a light page, the accent lifted towards
 * white on a dark one, so a bar reads as the brand colour in both cases.
 *
 * The grid is a hairline on the page, not a table ruling: it is derived from the
 * page colour at low strength, which is what made a hard-coded `#E3E7EC` look
 * like a ladder on a dark deck.
 */
export interface ChartPageColors {
  background: string;
  accent: string;
  accentStrong?: string;
  accent2?: string;
  accent3?: string;
  border?: string;
}

/** One fill per series, in theme order. */
export function chartSeriesColors(colors: ChartPageColors, seriesCount: number): string[] {
  const dark = (colorLuminance(colors.background) ?? 1) < 0.45;
  const base = dark ? mixHex(colors.accent, "#FFFFFF", 0.45) : (colors.accentStrong ?? colors.accent);
  const second = colors.accent2 ?? mixHex(base, colors.background, dark ? 0.3 : 0.25);
  const third = colors.accent3 ?? mixHex(base, colors.background, dark ? 0.5 : 0.45);
  const palette = [base, second, third];
  return Array.from({ length: Math.max(1, seriesCount) }, (_, index) => palette[index % palette.length]!);
}

/** The grid line of the plot area: the page colour nudged, never a fixed grey. */
export function chartGridColor(background: string): string {
  const dark = (colorLuminance(background) ?? 1) < 0.45;
  return mixHex(background, dark ? "#FFFFFF" : "#000000", dark ? 0.14 : 0.08);
}

/**
 * Whether the series palette separates from the page well enough to be seen.
 *
 * A chart that cannot be read is worse than a chart in the wrong colour, so the
 * exporter reports this instead of silently drawing a nearly invisible one.
 */
export function chartPaletteReadable(series: readonly string[], background: string): boolean {
  return series.every((color) => (contrastRatio(color, background) ?? 0) >= 1.3);
}
