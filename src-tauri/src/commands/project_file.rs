use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;
use tempfile::NamedTempFile;
use zip::ZipArchive;

const MAX_IMAGE_BYTES: usize = 256 * 1024 * 1024;
const MAX_PROJECT_ASSET_BYTES: usize = 4 * 1024 * 1024 * 1024;
const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 100 * 1024 * 1024;
const MAX_TEMPLATE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TEMPLATE_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 2_048;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const TEMPLATE_RENDER_TIMEOUT: Duration = Duration::from_secs(120);
/// 评审用真实文稿的栅格化超时。拉起 PowerPoint 加逐页导出的代价在秒级以上。
const REVIEW_RASTER_TIMEOUT: Duration = Duration::from_secs(180);
/// 送进评审的真实文稿最大字节数。
const REVIEW_RASTER_MAX_BYTES: usize = 64 * 1024 * 1024;
/// 评审图最多多少页。
const REVIEW_RASTER_MAX_SLIDES: usize = 40;
/// 缓存格式版本。渲染脚本、导出分辨率或缓存结构变化时递增，旧缓存自然失效。
const LAYOUT_RENDER_CACHE_VERSION: &str = "v1";
/// 缓存目录名，位于应用数据目录下，与模板库同级。
const LAYOUT_RENDER_CACHE_DIR: &str = "layout-render-cache";
/// 最多保留多少个模板的渲染缓存。
const LAYOUT_RENDER_CACHE_MAX_TEMPLATES: usize = 8;
/// 渲染缓存总体积上限，超出后按最旧优先删除。
const LAYOUT_RENDER_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;
/// 单个模板最多渲染多少个版式。
const LAYOUT_RENDER_MAX_LAYOUTS: usize = 128;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRecord {
    id: String,
    name: String,
    size: u64,
    imported_at: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLayoutRender {
    layout_index: usize,
    layout_name: String,
    data_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateThemeColor {
    name: String,
    value: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSlideSummary {
    index: usize,
    title: String,
    text_count: usize,
    image_count: usize,
    shape_count: usize,
    layout: Option<String>,
    background_color: Option<String>,
    decorations: Vec<TemplateDecoration>,
    regions: Vec<TemplateRegion>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRegion {
    role: String,
    x: u64,
    y: u64,
    width: u64,
    height: u64,
    /// Ink the template designer assigned to this placeholder.
    text_color: Option<String>,
    /// Font size in points the template designer assigned to this placeholder.
    font_size_pt: Option<u16>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDecoration {
    shape: String,
    x: u64,
    y: u64,
    width: u64,
    height: u64,
    fill: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLayoutSummary {
    index: usize,
    name: String,
    background_color: Option<String>,
    decorations: Vec<TemplateDecoration>,
    regions: Vec<TemplateRegion>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateAnalysis {
    slide_count: usize,
    slide_width_emu: Option<u64>,
    slide_height_emu: Option<u64>,
    master_count: usize,
    layout_count: usize,
    theme_count: usize,
    theme_colors: Vec<TemplateThemeColor>,
    major_font: Option<String>,
    minor_font: Option<String>,
    default_background_color: Option<String>,
    default_decorations: Vec<TemplateDecoration>,
    slides: Vec<TemplateSlideSummary>,
    layouts: Vec<TemplateLayoutSummary>,
    warnings: Vec<String>,
}

fn validate_path(path: &str, extension: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("PATH_NOT_ABSOLUTE".into());
    }
    let parent = path.parent().ok_or("INVALID_PARENT_PATH")?;
    if !parent.exists() || !parent.is_dir() {
        return Err("PARENT_DIRECTORY_NOT_FOUND".into());
    }
    let file_name = path.file_name().ok_or("INVALID_FILE_NAME")?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("PARENT_DIRECTORY_CANONICALIZE_FAILED: {error}"))?;
    let path = parent.join(file_name);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        != Some(extension.to_owned())
    {
        return Err("INVALID_FILE_EXTENSION".into());
    }
    if path.exists()
        && path
            .symlink_metadata()
            .map_err(|error| format!("FILE_METADATA_FAILED: {error}"))?
            .file_type()
            .is_symlink()
    {
        return Err("SYMLINK_PATH_REJECTED".into());
    }
    Ok(path)
}

fn ensure_project_size(path: &Path) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("PROJECT_METADATA_FAILED: {error}"))?;
    if !metadata.is_file() {
        return Err("PROJECT_NOT_A_FILE".into());
    }
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err("PROJECT_TOO_LARGE".into());
    }
    Ok(())
}

/// Guard against ZIP bombs and hostile entry names before any XML is parsed.
fn validate_archive_limits(archive: &mut ZipArchive<File>) -> Result<(), String> {
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("PPTX_ARCHIVE_TOO_MANY_ENTRIES".into());
    }
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("PPTX_ARCHIVE_READ_FAILED: {error}"))?;
        let name = entry.name();
        let normalized = name.replace('\\', "/");
        if normalized.starts_with('/')
            || normalized
                .split('/')
                .any(|component| component == ".." || component == ".")
            || normalized.contains('\0')
        {
            return Err("PPTX_ARCHIVE_ENTRY_PATH_INVALID".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("PPTX_ARCHIVE_TOO_LARGE")?;
        if total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            return Err("PPTX_ARCHIVE_TOO_LARGE".into());
        }
    }
    Ok(())
}

fn validate_pptx_archive(path: &Path) -> Result<(), String> {
    let file = File::open(path).map_err(|error| format!("TEMPLATE_READ_FAILED: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("PPTX_ARCHIVE_INVALID: {error}"))?;
    validate_archive_limits(&mut archive)?;
    for required in ["[Content_Types].xml", "ppt/presentation.xml"] {
        if archive.by_name(required).is_err() {
            return Err(format!("PPTX_REQUIRED_ENTRY_MISSING:{required}"));
        }
    }
    Ok(())
}

fn run_powershell_with_timeout(script: &Path, source: &Path, output: &Path) -> Result<(), String> {
    run_powershell_script(
        script,
        source,
        output,
        TEMPLATE_RENDER_TIMEOUT,
        PowerShellErrorCodes {
            unavailable: "TEMPLATE_RENDERER_UNAVAILABLE",
            wait_failed: "TEMPLATE_RENDERER_WAIT_FAILED",
            failed: "TEMPLATE_LAYOUT_RENDER_FAILED",
            timed_out: "TEMPLATE_LAYOUT_RENDER_TIMEOUT",
        },
    )
}

/// 外部渲染器的错误码。不同的调用场景用不同的码，用户看到的提示才说得清是哪一步坏了。
struct PowerShellErrorCodes {
    unavailable: &'static str,
    wait_failed: &'static str,
    failed: &'static str,
    timed_out: &'static str,
}

fn run_powershell_script(
    script: &Path,
    source: &Path,
    output: &Path,
    timeout: Duration,
    codes: PowerShellErrorCodes,
) -> Result<(), String> {
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .arg("-Source")
        .arg(source)
        .arg("-Output")
        .arg(output)
        .spawn()
        .map_err(|error| format!("{}: {error}", codes.unavailable))?;
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("{}: {error}", codes.wait_failed))?
        {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("{}:{}", codes.failed, status.code().unwrap_or(-1)))
            };
        }
        if Instant::now() >= deadline {
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .status();
            let _ = child.kill();
            return Err(codes.timed_out.into());
        }
        thread::sleep(Duration::from_millis(150));
    }
}

/// 同一进程内的写操作串行化。
///
/// 自动保存与手动保存可能撞在一起，两个任务同时替换同一个文件时后者会拿到
/// "拒绝访问"。把写操作排成队，比让用户看到一次失败的保存更合理。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 替换目标文件，失败时重试。
///
/// Windows 上只要还有句柄指向目标文件，替换就会失败——哪怕那个句柄只是刚好
/// 读了一下。句柄通常很短命，所以重试几次就能挤过去。
fn persist_with_retry(temporary: NamedTempFile, path: &Path) -> Result<(), String> {
    let mut pending = temporary;
    for attempt in 0..8_u32 {
        match pending.persist(path) {
            Ok(_) => return Ok(()),
            Err(error) => {
                let detail = error.error;
                pending = error.file;
                if attempt == 7 {
                    return Err(format!("FILE_REPLACE_FAILED: {detail}"));
                }
                std::thread::sleep(Duration::from_millis(25 * u64::from(attempt) + 25));
            }
        }
    }
    Err("FILE_REPLACE_FAILED".into())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
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
    persist_with_retry(temporary, path)
}

fn atomic_write_json(path: &Path, document: &Value) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let parent = path.parent().ok_or("INVALID_PARENT_PATH")?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("TEMP_FILE_CREATE_FAILED: {error}"))?;
    serde_json::to_writer_pretty(&mut temporary, document)
        .map_err(|error| format!("PROJECT_SERIALIZE_FAILED: {error}"))?;
    temporary
        .flush()
        .map_err(|error| format!("FILE_WRITE_FAILED: {error}"))?;
    if temporary
        .as_file()
        .metadata()
        .map_err(|error| format!("PROJECT_METADATA_FAILED: {error}"))?
        .len()
        > MAX_PROJECT_BYTES
    {
        return Err("PROJECT_TOO_LARGE".into());
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("FILE_SYNC_FAILED: {error}"))?;
    persist_with_retry(temporary, path)
}

fn assets_root(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("INVALID_PROJECT_FILE_NAME")?;
    Ok(path.with_file_name(format!("{file_name}.assets")))
}

/// The lowercase hex SHA-256 digest of image bytes, used as the resource file
/// name. The digest depends only on the bytes, never on the page, order or
/// revision, so the same picture is written once and a text-only autosave no
/// longer rewrites every image. Cleanup then removes a file only when no
/// element references it anymore.
fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// A content-addressed reference is `{64 lowercase hex}.{png|jpg|webp}`. Newer
/// saves use this shape; the legacy `revision-N/…` shape is handled elsewhere.
fn is_content_addressed_reference(reference: &str) -> bool {
    let Some((name, extension)) = reference.rsplit_once('.') else {
        return false;
    };
    matches!(extension, "png" | "jpg" | "webp")
        && name.len() == 64
        && name.chars().all(|character| character.is_ascii_hexdigit())
}

fn externalize_images(path: &Path, document: &mut Value) -> Result<(), String> {
    let directory = assets_root(path)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("ASSET_DIRECTORY_CREATE_FAILED: {error}"))?;
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
            let file_name = format!("{}.{extension}", hex_digest(&bytes));
            let file_path = directory.join(&file_name);
            // 同一张图只写一次：内容没变时跳过写盘，纯文字编辑的自动保存不再重写所有图片。
            if !file_path.is_file() {
                atomic_write(&file_path, &bytes)?;
            }
            source.insert(
                "dataUrl".into(),
                Value::String(format!("asset://{file_name}")),
            );
        }
    }
    cleanup_unreferenced_assets(path, document);
    Ok(())
}

/// Removes resource files no element references and legacy `revision-N`
/// directories. Runs after a save, so an old project opened before its first
/// save still reads its revision directory; only a save in the new format
/// retires it.
fn cleanup_unreferenced_assets(path: &Path, document: &Value) {
    let Ok(root) = assets_root(path) else { return };
    let mut referenced = std::collections::HashSet::new();
    if let Some(slides) = document.pointer("/slides").and_then(Value::as_array) {
        for slide in slides {
            if let Some(elements) = slide.get("elements").and_then(Value::as_array) {
                for element in elements {
                    if let Some(data_url) = element
                        .get("source")
                        .and_then(|source| source.get("dataUrl"))
                        .and_then(Value::as_str)
                    {
                        if let Some(reference) = data_url.strip_prefix("asset://") {
                            referenced.insert(reference.to_owned());
                        }
                    }
                }
            }
        }
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().into_owned();
        if name.starts_with("revision-") {
            let _ = fs::remove_dir_all(entry.path());
        } else if !referenced.contains(&name) {
            let _ = fs::remove_file(entry.path());
        }
    }
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
            // A content-addressed reference stays as-is: the front end loads it
            // on demand instead of turning every picture back into base64 at
            // open time. The legacy `revision-N/…` shape still falls through to
            // the read-and-inline path below, so old projects keep working.
            if is_content_addressed_reference(reference) {
                continue;
            }
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

/// Reads a single stored image back as an inline data URL.
///
/// Opening a project no longer inlines every picture (see `hydrate_images`);
/// the front end calls this lazily for the pictures it actually renders, and
/// caches the result.
#[tauri::command]
pub async fn read_image_asset(project_path: String, reference: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let path = validate_path(&project_path, "pptd")?;
        let root = assets_root(&path)?;
        let relative = reference
            .strip_prefix("asset://")
            .ok_or("ASSET_REF_INVALID")?;
        let relative_path = Path::new(relative);
        if relative_path.is_absolute()
            || relative_path
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            return Err("ASSET_PATH_INVALID".into());
        }
        let asset_path = root.join(relative_path);
        let bytes = fs::read(&asset_path).map_err(|_| "ASSET_NOT_FOUND".to_string())?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err("IMAGE_TOO_LARGE".into());
        }
        let mime = match relative_path.extension().and_then(|value| value.to_str()) {
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            _ => return Err("ASSET_MIME_INVALID".into()),
        };
        Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
    })
    .await
    .map_err(|error| format!("IMAGE_READ_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn save_project(path: String, document: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = validate_path(&path, "pptd")?;
        let mut document = document;
        externalize_images(&path, &mut document)?;
        atomic_write_json(&path, &document)?;
        Ok(())
    })
    .await
    .map_err(|error| format!("PROJECT_SAVE_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn open_project(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = validate_path(&path, "pptd")?;
        ensure_project_size(&path)?;
        let file = File::open(&path).map_err(|error| format!("PROJECT_OPEN_FAILED: {error}"))?;
        let mut document: Value = serde_json::from_reader(file)
            .map_err(|error| format!("PROJECT_JSON_INVALID: {error}"))?;
        hydrate_images(&path, &mut document)?;
        Ok(document)
    })
    .await
    .map_err(|error| format!("PROJECT_OPEN_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub fn project_modified_at(path: String) -> Result<u64, String> {
    let path = validate_path(&path, "pptd")?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("PROJECT_METADATA_FAILED: {error}"))?;
    if !metadata.is_file() {
        return Err("PROJECT_NOT_A_FILE".into());
    }
    let modified = metadata
        .modified()
        .map_err(|error| format!("PROJECT_MODIFIED_TIME_UNAVAILABLE: {error}"))?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "SYSTEM_TIME_INVALID")?
        .as_millis() as u64)
}

fn recovery_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("APP_DATA_DIRECTORY_UNAVAILABLE: {error}"))?
        .join("recovery");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("RECOVERY_DIRECTORY_CREATE_FAILED: {error}"))?;
    Ok(directory.join("latest.pptd"))
}

#[tauri::command]
pub async fn save_recovery(
    app: tauri::AppHandle,
    source_path: Option<String>,
    document: Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = recovery_path(&app)?;
        let source = source_path.map(PathBuf::from);
        save_recovery_at(&path, document, source.as_deref())
    })
    .await
    .map_err(|error| format!("RECOVERY_SAVE_TASK_FAILED: {error}"))?
}

/// 写入恢复副本。落盘用临时文件加原子替换，中断时保留上一个有效版本。
fn save_recovery_at(
    path: &Path,
    mut document: Value,
    source_path: Option<&Path>,
) -> Result<(), String> {
    externalize_images(path, &mut document)?;
    copy_referenced_assets(path, &document, source_path)?;
    atomic_write_json(path, &document)?;
    Ok(())
}

/// 把文档引用的图片复制到这份副本自己的资源目录。
///
/// A document keeps its pictures as references into the asset directory of the
/// project they belong to. A recovery copy written next to that project would
/// keep the references but not the files behind them, so the restored document
/// would come back without its pictures.
fn copy_referenced_assets(
    path: &Path,
    document: &Value,
    source_path: Option<&Path>,
) -> Result<(), String> {
    let Some(source_path) = source_path else {
        return Ok(());
    };
    let source_root = assets_root(source_path)?;
    let target_root = assets_root(path)?;
    let Some(slides) = document.pointer("/slides").and_then(Value::as_array) else {
        return Ok(());
    };
    for slide in slides {
        let Some(elements) = slide.get("elements").and_then(Value::as_array) else {
            continue;
        };
        for element in elements {
            if element.get("type").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let Some(reference) = element
                .pointer("/source/dataUrl")
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
                continue;
            }
            let target = target_root.join(relative);
            if target.is_file() {
                continue;
            }
            let origin = source_root.join(relative);
            if !origin.is_file() {
                continue;
            }
            fs::create_dir_all(&target_root)
                .map_err(|error| format!("ASSET_DIRECTORY_CREATE_FAILED: {error}"))?;
            fs::copy(&origin, &target).map_err(|error| format!("ASSET_COPY_FAILED: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn load_recovery(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = recovery_path(&app)?;
        load_recovery_at(&path)
    })
    .await
    .map_err(|error| format!("RECOVERY_LOAD_TASK_FAILED: {error}"))?
}

/// The file the recovery copy is written to.
///
/// A restored document keeps its pictures as asset references next to that
/// file, so the front end needs the path to read them back.
#[tauri::command]
pub fn recovery_project_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = recovery_path(&app)?;
    Ok(path.is_file().then(|| path.to_string_lossy().into_owned()))
}

/// 读取恢复副本。文件不存在时返回空，文件损坏时报告错误而不是返回半个文档。
fn load_recovery_at(path: &Path) -> Result<Option<Value>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    ensure_project_size(path)?;
    let file = File::open(path).map_err(|error| format!("RECOVERY_OPEN_FAILED: {error}"))?;
    let mut document: Value =
        serde_json::from_reader(file).map_err(|error| format!("RECOVERY_JSON_INVALID: {error}"))?;
    hydrate_images(path, &mut document)?;
    Ok(Some(document))
}

#[tauri::command]
pub fn clear_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    clear_recovery_at(&path)
}

/// 清除恢复副本与其资源目录。没有恢复文件时也不应该报错。
fn clear_recovery_at(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("RECOVERY_DELETE_FAILED: {error}"))?;
    }
    let assets = assets_root(path)?;
    if assets.exists() {
        fs::remove_dir_all(&assets)
            .map_err(|error| format!("RECOVERY_ASSETS_DELETE_FAILED: {error}"))?;
    }
    Ok(())
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

/// Binary-safe export path. The JSON command above remains for tests and small
/// callers; the UI uses this raw IPC body to avoid serializing a large byte array.
#[tauri::command]
pub fn write_pptx_raw(request: Request<'_>) -> Result<(), String> {
    let encoded_path = request
        .headers()
        .get("x-pptd-path")
        .and_then(|value| value.to_str().ok())
        .ok_or("EXPORT_PATH_HEADER_MISSING")?;
    let path = BASE64
        .decode(encoded_path)
        .map_err(|_| "EXPORT_PATH_HEADER_INVALID")?;
    let path = String::from_utf8(path).map_err(|_| "EXPORT_PATH_HEADER_INVALID")?;
    let path = validate_path(&path, "pptx")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("EXPORT_BODY_NOT_RAW".into());
    };
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("EXPORT_TOO_LARGE".into());
    }
    if !bytes.starts_with(b"PK") {
        return Err("PPTX_ZIP_SIGNATURE_INVALID".into());
    }
    atomic_write(&path, bytes)
}

/// 逐页栅格化脚本。PowerPoint 是这份文稿的目标应用，评审模型看的应该是它
/// 渲染出来的画面，而不是画布上的一次近似重绘。
///
/// 宏被显式禁用：文稿是机器生成的中间产物，不需要也不能执行其中的任何脚本。
const REVIEW_RASTER_SCRIPT: &str = r#"param([string]$Source, [string]$Output)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Output)) { New-Item -ItemType Directory -Path $Output | Out-Null }
$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.AutomationSecurity = 3
  $presentation = $powerPoint.Presentations.Open($Source, -1, 0, 0)
  for ($index = 1; $index -le $presentation.Slides.Count; $index += 1) {
    $target = Join-Path $Output ("slide{0}.png" -f $index)
    $presentation.Slides.Item($index).Export($target, 'PNG', 1280, 720)
  }
} finally {
  if ($presentation -ne $null) { $presentation.Close() }
  if ($powerPoint -ne $null) { $powerPoint.Quit() }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
"#;

/// Renders an exported deck into one image per slide for the visual review.
///
/// The bytes arrive as the raw IPC body: a deck is far too large to be sent as
/// a JSON array of numbers. PowerPoint may be missing, disabled by policy or
/// simply not installed; the command then fails and the caller falls back to
/// the canvas preview. Failing here is not a failure of the generation.
#[tauri::command]
pub async fn rasterize_pptx_for_review(request: Request<'_>) -> Result<Vec<String>, String> {
    let InvokeBody::Raw(raw) = request.body() else {
        return Err("REVIEW_RASTER_BODY_NOT_RAW".into());
    };
    // The body is borrowed from the request, but the render runs on a blocking
    // task: the bytes have to be owned before they leave this scope.
    let bytes = raw.to_vec();
    if bytes.is_empty() || bytes.len() > REVIEW_RASTER_MAX_BYTES {
        return Err("REVIEW_RASTER_SIZE_INVALID".into());
    }
    if !bytes.starts_with(b"PK") {
        return Err("REVIEW_RASTER_ZIP_SIGNATURE_INVALID".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let working =
            tempfile::tempdir().map_err(|error| format!("REVIEW_RASTER_TEMP_FAILED: {error}"))?;
        let source = working.path().join("review.pptx");
        fs::write(&source, bytes)
            .map_err(|error| format!("REVIEW_RASTER_WRITE_FAILED: {error}"))?;
        let output = working.path().join("slides");
        fs::create_dir_all(&output)
            .map_err(|error| format!("REVIEW_RASTER_DIRECTORY_FAILED: {error}"))?;
        let script = working.path().join("rasterize.ps1");
        fs::write(&script, REVIEW_RASTER_SCRIPT)
            .map_err(|error| format!("REVIEW_RASTER_SCRIPT_FAILED: {error}"))?;
        run_powershell_script(
            &script,
            &source,
            &output,
            REVIEW_RASTER_TIMEOUT,
            PowerShellErrorCodes {
                unavailable: "REVIEW_RASTERER_UNAVAILABLE",
                wait_failed: "REVIEW_RASTERER_WAIT_FAILED",
                failed: "REVIEW_RASTER_FAILED",
                timed_out: "REVIEW_RASTER_TIMEOUT",
            },
        )?;
        let mut renders = Vec::new();
        for index in 1..=REVIEW_RASTER_MAX_SLIDES {
            let path = output.join(format!("slide{index}.png"));
            if !path.is_file() {
                continue;
            }
            let data =
                fs::read(&path).map_err(|error| format!("REVIEW_RASTER_READ_FAILED: {error}"))?;
            if data.is_empty() || data.len() > MAX_TEMPLATE_PREVIEW_BYTES as usize {
                return Err("REVIEW_RASTER_IMAGE_INVALID".into());
            }
            renders.push(format!("data:image/png;base64,{}", BASE64.encode(data)));
        }
        if renders.is_empty() {
            return Err("REVIEW_RASTER_EMPTY".into());
        }
        Ok(renders)
    })
    .await
    .map_err(|error| format!("REVIEW_RASTER_TASK_FAILED: {error}"))?
}

fn template_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("templates"))
        .map_err(|error| format!("TEMPLATE_DIRECTORY_UNAVAILABLE: {error}"))
}

fn safe_template_name(name: &str) -> String {
    let value: String = name
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character.is_control()
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let value = value.trim().trim_end_matches('.');
    if value.is_empty() {
        "template.pptx".into()
    } else {
        value.into()
    }
}

#[tauri::command]
pub async fn import_pptx_template(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<TemplateRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = validate_path(&source_path, "pptx")?;
        let metadata =
            fs::metadata(&source).map_err(|error| format!("TEMPLATE_READ_FAILED: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_TEMPLATE_BYTES {
            return Err("TEMPLATE_SIZE_INVALID".into());
        }
        let mut signature = [0_u8; 2];
        File::open(&source)
            .and_then(|mut file| file.read_exact(&mut signature))
            .map_err(|error| format!("TEMPLATE_READ_FAILED: {error}"))?;
        if signature != *b"PK" {
            return Err("PPTX_ZIP_SIGNATURE_INVALID".into());
        }
        validate_pptx_archive(&source)?;
        let imported_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "SYSTEM_TIME_INVALID")?
            .as_millis() as u64;
        let name = safe_template_name(
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("template.pptx"),
        );
        let id = format!("{imported_at}-{name}");
        let root = template_root(&app)?;
        fs::create_dir_all(&root)
            .map_err(|error| format!("TEMPLATE_DIRECTORY_CREATE_FAILED: {error}"))?;
        fs::copy(&source, root.join(&id))
            .map_err(|error| format!("TEMPLATE_COPY_FAILED: {error}"))?;
        Ok(TemplateRecord {
            id,
            name,
            size: metadata.len(),
            imported_at,
        })
    })
    .await
    .map_err(|error| format!("TEMPLATE_IMPORT_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub fn list_pptx_templates(app: tauri::AppHandle) -> Result<Vec<TemplateRecord>, String> {
    let root = template_root(&app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut templates = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| format!("TEMPLATE_LIST_FAILED: {error}"))? {
        let entry = entry.map_err(|error| format!("TEMPLATE_LIST_FAILED: {error}"))?;
        let id = entry.file_name().to_string_lossy().into_owned();
        let Some((timestamp, name)) = id.split_once('-') else {
            continue;
        };
        let Ok(imported_at) = timestamp.parse::<u64>() else {
            continue;
        };
        if !name.to_ascii_lowercase().ends_with(".pptx") {
            continue;
        }
        let name = name.to_owned();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("TEMPLATE_LIST_FAILED: {error}"))?;
        if metadata.is_file() {
            templates.push(TemplateRecord {
                id,
                name,
                size: metadata.len(),
                imported_at,
            });
        }
    }
    templates.sort_by_key(|item| std::cmp::Reverse(item.imported_at));
    Ok(templates)
}

#[tauri::command]
pub async fn get_pptx_template_preview(
    app: tauri::AppHandle,
    template_id: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if template_id.is_empty()
            || template_id.contains('/')
            || template_id.contains('\\')
            || template_id == "."
            || template_id == ".."
        {
            return Err("TEMPLATE_ID_INVALID".into());
        }
        let root = template_root(&app)?;
        let path = root.join(&template_id);
        if !path.starts_with(&root) || !path.is_file() {
            return Err("TEMPLATE_NOT_FOUND".into());
        }
        let file = File::open(path).map_err(|error| format!("TEMPLATE_READ_FAILED: {error}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|error| format!("PPTX_ARCHIVE_INVALID: {error}"))?;
        validate_archive_limits(&mut archive)?;
        for (entry_name, mime_type) in [
            ("docProps/thumbnail.jpeg", "image/jpeg"),
            ("docProps/thumbnail.jpg", "image/jpeg"),
            ("docProps/thumbnail.png", "image/png"),
        ] {
            let Ok(entry) = archive.by_name(entry_name) else {
                continue;
            };
            if entry.size() == 0 || entry.size() > MAX_TEMPLATE_PREVIEW_BYTES {
                return Err("TEMPLATE_PREVIEW_SIZE_INVALID".into());
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .take(MAX_TEMPLATE_PREVIEW_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("TEMPLATE_PREVIEW_READ_FAILED: {error}"))?;
            if bytes.len() as u64 > MAX_TEMPLATE_PREVIEW_BYTES {
                return Err("TEMPLATE_PREVIEW_SIZE_INVALID".into());
            }
            return Ok(Some(format!(
                "data:{mime_type};base64,{}",
                BASE64.encode(bytes)
            )));
        }
        Ok(None)
    })
    .await
    .map_err(|error| format!("TEMPLATE_PREVIEW_TASK_FAILED: {error}"))?
}

#[tauri::command]
pub async fn render_pptx_template_layouts(
    app: tauri::AppHandle,
    template_id: String,
) -> Result<Vec<TemplateLayoutRender>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if template_id.is_empty()
            || template_id.contains('/')
            || template_id.contains('\\')
            || template_id == "."
            || template_id == ".."
        {
            return Err("TEMPLATE_ID_INVALID".into());
        }
        let root = template_root(&app)?;
        let source = root.join(&template_id);
        if !source.starts_with(&root) || !source.is_file() {
            return Err("TEMPLATE_NOT_FOUND".into());
        }
        validate_pptx_archive(&source)?;
        // 版式渲染要拉起 PowerPoint 逐个版式导出图片，代价在秒级以上。模板内容
        // 没变时直接复用上次结果：缓存键跟随内容摘要，模板被替换后自然失效。
        let cache_root = layout_render_cache_root(&app);
        let content_hash = template_content_hash(&source)?;
        let cache_dir = cache_root.join(layout_render_cache_key(&content_hash));
        if let Some(renders) = read_layout_render_cache(&cache_dir) {
            return Ok(renders);
        }
        let working =
            tempfile::tempdir().map_err(|error| format!("TEMPLATE_RENDER_TEMP_FAILED: {error}"))?;
        let working_pptx = working.path().join("template.pptx");
        fs::copy(&source, &working_pptx)
            .map_err(|error| format!("TEMPLATE_RENDER_COPY_FAILED: {error}"))?;
        let output = working.path().join("renders");
        fs::create_dir_all(&output)
            .map_err(|error| format!("TEMPLATE_RENDER_DIRECTORY_FAILED: {error}"))?;
        let script = working.path().join("render-layouts.ps1");
        fs::write(
            &script,
            r#"param([string]$Source, [string]$Output)
$ErrorActionPreference = 'Stop'
$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.AutomationSecurity = 3
  $presentation = $powerPoint.Presentations.Open($Source, 0, 0, 0)
  $globalIndex = 0
  $manifest = Join-Path $Output 'layouts.tsv'
  Set-Content -LiteralPath $manifest -Value '' -Encoding UTF8
  for ($designIndex = 1; $designIndex -le $presentation.Designs.Count; $designIndex++) {
    $master = $presentation.Designs.Item($designIndex).SlideMaster
    for ($layoutIndex = 1; $layoutIndex -le $master.CustomLayouts.Count; $layoutIndex++) {
      $globalIndex++
      $layout = $master.CustomLayouts.Item($layoutIndex)
      $slide = $presentation.Slides.AddSlide($presentation.Slides.Count + 1, $layout)
      $target = Join-Path $Output ("layout{0}.png" -f $globalIndex)
      $slide.Export($target, 'PNG', 1600, 900)
      Add-Content -LiteralPath $manifest -Value ("{0}`t{1}" -f $globalIndex, $layout.Name) -Encoding UTF8
      $slide.Delete()
    }
  }
} finally {
  if ($presentation -ne $null) { $presentation.Close() }
  if ($powerPoint -ne $null) { $powerPoint.Quit() }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
"#,
        )
        .map_err(|error| format!("TEMPLATE_RENDER_SCRIPT_FAILED: {error}"))?;
        run_powershell_with_timeout(&script, &working_pptx, &output)?;
        let manifest = fs::read_to_string(output.join("layouts.tsv"))
            .map_err(|error| format!("TEMPLATE_LAYOUT_MANIFEST_READ_FAILED: {error}"))?;
        let layout_names: std::collections::HashMap<usize, String> = manifest
            .lines()
            .filter_map(|line| line.trim_start_matches('\u{feff}').split_once('\t'))
            .filter_map(|(index, name)| index.parse::<usize>().ok().map(|index| (index, name.trim().to_owned())))
            .collect();
        let mut renders = Vec::new();
        for index in 1..=LAYOUT_RENDER_MAX_LAYOUTS {
            let path = output.join(format!("layout{index}.png"));
            if !path.is_file() {
                continue;
            }
            let bytes = fs::read(&path)
                .map_err(|error| format!("TEMPLATE_LAYOUT_RENDER_READ_FAILED: {error}"))?;
            if bytes.is_empty() || bytes.len() > MAX_TEMPLATE_PREVIEW_BYTES as usize {
                return Err("TEMPLATE_LAYOUT_RENDER_SIZE_INVALID".into());
            }
            renders.push(TemplateLayoutRender {
                layout_index: index,
                layout_name: layout_names.get(&index).cloned().unwrap_or_default(),
                data_url: format!("data:image/png;base64,{}", BASE64.encode(bytes)),
            });
        }
        if renders.is_empty() {
            return Err("TEMPLATE_LAYOUT_RENDER_EMPTY".into());
        }
        // 缓存只是加速手段：写缓存或裁剪失败都不影响本次渲染结果。
        let _ = write_layout_render_cache(&cache_dir, &output);
        let _ = prune_layout_render_cache(&cache_root);
        Ok(renders)
    })
    .await
    .map_err(|error| format!("TEMPLATE_LAYOUT_RENDER_TASK_FAILED: {error}"))?
}

/// 渲染缓存与模板库同放在应用数据目录下。
fn layout_render_cache_root(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|path| path.join(LAYOUT_RENDER_CACHE_DIR))
        .unwrap_or_else(|_| PathBuf::from(LAYOUT_RENDER_CACHE_DIR))
}

/// 模板内容的流式摘要。缓存键跟随内容而不是文件名，同名模板被替换也会重新渲染。
fn template_content_hash(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("TEMPLATE_HASH_READ_FAILED: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("TEMPLATE_HASH_READ_FAILED: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    Ok(hex_digest(&digest))
}

/// 缓存键包含渲染格式版本：渲染方式变化后旧缓存自动作废。
fn layout_render_cache_key(content_hash: &str) -> String {
    format!("{LAYOUT_RENDER_CACHE_VERSION}-{content_hash}")
}

/// 读回缓存的版式渲染。缓存缺失、不完整或损坏时返回 None，由调用方重新渲染。
fn read_layout_render_cache(cache_dir: &Path) -> Option<Vec<TemplateLayoutRender>> {
    let manifest = fs::read_to_string(cache_dir.join("layouts.tsv")).ok()?;
    let layout_names: std::collections::HashMap<usize, String> = manifest
        .lines()
        .filter_map(|line| line.trim_start_matches('\u{feff}').split_once('\t'))
        .filter_map(|(index, name)| {
            index
                .parse::<usize>()
                .ok()
                .map(|index| (index, name.trim().to_owned()))
        })
        .collect();
    let mut renders = Vec::new();
    for index in 1..=LAYOUT_RENDER_MAX_LAYOUTS {
        let path = cache_dir.join(format!("layout{index}.png"));
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        if bytes.is_empty() || bytes.len() > MAX_TEMPLATE_PREVIEW_BYTES as usize {
            // 缓存内容异常：当作没有缓存，避免把坏数据交给调用方。
            return None;
        }
        renders.push(TemplateLayoutRender {
            layout_index: index,
            layout_name: layout_names.get(&index).cloned().unwrap_or_default(),
            data_url: format!("data:image/png;base64,{}", BASE64.encode(bytes)),
        });
    }
    if renders.is_empty() {
        None
    } else {
        Some(renders)
    }
}

/// 写入渲染缓存。先写临时目录再改名，避免并发读取时看到半截缓存。
fn write_layout_render_cache(cache_dir: &Path, render_dir: &Path) -> Result<(), String> {
    let parent = cache_dir
        .parent()
        .ok_or_else(|| "TEMPLATE_LAYOUT_CACHE_PATH_INVALID".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("TEMPLATE_LAYOUT_CACHE_DIR_FAILED: {error}"))?;
    // 临时目录名带进程号与纳秒时间戳，避免同一进程内并发渲染互相踩目录。
    let staging = parent.join(format!(
        ".staging-{}-{}-{}",
        cache_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("cache"),
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default()
    ));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)
        .map_err(|error| format!("TEMPLATE_LAYOUT_CACHE_DIR_FAILED: {error}"))?;
    fs::copy(render_dir.join("layouts.tsv"), staging.join("layouts.tsv"))
        .map_err(|error| format!("TEMPLATE_LAYOUT_CACHE_COPY_FAILED: {error}"))?;
    for index in 1..=LAYOUT_RENDER_MAX_LAYOUTS {
        let name = format!("layout{index}.png");
        let source = render_dir.join(&name);
        if source.is_file() {
            fs::copy(&source, staging.join(&name))
                .map_err(|error| format!("TEMPLATE_LAYOUT_CACHE_COPY_FAILED: {error}"))?;
        }
    }
    if cache_dir.exists() {
        fs::remove_dir_all(cache_dir)
            .map_err(|error| format!("TEMPLATE_LAYOUT_CACHE_REPLACE_FAILED: {error}"))?;
    }
    fs::rename(&staging, cache_dir)
        .map_err(|error| format!("TEMPLATE_LAYOUT_CACHE_REPLACE_FAILED: {error}"))?;
    Ok(())
}

/// 限制缓存体积：超出模板数量或总体积上限时，按最旧优先删除。
fn prune_layout_render_cache(cache_root: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(cache_root) else {
        return Ok(());
    };
    let mut candidates: Vec<(SystemTime, PathBuf, u64)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        let size = directory_size(&path);
        candidates.push((modified, path, size));
    }
    candidates.sort_by_key(|candidate| candidate.0);
    let mut total: u64 = candidates.iter().map(|(_, _, size)| *size).sum();
    let mut count = candidates.len();
    for (_, path, size) in candidates {
        if count <= LAYOUT_RENDER_CACHE_MAX_TEMPLATES && total <= LAYOUT_RENDER_CACHE_MAX_BYTES {
            break;
        }
        if fs::remove_dir_all(&path).is_ok() {
            total = total.saturating_sub(size);
            count = count.saturating_sub(1);
        }
    }
    Ok(())
}

/// 目录占用的字节数。统计失败按 0 计，不让统计问题阻断缓存写入。
fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            entry
                .metadata()
                .map(|metadata| {
                    if metadata.is_dir() {
                        directory_size(&entry.path())
                    } else {
                        metadata.len()
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

fn read_zip_text(
    archive: &mut ZipArchive<File>,
    entry_name: &str,
) -> Result<Option<String>, String> {
    const MAX_XML_BYTES: u64 = 8 * 1024 * 1024;
    let Ok(entry) = archive.by_name(entry_name) else {
        return Ok(None);
    };
    if entry.size() > MAX_XML_BYTES {
        return Err("PPTX_XML_ENTRY_TOO_LARGE".into());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(MAX_XML_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("PPTX_XML_READ_FAILED: {error}"))?;
    if bytes.len() as u64 > MAX_XML_BYTES {
        return Err("PPTX_XML_ENTRY_TOO_LARGE".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "PPTX_XML_ENCODING_INVALID".into())
}

/// Resolves a DrawingML scheme colour against the template theme.
fn resolve_scheme_color(
    value: &str,
    theme: &std::collections::HashMap<String, String>,
) -> Option<String> {
    let lowered = value.to_ascii_lowercase();
    let key = match lowered.as_str() {
        "bg1" => "lt1",
        "tx1" => "dk1",
        "bg2" => "lt2",
        "tx2" => "dk2",
        other => other,
    };
    theme.get(key).cloned()
}

/// Reads the ink and the size the template assigned to a placeholder so that
/// generated pages keep the template's own typography instead of a guess.
fn extract_text_style(
    shape: roxmltree::Node<'_, '_>,
    theme: &std::collections::HashMap<String, String>,
) -> (Option<String>, Option<u16>) {
    let Some(body) = shape
        .descendants()
        .find(|node| node.tag_name().name() == "txBody")
    else {
        return (None, None);
    };
    let mut color = None;
    let mut size = None;
    for node in body.descendants() {
        let name = node.tag_name().name();
        if name != "rPr" && name != "defRPr" && name != "endParaRPr" {
            continue;
        }
        if size.is_none() {
            size = node
                .attribute("sz")
                .and_then(|value| value.parse::<u16>().ok())
                .filter(|value| *value >= 100)
                .map(|value| value / 100);
        }
        if color.is_none() {
            let Some(fill) = node
                .children()
                .find(|child| child.tag_name().name() == "solidFill")
            else {
                continue;
            };
            let Some(color_node) = fill.children().find(|child| child.is_element()) else {
                continue;
            };
            color = match color_node.tag_name().name() {
                "srgbClr" => color_node.attribute("val").map(|value| format!("#{value}")),
                "sysClr" => color_node
                    .attribute("lastClr")
                    .map(|value| format!("#{value}")),
                "schemeClr" => color_node
                    .attribute("val")
                    .and_then(|value| resolve_scheme_color(value, theme)),
                _ => None,
            };
        }
    }
    (color, size)
}

fn extract_template_regions(
    document: &roxmltree::Document<'_>,
    theme: &std::collections::HashMap<String, String>,
) -> Vec<TemplateRegion> {
    document
        .descendants()
        .filter(|node| matches!(node.tag_name().name(), "sp" | "pic"))
        .filter_map(|shape| {
            let transform = shape
                .descendants()
                .find(|node| node.tag_name().name() == "xfrm")?;
            let offset = transform
                .children()
                .find(|node| node.tag_name().name() == "off")?;
            let extent = transform
                .children()
                .find(|node| node.tag_name().name() == "ext")?;
            let x = offset.attribute("x")?.parse().ok()?;
            let y = offset.attribute("y")?.parse().ok()?;
            let width = extent.attribute("cx")?.parse().ok()?;
            let height = extent.attribute("cy")?.parse().ok()?;
            if width == 0 || height == 0 {
                return None;
            }
            let placeholder = shape
                .descendants()
                .find(|node| node.tag_name().name() == "ph")
                .and_then(|node| node.attribute("type"));
            let has_text = shape.descendants().any(|node| {
                node.tag_name().name() == "t"
                    && node.text().is_some_and(|text| !text.trim().is_empty())
            });
            let role = if shape.tag_name().name() == "pic"
                || matches!(placeholder, Some("pic" | "clipArt" | "media"))
            {
                "image"
            } else if matches!(placeholder, Some("title" | "ctrTitle")) {
                "title"
            } else if matches!(placeholder, Some("body" | "obj" | "subTitle")) || has_text {
                "body"
            } else {
                return None;
            };
            let (text_color, font_size_pt) = extract_text_style(shape, theme);
            Some(TemplateRegion {
                role: role.into(),
                x,
                y,
                width,
                height,
                text_color,
                font_size_pt,
            })
        })
        .take(32)
        .collect()
}

fn extract_background_color(document: &roxmltree::Document<'_>) -> Option<String> {
    let background = document
        .descendants()
        .find(|node| node.tag_name().name() == "bg")?;
    let fill = background
        .descendants()
        .find(|node| node.tag_name().name() == "solidFill")?;
    let color = fill.children().find(|node| node.is_element())?;
    match color.tag_name().name() {
        "srgbClr" => color.attribute("val").map(|value| format!("#{value}")),
        "sysClr" => color.attribute("lastClr").map(|value| format!("#{value}")),
        "schemeClr" => color.attribute("val").map(str::to_owned),
        _ => None,
    }
}

fn extract_template_decorations(document: &roxmltree::Document<'_>) -> Vec<TemplateDecoration> {
    document
        .descendants()
        .filter(|node| node.tag_name().name() == "sp")
        .filter(|shape| {
            !shape
                .descendants()
                .any(|node| node.tag_name().name() == "ph")
        })
        .filter_map(|shape| {
            let properties = shape
                .children()
                .find(|node| node.tag_name().name() == "spPr")?;
            let transform = properties
                .descendants()
                .find(|node| node.tag_name().name() == "xfrm")?;
            let offset = transform
                .children()
                .find(|node| node.tag_name().name() == "off")?;
            let extent = transform
                .children()
                .find(|node| node.tag_name().name() == "ext")?;
            let x = offset.attribute("x")?.parse().ok()?;
            let y = offset.attribute("y")?.parse().ok()?;
            let width = extent.attribute("cx")?.parse().ok()?;
            let height = extent.attribute("cy")?.parse().ok()?;
            if width == 0 || height == 0 {
                return None;
            }
            let fill_node = properties
                .children()
                .find(|node| node.tag_name().name() == "solidFill")?
                .children()
                .find(|node| node.is_element())?;
            let fill = match fill_node.tag_name().name() {
                "srgbClr" => fill_node.attribute("val").map(|value| format!("#{value}")),
                "sysClr" => fill_node
                    .attribute("lastClr")
                    .map(|value| format!("#{value}")),
                "schemeClr" => fill_node.attribute("val").map(str::to_owned),
                _ => None,
            }?;
            let kind = properties
                .descendants()
                .find(|node| node.tag_name().name() == "prstGeom")
                .and_then(|node| node.attribute("prst"));
            Some(TemplateDecoration {
                shape: if matches!(kind, Some("ellipse")) {
                    "ellipse"
                } else {
                    "rectangle"
                }
                .into(),
                x,
                y,
                width,
                height,
                fill,
            })
        })
        .take(64)
        .collect()
}

#[tauri::command]
pub async fn analyze_pptx_template(
    app: tauri::AppHandle,
    template_id: String,
) -> Result<TemplateAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if template_id.is_empty()
            || template_id.contains('/')
            || template_id.contains('\\')
            || template_id == "."
            || template_id == ".."
        {
            return Err("TEMPLATE_ID_INVALID".into());
        }
        let root = template_root(&app)?;
        let path = root.join(&template_id);
        if !path.starts_with(&root) || !path.is_file() {
            return Err("TEMPLATE_NOT_FOUND".into());
        }
        let file = File::open(path).map_err(|error| format!("TEMPLATE_READ_FAILED: {error}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|error| format!("PPTX_ARCHIVE_INVALID: {error}"))?;
        validate_archive_limits(&mut archive)?;
        let mut slide_count = 0;
        let mut master_count = 0;
        let mut layout_count = 0;
        let mut theme_count = 0;
        for index in 0..archive.len() {
            let name = archive
                .by_index(index)
                .map_err(|error| format!("PPTX_ARCHIVE_READ_FAILED: {error}"))?
                .name()
                .to_owned();
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                slide_count += 1;
            } else if name.starts_with("ppt/slideMasters/slideMaster") && name.ends_with(".xml") {
                master_count += 1;
            } else if name.starts_with("ppt/slideLayouts/slideLayout") && name.ends_with(".xml") {
                layout_count += 1;
            } else if name.starts_with("ppt/theme/theme") && name.ends_with(".xml") {
                theme_count += 1;
            }
        }

        let mut slide_width_emu = None;
        let mut slide_height_emu = None;
        if let Some(xml) = read_zip_text(&mut archive, "ppt/presentation.xml")? {
            let document = roxmltree::Document::parse(&xml)
                .map_err(|error| format!("PPTX_PRESENTATION_XML_INVALID: {error}"))?;
            if let Some(size) = document
                .descendants()
                .find(|node| node.tag_name().name() == "sldSz")
            {
                slide_width_emu = size.attribute("cx").and_then(|value| value.parse().ok());
                slide_height_emu = size.attribute("cy").and_then(|value| value.parse().ok());
            }
        }

        let mut theme_colors = Vec::new();
        let mut major_font = None;
        let mut minor_font = None;
        let mut theme_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        if let Some(xml) = read_zip_text(&mut archive, "ppt/theme/theme1.xml")? {
            let document = roxmltree::Document::parse(&xml)
                .map_err(|error| format!("PPTX_THEME_XML_INVALID: {error}"))?;
            if let Some(scheme) = document
                .descendants()
                .find(|node| node.tag_name().name() == "clrScheme")
            {
                for color in scheme.children().filter(|node| node.is_element()) {
                    if let Some(value_node) = color.children().find(|node| node.is_element()) {
                        if let Some(value) = value_node
                            .attribute("val")
                            .or_else(|| value_node.attribute("lastClr"))
                        {
                            let resolved = format!("#{value}");
                            theme_map.insert(
                                color.tag_name().name().to_ascii_lowercase(),
                                resolved.clone(),
                            );
                            theme_colors.push(TemplateThemeColor {
                                name: color.tag_name().name().to_owned(),
                                value: resolved,
                            });
                        }
                    }
                }
            }
            let theme_font = |family: &str| {
                document
                    .descendants()
                    .find(|node| node.tag_name().name() == family)
                    .and_then(|node| {
                        node.descendants()
                            .find(|child| {
                                child.tag_name().name() == "ea"
                                    && child
                                        .attribute("typeface")
                                        .is_some_and(|value| !value.is_empty())
                            })
                            .or_else(|| {
                                node.descendants().find(|child| {
                                    child.tag_name().name() == "font"
                                        && matches!(
                                            child.attribute("script"),
                                            Some("Hans" | "Hant")
                                        )
                                        && child
                                            .attribute("typeface")
                                            .is_some_and(|value| !value.is_empty())
                                })
                            })
                            .or_else(|| {
                                node.descendants()
                                    .find(|child| child.tag_name().name() == "latin")
                            })
                    })
                    .and_then(|node| node.attribute("typeface"))
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
            };
            major_font = theme_font("majorFont");
            minor_font = theme_font("minorFont");
        }

        let mut slide_entries = Vec::new();
        for index in 0..archive.len() {
            let name = archive
                .by_index(index)
                .map_err(|error| format!("PPTX_ARCHIVE_READ_FAILED: {error}"))?
                .name()
                .to_owned();
            if let Some(number) = name
                .strip_prefix("ppt/slides/slide")
                .and_then(|value| value.strip_suffix(".xml"))
                .and_then(|value| value.parse::<usize>().ok())
            {
                slide_entries.push((number, name));
            }
        }
        slide_entries.sort_by_key(|(number, _)| *number);
        let mut slides = Vec::with_capacity(slide_entries.len());
        for (number, entry_name) in slide_entries {
            let Some(xml) = read_zip_text(&mut archive, &entry_name)? else {
                continue;
            };
            let document = roxmltree::Document::parse(&xml)
                .map_err(|error| format!("PPTX_SLIDE_XML_INVALID: {error}"))?;
            let text_nodes: Vec<&str> = document
                .descendants()
                .filter(|node| node.tag_name().name() == "t")
                .filter_map(|node| node.text())
                .filter(|text| !text.trim().is_empty())
                .collect();
            let title = document
                .descendants()
                .filter(|node| node.tag_name().name() == "sp")
                .find_map(|shape| {
                    let is_title = shape.descendants().any(|node| {
                        node.tag_name().name() == "ph"
                            && matches!(node.attribute("type"), Some("title" | "ctrTitle"))
                    });
                    is_title.then(|| {
                        shape
                            .descendants()
                            .filter(|node| node.tag_name().name() == "t")
                            .filter_map(|node| node.text())
                            .collect::<Vec<_>>()
                            .join("")
                    })
                })
                .filter(|value| !value.trim().is_empty())
                .or_else(|| text_nodes.first().map(|value| (*value).to_owned()))
                .unwrap_or_else(|| format!("第 {number} 页"));
            let relationship_name = format!("ppt/slides/_rels/slide{number}.xml.rels");
            let layout =
                read_zip_text(&mut archive, &relationship_name)?.and_then(|relationships| {
                    roxmltree::Document::parse(&relationships)
                        .ok()
                        .and_then(|doc| {
                            doc.descendants()
                                .find(|node| {
                                    node.tag_name().name() == "Relationship"
                                        && node
                                            .attribute("Type")
                                            .is_some_and(|value| value.ends_with("/slideLayout"))
                                })
                                .and_then(|node| node.attribute("Target"))
                                .and_then(|target| target.rsplit('/').next())
                                .map(str::to_owned)
                        })
                });
            let regions = extract_template_regions(&document, &theme_map);
            let background_color = extract_background_color(&document);
            let decorations = extract_template_decorations(&document);
            slides.push(TemplateSlideSummary {
                index: number,
                title,
                text_count: text_nodes.len(),
                image_count: document
                    .descendants()
                    .filter(|node| node.tag_name().name() == "pic")
                    .count(),
                shape_count: document
                    .descendants()
                    .filter(|node| node.tag_name().name() == "sp")
                    .count(),
                layout,
                background_color,
                decorations,
                regions,
            });
        }

        let mut layouts = Vec::new();
        for number in 1..=layout_count {
            let entry_name = format!("ppt/slideLayouts/slideLayout{number}.xml");
            let Some(xml) = read_zip_text(&mut archive, &entry_name)? else {
                continue;
            };
            let document = roxmltree::Document::parse(&xml)
                .map_err(|error| format!("PPTX_LAYOUT_XML_INVALID: {error}"))?;
            let name = document
                .descendants()
                .find(|node| node.tag_name().name() == "cSld")
                .and_then(|node| node.attribute("name"))
                .unwrap_or("未命名版式")
                .to_owned();
            // Keep only placeholders explicitly declared by this layout. Copying all
            // master placeholders into every layout makes cover layouts look like
            // content layouts and causes the cover artwork to be reused everywhere.
            let regions = extract_template_regions(&document, &theme_map);
            let background_color = extract_background_color(&document);
            let decorations = extract_template_decorations(&document);
            layouts.push(TemplateLayoutSummary {
                index: number,
                name,
                background_color,
                decorations,
                regions,
            });
        }

        let mut warnings = Vec::new();
        if slide_count == 0 {
            warnings.push("未发现可解析的幻灯片页面".into());
        }
        if theme_count == 0 {
            warnings.push("未发现 OOXML 主题定义".into());
        }
        warnings.push("动画、切换、SmartArt、视频和宏尚未解析".into());
        let master_xml = read_zip_text(&mut archive, "ppt/slideMasters/slideMaster1.xml")?;
        let default_background_color = master_xml.as_ref().and_then(|xml| {
            roxmltree::Document::parse(xml)
                .ok()
                .and_then(|document| extract_background_color(&document))
        });
        let default_decorations = master_xml
            .as_ref()
            .and_then(|xml| {
                roxmltree::Document::parse(xml)
                    .ok()
                    .map(|document| extract_template_decorations(&document))
            })
            .unwrap_or_default();
        Ok(TemplateAnalysis {
            slide_count,
            slide_width_emu,
            slide_height_emu,
            master_count,
            layout_count,
            theme_count,
            theme_colors,
            major_font,
            minor_font,
            default_background_color,
            default_decorations,
            slides,
            layouts,
            warnings,
        })
    })
    .await
    .map_err(|error| format!("TEMPLATE_ANALYSIS_TASK_FAILED: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn saves_and_opens_a_project() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.pptd");
        let value = json!({ "schemaVersion": 1, "title": "测试" });
        save_project(path.to_string_lossy().into_owned(), value.clone())
            .await
            .unwrap();
        assert_eq!(
            open_project(path.to_string_lossy().into_owned())
                .await
                .unwrap(),
            value
        );
    }

    #[tokio::test]
    async fn project_json_is_not_rejected_at_the_previous_size_boundary() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.pptd");
        let value = json!({ "schemaVersion": 2, "payload": "x".repeat(17 * 1024 * 1024) });
        save_project(path.to_string_lossy().into_owned(), value)
            .await
            .unwrap();
        assert!(path.metadata().unwrap().len() > 16 * 1024 * 1024);
    }

    #[tokio::test]
    async fn rejects_wrong_extensions_and_invalid_pptx_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let wrong = directory.path().join("sample.json");
        assert_eq!(
            save_project(wrong.to_string_lossy().into_owned(), json!({}))
                .await
                .unwrap_err(),
            "INVALID_FILE_EXTENSION"
        );

        let pptx = directory.path().join("sample.pptx");
        assert_eq!(
            write_pptx(pptx.to_string_lossy().into_owned(), b"not a zip".to_vec()).unwrap_err(),
            "PPTX_ZIP_SIGNATURE_INVALID"
        );
    }

    #[tokio::test]
    async fn stores_embedded_images_in_the_project_asset_directory() {
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
        save_project(path.to_string_lossy().into_owned(), value.clone())
            .await
            .unwrap();
        let stored: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let stored_url = stored
            .pointer("/slides/0/elements/0/source/dataUrl")
            .and_then(Value::as_str)
            .unwrap();
        // 图片按内容哈希命名，同一张图只落盘一次，纯文字编辑不再重写图片。
        assert!(stored_url.starts_with("asset://") && stored_url.ends_with(".png"));
        let file_name = stored_url.strip_prefix("asset://").unwrap();
        assert_eq!(
            file_name.len(),
            64 + 4,
            "资源文件名应是 64 位十六进制摘要加扩展名"
        );
        assert!(directory
            .path()
            .join("images.pptd.assets")
            .join(file_name)
            .is_file());
        // 打开时不再把所有图片还原成 base64：内容寻址引用保持原样，前端按需读取。
        let opened = open_project(path.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(
            opened
                .pointer("/slides/0/elements/0/source/dataUrl")
                .and_then(Value::as_str),
            Some(stored_url)
        );
    }

    #[test]
    fn rejects_archive_entries_that_escape_the_extraction_root() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hostile.pptx");
        let file = File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../evil.xml", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"<xml/>").unwrap();
        writer.finish().unwrap();
        let mut archive = ZipArchive::new(File::open(&path).unwrap()).unwrap();
        assert_eq!(
            validate_archive_limits(&mut archive).unwrap_err(),
            "PPTX_ARCHIVE_ENTRY_PATH_INVALID"
        );
    }

    #[test]
    fn extracts_title_and_body_regions_from_ooxml_layouts() {
        let xml = r#"<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:sp>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="500" y="600"/><a:ext cx="700" cy="800"/></a:xfrm></p:spPr></p:sp>
          <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></p:spPr></p:sp>
        </p:spTree></p:cSld></p:sldLayout>"#;
        let document = roxmltree::Document::parse(xml).unwrap();
        let regions = extract_template_regions(&document, &std::collections::HashMap::new());
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].role, "title");
        assert_eq!(
            (
                regions[0].x,
                regions[0].y,
                regions[0].width,
                regions[0].height
            ),
            (100, 200, 300, 400)
        );
        assert_eq!(regions[1].role, "body");
    }

    #[test]
    fn reads_the_ink_and_size_a_layout_assigned_to_its_placeholders() {
        let xml = r#"<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>
            <p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="2600"><a:solidFill><a:srgbClr val="273D79"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle></p:txBody>
          </p:sp>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="500" y="600"/><a:ext cx="700" cy="800"/></a:xfrm></p:spPr>
            <p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle></p:txBody>
          </p:sp>
        </p:spTree></p:cSld></p:sldLayout>"#;
        let document = roxmltree::Document::parse(xml).unwrap();
        let theme = std::collections::HashMap::from([("lt1".to_owned(), "#FFFFFF".to_owned())]);
        let regions = extract_template_regions(&document, &theme);
        assert_eq!(regions[0].text_color.as_deref(), Some("#273D79"));
        assert_eq!(regions[0].font_size_pt, Some(26));
        assert_eq!(regions[1].text_color.as_deref(), Some("#FFFFFF"));
        assert_eq!(regions[1].font_size_pt, Some(18));
    }

    #[test]
    fn extracts_direct_and_theme_background_colors() {
        let direct = roxmltree::Document::parse(r#"<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F5F1E8"/></a:solidFill></p:bgPr></p:bg></p:cSld></p:sld>"#).unwrap();
        let themed = roxmltree::Document::parse(r#"<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg></p:cSld></p:sldLayout>"#).unwrap();
        assert_eq!(
            extract_background_color(&direct).as_deref(),
            Some("#F5F1E8")
        );
        assert_eq!(extract_background_color(&themed).as_deref(), Some("bg1"));
    }

    /// 一份带内嵌图片的恢复文档，用来验证恢复链路真的能把图片带回来。
    fn recovery_document() -> Value {
        json!({
            "schemaVersion": 2,
            "title": "恢复测试",
            "revisions": { "document": 3 },
            "slides": [{
                "elements": [{
                    "id": "33333333-3333-4333-8333-333333333333",
                    "type": "image",
                    "source": { "kind": "embedded", "dataUrl": "data:image/png;base64,iVBORw0KGgo=", "mimeType": "image/png" }
                }]
            }]
        })
    }

    #[test]
    fn saves_and_restores_a_recovery_copy() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("latest.pptd");
        let value = json!({ "schemaVersion": 2, "title": "恢复测试" });

        save_recovery_at(&path, value.clone(), None).unwrap();

        assert_eq!(load_recovery_at(&path).unwrap(), Some(value));
    }

    #[test]
    fn restores_the_embedded_images_of_a_recovery_copy() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("latest.pptd");

        save_recovery_at(&path, recovery_document(), None).unwrap();

        // 落盘时图片变成资源引用，读回时必须还原成内嵌数据。
        let stored: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let stored_url = stored
            .pointer("/slides/0/elements/0/source/dataUrl")
            .and_then(Value::as_str)
            .unwrap();
        assert!(stored_url.starts_with("asset://") && stored_url.ends_with(".png"));
        // 内容寻址引用在打开时保持原样，前端按需读取，不再还原成 base64。
        let restored = load_recovery_at(&path)
            .unwrap()
            .expect("recovery copy must exist");
        assert_eq!(
            restored
                .pointer("/slides/0/elements/0/source/dataUrl")
                .and_then(Value::as_str),
            Some(stored_url)
        );
    }

    #[test]
    fn carries_the_pictures_of_a_project_into_the_recovery_copy() {
        // 文档里的图片是指向项目资源目录的引用。恢复副本写在别处时必须把图片
        // 一起带走，否则恢复出来的文档只剩引用，图片全丢。
        let directory = tempfile::tempdir().unwrap();
        let project = directory.path().join("project.pptd");
        let recovery = directory.path().join("latest.pptd");
        let reference = format!("{}.png", "a".repeat(64));
        fs::create_dir_all(assets_root(&project).unwrap()).unwrap();
        fs::write(
            assets_root(&project).unwrap().join(&reference),
            b"picture bytes",
        )
        .unwrap();
        let document = json!({
            "schemaVersion": 2,
            "title": "带图恢复",
            "slides": [{
                "elements": [{
                    "id": "33333333-3333-4333-8333-333333333333",
                    "type": "image",
                    "source": { "kind": "embedded", "dataUrl": format!("asset://{reference}"), "mimeType": "image/png" }
                }]
            }]
        });

        save_recovery_at(&recovery, document, Some(&project)).unwrap();

        assert!(assets_root(&recovery).unwrap().join(&reference).is_file());
    }

    #[test]
    fn reports_a_corrupt_recovery_copy_instead_of_returning_half_a_document() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("latest.pptd");
        fs::write(&path, b"{ this is not json").unwrap();

        let error = load_recovery_at(&path).unwrap_err();

        assert!(error.starts_with("RECOVERY_JSON_INVALID"));
    }

    #[test]
    fn has_no_recovery_copy_until_one_is_written() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("latest.pptd");

        assert_eq!(load_recovery_at(&path).unwrap(), None);
    }

    #[test]
    fn clears_the_recovery_copy_and_its_assets() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("latest.pptd");
        save_recovery_at(&path, recovery_document(), None).unwrap();
        assert!(assets_root(&path).unwrap().exists());

        clear_recovery_at(&path).unwrap();

        assert!(!path.exists());
        assert!(!assets_root(&path).unwrap().exists());
        // 清除一个不存在的恢复副本不应该是错误。
        clear_recovery_at(&path).unwrap();
    }

    #[test]
    fn never_exposes_a_half_written_file() {
        // 保存中断的可观测后果只有一个：读者永远只能看到完整的旧版本或完整的新版本，
        // 不能看到写了一半的文件。
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.pptd");
        let first = vec![b'a'; 64 * 1024];
        let second = vec![b'b'; 64 * 1024];
        atomic_write(&path, &first).unwrap();

        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        let reader_path = path.clone();
        let reader_first = first.clone();
        let reader_second = second.clone();
        let reader = std::thread::spawn(move || {
            while !flag.load(std::sync::atomic::Ordering::SeqCst) {
                if let Ok(bytes) = fs::read(&reader_path) {
                    assert!(
                        bytes == reader_first || bytes == reader_second,
                        "a reader must never see a half-written file"
                    );
                }
                // 真实的读取是零散的，不是死循环占用。
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        });
        for _ in 0..30 {
            atomic_write(&path, &second).unwrap();
            atomic_write(&path, &first).unwrap();
        }
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        reader.join().unwrap();
    }

    #[test]
    fn a_failed_replacement_leaves_the_previous_version_intact() {
        // 目标是已存在的目录时替换必然失败：失败不能留下半截文件。
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.pptd");
        fs::create_dir(&path).unwrap();

        let error = atomic_write(&path, b"{\"version\":2}").unwrap_err();

        assert!(error.starts_with("FILE_REPLACE_FAILED"), "{error}");
        assert!(path.is_dir());
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
    }

    #[test]
    fn concurrent_saves_do_not_fail_each_other() {
        // 自动保存和手动保存可能同时触发。两个任务都写同一个文件时，
        // 后替换的那个不应该拿到"拒绝访问"。
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.pptd");
        let failures = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut handles = Vec::new();
        for worker in 0..4_u8 {
            let path = path.clone();
            let failures = failures.clone();
            handles.push(std::thread::spawn(move || {
                for round in 0..10 {
                    let payload = format!("{{\"worker\":{worker},\"round\":{round}}}");
                    if let Err(error) = atomic_write(&path, payload.as_bytes()) {
                        failures.lock().unwrap().push(error);
                    }
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        let failures = failures.lock().unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        // 最后写入的内容必须是某一次完整写入的结果。
        let stored: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(stored.get("worker").is_some());
    }

    #[test]
    fn replaces_the_previous_version_without_leaving_a_partial_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.pptd");

        atomic_write(&path, b"{\"version\":1}").unwrap();
        atomic_write(&path, b"{\"version\":2}").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"{\"version\":2}");
        // 临时文件被替换掉了，目录里只应该剩下目标文件。
        let leftovers = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name() != "project.pptd")
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn layout_render_cache_round_trips_the_rendered_layouts() {
        let directory = tempfile::tempdir().unwrap();
        let render_dir = directory.path().join("renders");
        fs::create_dir_all(&render_dir).unwrap();
        fs::write(render_dir.join("layouts.tsv"), "1\t标题页\n2\t正文页\n").unwrap();
        fs::write(render_dir.join("layout1.png"), b"first").unwrap();
        fs::write(render_dir.join("layout2.png"), b"second").unwrap();

        let cache_dir = directory.path().join("cache").join("v1-abc");
        write_layout_render_cache(&cache_dir, &render_dir).unwrap();

        let cached = read_layout_render_cache(&cache_dir).unwrap();
        assert_eq!(cached.len(), 2);
        assert_eq!(cached[0].layout_index, 1);
        assert_eq!(cached[0].layout_name, "标题页");
        assert!(cached[0].data_url.starts_with("data:image/png;base64,"));
        assert_eq!(cached[1].layout_name, "正文页");
    }

    #[test]
    fn an_incomplete_layout_render_cache_is_treated_as_a_miss() {
        let directory = tempfile::tempdir().unwrap();
        let cache_dir = directory.path().join("cache");
        fs::create_dir_all(&cache_dir).unwrap();
        // 只有清单没有图片：不算命中，必须重新渲染。
        fs::write(cache_dir.join("layouts.tsv"), "1\t标题页\n").unwrap();
        assert!(read_layout_render_cache(&cache_dir).is_none());
    }

    #[test]
    fn the_layout_render_cache_key_follows_the_template_content() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("first.pptx");
        let second = directory.path().join("second.pptx");
        fs::write(&first, b"template-one").unwrap();
        fs::write(&second, b"template-two").unwrap();

        let first_hash = template_content_hash(&first).unwrap();
        let second_hash = template_content_hash(&second).unwrap();
        assert_ne!(first_hash, second_hash);
        // 同一份内容重复上传命中同一份缓存，替换内容则重新渲染。
        assert_eq!(first_hash, template_content_hash(&first).unwrap());
        assert_eq!(
            layout_render_cache_key(&first_hash),
            layout_render_cache_key(&template_content_hash(&first).unwrap())
        );
    }

    #[test]
    fn pruning_keeps_the_layout_render_cache_within_its_template_limit() {
        let directory = tempfile::tempdir().unwrap();
        let cache_root = directory.path().join("cache");
        fs::create_dir_all(&cache_root).unwrap();
        for index in 0..(LAYOUT_RENDER_CACHE_MAX_TEMPLATES + 3) {
            let entry = cache_root.join(format!("v1-{index}"));
            fs::create_dir_all(&entry).unwrap();
            fs::write(entry.join("layouts.tsv"), format!("1\t版式{index}\n")).unwrap();
        }

        prune_layout_render_cache(&cache_root).unwrap();

        let remaining = fs::read_dir(&cache_root).unwrap().count();
        assert!(
            remaining <= LAYOUT_RENDER_CACHE_MAX_TEMPLATES,
            "{remaining}"
        );
    }
}
