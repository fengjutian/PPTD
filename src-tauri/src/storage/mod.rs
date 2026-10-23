use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

const SCHEMA_VERSION: i64 = 1;
const HISTORY_LIMIT: usize = 20;
const MAX_PROVIDER_ID_CHARS: usize = 64;
const MAX_MODEL_CHARS: usize = 128;
const MAX_TOPIC_CHARS: usize = 4000;
const MAX_DRAFT_BYTES: usize = 4 * 1024 * 1024;
/// 旧库里没有 ui_font 键时使用的界面字体。
const DEFAULT_UI_FONT: &str = "sans";

/// Persisted application preferences. The AI key never enters this table; it
/// lives in the operating system credential store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAppSettings {
    pub theme: String,
    #[serde(default = "default_ui_font")]
    pub ui_font: String,
    pub ai_provider_id: String,
    pub ai_model: String,
    /// 是否允许把页面渲染图发送给模型服务做视觉评审。缺省为允许，老库升级后
    /// 行为不变；只有用户显式关闭才会停止上传渲染图。
    #[serde(default = "default_vision_review_enabled")]
    pub vision_review_enabled: bool,
}

fn default_ui_font() -> String {
    DEFAULT_UI_FONT.to_string()
}

fn default_vision_review_enabled() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAiHistoryEntry {
    pub id: String,
    pub topic: String,
    pub slide_count: u32,
    pub updated_at: String,
    pub draft: Value,
}

/// SQLite-backed local store for preferences and AI draft history.
///
/// Only a single connection is kept behind a mutex: desktop volumes are small,
/// and serializing writes keeps history ordering deterministic. Project
/// documents remain files on disk; this database is not their source of truth.
pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection =
            Connection::open(path).map_err(|error| format!("DATABASE_OPEN_FAILED: {error}"))?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    fn open_in_memory() -> Result<Self, String> {
        let connection = Connection::open_in_memory()
            .map_err(|error| format!("DATABASE_OPEN_FAILED: {error}"))?;
        Self::from_connection(connection)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, String> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("DATABASE_BUSY_TIMEOUT_FAILED: {error}"))?;
        migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "DATABASE_LOCK_FAILED".to_string())
    }

    pub fn load_settings(&self) -> Result<Option<StoredAppSettings>, String> {
        let connection = self.lock()?;
        let theme = read_setting(&connection, "theme")?;
        let provider = read_setting(&connection, "ai_provider_id")?;
        let model = read_setting(&connection, "ai_model")?;
        // 字体键是后加的，老库里没有时回落到默认字体，不让整份设置读不出来。
        let ui_font =
            read_setting(&connection, "ui_font")?.unwrap_or_else(|| DEFAULT_UI_FONT.to_string());
        // 视觉评审开关同理：缺省为开启，只有显式写入 false 才关闭。
        let vision_review_enabled = read_setting(&connection, "vision_review_enabled")?
            .map(|value| value == "true")
            .unwrap_or(true);
        match (theme, provider, model) {
            (Some(theme), Some(ai_provider_id), Some(ai_model)) => Ok(Some(StoredAppSettings {
                theme,
                ui_font,
                ai_provider_id,
                ai_model,
                vision_review_enabled,
            })),
            _ => Ok(None),
        }
    }

    pub fn save_settings(&self, settings: &StoredAppSettings) -> Result<(), String> {
        validate_settings(settings)?;
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("DATABASE_WRITE_FAILED: {error}"))?;
        let now = unix_timestamp_ms();
        for (key, value) in [
            ("theme", settings.theme.as_str()),
            ("ui_font", settings.ui_font.as_str()),
            ("ai_provider_id", settings.ai_provider_id.as_str()),
            ("ai_model", settings.ai_model.as_str()),
            (
                "vision_review_enabled",
                if settings.vision_review_enabled {
                    "true"
                } else {
                    "false"
                },
            ),
        ] {
            transaction
                .execute(
                    "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    params![key, value, now],
                )
                .map_err(|error| format!("DATABASE_WRITE_FAILED: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("DATABASE_COMMIT_FAILED: {error}"))
    }

    pub fn load_ai_history(&self) -> Result<Vec<StoredAiHistoryEntry>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT id, topic, slide_count, updated_at, draft_json
                 FROM ai_draft_history
                 ORDER BY updated_at DESC, rowid DESC
                 LIMIT ?1",
            )
            .map_err(|error| format!("DATABASE_READ_FAILED: {error}"))?;
        let rows = statement
            .query_map([HISTORY_LIMIT as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u32>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|error| format!("DATABASE_READ_FAILED: {error}"))?;
        let mut entries = Vec::new();
        for row in rows {
            let (id, topic, slide_count, updated_at, draft_json) =
                row.map_err(|error| format!("DATABASE_READ_FAILED: {error}"))?;
            let draft: Value = serde_json::from_str(&draft_json)
                .map_err(|error| format!("AI_HISTORY_CORRUPT: {error}"))?;
            entries.push(StoredAiHistoryEntry {
                id,
                topic,
                slide_count,
                updated_at,
                draft,
            });
        }
        Ok(entries)
    }

    pub fn save_ai_history(
        &self,
        entry: &StoredAiHistoryEntry,
    ) -> Result<Vec<StoredAiHistoryEntry>, String> {
        validate_history_entry(entry)?;
        let draft_json = serde_json::to_string(&entry.draft)
            .map_err(|error| format!("AI_HISTORY_SERIALIZE_FAILED: {error}"))?;
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("DATABASE_WRITE_FAILED: {error}"))?;
        transaction
            .execute(
                "INSERT INTO ai_draft_history (id, topic, slide_count, updated_at, draft_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                   topic = excluded.topic,
                   slide_count = excluded.slide_count,
                   updated_at = excluded.updated_at,
                   draft_json = excluded.draft_json",
                params![
                    entry.id,
                    entry.topic,
                    entry.slide_count,
                    entry.updated_at,
                    draft_json
                ],
            )
            .map_err(|error| format!("DATABASE_WRITE_FAILED: {error}"))?;
        transaction
            .execute(
                "DELETE FROM ai_draft_history WHERE id NOT IN (
                   SELECT id FROM ai_draft_history ORDER BY updated_at DESC, rowid DESC LIMIT ?1
                 )",
                [HISTORY_LIMIT as i64],
            )
            .map_err(|error| format!("DATABASE_WRITE_FAILED: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("DATABASE_COMMIT_FAILED: {error}"))?;
        drop(connection);
        self.load_ai_history()
    }
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("DATABASE_SCHEMA_READ_FAILED: {error}"))?;
    if version > SCHEMA_VERSION {
        return Err(format!(
            "DATABASE_SCHEMA_TOO_NEW: found {version}, supported {SCHEMA_VERSION}"
        ));
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("DATABASE_MIGRATION_FAILED: {error}"))?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_settings (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS ai_draft_history (
               id TEXT PRIMARY KEY NOT NULL,
               topic TEXT NOT NULL,
               slide_count INTEGER NOT NULL,
               updated_at TEXT NOT NULL,
               draft_json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS ai_draft_history_updated_at
               ON ai_draft_history (updated_at DESC);",
        )
        .map_err(|error| format!("DATABASE_MIGRATION_FAILED: {error}"))?;
    transaction
        .pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|error| format!("DATABASE_MIGRATION_FAILED: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("DATABASE_COMMIT_FAILED: {error}"))
}

fn read_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("DATABASE_READ_FAILED: {error}"))
}

fn validate_settings(settings: &StoredAppSettings) -> Result<(), String> {
    if !matches!(
        settings.theme.as_str(),
        "dark" | "light" | "system" | "amber" | "green" | "blue"
    ) {
        return Err("SETTINGS_THEME_INVALID".into());
    }
    if !matches!(settings.ui_font.as_str(), "sans" | "song" | "hei" | "mono") {
        return Err("SETTINGS_UI_FONT_INVALID".into());
    }
    if settings.ai_provider_id.trim().is_empty()
        || settings.ai_provider_id.chars().count() > MAX_PROVIDER_ID_CHARS
    {
        return Err("SETTINGS_PROVIDER_INVALID".into());
    }
    if settings.ai_model.trim().is_empty() || settings.ai_model.chars().count() > MAX_MODEL_CHARS {
        return Err("SETTINGS_MODEL_INVALID".into());
    }
    Ok(())
}

fn validate_history_entry(entry: &StoredAiHistoryEntry) -> Result<(), String> {
    if entry.id.trim().is_empty() || entry.id.chars().count() > 64 {
        return Err("AI_HISTORY_ID_INVALID".into());
    }
    if entry.topic.chars().count() > MAX_TOPIC_CHARS {
        return Err("AI_HISTORY_TOPIC_TOO_LONG".into());
    }
    if entry.slide_count == 0 {
        return Err("AI_HISTORY_SLIDE_COUNT_INVALID".into());
    }
    if entry.updated_at.trim().is_empty() || entry.updated_at.chars().count() > 64 {
        return Err("AI_HISTORY_TIMESTAMP_INVALID".into());
    }
    if !entry.draft.is_object() {
        return Err("AI_HISTORY_DRAFT_INVALID".into());
    }
    let size = serde_json::to_vec(&entry.draft)
        .map_err(|error| format!("AI_HISTORY_SERIALIZE_FAILED: {error}"))?
        .len();
    if size > MAX_DRAFT_BYTES {
        return Err("AI_HISTORY_DRAFT_TOO_LARGE".into());
    }
    Ok(())
}

fn unix_timestamp_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings() -> StoredAppSettings {
        StoredAppSettings {
            theme: "light".into(),
            ui_font: "song".into(),
            ai_provider_id: "minimax".into(),
            ai_model: "MiniMax-M3".into(),
            vision_review_enabled: true,
        }
    }

    fn history_entry(id: &str, updated_at: &str) -> StoredAiHistoryEntry {
        StoredAiHistoryEntry {
            id: id.into(),
            topic: "测试主题".into(),
            slide_count: 3,
            updated_at: updated_at.into(),
            draft: json!({ "title": "演示文稿", "slides": [] }),
        }
    }

    #[test]
    fn saves_and_loads_settings() {
        let database = Database::open_in_memory().expect("database");
        assert_eq!(database.load_settings().expect("load"), None);

        database.save_settings(&settings()).expect("save");
        assert_eq!(database.load_settings().expect("load"), Some(settings()));
    }

    #[test]
    fn rejects_invalid_settings() {
        let database = Database::open_in_memory().expect("database");
        let invalid = StoredAppSettings {
            theme: "neon".into(),
            ..settings()
        };
        assert_eq!(
            database.save_settings(&invalid).unwrap_err(),
            "SETTINGS_THEME_INVALID"
        );
    }

    #[test]
    fn rejects_invalid_ui_font() {
        let database = Database::open_in_memory().expect("database");
        let invalid = StoredAppSettings {
            ui_font: "comic".into(),
            ..settings()
        };
        assert_eq!(
            database.save_settings(&invalid).unwrap_err(),
            "SETTINGS_UI_FONT_INVALID"
        );
    }

    #[test]
    fn falls_back_to_default_font_when_key_is_missing() {
        let database = Database::open_in_memory().expect("database");
        database.save_settings(&settings()).expect("save");
        database
            .connection
            .lock()
            .expect("lock")
            .execute("DELETE FROM app_settings WHERE key = 'ui_font'", [])
            .expect("delete");
        let loaded = database.load_settings().expect("load").expect("settings");
        assert_eq!(loaded.ui_font, DEFAULT_UI_FONT);
    }

    #[test]
    fn keeps_vision_review_on_when_key_is_missing() {
        // 老库没有这个键时必须仍然允许视觉评审，否则升级会静默改变行为。
        let database = Database::open_in_memory().expect("database");
        database.save_settings(&settings()).expect("save");
        database
            .connection
            .lock()
            .expect("lock")
            .execute(
                "DELETE FROM app_settings WHERE key = 'vision_review_enabled'",
                [],
            )
            .expect("delete");
        assert!(database
            .load_settings()
            .expect("load")
            .expect("settings")
            .vision_review_enabled);
    }

    #[test]
    fn persists_vision_review_disabled() {
        let database = Database::open_in_memory().expect("database");
        let disabled = StoredAppSettings {
            vision_review_enabled: false,
            ..settings()
        };
        database.save_settings(&disabled).expect("save");
        assert!(!database
            .load_settings()
            .expect("load")
            .expect("settings")
            .vision_review_enabled);
    }

    #[test]
    fn history_is_ordered_and_upserted() {
        let database = Database::open_in_memory().expect("database");
        database
            .save_ai_history(&history_entry("a", "2026-01-01T00:00:00.000Z"))
            .expect("save a");
        database
            .save_ai_history(&history_entry("b", "2026-01-02T00:00:00.000Z"))
            .expect("save b");

        let ids: Vec<String> = database
            .load_ai_history()
            .expect("load")
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids, vec!["b", "a"]);

        let mut updated = history_entry("a", "2026-01-03T00:00:00.000Z");
        updated.topic = "更新后的主题".into();
        database.save_ai_history(&updated).expect("update");
        let entries = database.load_ai_history().expect("load");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "a");
        assert_eq!(entries[0].topic, "更新后的主题");
    }

    #[test]
    fn history_keeps_latest_twenty_entries() {
        let database = Database::open_in_memory().expect("database");
        for index in 0..25 {
            let timestamp = format!("2026-01-{:02}T00:00:00.000Z", index + 1);
            database
                .save_ai_history(&history_entry(&format!("entry-{index}"), &timestamp))
                .expect("save");
        }
        let entries = database.load_ai_history().expect("load");
        assert_eq!(entries.len(), 20);
        assert_eq!(entries[0].id, "entry-24");
        assert_eq!(entries[19].id, "entry-5");
    }

    #[test]
    fn history_rejects_oversized_payload() {
        let database = Database::open_in_memory().expect("database");
        let mut entry = history_entry("a", "2026-01-01T00:00:00.000Z");
        entry.draft = json!({ "body": "x".repeat(MAX_DRAFT_BYTES) });
        assert_eq!(
            database.save_ai_history(&entry).unwrap_err(),
            "AI_HISTORY_DRAFT_TOO_LARGE"
        );
    }
}
