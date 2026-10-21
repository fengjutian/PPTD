/**
 * Shared color math for readability decisions.
 *
 * The command layer, the visual quality gate and the rendered-pixel inspector all
 * need the same notion of "is this text readable on that background". Keeping one
 * implementation avoids three slightly different thresholds drifting apart.
 */

export function parseHexColor(value: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const color = Number.parseInt(match[1]!, 16);
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

export function colorLuminance(value: string): number | undefined {
  const rgb = parseHexColor(value);
  return rgb ? relativeLuminance(rgb) : undefined;
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const first = colorLuminance(foreground);
  const second = colorLuminance(background);
  if (first === undefined || second === undefined) return undefined;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Contrast against a background whose luminance is known but whose hue is not.
 *
 * The background value is a WCAG relative luminance, the same quantity
 * `colorLuminance` returns. It must not be expanded from sRGB a second time:
 * doing that turned a mid tone artwork into an almost black one and let
 * unreadable text pass the gate.
 */
export function contrastRatioAgainstLuminance(foreground: string, backgroundLuminance: number): number | undefined {
  const first = colorLuminance(foreground);
  if (first === undefined) return undefined;
  return (Math.max(first, backgroundLuminance) + 0.05) / (Math.min(first, backgroundLuminance) + 0.05);
}

export const MINIMUM_CONTRAST = 4.5;
export const MINIMUM_LARGE_TEXT_CONTRAST = 3;

/**
 * The range of relative luminance the artwork shows under one placeholder.
 *
 * A single average hides the patches that actually carry the text, and the
 * generator and the pixel gate then disagree about the same page. The range is
 * sampled the same way in both places so an ink that is accepted while
 * generating is also accepted by the gate.
 */
export interface BackgroundRange {
  /** Luminance of the darker patch the text may sit on. */
  darkest: number;
  /** Luminance of the lighter patch the text may sit on. */
  lightest: number;
}

/** WCAG large-text threshold: 24pt, or 18.66pt when bold. */
export function isLargeText(fontSizePt: number, bold: boolean): boolean {
  return fontSizePt >= 24 || (bold && fontSizePt >= 18.66);
}

export function requiredContrast(fontSizePt: number, bold: boolean): number {
  return isLargeText(fontSizePt, bold) ? MINIMUM_LARGE_TEXT_CONTRAST : MINIMUM_CONTRAST;
}

/** True when the ink stays readable on every patch of the background range. */
export function readableAcrossRange(ink: string, range: BackgroundRange, large = false): boolean {
  const threshold = large ? MINIMUM_LARGE_TEXT_CONTRAST : MINIMUM_CONTRAST;
  const darkest = contrastRatioAgainstLuminance(ink, range.darkest) ?? 0;
  const lightest = contrastRatioAgainstLuminance(ink, range.lightest) ?? 0;
  return darkest >= threshold && lightest >= threshold;
}

function hexToHsl(value: string): { h: number; s: number; l: number } | undefined {
  const rgb = parseHexColor(value);
  if (!rgb) return undefined;
  const red = rgb[0] / 255;
  const green = rgb[1] / 255;
  const blue = rgb[2] / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return { h: hue, s: saturation, l: lightness };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const table = [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary], [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]];
  const parts = table[sector]!.map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"));
  return `#${parts.join("")}`.toUpperCase();
}

/**
 * Moves a colour away from the background until it reads, keeping its hue so a
 * brand accent stays a brand accent instead of collapsing into plain black.
 */
function adjustForContrast(value: string, backgroundLuminance: number, threshold: number): string | undefined {
  const hsl = hexToHsl(value);
  // A neutral colour has no hue to preserve; the caller decides instead.
  if (!hsl || hsl.s < 0.15) return undefined;
  const direction = backgroundLuminance < 0.45 ? 1 : -1;
  for (let step = 1; step <= 20; step += 1) {
    const lightness = Math.min(1, Math.max(0, hsl.l + (direction * step * 0.05)));
    const candidate = hslToHex(hsl.h, hsl.s, lightness);
    const ratio = contrastRatioAgainstLuminance(candidate, backgroundLuminance);
    if (ratio !== undefined && ratio >= threshold) return candidate;
  }
  return undefined;
}

/**
 * Keeps the requested color when it is readable on the carrying background and
 * otherwise falls back to a readable ink. Callers pass the ink that preserves
 * their own hierarchy (a strong title ink and a softer body ink) so that fixing
 * contrast does not flatten the page into one flat colour.
 */
export function readableTextColor(preferred: string, backgroundLuminance: number, large = false, fallback?: string): string {
  const threshold = large ? MINIMUM_LARGE_TEXT_CONTRAST : MINIMUM_CONTRAST;
  const ratio = contrastRatioAgainstLuminance(preferred, backgroundLuminance);
  if (ratio !== undefined && ratio >= threshold) return preferred;
  const adjusted = adjustForContrast(preferred, backgroundLuminance, threshold);
  if (adjusted) return adjusted;
  const candidates = [fallback, backgroundLuminance < 0.45 ? "#FFFFFF" : "#1A1D23", "#FFFFFF", "#1A1D23"].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const candidateRatio = contrastRatioAgainstLuminance(candidate, backgroundLuminance);
    if (candidateRatio !== undefined && candidateRatio >= threshold) return candidate;
  }
  return candidates[0] ?? "#1A1D23";
}

/**
 * Darkens a fill until the given ink reads on it. A badge that carries white
 * numerals needs a fill dark enough to hold them, and the brand colour is
 * kept for as long as it can carry the ink.
 */
export function fillForInk(ink: string, fill: string, large = false): string {
  const threshold = large ? MINIMUM_LARGE_TEXT_CONTRAST : MINIMUM_CONTRAST;
  const ratio = contrastRatio(ink, fill);
  if (ratio !== undefined && ratio >= threshold) return fill;
  const hsl = hexToHsl(fill);
  if (!hsl) return fill;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = hslToHex(hsl.h, hsl.s, Math.max(0, hsl.l - step * 0.05));
    const candidateRatio = contrastRatio(ink, candidate);
    if (candidateRatio !== undefined && candidateRatio >= threshold) return candidate;
  }
  return fill;
}

/**
 * Keeps the requested ink when it reads on every patch of the artwork that
 * carries it, and otherwise falls back to an ink that does. The hue of a
 * branded colour survives the correction.
 */
export function readableTextColorOnRange(preferred: string, range: BackgroundRange, large = false, fallback?: string): string {
  if (readableAcrossRange(preferred, range, large)) return preferred;
  const adjusted = adjustForContrastOnRange(preferred, range, large);
  if (adjusted) return adjusted;
  const candidates = [fallback, range.darkest < 0.45 ? "#FFFFFF" : "#1A1D23", "#FFFFFF", "#1A1D23"].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (readableAcrossRange(candidate, range, large)) return candidate;
  }
  return candidates[0] ?? "#1A1D23";
}

/**
 * Moves the ink away from the artwork until it reads across the whole range.
 * A light ink is pushed lighter, a dark one darker, so the hue of a brand
 * colour is kept.
 */
function adjustForContrastOnRange(value: string, range: BackgroundRange, large: boolean): string | undefined {
  const hsl = hexToHsl(value);
  // A neutral colour has no hue to preserve; the caller decides instead.
  if (!hsl || hsl.s < 0.15) return undefined;
  const direction = (colorLuminance(value) ?? 0) > 0.45 ? 1 : -1;
  for (let step = 1; step <= 20; step += 1) {
    const lightness = Math.min(1, Math.max(0, hsl.l + (direction * step * 0.05)));
    const candidate = hslToHex(hsl.h, hsl.s, lightness);
    if (readableAcrossRange(candidate, range, large)) return candidate;
  }
  return undefined;
}
