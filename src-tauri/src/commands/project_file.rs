use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

const MAX_IMAGE_BYTES: usize = 256 * 1024 * 1024;
const MAX_PROJECT_ASSET_BYTES: usize = 4 * 1024 * 1024 * 1024;
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

fn atomic_write_json(path: &Path, document: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("INVALID_PARENT_PATH")?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("TEMP_FILE_CREATE_FAILED: {error}"))?;
    serde_json::to_writer_pretty(&mut temporary, document)
        .map_err(|error| format!("PROJECT_SERIALIZE_FAILED: {error}"))?;
    temporary
        .flush()
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

fn assets_root(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("INVALID_PROJECT_FILE_NAME")?;
    Ok(path.with_file_name(format!("{file_name}.assets")))
}

fn externalize_images(path: &Path, document: &mut Value) -> Result<(), String> {
    let revision = document
        .pointer("/revisions/document")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let version = format!("revision-{revision}");
    let directory = assets_root(path)?.join(&version);
    let Some(elements) = document
        .pointer_mut("/slides")
        .and_then(Value::as_array_mut)
    else {
        return Ok(());
    };
    for slide in elements {
        let Some(items) = slide.get_mut("elements").and_then(Value::as_array_mut) else {
            continue;
        };
        for element in items {
            if element.get("type").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let id = element
                .get("id")
                .and_then(Value::as_str)
                .ok_or("IMAGE_ID_INVALID")?
                .to_owned();
            if !id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
            {
                return Err("IMAGE_ID_INVALID".into());
            }
            let source = element
                .get_mut("source")
                .and_then(Value::as_object_mut)
                .ok_or("IMAGE_SOURCE_INVALID")?;
            let data_url = source
                .get("dataUrl")
                .and_then(Value::as_str)
                .ok_or("IMAGE_SOURCE_INVALID")?;
            if data_url.starts_with("asset://") {
                continue;
            }
            let mime = source
                .get("mimeType")
                .and_then(Value::as_str)
                .ok_or("IMAGE_MIME_INVALID")?;
            let extension = match mime {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/webp" => "webp",
                _ => return Err("IMAGE_MIME_INVALID".into()),
            };
            let payload = data_url
                .strip_prefix(&format!("data:{mime};base64,"))
                .ok_or("IMAGE_DATA_URL_INVALID")?;
            let bytes = BASE64.decode(payload).map_err(|_| "IMAGE_BASE64_INVALID")?;
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err("IMAGE_TOO_LARGE".into());
            }
            fs::create_dir_all(&directory)
                .map_err(|error| format!("ASSET_DIRECTORY_CREATE_FAILED: {error}"))?;
            let file_name = format!("{id}.{extension}");
            atomic_write(&directory.join(&file_name), &bytes)?;
            source.insert(
                "dataUrl".into(),
                Value::String(format!("asset://{version}/{file_name}")),
            );
        }
    }
    Ok(())
}

fn hydrate_images(path: &Path, document: &mut Value) -> Result<(), String> {
    let root = assets_root(path)?;
    let mut total_bytes = 0usize;
    let Some(slides) = document
        .pointer_mut("/slides")
        .and_then(Value::as_array_mut)
    else {
        return Ok(());
    };
    for slide in slides {
        let Some(items) = slide.get_mut("elements").and_then(Value::as_array_mut) else {
            continue;
        };
        for element in items {
            if element.get("type").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let source = element
                .get_mut("source")
                .and_then(Value::as_object_mut)
                .ok_or("IMAGE_SOURCE_INVALID")?;
            let Some(reference) = source
                .get("dataUrl")
                .and_then(Value::as_str)
                .and_then(|value| value.strip_prefix("asset://"))
            else {
                continue;
            };
            let relative = Path::new(reference);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|component| !matches!(component, std::path::Component::Normal(_)))
            {
                return Err("ASSET_PATH_INVALID".into());
            }
            let asset_path = root.join(relative);
            let bytes =
                fs::read(&asset_path).map_err(|error| format!("ASSET_READ_FAILED: {error}"))?;
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err("IMAGE_TOO_LARGE".into());
            }
            total_bytes = total_bytes
                .checked_add(bytes.len())
                .ok_or("PROJECT_ASSETS_TOO_LARGE")?;
            if total_bytes > MAX_PROJECT_ASSET_BYTES {
                return Err("PROJECT_ASSETS_TOO_LARGE".into());
            }
            let mime = source
                .get("mimeType")
                .and_then(Value::as_str)
                .ok_or("IMAGE_MIME_INVALID")?
                .to_owned();
            source.insert(
                "dataUrl".into(),
                Value::String(format!("data:{mime};base64,{}", BASE64.encode(bytes))),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_project(path: String, mut document: Value) -> Result<(), String> {
    let path = validate_path(&path, "pptd")?;
    externalize_images(&path, &mut document)?;
    atomic_write_json(&path, &document)
}

#[tauri::command]
pub fn open_project(path: String) -> Result<Value, String> {
    let path = validate_path(&path, "pptd")?;
    let file = File::open(&path).map_err(|error| format!("PROJECT_OPEN_FAILED: {error}"))?;
    let mut document: Value =
        serde_json::from_reader(file).map_err(|error| format!("PROJECT_JSON_INVALID: {error}"))?;
    hydrate_images(&path, &mut document)?;
    Ok(document)
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
    fn project_json_is_not_rejected_at_the_previous_size_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.pptd");
        let value = json!({ "schemaVersion": 2, "payload": "x".repeat(17 * 1024 * 1024) });
        save_project(path.to_string_lossy().into_owned(), value).unwrap();
        assert!(path.metadata().unwrap().len() > 16 * 1024 * 1024);
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

    #[test]
    fn stores_embedded_images_in_the_project_asset_directory() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("images.pptd");
        let value = json!({
            "schemaVersion": 2,
            "revisions": { "document": 7 },
            "slides": [{
                "elements": [{
                    "id": "33333333-3333-4333-8333-333333333333",
                    "type": "image",
                    "source": { "kind": "embedded", "dataUrl": "data:image/png;base64,iVBORw0KGgo=", "mimeType": "image/png" }
                }]
            }]
        });
        save_project(path.to_string_lossy().into_owned(), value.clone()).unwrap();
        let stored: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            stored
                .pointer("/slides/0/elements/0/source/dataUrl")
                .unwrap(),
            "asset://revision-7/33333333-3333-4333-8333-333333333333.png"
        );
        assert!(directory
            .path()
            .join("images.pptd.assets/revision-7/33333333-3333-4333-8333-333333333333.png")
            .is_file());
        assert_eq!(
            open_project(path.to_string_lossy().into_owned()).unwrap(),
            value
        );
    }
}
