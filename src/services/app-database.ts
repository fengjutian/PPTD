import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Tauri/SQLite adapter for local preferences and AI draft history.
 *
 * Project documents stay in `.pptd` files; this store only holds metadata that
 * desktop users expect to survive a restart. Browser preview has no local
 * database, so reads fall back to defaults and writes report the missing
 * desktop runtime instead of silently degrading to another storage mechanism.
 */
export interface StoredAppSettings {
  theme: string;
  uiFont: string;
  aiProviderId: string;
  aiModel: string;
}

export interface StoredAiHistoryEntry {
  id: string;
  topic: string;
  slideCount: number;
  updatedAt: string;
  draft: unknown;
}

const requireDesktopRuntime = (): void => {
  if (!isTauri()) throw new Error("DESKTOP_RUNTIME_REQUIRED");
};

export async function loadStoredAppSettings(): Promise<StoredAppSettings | null> {
  if (!isTauri()) return null;
  return invoke<StoredAppSettings | null>("load_app_settings");
}

export async function saveStoredAppSettings(settings: StoredAppSettings): Promise<void> {
  requireDesktopRuntime();
  await invoke("save_app_settings", { settings });
}

export async function loadStoredAiHistory(): Promise<StoredAiHistoryEntry[]> {
  if (!isTauri()) return [];
  return invoke<StoredAiHistoryEntry[]>("load_ai_draft_history");
}

export async function saveStoredAiHistory(entry: StoredAiHistoryEntry): Promise<StoredAiHistoryEntry[]> {
  requireDesktopRuntime();
  return invoke<StoredAiHistoryEntry[]>("upsert_ai_draft_history", { entry });
}
