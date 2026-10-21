use serde_json::Value;
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

const MAX_PROJECT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 100 * 1024 * 1024;

fn validate_path(path: &str, extension: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("PATH_NOT_ABSOLUTE".into());
    }
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        != Some(extension.to_owned())
    {
        return Err("INVALID_FILE_EXTENSION".into());
    }
    let parent = path.parent().ok_or("INVALID_PARENT_PATH")?;
    if !parent.exists() || !parent.is_dir() {
        return Err("PARENT_DIRECTORY_NOT_FOUND".into());
    }
    Ok(path)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("INVALID_PARENT_PATH")?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("TEMP_FILE_CREATE_FAILED: {error}"))?;
    temporary
        .write_all(bytes)
        .map_err(|error| format!("FILE_WRITE_FAILED: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("FILE_SYNC_FAILED: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("FILE_REPLACE_FAILED: {}", error.error))?;
    Ok(())
}

#[tauri::command]
pub fn save_project(path: String, document: Value) -> Result<(), String> {
    let path = validate_path(&path, "pptd")?;
    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|error| format!("PROJECT_SERIALIZE_FAILED: {error}"))?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err("PROJECT_TOO_LARGE".into());
    }
    atomic_write(&path, &bytes)
}

#[tauri::command]
pub fn open_project(path: String) -> Result<Value, String> {
    let path = validate_path(&path, "pptd")?;
    let metadata = path
        .metadata()
        .map_err(|error| format!("PROJECT_METADATA_FAILED: {error}"))?;
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err("PROJECT_TOO_LARGE".into());
    }
    let file = File::open(path).map_err(|error| format!("PROJECT_OPEN_FAILED: {error}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_PROJECT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("PROJECT_READ_FAILED: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("PROJECT_JSON_INVALID: {error}"))
}

#[tauri::command]
pub fn write_pptx(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = validate_path(&path, "pptx")?;
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("EXPORT_TOO_LARGE".into());
    }
    if !bytes.starts_with(b"PK") {
        return Err("PPTX_ZIP_SIGNATURE_INVALID".into());
    }
    atomic_write(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saves_and_opens_a_project() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.pptd");
        let value = json!({ "schemaVersion": 1, "title": "测试" });
        save_project(path.to_string_lossy().into_owned(), value.clone()).unwrap();
        assert_eq!(
            open_project(path.to_string_lossy().into_owned()).unwrap(),
            value
        );
    }

    #[test]
    fn rejects_wrong_extensions_and_invalid_pptx_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let wrong = directory.path().join("sample.json");
        assert_eq!(
            save_project(wrong.to_string_lossy().into_owned(), json!({})).unwrap_err(),
            "INVALID_FILE_EXTENSION"
        );

        let pptx = directory.path().join("sample.pptx");
        assert_eq!(
            write_pptx(pptx.to_string_lossy().into_owned(), b"not a zip".to_vec()).unwrap_err(),
            "PPTX_ZIP_SIGNATURE_INVALID"
        );
    }
}
