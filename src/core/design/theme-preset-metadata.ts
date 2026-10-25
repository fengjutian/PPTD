export type ThemeAudience = "general" | "education" | "executive" | "professional" | "public" | "consumer";
export type ThemeContentDensity = "airy" | "balanced" | "compact";
export type ThemePageType =
  "cover" | "section" | "narrative" | "comparison" | "metrics" | "table" | "chart" | "image" | "summary";

/** Structured art direction consumed by the picker and the design-agent prompt. */
export interface ThemePresetMetadata {
  character: string;
  scenarios: readonly string[];
  audiences: readonly ThemeAudience[];
  recommendedPageTypes: readonly ThemePageType[];
  density: ThemeContentDensity;
  fontFallbacks: { latin: readonly string[]; eastAsian: readonly string[] };
  pageRhythm: string;
  imageStyle: string;
  chartPalette: readonly string[];
  forbiddenCombinations: readonly string[];
}

const latin = ["Aptos", "Arial", "Calibri"] as const;
const sansCjk = ["微软雅黑", "等线", "宋体"] as const;
const serifCjk = ["华文中宋", "宋体", "微软雅黑"] as const;
const generalPages = ["cover", "section", "narrative", "comparison", "metrics", "chart", "summary"] as const;
const dataPages = ["cover", "section", "comparison", "metrics", "table", "chart", "summary"] as const;

export const THEME_PRESET_METADATA: Readonly<Record<string, ThemePresetMetadata>> = {
  "paper-ink": {
    character: "温润、克制、有人文书卷气，强调原文与观点之间的呼吸感。",
    scenarios: ["语文课件", "古典文学", "人文讲座", "阅读分享"],
    audiences: ["education", "general"],
    recommendedPageTypes: ["cover", "section", "narrative", "comparison", "image", "summary"],
    density: "airy",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "暖白内容页为主，以墨绿章节页和赭石重点页形成节奏。",
    imageStyle: "宣纸肌理、山水局部、古籍细节或自然光摄影，避免科技感图库。",
    chartPalette: ["#2F6B5F", "#B36A3C", "#D6A84B", "#6F7B85"],
    forbiddenCombinations: ["霓虹渐变", "大面积纯黑背景", "科技感线框插画"],
  },
  "blue-white-porcelain": {
    character: "清雅、含蓄、疏朗，以瓷白留白和青花层次传达东方秩序感。",
    scenarios: ["传统文化", "瓷器艺术", "博物馆课程", "古典文学"],
    audiences: ["education", "general"],
    recommendedPageTypes: ["cover", "section", "narrative", "image", "comparison", "summary"],
    density: "airy",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "鱼肚白内容页为主，以靛青章节页和远天蓝图文页形成节奏。",
    imageStyle: "青花瓷器局部、器物纹样、博物馆实拍和柔和自然光静物，避免满版纹样与仿古滤镜。",
    chartPalette: ["#1661AB", "#2376B7", "#D6A01D", "#5E7987"],
    forbiddenCombinations: ["满版重复纹样", "高饱和霓虹色", "仿古滤镜叠字"],
  },
  "editorial-teal": {
    character: "清爽、理性、编辑感强，兼顾课程内容与现代产品表达。",
    scenarios: ["通用课程", "产品说明", "知识分享", "内部培训"],
    audiences: ["general", "education", "professional"],
    recommendedPageTypes: generalPages,
    density: "balanced",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "浅色内容页配青色重点页，穿插蓝色证据页和金色结论标记。",
    imageStyle: "自然光实景、简洁人物或几何抽象插图，画面留有文字空间。",
    chartPalette: ["#0F7869", "#3A78A1", "#D59B43", "#5F6B76"],
    forbiddenCombinations: ["连续三页同构卡片", "大面积近黑背景", "图片内生成文字"],
  },
  "consulting-navy": {
    character: "严谨、专业、结构明确，适合结论先行与证据支撑。",
    scenarios: ["经营汇报", "战略方案", "咨询报告", "项目路演"],
    audiences: ["executive", "professional"],
    recommendedPageTypes: dataPages,
    density: "compact",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "浅灰蓝内容页为主，蓝色章节页与金色关键结论页交替出现。",
    imageStyle: "建筑、团队、行业场景与高质量数据可视化，避免装饰性插画。",
    chartPalette: ["#1F4E79", "#2E75B6", "#C59A4A", "#5B6B7F"],
    forbiddenCombinations: ["卡通插画", "无结论的数据堆叠", "连续深色内容页"],
  },
  "warm-paper": {
    character: "温暖、松弛、叙事性强，适合让故事和人物成为视觉中心。",
    scenarios: ["主题讲座", "文化展陈", "人物故事", "旅行叙事"],
    audiences: ["general", "consumer"],
    recommendedPageTypes: ["cover", "section", "narrative", "image", "comparison", "summary"],
    density: "airy",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "米白叙事页、赭石章节页与灰绿图片页交替，留白相对充足。",
    imageStyle: "胶片感摄影、手作纹理、局部特写和低饱和自然场景。",
    chartPalette: ["#A8642E", "#6F7F54", "#C58E68", "#7A6A5A"],
    forbiddenCombinations: ["冷色霓虹", "密集仪表盘", "锐利科技线条"],
  },
  "tech-blue": {
    character: "清晰、锐利、未来感适中，突出系统、能力与增长。",
    scenarios: ["技术方案", "产品发布", "AI 应用", "互联网业务"],
    audiences: ["professional", "executive", "consumer"],
    recommendedPageTypes: generalPages,
    density: "balanced",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "冷白内容页配电光蓝章节页，青色流程页和紫色创新页形成变化。",
    imageStyle: "真实设备、数据空间、精细 3D 或光感抽象图，避免廉价霓虹。",
    chartPalette: ["#2563EB", "#06A6C8", "#7357D8", "#5B6B7F"],
    forbiddenCombinations: ["廉价霓虹光效", "满页代码雨", "低对比度蓝字蓝底"],
  },
  "finance-gold": {
    character: "稳健、可信、精致，以克制金色传达价值与秩序。",
    scenarios: ["年度报告", "投资分析", "融资路演", "财富管理"],
    audiences: ["executive", "professional"],
    recommendedPageTypes: dataPages,
    density: "compact",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "白色数据页为主，哑金结论页与墨绿色分析页作为视觉节点。",
    imageStyle: "城市、产业、材质与专业人物摄影，避免金币和钞票等直白意象。",
    chartPalette: ["#A67C2E", "#486A67", "#C65D3B", "#6B6459"],
    forbiddenCombinations: ["金币钞票素材", "亮黄色大面积填充", "装饰性 3D 图表"],
  },
  "medical-teal": {
    character: "洁净、可信、友好，兼顾专业信息与公众可理解性。",
    scenarios: ["医学科普", "医院汇报", "健康教育", "药械介绍"],
    audiences: ["professional", "public", "general"],
    recommendedPageTypes: generalPages,
    density: "balanced",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "浅青内容页为主，深青章节页、蓝色证据页和绿色行动页交替。",
    imageStyle: "真实医疗环境、健康生活与科学插图，避免惊悚病理图片。",
    chartPalette: ["#0E8C7F", "#3B82A0", "#71A85A", "#5F7A75"],
    forbiddenCombinations: ["惊悚病理图片", "未经标注的诊断结论", "红绿作为唯一编码"],
  },
  "gov-red": {
    character: "庄重、清晰、有公共表达的秩序感，避免过度装饰。",
    scenarios: ["政策解读", "政务汇报", "党建学习", "公共事务"],
    audiences: ["public", "professional"],
    recommendedPageTypes: dataPages,
    density: "balanced",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "白色正文页配朱红章节页，金色重点页与棕色历史页适量穿插。",
    imageStyle: "公共服务、城市建设与真实工作场景，保持正式、明亮和可信。",
    chartPalette: ["#A62B1F", "#C98324", "#6E5944", "#6E5A55"],
    forbiddenCombinations: ["娱乐化贴纸", "过度金色装饰", "连续满版红底"],
  },
  "creative-orange": {
    character: "鲜活、开放、富有提案感，强调观点碰撞与视觉记忆点。",
    scenarios: ["品牌提案", "营销活动", "创意概念", "新品策划"],
    audiences: ["consumer", "executive", "general"],
    recommendedPageTypes: ["cover", "section", "narrative", "comparison", "image", "metrics", "summary"],
    density: "balanced",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "暖白内容页配橙色主张页，黄色机会页和紫色创意页制造跳跃。",
    imageStyle: "大胆裁切、拼贴、材质和高质量生活方式摄影，允许适度反差。",
    chartPalette: ["#E0662A", "#E3A629", "#7657C8", "#7A6A5A"],
    forbiddenCombinations: ["所有页面同时高饱和", "超过三种装饰语言", "正文使用展示字体"],
  },
  "education-green": {
    character: "自然、亲和、清楚，适合循序渐进的学习路径。",
    scenarios: ["课程课件", "校园活动", "教师培训", "学习成果"],
    audiences: ["education", "general"],
    recommendedPageTypes: generalPages,
    density: "balanced",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "浅草白内容页为主，绿色章节页、蓝色知识页与金色提示页交替。",
    imageStyle: "课堂、校园、自然观察和扁平知识插图，避免严肃商务图库。",
    chartPalette: ["#3E7C44", "#4D8FA8", "#D59A32", "#64756A"],
    forbiddenCombinations: ["严肃商务图库", "过密小字", "只用颜色表达对错"],
  },
  "academic-indigo": {
    character: "严谨、克制、有研究感，以深靛与砖红区分论证结构与结论。",
    scenarios: ["论文答辩", "课题汇报", "学术会议", "研究报告"],
    audiences: ["education", "professional"],
    recommendedPageTypes: dataPages,
    density: "balanced",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "暖白正文页为主，深靛章节页与砖红结论页形成论证节奏。",
    imageStyle: "实验场景、档案文献、研究设备与建筑摄影，避免装饰性插画。",
    chartPalette: ["#2E4A7D", "#6B7F9E", "#9C4A32", "#5B6577"],
    forbiddenCombinations: ["花哨渐变", "卡通图标", "满页引文堆叠"],
  },
  "minimal-gray": {
    character: "安静、克制、以留白和字重建立秩序，几乎不依赖颜色。",
    scenarios: ["作品集", "品牌手册", "极简提案", "摄影集"],
    audiences: ["consumer", "general", "executive"],
    recommendedPageTypes: ["cover", "section", "narrative", "image", "comparison", "summary"],
    density: "airy",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "纯白内容页与灰阶图文页交替，黄铜只做低频标记。",
    imageStyle: "黑白或低饱和摄影、材质特写和大面积留白，避免多彩装饰图形。",
    chartPalette: ["#333333", "#8A8A8A", "#B08A4F", "#666666"],
    forbiddenCombinations: ["多彩渐变", "装饰性图标", "浅灰正文"],
  },
  "legal-burgundy": {
    character: "庄重、审慎、条款感强，酒红只用于结论与风险提示。",
    scenarios: ["法律意见", "合规培训", "审计报告", "风控汇报"],
    audiences: ["executive", "professional", "public"],
    recommendedPageTypes: dataPages,
    density: "compact",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "象牙白正文页配酒红章节页，深灰证据页与铜色结论页穿插。",
    imageStyle: "建筑、档案、签约与办公场景，避免法槌等直白法律图库。",
    chartPalette: ["#7B2D3B", "#4A4E5A", "#A67A46", "#6A5B5E"],
    forbiddenCombinations: ["戏剧化红底", "法槌图库", "密集小字条款"],
  },
  "fashion-rose": {
    character: "明快、精致、有编辑大片感，用大字与玫红制造记忆点。",
    scenarios: ["时尚发布", "美妆新品", "消费品牌", "生活方式"],
    audiences: ["consumer", "general"],
    recommendedPageTypes: ["cover", "section", "narrative", "comparison", "image", "metrics", "summary"],
    density: "balanced",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "暖白内容页配玫红主张页，浅粉图文页与金色细节页制造跳跃。",
    imageStyle: "时尚大片、产品特写与柔和布光的人像，避免促销贴纸和高饱和渐变。",
    chartPalette: ["#B03A5B", "#D98C9E", "#C7A15A", "#7A6468"],
    forbiddenCombinations: ["促销爆炸贴", "过度粉色渐变", "正文使用装饰字体"],
  },
  "industrial-steel": {
    character: "硬朗、精确、工程感强，以冷灰和钢蓝突出结构与参数。",
    scenarios: ["制造工艺", "汽车项目", "工程方案", "供应链"],
    audiences: ["professional", "executive"],
    recommendedPageTypes: dataPages,
    density: "compact",
    fontFallbacks: { latin, eastAsian: sansCjk },
    pageRhythm: "冷灰内容页配钢蓝章节页，安全橙只用于参数与风险提示。",
    imageStyle: "工厂产线、机械细节、工程图纸与冷调摄影，避免卡通汽车和廉价霓虹。",
    chartPalette: ["#35566B", "#5E7A8A", "#D97706", "#5C6B75"],
    forbiddenCombinations: ["卡通汽车", "霓虹科技蓝", "装饰性渐变"],
  },
  "architecture-stone": {
    character: "沉静、有结构感、材质导向，用暖石色与铜棕承载空间叙事。",
    scenarios: ["建筑方案", "地产定位", "室内设计", "城市更新"],
    audiences: ["executive", "professional", "consumer"],
    recommendedPageTypes: ["cover", "section", "narrative", "comparison", "image", "metrics", "summary"],
    density: "balanced",
    fontFallbacks: { latin, eastAsian: serifCjk },
    pageRhythm: "暖石色内容页配墨色章节页，铜棕用于图纸与关键指标。",
    imageStyle: "建筑摄影、混凝土与木石材质、轴测图，避免亮面金色和卡通渲染。",
    chartPalette: ["#7A6A57", "#4F5D5A", "#B07A3F", "#6B6259"],
    forbiddenCombinations: ["亮面金色", "卡通渲染", "满版效果图叠字"],
  },
};

const fallback: ThemePresetMetadata = {
  character: "清晰、统一、以内容层级为先。",
  scenarios: ["通用演示"],
  audiences: ["general"],
  recommendedPageTypes: generalPages,
  density: "balanced",
  fontFallbacks: { latin, eastAsian: sansCjk },
  pageRhythm: "内容页与重点页交替，避免连续页面使用同一骨架。",
  imageStyle: "选择与主题直接相关、构图简洁且不含文字的视觉素材。",
  chartPalette: ["#2563EB", "#0F7869", "#D59B43", "#5F6B76"],
  forbiddenCombinations: ["低对比度文字", "连续同构页面", "图片内生成文字"],
};

export function themePresetMetadata(id: string): ThemePresetMetadata {
  return THEME_PRESET_METADATA[id] ?? fallback;
}
