import type { DocumentTextStyles, DocumentTheme } from "../document-model";
import { deriveSemanticColors, type SemanticColors } from "./design-tokens";

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
  overrides: Partial<SemanticColors> = {},
): DocumentTheme {
  /**
   * The four semantic roles are derived from the preset's own surface, ink and
   * accent, then written into the theme.
   *
   * Writing them once means every consumer — the page builder, the theme
   * picker, a future export — reads the same four values instead of each
   * deriving its own tint. The derivation is the same function a template page
   * uses, so a preset deck and a template deck cannot drift apart on what
   * "raised" or "border" means.
   */
  const semantic = {
    ...deriveSemanticColors({
      surface: colors.surface ?? "#FFFFFF",
      ink: colors.primary ?? "#1A1A1A",
      accent: colors.accent ?? "#1F4E79",
    }),
    ...overrides,
  };
  return {
    name,
    majorFont,
    minorFont,
    colors: [...Object.entries(colors), ...Object.entries(semantic)].map(([slot, value]) => ({
      name: slot,
      value,
    })),
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
        accent2: "#B36A3C",
        accent3: "#D6A84B",
        muted: "#6F7B85",
        surface: "#FBFAF7",
        surfaceAlt: "#EEF3EC",
      },
      scale(44, 30, 18, 16, 11, 0.8),
    ),
  },
  {
    id: "blue-white-porcelain",
    name: "青花瓷韵",
    description: "鱼肚白底、青灰正文、靛青与花青强调；适合传统文化、瓷器艺术与人文课程。",
    theme: theme(
      "青花瓷韵",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#2B333E",
        accent: "#1661AB",
        accent2: "#2376B7",
        accent3: "#D6A01D",
        muted: "#5E7987",
        surface: "#F7F4ED",
        surfaceAlt: "#D0DFE6",
      },
      scale(44, 31, 18, 16, 11, 0.8),
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
        accent2: "#3A78A1",
        accent3: "#D59B43",
        muted: "#5F6B76",
        surface: "#FFFFFF",
        surfaceAlt: "#EAF5F2",
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
        accent2: "#2E75B6",
        accent3: "#C59A4A",
        muted: "#5B6B7F",
        surface: "#FFFFFF",
        surfaceAlt: "#EAF0F7",
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
        accent2: "#6F7F54",
        accent3: "#C58E68",
        muted: "#7A6A5A",
        surface: "#F7F3EC",
        surfaceAlt: "#EDE3D5",
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
        accent2: "#06A6C8",
        accent3: "#7357D8",
        muted: "#5B6B7F",
        surface: "#F7F9FC",
        surfaceAlt: "#E8F0FF",
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
        accent2: "#486A67",
        accent3: "#C65D3B",
        muted: "#6B6459",
        surface: "#FFFFFF",
        surfaceAlt: "#F6F0E3",
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
        accent2: "#3B82A0",
        accent3: "#71A85A",
        muted: "#5F7A75",
        surface: "#F6FBFA",
        surfaceAlt: "#E2F4F0",
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
        accent2: "#C98324",
        accent3: "#6E5944",
        muted: "#6E5A55",
        surface: "#FFFFFF",
        surfaceAlt: "#FAECE8",
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
        accent2: "#E3A629",
        accent3: "#7657C8",
        muted: "#7A6A5A",
        surface: "#FFF9F2",
        surfaceAlt: "#FCE8D5",
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
        accent2: "#4D8FA8",
        accent3: "#D59A32",
        muted: "#64756A",
        surface: "#F7FBF3",
        surfaceAlt: "#E8F3DF",
      },
      scale(42, 30, 18, 16, 11, 0.6),
    ),
  },
  {
    id: "academic-indigo",
    name: "学术靛",
    description: "暖白底、深靛与砖红、宋体标题；适合论文答辩、课题汇报与学术会议。",
    theme: theme(
      "学术靛",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#1B2436",
        accent: "#2E4A7D",
        accent2: "#6B7F9E",
        accent3: "#9C4A32",
        muted: "#5B6577",
        surface: "#FCFBF8",
        surfaceAlt: "#E9EDF4",
      },
      scale(42, 30, 18, 16, 11, 0.6),
    ),
  },
  {
    id: "minimal-gray",
    name: "极简灰",
    description: "纯白与灰阶、无彩强调、黑体紧排；适合作品集、极简提案与高端品牌。",
    theme: theme(
      "极简灰",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#1A1A1A",
        accent: "#333333",
        accent2: "#8A8A8A",
        accent3: "#B08A4F",
        muted: "#666666",
        surface: "#FFFFFF",
        surfaceAlt: "#F2F2F2",
      },
      scale(40, 28, 17, 16, 11, 0),
    ),
  },
  {
    id: "legal-burgundy",
    name: "法务酒红",
    description: "象牙白底、酒红与深灰、宋体标题；适合法律、合规、审计与风控材料。",
    theme: theme(
      "法务酒红",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#241C1E",
        accent: "#7B2D3B",
        accent2: "#4A4E5A",
        accent3: "#A67A46",
        muted: "#6A5B5E",
        surface: "#FFFCF8",
        surfaceAlt: "#F3E7E7",
      },
      scale(42, 30, 18, 16, 11, 0.6),
    ),
  },
  {
    id: "fashion-rose",
    name: "时尚玫",
    description: "暖白底、炭黑与玫红、黑体大字；适合时尚、美妆、消费品牌与生活方式内容。",
    theme: theme(
      "时尚玫",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#231A1C",
        accent: "#B03A5B",
        accent2: "#D98C9E",
        accent3: "#C7A15A",
        muted: "#7A6468",
        surface: "#FFF9F7",
        surfaceAlt: "#FBE8EC",
      },
      scale(44, 31, 18, 17, 12, 0),
    ),
  },
  {
    id: "industrial-steel",
    name: "钢蓝",
    description: "冷灰底、钢蓝与安全橙、黑体紧排；适合制造、汽车、工程与供应链内容。",
    theme: theme(
      "钢蓝",
      "微软雅黑",
      "微软雅黑",
      {
        primary: "#1B242B",
        accent: "#35566B",
        accent2: "#5E7A8A",
        accent3: "#D97706",
        muted: "#5C6B75",
        surface: "#F8FAFB",
        surfaceAlt: "#E4EBEF",
      },
      scale(40, 28, 17, 16, 11, 0),
    ),
  },
  {
    id: "architecture-stone",
    name: "石筑",
    description: "暖石色底、铜棕与墨色、宋体标题；适合建筑、地产、空间与城市更新提案。",
    theme: theme(
      "石筑",
      "华文中宋",
      "微软雅黑",
      {
        primary: "#232323",
        accent: "#7A6A57",
        accent2: "#4F5D5A",
        accent3: "#B07A3F",
        muted: "#6B6259",
        surface: "#FAF8F4",
        surfaceAlt: "#EDE8E0",
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
