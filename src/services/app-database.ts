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
  /** PPTD 界面语言。老库没有这个字段时按中文处理。 */
  uiLanguage?: string;
  aiProviderId: string;
  aiModel: string;
  /** 是否允许把页面渲染图发送给模型服务。老库没有这个字段时按允许处理。 */
  visionReviewEnabled?: boolean;
  /** 是否在无模板生成时先给出两个设计方向。老库没有这个字段时按开启处理。 */
  designDirectionGate?: boolean;
  /** 是否允许在本机保存设计记忆（外观指纹与偏好原话）。缺省开启。 */
  designMemoryEnabled?: boolean;
  /** 是否运行确定性设计体检。缺省开启；关闭后不显示、不写导出报告。 */
  tasteLintEnabled?: boolean;
}

/** One local design-memory row. The payload never carries reviewed copy. */
export interface StoredDesignMemoryEntry {
  id: string;
  kind: "deck" | "preference";
  scope: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface StoredAiHistoryEntry {
  id: string;
  topic: string;
  slideCount: number;
  updatedAt: string;
  draft: unknown;
}

export interface RecentProjectEntry {
  projectId: string;
  path: string;
  title: string;
  createdAt: number;
  modifiedAt: number;
  lastOpenedAt: number;
  missing: boolean;
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

export async function removeStoredAiHistory(id: string): Promise<StoredAiHistoryEntry[]> {
  requireDesktopRuntime();
  return invoke<StoredAiHistoryEntry[]>("remove_ai_draft_history", { id });
}

export async function loadRecentProjects(): Promise<RecentProjectEntry[]> {
  if (!isTauri()) return [];
  return invoke<RecentProjectEntry[]>("load_recent_projects");
}

export async function saveRecentProject(entry: RecentProjectEntry): Promise<RecentProjectEntry[]> {
  requireDesktopRuntime();
  return invoke<RecentProjectEntry[]>("upsert_recent_project", { entry });
}

export async function removeRecentProject(path: string): Promise<RecentProjectEntry[]> {
  requireDesktopRuntime();
  return invoke<RecentProjectEntry[]>("remove_recent_project", { path });
}

export async function loadStoredDesignMemory(): Promise<StoredDesignMemoryEntry[]> {
  if (!isTauri()) return [];
  return invoke<StoredDesignMemoryEntry[]>("load_design_memory");
}

export async function saveStoredDesignMemory(entry: StoredDesignMemoryEntry): Promise<StoredDesignMemoryEntry[]> {
  requireDesktopRuntime();
  return invoke<StoredDesignMemoryEntry[]>("upsert_design_memory", { entry });
}

export async function removeStoredDesignMemory(id: string): Promise<StoredDesignMemoryEntry[]> {
  requireDesktopRuntime();
  return invoke<StoredDesignMemoryEntry[]>("remove_design_memory", { id });
}

export async function clearStoredDesignMemory(): Promise<StoredDesignMemoryEntry[]> {
  requireDesktopRuntime();
  return invoke<StoredDesignMemoryEntry[]>("clear_design_memory");
}
