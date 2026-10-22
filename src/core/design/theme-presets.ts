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

function scale(
  display: number,
  title: number,
  subtitle: number,
  body: number,
  caption: number,
  titleTracking = 0.4,
): DocumentTextStyles {
  return {
    display: { fontSizePt: display, bold: true },
    title: { fontSizePt: title, bold: true, letterSpacingPt: titleTracking },
    subtitle: { fontSizePt: subtitle },
    body: { fontSizePt: body, lineHeight: 1.3 },
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
      scale(44, 30, 18, 16, 11, 0.8),
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
      scale(42, 30, 18, 17, 11, 0.6),
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
      scale(40, 28, 17, 16, 11, 0),
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
      scale(46, 32, 19, 17, 12, 0.8),
    ),
  },
  {
    id: "tech-blue",
    name: "科技蓝",
    description: "冷白底、深蓝与电光蓝、黑体紧排；适合产品、技术与互联网内容。",
    theme: theme(
      "科技蓝",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#0B1F3A",
        accent: "#2563EB",
        muted: "#5B6B7F",
        surface: "#F7F9FC",
      },
      scale(40, 28, 17, 16, 11, 0),
    ),
  },
  {
    id: "finance-gold",
    name: "金融金",
    description: "白底、墨黑与哑金强调、宋体标题；适合年报、投融资与策略材料。",
    theme: theme(
      "金融金",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#1C1C1C",
        accent: "#A67C2E",
        muted: "#6B6459",
        surface: "#FFFFFF",
      },
      scale(42, 30, 18, 16, 11, 0.6),
    ),
  },
  {
    id: "medical-teal",
    name: "医疗青",
    description: "浅青白底、深青与松石绿、黑体清晰；适合医疗、健康与科普内容。",
    theme: theme(
      "医疗青",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#123B36",
        accent: "#0E8C7F",
        muted: "#5F7A75",
        surface: "#F6FBFA",
      },
      scale(40, 28, 17, 16, 11, 0.2),
    ),
  },
  {
    id: "gov-red",
    name: "政务红",
    description: "白底、墨色与朱红强调、宋体标题；适合政务、党建与公共事务内容。",
    theme: theme(
      "政务红",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#2A1A16",
        accent: "#A62B1F",
        muted: "#6E5A55",
        surface: "#FFFFFF",
      },
      scale(42, 30, 18, 16, 11, 0.6),
    ),
  },
  {
    id: "creative-orange",
    name: "创意橙",
    description: "暖白底、炭黑与橙红、字号跳跃；适合创意提案、品牌与活动内容。",
    theme: theme(
      "创意橙",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#2B2118",
        accent: "#E0662A",
        muted: "#7A6A5A",
        surface: "#FFF9F2",
      },
      scale(44, 32, 18, 17, 12, 0),
    ),
  },
  {
    id: "education-green",
    name: "教育绿",
    description: "浅草白底、墨绿强调、宋体标题；适合课程、校园与培训内容。",
    theme: theme(
      "教育绿",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#1F3322",
        accent: "#3E7C44",
        muted: "#64756A",
        surface: "#F7FBF3",
      },
      scale(42, 30, 18, 16, 11, 0.6),
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
