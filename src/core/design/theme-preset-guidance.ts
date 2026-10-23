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
};

export function themePresetGuidance(id: string): ThemePresetGuidance {
  return (
    GUIDANCE[id] ?? {
      character: "清晰、统一、以内容层级为先。",
      scenarios: ["通用演示"],
      pageRhythm: "内容页与重点页交替，避免连续页面使用同一骨架。",
      imageStyle: "选择与主题直接相关、构图简洁且不含文字的视觉素材。",
    }
  );
}

/** A portable art-direction prompt for a design model or image-capable agent. */
export function themePresetAiPrompt(preset: ThemePreset): string {
  const guidance = themePresetGuidance(preset.id);
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
    "逐页先判断视觉叙事方式：结论、证据、对比、时序、框架、引语或场景，再选择相应构图；相邻页面避免连续使用相同骨架。",
    "封面与章节页可使用主题强调色背景，普通内容页使用浅色表面；每页必须有明确的第一视觉焦点，并保持足够留白和文字对比度。",
    "所有标题、正文、数字、引用、备注和页面顺序均为已审核内容：不得改写、概括、补充、删除或重新排序。空间不足时返回布局冲突，不得静默删减内容。",
    "文本、形状、图片、表格和图表应尽量保持为 PowerPoint 原生可编辑对象，不要把整页拍平成图片。",
  ].join("\n");
}

import type { ThemePreset } from "./theme-presets";

