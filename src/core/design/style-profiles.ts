import type { ConceptPresetId, RecipeId } from "./deck-concept";
import type { ThemeDirection } from "./theme-direction";

export type StyleProfileId =
  | "minimal"
  | "corporate"
  | "futuristic"
  | "editorial"
  | "academic"
  | "infographic"
  | "organic"
  | "luxury";

export type StyleDensity = "airy" | "balanced" | "compact";
export type StyleImageMedium = "photo" | "illustration" | "3d" | "texture";

/**
 * A user-facing visual language assembled from capabilities the renderer owns.
 * Profiles contain no copy or coordinates: applying one is always a design-only
 * choice and cannot silently alter reviewed content.
 */
export interface StyleProfile {
  id: StyleProfileId;
  name: string;
  englishName: string;
  summary: string;
  suitableFor: readonly string[];
  themePresetId: string;
  preferredConcept: ConceptPresetId;
  allowedConcepts: readonly ConceptPresetId[];
  preferredRecipes: readonly RecipeId[];
  density: StyleDensity;
  imagery: {
    media: readonly StyleImageMedium[];
    guidance: string;
  };
  visualTraits: readonly string[];
  forbidden: readonly string[];
  specimen: {
    background: string;
    ink: string;
    accent: string;
    secondary: string;
    composition: "minimal" | "grid" | "hero" | "editorial" | "paper" | "data" | "organic" | "luxury";
  };
}

export const STYLE_PROFILES: readonly StyleProfile[] = [
  {
    id: "minimal",
    name: "极简主义",
    englishName: "Minimal",
    summary: "以留白、克制字阶和少量细线建立清晰层级。",
    suitableFor: ["产品介绍", "作品集", "品牌展示"],
    themePresetId: "minimal-gray",
    preferredConcept: "editorial",
    allowedConcepts: ["editorial", "paper"],
    preferredRecipes: ["cover-statement", "asymmetric-split", "section-statement"],
    density: "airy",
    imagery: { media: ["photo"], guidance: "低饱和摄影、材质特写和大面积留白，主体清晰。" },
    visualTraits: ["大留白", "低饱和", "细线"],
    forbidden: ["多彩渐变", "装饰性图标", "连续卡片阵列"],
    specimen: { background: "#F7F7F5", ink: "#202326", accent: "#85898D", secondary: "#D7D8D6", composition: "minimal" },
  },
  {
    id: "corporate",
    name: "商务专业",
    englishName: "Corporate",
    summary: "结论先行，使用严谨网格承载数据、比较与行动项。",
    suitableFor: ["经营汇报", "咨询报告", "项目路演"],
    themePresetId: "consulting-navy",
    preferredConcept: "instrument",
    allowedConcepts: ["instrument", "editorial"],
    preferredRecipes: ["instrument-columns", "data-story", "chart-story", "comparison"],
    density: "compact",
    imagery: { media: ["photo"], guidance: "真实行业、建筑与团队场景，避免无意义装饰图。" },
    visualTraits: ["严谨网格", "结论先行", "数据清晰"],
    forbidden: ["卡通插画", "无结论的数据堆叠", "连续深色页"],
    specimen: { background: "#F4F7FA", ink: "#12233E", accent: "#2E75B6", secondary: "#C59A4A", composition: "grid" },
  },
  {
    id: "futuristic",
    name: "未来科技",
    englishName: "Futuristic",
    summary: "深色空间、锐利字阶与克制光感，突出系统和能力。",
    suitableFor: ["AI 产品", "技术方案", "数字化转型"],
    themePresetId: "tech-blue",
    preferredConcept: "instrument",
    allowedConcepts: ["instrument", "documentary"],
    preferredRecipes: ["instrument-columns", "process-rail", "chart-story", "full-bleed-image"],
    density: "balanced",
    imagery: { media: ["photo", "3d"], guidance: "真实设备、数据空间、精细 3D 或克制光感抽象图。" },
    visualTraits: ["深色空间", "光感图像", "系统线框"],
    forbidden: ["廉价霓虹", "满页代码雨", "低对比蓝字蓝底"],
    specimen: { background: "#081426", ink: "#F2F7FF", accent: "#2F6BFF", secondary: "#19BCD1", composition: "hero" },
  },
  {
    id: "editorial",
    name: "杂志编辑",
    englishName: "Editorial",
    summary: "使用大标题、错落图文与鲜明节奏组织品牌故事。",
    suitableFor: ["品牌故事", "行业洞察", "人物介绍"],
    themePresetId: "editorial-teal",
    preferredConcept: "editorial",
    allowedConcepts: ["editorial", "documentary"],
    preferredRecipes: ["editorial-index", "image-led", "side-image-text", "quote-field"],
    density: "balanced",
    imagery: { media: ["photo"], guidance: "有编辑构图的纪实或人物摄影，保留可供标题进入的负空间。" },
    visualTraits: ["大标题", "错落图文", "章节节奏"],
    forbidden: ["同构卡片墙", "图片内生成文字", "平均分栏"],
    specimen: { background: "#F3F0E8", ink: "#1E292B", accent: "#0F7869", secondary: "#D59B43", composition: "editorial" },
  },
  {
    id: "academic",
    name: "学术科研",
    englishName: "Academic",
    summary: "克制排版承载论证、图表、公式与引用来源。",
    suitableFor: ["论文答辩", "研究报告", "技术讲解"],
    themePresetId: "academic-indigo",
    preferredConcept: "paper",
    allowedConcepts: ["paper", "instrument"],
    preferredRecipes: ["paper-column", "chart-story", "timeline-rail", "quote-field"],
    density: "balanced",
    imagery: { media: ["photo", "illustration"], guidance: "实验场景、研究设备、文献细节与准确科学图示。" },
    visualTraits: ["论证层级", "来源清晰", "克制注释"],
    forbidden: ["花哨渐变", "卡通图标", "装饰性大图"],
    specimen: { background: "#F6F3EC", ink: "#20283A", accent: "#2E4A7D", secondary: "#9C4A32", composition: "paper" },
  },
  {
    id: "infographic",
    name: "信息图表",
    englishName: "Infographic",
    summary: "用数字、流程、时间线和原生图表解释复杂关系。",
    suitableFor: ["数据报告", "业务分析", "培训课件"],
    themePresetId: "consulting-navy",
    preferredConcept: "instrument",
    allowedConcepts: ["instrument", "editorial"],
    preferredRecipes: ["data-story", "chart-story", "process-rail", "timeline-rail"],
    density: "compact",
    imagery: { media: ["illustration"], guidance: "简洁扁平的信息插图，只用于解释关系，不替代真实图表。" },
    visualTraits: ["数字驱动", "流程清晰", "直接标注"],
    forbidden: ["装饰性 3D 图表", "图例远离数据", "过量图标"],
    specimen: { background: "#F5F7F9", ink: "#17314D", accent: "#2E75B6", secondary: "#E09A31", composition: "data" },
  },
  {
    id: "organic",
    name: "自然有机",
    englishName: "Organic",
    summary: "温暖纸色、自然材质和舒展图片形成亲和叙事。",
    suitableFor: ["可持续发展", "健康生活", "文化教育"],
    themePresetId: "warm-paper",
    preferredConcept: "documentary",
    allowedConcepts: ["documentary", "paper"],
    preferredRecipes: ["image-led", "full-bleed-image", "paper-column", "quote-field"],
    density: "airy",
    imagery: { media: ["photo", "texture"], guidance: "自然光、植物、手作材质和低饱和生活场景。" },
    visualTraits: ["自然材质", "温暖留白", "柔和节奏"],
    forbidden: ["冷色霓虹", "密集仪表盘", "锐利科技线条"],
    specimen: { background: "#F5F0E5", ink: "#334438", accent: "#6F7F54", secondary: "#B9784D", composition: "organic" },
  },
  {
    id: "luxury",
    name: "高端品牌",
    englishName: "Luxury",
    summary: "以克制深色、精致字阶和高质量摄影传达价值感。",
    suitableFor: ["高端品牌", "精品地产", "投资路演"],
    themePresetId: "finance-gold",
    preferredConcept: "documentary",
    allowedConcepts: ["documentary", "editorial"],
    preferredRecipes: ["cover-statement", "full-bleed-image", "asymmetric-split", "quote-field"],
    density: "airy",
    imagery: { media: ["photo"], guidance: "建筑、材质和产品特写，使用克制布光与充足负空间。" },
    visualTraits: ["克制金色", "精致字阶", "大片摄影"],
    forbidden: ["亮黄大面积填充", "金币意象", "繁复装饰边框"],
    specimen: { background: "#171714", ink: "#F4EFE5", accent: "#B08A4F", secondary: "#706A5E", composition: "luxury" },
  },
] as const;

export function findStyleProfile(id: string | undefined): StyleProfile | undefined {
  return STYLE_PROFILES.find((profile) => profile.id === id);
}

/** Adds the selected visual language to the model-facing theme contract. */
export function applyStyleProfileToThemeDirection(
  direction: ThemeDirection | undefined,
  profile: StyleProfile | undefined,
): ThemeDirection | undefined {
  if (!direction || !profile) return direction;
  return {
    ...direction,
    character: `${profile.name}：${profile.summary} ${direction.character}`,
    pageRhythm: `优先使用${profile.preferredConcept}构图；${profile.visualTraits.join("、")}。${direction.pageRhythm}`,
    imageStyle: `${profile.imagery.guidance} ${direction.imageStyle}`,
    density: profile.density,
    forbiddenCombinations: [...new Set([...direction.forbiddenCombinations, ...profile.forbidden])],
  };
}
