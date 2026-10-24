use crate::storage::{
    Database, DesignMemoryEntry, RecentProjectEntry, StoredAiHistoryEntry, StoredAppSettings,
};
use tauri::State;

#[tauri::command]
pub fn load_app_settings(
    database: State<'_, Database>,
) -> Result<Option<StoredAppSettings>, String> {
    database.load_settings()
}

#[tauri::command]
pub fn save_app_settings(
    database: State<'_, Database>,
    settings: StoredAppSettings,
) -> Result<(), String> {
    database.save_settings(&settings)
}

#[tauri::command]
pub fn load_ai_draft_history(
    database: State<'_, Database>,
) -> Result<Vec<StoredAiHistoryEntry>, String> {
    database.load_ai_history()
}

#[tauri::command]
pub fn upsert_ai_draft_history(
    database: State<'_, Database>,
    entry: StoredAiHistoryEntry,
) -> Result<Vec<StoredAiHistoryEntry>, String> {
    database.save_ai_history(&entry)
}

#[tauri::command]
pub fn remove_ai_draft_history(
    database: State<'_, Database>,
    id: String,
) -> Result<Vec<StoredAiHistoryEntry>, String> {
    database.remove_ai_history(&id)
}

#[tauri::command]
pub fn load_design_memory(database: State<'_, Database>) -> Result<Vec<DesignMemoryEntry>, String> {
    database.load_design_memory()
}

#[tauri::command]
pub fn upsert_design_memory(
    database: State<'_, Database>,
    entry: DesignMemoryEntry,
) -> Result<Vec<DesignMemoryEntry>, String> {
    database.save_design_memory(&entry)
}

#[tauri::command]
pub fn remove_design_memory(
    database: State<'_, Database>,
    id: String,
) -> Result<Vec<DesignMemoryEntry>, String> {
    database.remove_design_memory(&id)
}

#[tauri::command]
pub fn clear_design_memory(
    database: State<'_, Database>,
) -> Result<Vec<DesignMemoryEntry>, String> {
    database.clear_design_memory()
}

#[tauri::command]
pub fn load_recent_projects(
    database: State<'_, Database>,
) -> Result<Vec<RecentProjectEntry>, String> {
    database.load_recent_projects()
}

#[tauri::command]
pub fn upsert_recent_project(
    database: State<'_, Database>,
    entry: RecentProjectEntry,
) -> Result<Vec<RecentProjectEntry>, String> {
    database.upsert_recent_project(&entry)
}

#[tauri::command]
pub fn remove_recent_project(
    database: State<'_, Database>,
    path: String,
) -> Result<Vec<RecentProjectEntry>, String> {
    database.remove_recent_project(&path)
}
