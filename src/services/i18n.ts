/**
 * PPTD 界面语言。
 *
 * 这里只收录界面自身的文案，不翻译演示文稿内容、模板名称和导出结果。界面
 * 文案集中在一个字典里，避免同一个按钮在设置页和主框架各写一份中文。
 */
export type UiLanguage = "zh" | "en";

const zh = {
  "shell.navAria": "主功能",
  "shell.editor": "编辑",
  "shell.editorTitle": "编辑器",
  "shell.ai": "AI",
  "shell.aiTitle": "AI 生成",
  "shell.theme": "主题",
  "shell.themeTitle": "主题模板",
  "shell.settings": "设置",

  "settings.title": "设置",
  "settings.description": "管理模型连接、安全凭据、界面语言和应用外观",
  "settings.tabs.model": "模型服务",
  "settings.tabs.appearance": "应用外观",
  "settings.tabs.font": "字体",
  "settings.tabs.language": "语言",

  "settings.model.title": "AI 模型服务",
  "settings.model.description": "选择生成结构化演示文稿内容所用的厂商与模型。",
  "settings.model.provider": "服务商",
  "settings.model.model": "模型",
  "settings.model.visionReview": "允许视觉评审",
  "settings.model.visionReviewHelp":
    "生成时把页面渲染图发送给当前模型服务检查排版。关闭后不再上传任何渲染图，只做确定性排版校验，视觉评分与建议将不可用。首次生成前会发一张小图探测模型是否支持图片输入；不支持时本次自动跳过。",
  "settings.model.directionGate": "生成前选择设计方向",
  "settings.model.directionGateHelp":
    "无模板生成时先给出“编辑式”和“纪实全幅”两个方向，各附两页真实预览。关闭后直接按推荐方向生成，少一次提案调用和两页预览设计。",
  "settings.model.designMemory": "保存本机设计记忆",
  "settings.model.designMemoryHelp":
    "只保存配色、字体、方向、页数和你在方向选择时写下的偏好原话；不保存正文、备注、图片或模型响应。用于下次方向提案时避免重复。",
  "settings.model.tasteLint": "运行设计体检",
  "settings.model.tasteLintHelp":
    "在右侧属性面板检查正文字号、字阶、字体与色彩数量、连续同骨架等确定性项，并在导出报告中记录数量。只提示，不阻断生成或导出。",
  "settings.memory.count": "已记录 {decks} 个外观、{preferences} 条偏好",
  "settings.memory.clear": "清除设计记忆",
  "settings.model.apiBaseUrl": "API 地址",
  "settings.model.apiKey": "API Key",
  "settings.model.configured": "已安全配置",
  "settings.model.notConfigured": "未配置",
  "settings.model.apiKeySavedPlaceholder": "留空则使用已保存的 Key",
  "settings.model.apiKeyPlaceholder": "输入 {provider} API Key",
  "settings.model.keyHelp":
    "Key 保存在操作系统凭据库中，不进入项目文件或日志。测试会发送一条最小请求，可能产生少量 Token 消耗。",
  "settings.model.test": "测试模型连通性",
  "settings.model.testing": "正在测试…",
  "settings.model.deleteKey": "删除 API Key",
  "settings.model.testFailed": "连接失败：{detail}",

  "settings.appearance.title": "应用主题",
  "settings.appearance.description": "只调整 PPTD 界面外观，不影响 PPT 模板和演示文稿设计。",
  "settings.theme.dark": "深色",
  "settings.theme.light": "浅色",
  "settings.theme.amber": "橙黄",
  "settings.theme.green": "绿色",
  "settings.theme.blue": "蓝色",
  "settings.theme.system": "跟随系统",

  "settings.font.title": "界面字体",
  "settings.font.description": "只调整 PPTD 界面的排版字体，不影响 PPT 模板与导出文稿里的字体。",
  "settings.font.sample": "思源宋体示例 ABC 0123",
  "settings.font.missing": "未安装",
  "settings.font.help":
    "PPTD 不内置字体文件。选择未安装的字体时会自动回退到系统同类字体；如需使用思源宋体，请先在操作系统中安装 Source Han Serif。",
  "settings.font.sans.label": "默认无衬线",
  "settings.font.sans.note": "与当前界面一致，跨平台回退最稳。",
  "settings.font.song.label": "思源宋体",
  "settings.font.song.note": "思源宋体（Source Han Serif）适合正文与引文，需本机已安装；PPTD 不内置字体文件。",
  "settings.font.hei.label": "思源黑体",
  "settings.font.hei.note": "思源黑体（Source Han Sans）适合标题与界面，需本机已安装。",
  "settings.font.mono.label": "等宽",
  "settings.font.mono.note": "等宽字体适合数值与代码片段。",

  "settings.language.title": "界面语言",
  "settings.language.description": "选择 PPTD 界面使用的语言，不会改变演示文稿内容或 PPTX 导出结果。",
  "settings.language.help": "语言会在保存设置后应用到设置页与主导航。演示文稿正文、模板和导出的 PPTX 文件不会被翻译。",
  "settings.language.zh.name": "简体中文",
  "settings.language.zh.englishName": "Chinese (Simplified)",
  "settings.language.zh.note": "使用简体中文显示界面，适合中文内容创作。",
  "settings.language.en.name": "English",
  "settings.language.en.englishName": "English",
  "settings.language.en.note": "使用英文显示界面；演示文稿内容与导出文件保持不变。",

  "settings.actions.save": "保存设置",
  "settings.actions.saving": "保存中…",
  "settings.message.saved": "设置已保存",
  "settings.message.saveFailed": "设置保存失败：{detail}",
  "settings.message.browserPreview": "浏览器预览模式不保存设置，请使用桌面端",
  "settings.message.keyDeleted": "{provider} API Key 已删除",

  "settings.provider.minimax": "MiniMax 中国区",
  "settings.model.note.latest": "最新旗舰",
  "settings.model.note.highspeed": "高速版",
} as const;

export type UiMessageKey = keyof typeof zh;

const en: Record<UiMessageKey, string> = {
  "shell.navAria": "Primary navigation",
  "shell.editor": "Edit",
  "shell.editorTitle": "Editor",
  "shell.ai": "AI",
  "shell.aiTitle": "AI generation",
  "shell.theme": "Theme",
  "shell.themeTitle": "Theme templates",
  "shell.settings": "Settings",

  "settings.title": "Settings",
  "settings.description": "Manage model connections, credentials, interface language, and appearance",
  "settings.tabs.model": "Model service",
  "settings.tabs.appearance": "Appearance",
  "settings.tabs.font": "Fonts",
  "settings.tabs.language": "Language",

  "settings.model.title": "AI model service",
  "settings.model.description": "Choose the provider and model used to generate structured presentation content.",
  "settings.model.provider": "Provider",
  "settings.model.model": "Model",
  "settings.model.visionReview": "Allow visual review",
  "settings.model.visionReviewHelp":
    "Send slide renders to the current model service during generation so it can check layout. When disabled, no renders are uploaded and only deterministic layout validation runs; visual scores and suggestions become unavailable. Before the first run a small image probes whether the model accepts image input; if it does not, visual review is skipped for this run.",
  "settings.model.directionGate": "Choose a design direction before generating",
  "settings.model.directionGateHelp":
    "Without a template, propose Editorial and Documentary with two real previews each. When disabled, the deck is generated from the recommended direction directly, saving one proposal call and two preview designs.",
  "settings.model.designMemory": "Save design memory on this computer",
  "settings.model.designMemoryHelp":
    "Stores only palette, fonts, direction, page count and the taste notes you type while choosing a direction. It never stores copy, notes, images or model responses. Used to avoid repeating a look in the next proposal.",
  "settings.model.tasteLint": "Run the design health check",
  "settings.model.tasteLintHelp":
    "Checks body size, type scale, font and colour counts, repeated skeletons and other deterministic items in the inspector, and records counts in the export report. Findings never block generation or export.",
  "settings.memory.count": "{decks} looks and {preferences} preferences saved",
  "settings.memory.clear": "Clear design memory",
  "settings.model.apiBaseUrl": "API endpoint",
  "settings.model.apiKey": "API Key",
  "settings.model.configured": "Configured securely",
  "settings.model.notConfigured": "Not configured",
  "settings.model.apiKeySavedPlaceholder": "Leave blank to use the saved key",
  "settings.model.apiKeyPlaceholder": "Enter your {provider} API key",
  "settings.model.keyHelp":
    "The key is stored in the operating system credential vault and never enters project files or logs. A test sends one minimal request and may consume a small number of tokens.",
  "settings.model.test": "Test connection",
  "settings.model.testing": "Testing…",
  "settings.model.deleteKey": "Delete API Key",
  "settings.model.testFailed": "Connection failed: {detail}",

  "settings.appearance.title": "Appearance",
  "settings.appearance.description":
    "Adjust the PPTD interface only. PPT templates and presentation design are unchanged.",
  "settings.theme.dark": "Dark",
  "settings.theme.light": "Light",
  "settings.theme.amber": "Amber",
  "settings.theme.green": "Green",
  "settings.theme.blue": "Blue",
  "settings.theme.system": "Follow system",

  "settings.font.title": "Interface font",
  "settings.font.description":
    "Adjust the typeface of the PPTD interface only. Fonts in PPT templates and exported decks are unchanged.",
  "settings.font.sample": "Typeface sample ABC 0123",
  "settings.font.missing": "Not installed",
  "settings.font.help":
    "PPTD does not bundle font files. A missing font falls back to a similar system font. To use Source Han Serif, install it in your operating system first.",
  "settings.font.sans.label": "Default sans",
  "settings.font.sans.note": "Matches the current interface and has the most reliable cross-platform fallback.",
  "settings.font.song.label": "Source Han Serif",
  "settings.font.song.note":
    "Source Han Serif suits body copy and quotations, but must be installed locally; PPTD does not bundle font files.",
  "settings.font.hei.label": "Source Han Sans",
  "settings.font.hei.note": "Source Han Sans suits headings and the interface, but must be installed locally.",
  "settings.font.mono.label": "Monospace",
  "settings.font.mono.note": "Monospace suits numbers and code snippets.",

  "settings.language.title": "Interface language",
  "settings.language.description":
    "Choose the language used by the PPTD interface. Presentation content and PPTX output are unchanged.",
  "settings.language.help":
    "The language is applied to Settings and the primary navigation after you save. Presentation text, templates, and exported PPTX files are never translated.",
  "settings.language.zh.name": "简体中文",
  "settings.language.zh.englishName": "Chinese (Simplified)",
  "settings.language.zh.note": "Display the interface in Simplified Chinese. Best for Chinese content creation.",
  "settings.language.en.name": "English",
  "settings.language.en.englishName": "English",
  "settings.language.en.note":
    "Display the interface in English. Presentation content and exported files remain unchanged.",

  "settings.actions.save": "Save settings",
  "settings.actions.saving": "Saving…",
  "settings.message.saved": "Settings saved",
  "settings.message.saveFailed": "Could not save settings: {detail}",
  "settings.message.browserPreview": "Settings are not saved in browser preview. Use the desktop app.",
  "settings.message.keyDeleted": "{provider} API key deleted",

  "settings.provider.minimax": "MiniMax (China)",
  "settings.model.note.latest": "Latest flagship",
  "settings.model.note.highspeed": "High-speed",
};

export const UI_MESSAGES: Record<UiLanguage, Record<UiMessageKey, string>> = { zh, en };

export interface UiLanguageOption {
  id: UiLanguage;
  /** 语言自己的写法，不随当前界面语言变化。 */
  name: string;
  englishName: string;
  sample: string;
  noteKey: UiMessageKey;
}

export const UI_LANGUAGE_OPTIONS: readonly UiLanguageOption[] = [
  {
    id: "zh",
    name: "简体中文",
    englishName: "Chinese (Simplified)",
    sample: "Aa 中文字体示例",
    noteKey: "settings.language.zh.note",
  },
  {
    id: "en",
    name: "English",
    englishName: "English",
    sample: "Aa Typeface sample",
    noteKey: "settings.language.en.note",
  },
];

export type TranslationValues = Record<string, string | number>;
export type Translator = (key: UiMessageKey, values?: TranslationValues) => string;

export function translate(language: UiLanguage, key: UiMessageKey, values?: TranslationValues): string {
  const template = UI_MESSAGES[language][key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

export function createTranslator(language: UiLanguage): Translator {
  return (key, values) => translate(language, key, values);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh" || value === "en";
}
