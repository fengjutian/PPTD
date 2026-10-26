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
  | "luxury"
  | "swiss"
  | "keynote"
  | "brutalist"
  | "zen"
  | "bauhaus"
  | "hand-drawn"
  | "government"
  | "industrial";

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
    specimen: {
      background: "#F7F7F5",
      ink: "#202326",
      accent: "#85898D",
      secondary: "#D7D8D6",
      composition: "minimal",
    },
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
    specimen: {
      background: "#F3F0E8",
      ink: "#1E292B",
      accent: "#0F7869",
      secondary: "#D59B43",
      composition: "editorial",
    },
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
    specimen: {
      background: "#F5F0E5",
      ink: "#334438",
      accent: "#6F7F54",
      secondary: "#B9784D",
      composition: "organic",
    },
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
  {
    id: "swiss",
    name: "瑞士国际",
    englishName: "Swiss International",
    summary: "严格网格、无衬线字阶和强对齐形成理性的信息秩序。",
    suitableFor: ["设计提案", "品牌策略", "信息可视化"],
    themePresetId: "minimal-gray",
    preferredConcept: "editorial",
    allowedConcepts: ["editorial", "instrument"],
    preferredRecipes: ["editorial-index", "asymmetric-split", "comparison", "timeline-rail"],
    density: "balanced",
    imagery: { media: ["photo"], guidance: "高对比纪实摄影或几何裁切，图片边缘服从统一网格。" },
    visualTraits: ["严格网格", "强对齐", "无衬线"],
    forbidden: ["随意旋转", "柔和装饰阴影", "不对齐的悬浮卡片"],
    specimen: { background: "#F5F5F2", ink: "#16191C", accent: "#D43A2F", secondary: "#8B9095", composition: "grid" },
  },
  {
    id: "keynote",
    name: "产品发布",
    englishName: "Keynote",
    summary: "超大观点、产品大图和短文案构成具有舞台感的发布节奏。",
    suitableFor: ["新品发布", "软件演示", "融资路演"],
    themePresetId: "tech-blue",
    preferredConcept: "documentary",
    allowedConcepts: ["documentary", "editorial"],
    preferredRecipes: ["cover-statement", "full-bleed-image", "section-statement", "data-story"],
    density: "airy",
    imagery: { media: ["photo", "3d"], guidance: "单一产品主体、简洁环境与明确光向，保留大面积舞台空间。" },
    visualTraits: ["超大观点", "产品主角", "舞台节奏"],
    forbidden: ["长段正文", "多产品同页争抢", "密集装饰"],
    specimen: { background: "#07101F", ink: "#F7FAFF", accent: "#3979F6", secondary: "#98B8F8", composition: "hero" },
  },
  {
    id: "brutalist",
    name: "粗野主义",
    englishName: "Brutalist",
    summary: "粗大字形、高反差色块和非对称切分制造直接冲击。",
    suitableFor: ["创意机构", "艺术展览", "青年活动"],
    themePresetId: "creative-orange",
    preferredConcept: "editorial",
    allowedConcepts: ["editorial", "documentary"],
    preferredRecipes: ["cover-statement", "asymmetric-split", "editorial-index", "image-led"],
    density: "balanced",
    imagery: { media: ["photo", "texture"], guidance: "高反差裁切、印刷颗粒和直接闪光摄影，保留原始质感。" },
    visualTraits: ["粗大字形", "高反差", "非对称"],
    forbidden: ["柔弱低对比", "精致奢华边框", "平均三栏"],
    specimen: {
      background: "#F3E52B",
      ink: "#111111",
      accent: "#E64A25",
      secondary: "#2157C9",
      composition: "editorial",
    },
  },
  {
    id: "zen",
    name: "日式禅意",
    englishName: "Zen",
    summary: "克制色彩、细腻留白和安静节奏承载文化与生活美学。",
    suitableFor: ["文化艺术", "茶道生活", "个人品牌"],
    themePresetId: "paper-ink",
    preferredConcept: "paper",
    allowedConcepts: ["paper", "documentary"],
    preferredRecipes: ["paper-column", "quote-field", "side-image-text", "section-statement"],
    density: "airy",
    imagery: { media: ["photo", "texture"], guidance: "自然光静物、器物局部、纸张与木石肌理，构图安静疏朗。" },
    visualTraits: ["安静留白", "细腻材质", "克制色彩"],
    forbidden: ["高饱和撞色", "密集信息板", "厚重阴影"],
    specimen: { background: "#F2EFE7", ink: "#2D332E", accent: "#65745C", secondary: "#B18B68", composition: "paper" },
  },
  {
    id: "bauhaus",
    name: "包豪斯",
    englishName: "Bauhaus",
    summary: "基础色、几何构成和功能主义网格建立鲜明视觉记忆。",
    suitableFor: ["设计教育", "创意提案", "视觉实验"],
    themePresetId: "creative-orange",
    preferredConcept: "editorial",
    allowedConcepts: ["editorial", "instrument"],
    preferredRecipes: ["cover-statement", "process-rail", "comparison", "editorial-index"],
    density: "balanced",
    imagery: { media: ["illustration"], guidance: "使用圆、方、线等简洁几何关系，图形服务于信息结构。" },
    visualTraits: ["基础色", "几何构成", "功能主义"],
    forbidden: ["仿真材质", "复杂渐变", "无功能装饰"],
    specimen: { background: "#F2E9D7", ink: "#171717", accent: "#D63B2E", secondary: "#2457A6", composition: "data" },
  },
  {
    id: "hand-drawn",
    name: "手绘插画",
    englishName: "Hand-drawn",
    summary: "轻松线条、知识插图和清晰步骤营造亲切的讲解感。",
    suitableFor: ["教学课件", "儿童科普", "头脑风暴"],
    themePresetId: "education-green",
    preferredConcept: "editorial",
    allowedConcepts: ["editorial", "paper"],
    preferredRecipes: ["process-rail", "timeline-rail", "comparison", "side-image-text"],
    density: "balanced",
    imagery: { media: ["illustration"], guidance: "统一笔触的扁平手绘插图，轮廓清楚且不在图片内生成文字。" },
    visualTraits: ["手绘线条", "亲切讲解", "步骤清晰"],
    forbidden: ["写实与卡通混搭", "图片内文字", "幼稚贴纸堆叠"],
    specimen: {
      background: "#F6F5E9",
      ink: "#26392C",
      accent: "#4E8853",
      secondary: "#E0A13A",
      composition: "organic",
    },
  },
  {
    id: "government",
    name: "政务庄重",
    englishName: "Government",
    summary: "正式层级、稳定版心和克制红金表达公共事务的秩序感。",
    suitableFor: ["政策解读", "政务汇报", "公共事务"],
    themePresetId: "gov-red",
    preferredConcept: "instrument",
    allowedConcepts: ["instrument", "paper"],
    preferredRecipes: ["instrument-columns", "data-story", "timeline-rail", "paper-column"],
    density: "balanced",
    imagery: { media: ["photo"], guidance: "公共服务、城市建设和真实工作场景，保持明亮、正式和可信。" },
    visualTraits: ["正式层级", "稳定版心", "公共表达"],
    forbidden: ["娱乐化贴纸", "过量金色装饰", "连续满版红底"],
    specimen: { background: "#FAF7F0", ink: "#312725", accent: "#A62B1F", secondary: "#C98324", composition: "grid" },
  },
  {
    id: "industrial",
    name: "工业工程",
    englishName: "Industrial",
    summary: "冷灰、钢蓝与参数化结构突出工程精度和实施路径。",
    suitableFor: ["制造工艺", "工程方案", "供应链汇报"],
    themePresetId: "industrial-steel",
    preferredConcept: "instrument",
    allowedConcepts: ["instrument", "documentary"],
    preferredRecipes: ["instrument-columns", "process-rail", "data-story", "side-image-text"],
    density: "compact",
    imagery: { media: ["photo"], guidance: "工厂产线、机械细节、工程图纸与冷调工业摄影。" },
    visualTraits: ["参数结构", "工程精度", "冷调摄影"],
    forbidden: ["卡通机械", "廉价科技蓝", "装饰性渐变"],
    specimen: { background: "#EEF1F2", ink: "#25343D", accent: "#35566B", secondary: "#D97706", composition: "data" },
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
