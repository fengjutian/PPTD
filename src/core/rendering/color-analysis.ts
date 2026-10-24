/**
 * Colour classification for deterministic design review.
 *
 * The readability gate only needs contrast; the taste lint also needs to know
 * whether a colour is a deliberate accent or part of the neutral greys. Keeping
 * the conversion here avoids a second HSL implementation drifting from the
 * luminance one.
 */

import { parseHexColor } from "./contrast";

export interface Hsl {
  /** Hue in degrees, 0–360. */
  h: number;
  /** Saturation, 0–1. */
  s: number;
  /** Lightness, 0–1. */
  l: number;
}

/** Canonical `#RRGGBB` form, or undefined for names and shorthand. */
export function normalizeHexColor(value: string): string | undefined {
  const rgb = parseHexColor(value);
  if (!rgb) return undefined;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function hexToHsl(value: string): Hsl | undefined {
  const rgb = parseHexColor(value);
  if (!rgb) return undefined;
  const [red, green, blue] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return { h: hue * 60, s: saturation, l: lightness };
}

/**
 * Whether a colour reads as grey / near-black / near-white.
 *
 * Unknown values count as neutral: a colour the analysis cannot parse must not
 * inflate the accent count and turn a page into a false warning.
 */
export function isNeutralColor(value: string): boolean {
  const hsl = hexToHsl(value);
  if (!hsl) return true;
  return hsl.s < 0.12 || hsl.l > 0.95 || hsl.l < 0.08;
}
