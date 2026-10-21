import { DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";

export type AppTheme = "dark" | "light" | "system";
export interface AppSettings { theme: AppTheme; aiProviderId: string; aiModel: string }
const themeKey = "pptd:theme";
const providerKey = "pptd:ai-provider";
const modelKey = "pptd:ai-model";
/** 旧版本把模型选择存在厂商命名的键下，迁移时读取一次。 */
const legacyModelKey = "pptd:minimax-model";
let systemThemeQuery: MediaQueryList | undefined;
let systemThemeListener: (() => void) | undefined;

export function loadSettings(): AppSettings {
  const theme = localStorage.getItem(themeKey);
  const provider = findAiProvider(localStorage.getItem(providerKey) || DEFAULT_AI_PROVIDER_ID);
  const storedModel = localStorage.getItem(modelKey) ?? localStorage.getItem(legacyModelKey);
  const aiModel = storedModel && provider.models.includes(storedModel) ? storedModel : provider.defaultModel;
  return { theme: theme === "light" || theme === "system" ? theme : "dark", aiProviderId: provider.id, aiModel };
}
export function applyTheme(theme: AppTheme): void {
  if (systemThemeQuery && systemThemeListener) systemThemeQuery.removeEventListener("change", systemThemeListener);
  const update = () => { document.documentElement.dataset.theme = theme === "system" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : theme === "system" ? "dark" : theme; };
  update();
  if (theme === "system") { systemThemeQuery = matchMedia("(prefers-color-scheme: light)"); systemThemeListener = update; systemThemeQuery.addEventListener("change", update); }
}
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(themeKey, settings.theme); localStorage.setItem(providerKey, settings.aiProviderId); localStorage.setItem(modelKey, settings.aiModel); applyTheme(settings.theme);
}
