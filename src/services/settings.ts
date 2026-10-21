export type AppTheme = "dark" | "light" | "system";
export interface AppSettings { theme: AppTheme; minimaxModel: string }
const themeKey = "pptd:theme";
const modelKey = "pptd:minimax-model";
let systemThemeQuery: MediaQueryList | undefined;
let systemThemeListener: (() => void) | undefined;

export function loadSettings(): AppSettings {
  const theme = localStorage.getItem(themeKey);
  return { theme: theme === "light" || theme === "system" ? theme : "dark", minimaxModel: localStorage.getItem(modelKey) || "MiniMax-M3" };
}
export function applyTheme(theme: AppTheme): void {
  if (systemThemeQuery && systemThemeListener) systemThemeQuery.removeEventListener("change", systemThemeListener);
  const update = () => { document.documentElement.dataset.theme = theme === "system" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : theme === "system" ? "dark" : theme; };
  update();
  if (theme === "system") { systemThemeQuery = matchMedia("(prefers-color-scheme: light)"); systemThemeListener = update; systemThemeQuery.addEventListener("change", update); }
}
export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(themeKey, settings.theme); localStorage.setItem(modelKey, settings.minimaxModel); applyTheme(settings.theme);
}
