import { loadStoredAppSettings, saveStoredAppSettings } from "./app-database";
import { DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";
import { isFontInstalled } from "./font-availability";

export type AppTheme = "dark" | "light" | "system" | "amber" | "green" | "blue";
/** PPTD 界面字体，只影响界面排版，不改变 PPT 模板与导出文稿的字体。 */
export type AppUiFont = "sans" | "song" | "hei" | "mono";
export interface AppSettings {
  theme: AppTheme;
  uiFont: AppUiFont;
  aiProviderId: string;
  aiModel: string;
  /**
   * 是否允许把页面渲染图发送给模型服务做视觉评审。
   *
   * 这是一项隐私开关：关闭后生成流程不再上传任何页面渲染图，只做确定性
   * 排版校验，视觉评分与建议随之不可用。缺省开启，保持既有行为。
   */
  visionReviewEnabled: boolean;
}
let systemThemeQuery: MediaQueryList | undefined;
let systemThemeListener: (() => void) | undefined;

const THEMES: readonly AppTheme[] = ["dark", "light", "system", "amber", "green", "blue"];
const UI_FONTS: readonly AppUiFont[] = ["sans", "song", "hei", "mono"];

export interface UiFontOption {
  id: AppUiFont;
  label: string;
  /** 写入 CSS 变量的字体栈。 */
  stack: string;
  /** 逐个探测的字体族名，任一命中即视为本机已安装。 */
  probes: string[];
  note: string;
}

export const UI_FONT_OPTIONS: readonly UiFontOption[] = [
  {
    id: "sans",
    label: "默认无衬线",
    stack: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
    probes: ["Microsoft YaHei", "Segoe UI"],
    note: "与当前界面一致，跨平台回退最稳。",
  },
  {
    id: "song",
    label: "思源宋体",
    stack: '"Source Han Serif SC", "Noto Serif SC", "思源宋体", "Songti SC", SimSun, serif',
    probes: ["Source Han Serif SC", "Noto Serif SC", "思源宋体"],
    note: "思源宋体（Source Han Serif）适合正文与引文，需本机已安装；PPTD 不内置字体文件。",
  },
  {
    id: "hei",
    label: "思源黑体",
    stack: '"Source Han Sans SC", "Noto Sans SC", "思源黑体", "Microsoft YaHei", sans-serif',
    probes: ["Source Han Sans SC", "Noto Sans SC", "思源黑体"],
    note: "思源黑体（Source Han Sans）适合标题与界面，需本机已安装。",
  },
  {
    id: "mono",
    label: "等宽",
    stack: '"Cascadia Mono", "JetBrains Mono", Consolas, "Microsoft YaHei", monospace',
    probes: ["Cascadia Mono", "JetBrains Mono", "Consolas"],
    note: "等宽字体适合数值与代码片段。",
  },
];

export function defaultSettings(): AppSettings {
  const provider = findAiProvider(DEFAULT_AI_PROVIDER_ID);
  return {
    theme: "dark",
    uiFont: "sans",
    aiProviderId: provider.id,
    aiModel: provider.defaultModel,
    visionReviewEnabled: true,
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const fallback = defaultSettings();
  const stored = await loadStoredAppSettings();
  if (!stored) return fallback;
  const provider = findAiProvider(stored.aiProviderId);
  const theme = THEMES.includes(stored.theme as AppTheme) ? (stored.theme as AppTheme) : fallback.theme;
  const uiFont = UI_FONTS.includes(stored.uiFont as AppUiFont) ? (stored.uiFont as AppUiFont) : fallback.uiFont;
  const aiModel = provider.models.includes(stored.aiModel) ? stored.aiModel : provider.defaultModel;
  // 老库没有这个字段：只有显式 false 才关闭，缺省保持允许。
  const visionReviewEnabled = stored.visionReviewEnabled !== false;
  return { theme, uiFont, aiProviderId: provider.id, aiModel, visionReviewEnabled };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await saveStoredAppSettings({
    theme: settings.theme,
    uiFont: settings.uiFont,
    aiProviderId: settings.aiProviderId,
    aiModel: settings.aiModel,
    visionReviewEnabled: settings.visionReviewEnabled,
  });
  applyTheme(settings.theme);
  applyUiFont(settings.uiFont);
}

export function applyTheme(theme: AppTheme): void {
  if (systemThemeQuery && systemThemeListener) systemThemeQuery.removeEventListener("change", systemThemeListener);
  const update = () => {
    document.documentElement.dataset.theme =
      theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
  };
  update();
  if (theme === "system") {
    systemThemeQuery = matchMedia("(prefers-color-scheme: light)");
    systemThemeListener = update;
    systemThemeQuery.addEventListener("change", update);
  }
}

/** 把界面字体写入 CSS 变量，styles.css 的 :root 只读这一个变量。 */
export function applyUiFont(font: AppUiFont): void {
  const option = UI_FONT_OPTIONS.find((item) => item.id === font);
  if (!option) return;
  document.documentElement.style.setProperty("--app-font-family", option.stack);
}

/** 探测本机是否装有该界面字体：任一候选字体族可用即视为已安装。 */
export function probeUiFont(option: UiFontOption): boolean {
  return option.probes.some((probe) => isFontInstalled(probe));
}
