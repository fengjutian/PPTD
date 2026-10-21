import { loadStoredAppSettings, saveStoredAppSettings } from "./app-database";
import { DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";

export type AppTheme = "dark" | "light" | "system" | "amber" | "green" | "blue";
export interface AppSettings { theme: AppTheme; aiProviderId: string; aiModel: string }
let systemThemeQuery: MediaQueryList | undefined;
let systemThemeListener: (() => void) | undefined;

const THEMES: readonly AppTheme[] = ["dark", "light", "system", "amber", "green", "blue"];

export function defaultSettings(): AppSettings {
  const provider = findAiProvider(DEFAULT_AI_PROVIDER_ID);
  return { theme: "dark", aiProviderId: provider.id, aiModel: provider.defaultModel };
}

export async function loadSettings(): Promise<AppSettings> {
  const fallback = defaultSettings();
  const stored = await loadStoredAppSettings().catch(() => null);
  if (!stored) return fallback;
  const provider = findAiProvider(stored.aiProviderId);
  const theme = THEMES.includes(stored.theme as AppTheme) ? (stored.theme as AppTheme) : fallback.theme;
  const aiModel = provider.models.includes(stored.aiModel) ? stored.aiModel : provider.defaultModel;
  return { theme, aiProviderId: provider.id, aiModel };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await saveStoredAppSettings({
    theme: settings.theme,
    aiProviderId: settings.aiProviderId,
    aiModel: settings.aiModel,
  });
  applyTheme(settings.theme);
}

export function applyTheme(theme: AppTheme): void {
  if (systemThemeQuery && systemThemeListener) systemThemeQuery.removeEventListener("change", systemThemeListener);
  const update = () => { document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme; };
  update();
  if (theme === "system") { systemThemeQuery = matchMedia("(prefers-color-scheme: light)"); systemThemeListener = update; systemThemeQuery.addEventListener("change", update); }
}
