//! 运行期诊断日志。
//!
//! 生成、导出和保存失败后，用户能看到的只有界面上一句话；应用退出之后
//! 那句话就没了。没有落盘的日志，排障只能靠猜。这里把失败写成 JSONL：
//! 一行一条，字段固定（时间、级别、稳定错误码、消息、结构化上下文）。
//!
//! 两条边界必须守住：
//!
//! 1. 日志是诊断通道，不是业务通道。写失败只返回错误给调用方记录统计，
//!    绝不能反过来让生成或导出失败。
//! 2. 日志不得变成用户正文的副本。调用方只传错误码、阶段和计数；这里再按
//!    长度截断一次，单条消息、上下文和单个文件都有上限。
use serde::Deserialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

/// 单条消息的字符上限。诊断需要的是错误码与阶段，不是整段草稿。
const MAX_MESSAGE_CHARS: usize = 2_000;
const MAX_CODE_CHARS: usize = 80;
const MAX_CONTEXT_CHARS: usize = 4_000;
/// 单个文件的上限；超过后轮转为 `app.log.1`，只保留一份历史。
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const LOG_FILE: &str = "app.log";

/// 串行化写入：两个并发的错误不会把彼此的行写坏。
static LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    /// `info` / `warn` / `error`。只用于过滤，不做业务判断。
    pub level: String,
    /// 稳定错误码，例如 `AI_DESIGN_JSON_INVALID`。
    pub code: String,
    pub message: String,
    /// 计数、阶段、页数一类可结构化字段；不得放用户正文。
    #[serde(default)]
    pub context: Option<serde_json::Value>,
    /// ISO 时间。缺失时用 Unix 毫秒兜底，日志仍然可排序。
    #[serde(default)]
    pub at: Option<String>,
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut shortened: String = value.chars().take(limit).collect();
    shortened.push('…');
    shortened
}

fn timestamp(entry_at: Option<String>) -> String {
    if let Some(value) = entry_at.filter(|value| !value.trim().is_empty()) {
        return truncate(&value, 64);
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// 把一条记录追加到 `path`。写在调用方持有的锁内完成，失败时返回稳定错误码。
fn append_at(path: &Path, entry: AppLogEntry) -> Result<(), String> {
    let at = timestamp(entry.at);
    let context = match entry.context {
        Some(value) => {
            // 上下文按序列化后的长度判断，避免一个巨大的对象塞满日志。
            let serialized = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
            if serialized.chars().count() > MAX_CONTEXT_CHARS {
                serde_json::json!({ "truncated": true })
            } else {
                value
            }
        }
        None => serde_json::Value::Null,
    };
    let record = serde_json::json!({
        "at": at,
        "level": truncate(&entry.level, 16),
        "code": truncate(&entry.code, MAX_CODE_CHARS),
        "message": truncate(&entry.message, MAX_MESSAGE_CHARS),
        "context": context,
    });
    let mut line = serde_json::to_string(&record)
        .map_err(|error| format!("APP_LOG_SERIALIZE_FAILED: {error}"))?;
    line.push('\n');

    let _guard = LOG_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("APP_LOG_DIRECTORY_FAILED: {error}"))?;
    }
    rotate_if_needed(path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("APP_LOG_OPEN_FAILED: {error}"))?;
    // 一次写入一整行：中断时最坏丢掉这一条，前面的记录仍然可读。
    file.write_all(line.as_bytes())
        .map_err(|error| format!("APP_LOG_WRITE_FAILED: {error}"))?;
    Ok(())
}

/// 超过体积上限时把当前文件挪到 `.1`，旧的历史直接丢弃。
fn rotate_if_needed(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() <= MAX_LOG_BYTES {
        return Ok(());
    }
    let backup = path.with_extension("log.1");
    let _ = fs::remove_file(&backup);
    fs::rename(path, &backup).map_err(|error| format!("APP_LOG_ROTATE_FAILED: {error}"))?;
    Ok(())
}

fn app_log_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("APP_LOG_DIRECTORY_UNAVAILABLE: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("APP_LOG_DIRECTORY_CREATE_FAILED: {error}"))?;
    Ok(directory.join(LOG_FILE))
}

/// 追加一条诊断记录。
///
/// 写盘是阻塞 IO，放到阻塞线程池里；调用方（前端）不需要等待结果，失败也
/// 不应该改变任何业务状态。
#[tauri::command]
pub async fn append_app_log(app: tauri::AppHandle, entry: AppLogEntry) -> Result<(), String> {
    let path = app_log_file(&app)?;
    tauri::async_runtime::spawn_blocking(move || append_at(&path, entry))
        .await
        .map_err(|error| format!("APP_LOG_TASK_FAILED: {error}"))?
}

/// 日志文件的绝对路径，供我们按需导出或排查。
#[tauri::command]
pub fn app_log_location(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app_log_file(&app)?.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn entry(message: &str) -> AppLogEntry {
        AppLogEntry {
            level: "error".into(),
            code: "AI_DESIGN_JSON_INVALID".into(),
            message: message.into(),
            context: None,
            at: Some("2026-10-25T14:00:00.000Z".into()),
        }
    }

    fn lines(path: &Path) -> Vec<serde_json::Value> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn appends_one_json_line_per_entry() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.log");
        append_at(&path, entry("第一行")).unwrap();
        append_at(&path, entry("第二行")).unwrap();

        let records = lines(&path);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0]["code"], "AI_DESIGN_JSON_INVALID");
        assert_eq!(records[1]["message"], "第二行");
        assert_eq!(records[0]["level"], "error");
    }

    #[test]
    fn truncates_long_messages_and_drops_oversized_context() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.log");
        let mut record = entry(&"长".repeat(MAX_MESSAGE_CHARS + 50));
        record.context = Some(serde_json::json!({ "body": "字".repeat(MAX_CONTEXT_CHARS) }));
        append_at(&path, record).unwrap();

        let stored = &lines(&path)[0];
        let message = stored["message"].as_str().unwrap();
        assert_eq!(message.chars().count(), MAX_MESSAGE_CHARS + 1);
        assert!(message.ends_with('…'));
        assert_eq!(stored["context"], serde_json::json!({ "truncated": true }));
    }

    #[test]
    fn rotates_the_file_when_it_exceeds_the_limit() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.log");
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize + 1]).unwrap();
        append_at(&path, entry("旋转后写入")).unwrap();

        let backup = path.with_extension("log.1");
        assert!(backup.exists());
        assert_eq!(fs::metadata(&path).unwrap().len() > 0, true);
        assert_eq!(lines(&path).len(), 1);
    }

    #[test]
    fn uses_the_unix_timestamp_when_the_caller_omits_one() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.log");
        let mut record = entry("无时间");
        record.at = None;
        append_at(&path, record).unwrap();

        let at = lines(&path)[0]["at"].as_str().unwrap().to_string();
        assert!(at.chars().all(|character| character.is_ascii_digit()));
    }
}
