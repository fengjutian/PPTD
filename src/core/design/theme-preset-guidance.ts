export interface ThemePresetGuidance {
  character: string;
  scenarios: readonly string[];
  pageRhythm: string;
  imageStyle: string;
}

const GUIDANCE: Readonly<Record<string, ThemePresetGuidance>> = {
  "paper-ink": {
    character: "温润、克制、有人文书卷气，强调原文与观点之间的呼吸感。",
    scenarios: ["语文课件", "古典文学", "人文讲座", "阅读分享"],
    pageRhythm: "暖白内容页为主，以墨绿章节页和赭石重点页形成节奏。",
    imageStyle: "宣纸肌理、山水局部、古籍细节或自然光摄影，避免科技感图库。",
  },
  "blue-white-porcelain": {
    character: "清雅、含蓄、疏朗，以瓷白留白和青花层次传达东方秩序感。",
    scenarios: ["传统文化", "瓷器艺术", "博物馆课程", "古典文学"],
    pageRhythm: "鱼肚白内容页为主，以靛青章节页和远天蓝图文页形成节奏；土黄只用于低频结论标记。",
    imageStyle: "青花瓷器局部、器物纹样、博物馆实拍和柔和自然光静物，避免满版纹样与仿古滤镜。",
  },
  "editorial-teal": {
    character: "清爽、理性、编辑感强，兼顾课程内容与现代产品表达。",
    scenarios: ["通用课程", "产品说明", "知识分享", "内部培训"],
    pageRhythm: "浅色内容页配青色重点页，穿插蓝色证据页和金色结论标记。",
    imageStyle: "自然光实景、简洁人物或几何抽象插图，画面留有文字空间。",
  },
  "consulting-navy": {
    character: "严谨、专业、结构明确，适合结论先行与证据支撑。",
    scenarios: ["经营汇报", "战略方案", "咨询报告", "项目路演"],
    pageRhythm: "浅灰蓝内容页为主，蓝色章节页与金色关键结论页交替出现。",
    imageStyle: "建筑、团队、行业场景与高质量数据可视化，避免装饰性插画。",
  },
  "warm-paper": {
    character: "温暖、松弛、叙事性强，适合让故事和人物成为视觉中心。",
    scenarios: ["主题讲座", "文化展陈", "人物故事", "旅行叙事"],
    pageRhythm: "米白叙事页、赭石章节页与灰绿图片页交替，留白相对充足。",
    imageStyle: "胶片感摄影、手作纹理、局部特写和低饱和自然场景。",
  },
  "tech-blue": {
    character: "清晰、锐利、未来感适中，突出系统、能力与增长。",
    scenarios: ["技术方案", "产品发布", "AI 应用", "互联网业务"],
    pageRhythm: "冷白内容页配电光蓝章节页，青色流程页和紫色创新页形成变化。",
    imageStyle: "真实设备、数据空间、精细 3D 或光感抽象图，避免廉价霓虹。",
  },
  "finance-gold": {
    character: "稳健、可信、精致，以克制金色传达价值与秩序。",
    scenarios: ["年度报告", "投资分析", "融资路演", "财富管理"],
    pageRhythm: "白色数据页为主，哑金结论页与墨绿色分析页作为视觉节点。",
    imageStyle: "城市、产业、材质与专业人物摄影，避免金币和钞票等直白意象。",
  },
  "medical-teal": {
    character: "洁净、可信、友好，兼顾专业信息与公众可理解性。",
    scenarios: ["医学科普", "医院汇报", "健康教育", "药械介绍"],
    pageRhythm: "浅青内容页为主，深青章节页、蓝色证据页和绿色行动页交替。",
    imageStyle: "真实医疗环境、健康生活与科学插图，避免惊悚病理图片。",
  },
  "gov-red": {
    character: "庄重、清晰、有公共表达的秩序感，避免过度装饰。",
    scenarios: ["政策解读", "政务汇报", "党建学习", "公共事务"],
    pageRhythm: "白色正文页配朱红章节页，金色重点页与棕色历史页适量穿插。",
    imageStyle: "公共服务、城市建设与真实工作场景，保持正式、明亮和可信。",
  },
  "creative-orange": {
    character: "鲜活、开放、富有提案感，强调观点碰撞与视觉记忆点。",
    scenarios: ["品牌提案", "营销活动", "创意概念", "新品策划"],
    pageRhythm: "暖白内容页配橙色主张页，黄色机会页和紫色创意页制造跳跃。",
    imageStyle: "大胆裁切、拼贴、材质和高质量生活方式摄影，允许适度反差。",
  },
  "education-green": {
    character: "自然、亲和、清楚，适合循序渐进的学习路径。",
    scenarios: ["课程课件", "校园活动", "教师培训", "学习成果"],
    pageRhythm: "浅草白内容页为主，绿色章节页、蓝色知识页与金色提示页交替。",
    imageStyle: "课堂、校园、自然观察和扁平知识插图，避免严肃商务图库。",
  },
  "academic-indigo": {
    character: "严谨、克制、有研究感，以深靛与砖红区分论证结构与结论。",
    scenarios: ["论文答辩", "课题汇报", "学术会议", "研究报告"],
    pageRhythm: "暖白正文页为主，深靛章节页与砖红结论页形成论证节奏。",
    imageStyle: "实验场景、档案文献、研究设备与建筑摄影，避免装饰性插画。",
  },
  "minimal-gray": {
    character: "安静、克制、以留白和字重建立秩序，几乎不依赖颜色。",
    scenarios: ["作品集", "品牌手册", "极简提案", "摄影集"],
    pageRhythm: "纯白内容页与灰阶图文页交替，黄铜只做低频标记。",
    imageStyle: "黑白或低饱和摄影、材质特写和大面积留白，避免多彩装饰图形。",
  },
  "legal-burgundy": {
    character: "庄重、审慎、条款感强，酒红只用于结论与风险提示。",
    scenarios: ["法律意见", "合规培训", "审计报告", "风控汇报"],
    pageRhythm: "象牙白正文页配酒红章节页，深灰证据页与铜色结论页穿插。",
    imageStyle: "建筑、档案、签约与办公场景，避免法槌等直白法律图库。",
  },
  "fashion-rose": {
    character: "明快、精致、有编辑大片感，用大字与玫红制造记忆点。",
    scenarios: ["时尚发布", "美妆新品", "消费品牌", "生活方式"],
    pageRhythm: "暖白内容页配玫红主张页，浅粉图文页与金色细节页制造跳跃。",
    imageStyle: "时尚大片、产品特写与柔和布光的人像，避免促销贴纸和高饱和渐变。",
  },
  "industrial-steel": {
    character: "硬朗、精确、工程感强，以冷灰和钢蓝突出结构与参数。",
    scenarios: ["制造工艺", "汽车项目", "工程方案", "供应链"],
    pageRhythm: "冷灰内容页配钢蓝章节页，安全橙只用于参数与风险提示。",
    imageStyle: "工厂产线、机械细节、工程图纸与冷调摄影，避免卡通汽车和廉价霓虹。",
  },
  "architecture-stone": {
    character: "沉静、有结构感、材质导向，用暖石色与铜棕承载空间叙事。",
    scenarios: ["建筑方案", "地产定位", "室内设计", "城市更新"],
    pageRhythm: "暖石色内容页配墨色章节页，铜棕用于图纸与关键指标。",
    imageStyle: "建筑摄影、混凝土与木石材质、轴测图，避免亮面金色和卡通渲染。",
  },
};

export function themePresetGuidance(id: string): ThemePresetGuidance {
  const metadata = themePresetMetadata(id);
  return (
    GUIDANCE[id] ?? {
      character: metadata.character,
      scenarios: metadata.scenarios,
      pageRhythm: metadata.pageRhythm,
      imageStyle: metadata.imageStyle,
    }
  );
}

/** A portable art-direction prompt for a design model or image-capable agent. */
export function themePresetAiPrompt(preset: ThemePreset): string {
  const guidance = themePresetGuidance(preset.id);
  const metadata = themePresetMetadata(preset.id);
  const colors = preset.theme.colors.map((color) => `${color.name}=${color.value}`).join("，");
  const styles = preset.theme.textStyles;
  return [
    `请使用「${preset.name}」主题为这套演示文稿做视觉设计。`,
    `视觉气质：${guidance.character}`,
    `适用语境：${guidance.scenarios.join("、")}。`,
    `字体系统：标题使用 ${preset.theme.majorFont}，正文使用 ${preset.theme.minorFont}；封面标题约 ${styles?.display?.fontSizePt ?? 44}pt，页标题约 ${styles?.title?.fontSizePt ?? 30}pt，正文约 ${styles?.body?.fontSizePt ?? 16}pt。`,
    `限定色板：${colors}。只使用这些颜色及其低透明度变体；不要使用纯黑或大面积近黑背景。`,
    `页面节奏：${guidance.pageRhythm}`,
    `图片方向：${guidance.imageStyle} 图片中不要生成文字、字母、数字或水印。`,
    `推荐页面类型：${metadata.recommendedPageTypes.join("、")}；信息密度：${metadata.density}。`,
    `字体回退：中文 ${metadata.fontFallbacks.eastAsian.join(" → ")}；西文 ${metadata.fontFallbacks.latin.join(" → ")}。`,
    `图表系列色：${metadata.chartPalette.join("、")}。`,
    `禁止组合：${metadata.forbiddenCombinations.join("；")}。`,
    "逐页先判断视觉叙事方式：结论、证据、对比、时序、框架、引语或场景，再选择相应构图；相邻页面避免连续使用相同骨架。",
    "封面与章节页可使用主题强调色背景，普通内容页使用浅色表面；每页必须有明确的第一视觉焦点，并保持足够留白和文字对比度。",
    "所有标题、正文、数字、引用、备注和页面顺序均为已审核内容：不得改写、概括、补充、删除或重新排序。空间不足时返回布局冲突，不得静默删减内容。",
    "文本、形状、图片、表格和图表应尽量保持为 PowerPoint 原生可编辑对象，不要把整页拍平成图片。",
  ].join("\n");
}

import type { ThemePreset } from "./theme-presets";
import { themePresetMetadata } from "./theme-preset-metadata";
