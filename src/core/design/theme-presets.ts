import type { DocumentTextStyles, DocumentTheme } from "../document-model";

/**
 * A built-in design system.
 *
 * A preset owns the palette, the font pairing and the type scale, so a deck
 * generated without an imported template still starts from a designed
 * hierarchy instead of the renderer's fallback numbers. The shape mirrors a
 * template theme: `DocumentTheme` is the same object a template produces, so the
 * renderer does not need a separate path for built-in themes.
 */
export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  theme: DocumentTheme;
}

function scale(display: number, title: number, subtitle: number, body: number, caption: number): DocumentTextStyles {
  return {
    display: { fontSizePt: display, bold: true },
    title: { fontSizePt: title, bold: true },
    subtitle: { fontSizePt: subtitle },
    body: { fontSizePt: body },
    caption: { fontSizePt: caption },
  };
}

function theme(
  name: string,
  majorFont: string,
  minorFont: string,
  colors: Record<string, string>,
  textStyles: DocumentTextStyles,
): DocumentTheme {
  return {
    name,
    majorFont,
    minorFont,
    colors: Object.entries(colors).map(([slot, value]) => ({ name: slot, value })),
    textStyles,
  };
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "paper-ink",
    name: "纸墨",
    description: "宋体标题配黑体正文，暖白底、墨绿强调；适合人文、语文与教学课件。",
    theme: theme(
      "纸墨",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#1E2A32",
        accent: "#2F6B5F",
        muted: "#6F7B85",
        surface: "#FBFAF7",
      },
      scale(44, 30, 18, 16, 11),
    ),
  },
  {
    id: "editorial-teal",
    name: "青编",
    description: "宋黑混排、白底青强调，克制而现代；适合通用课程与产品说明。",
    theme: theme(
      "青编",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#1E3550",
        accent: "#0F7869",
        muted: "#5F6B76",
        surface: "#FFFFFF",
      },
      scale(42, 30, 18, 17, 11),
    ),
  },
  {
    id: "consulting-navy",
    name: "藏青",
    description: "全黑体、深藏青强调、字号收敛；适合汇报、方案与尽调材料。",
    theme: theme(
      "藏青",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#12233D",
        accent: "#1F4E79",
        muted: "#5B6B7F",
        surface: "#FFFFFF",
      },
      scale(40, 28, 17, 16, 11),
    ),
  },
  {
    id: "warm-paper",
    name: "素纸",
    description: "米白纸感、赭石强调、字号偏大；适合讲座、展陈与叙事型内容。",
    theme: theme(
      "素纸",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#2C2620",
        accent: "#A8642E",
        muted: "#7A6A5A",
        surface: "#F7F3EC",
      },
      scale(46, 32, 19, 17, 12),
    ),
  },
];

/** The preset a template-less deck starts from when nothing else is chosen. */
export const DEFAULT_THEME_PRESET_ID = "editorial-teal";

export function findThemePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

export function defaultThemePreset(): ThemePreset {
  return findThemePreset(DEFAULT_THEME_PRESET_ID) ?? THEME_PRESETS[0]!;
}
