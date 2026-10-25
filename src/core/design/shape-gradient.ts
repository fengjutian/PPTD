import type { ShapeFillGradient } from "../document-model";
import { parseHexColor } from "../rendering/contrast";

type Rgb = [number, number, number];

function toHex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Mix two hex colors in sRGB. `amount` 0 keeps `from`, 1 returns `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const first = parseHexColor(from) ?? [0, 0, 0];
  const second = parseHexColor(to) ?? [0, 0, 0];
  const t = Math.max(0, Math.min(1, amount));
  return toHex([0, 1, 2].map((index) => first[index]! + (second[index]! - first[index]!) * t) as Rgb);
}

/**
 * The gradient of a theme's large accent panel.
 *
 * Three stops, not two: a light shoulder, the brand accent and a deeper edge.
 * The middle stop keeps the theme color dominant while the ends give the panel
 * a soft light direction like a printed cover.
 */
export function accentPanelGradient(accent: string): ShapeFillGradient {
  return {
    angleDeg: 45,
    stops: [
      { offset: 0, color: mixHex(accent, "#FFFFFF", 0.18) },
      { offset: 0.52, color: accent },
      { offset: 1, color: mixHex(accent, "#000000", 0.3) },
    ],
  };
}

/** CSS `linear-gradient()` for the editor; CSS 0deg points up, DrawingML 0 points right. */
export function gradientCss(gradient: ShapeFillGradient): string {
  const stops = [...gradient.stops]
    .sort((first, second) => first.offset - second.offset)
    .map((stop) => `${rgba(stop.color, stop.transparency)} ${(stop.offset * 100).toFixed(2)}%`)
    .join(", ");
  return `linear-gradient(${(gradient.angleDeg + 90) % 360}deg, ${stops})`;
}

/** Canvas/SVG endpoints for the DrawingML angle convention. */
export function gradientLinePoints(
  angleDeg: number,
  width: number,
  height: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  return {
    x1: width / 2 - dx * half,
    y1: height / 2 - dy * half,
    x2: width / 2 + dx * half,
    y2: height / 2 + dy * half,
  };
}

/** A hex color with PowerPoint-style transparency (0–100) as CSS rgba. */
export function rgba(color: string, transparency = 0): string {
  const [red, green, blue] = parseHexColor(color) ?? [0, 0, 0];
  const alpha = Math.max(0, Math.min(1, 1 - transparency / 100));
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
}
