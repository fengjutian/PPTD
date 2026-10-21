use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tempfile::NamedTempFile;
use zip::ZipArchive;

const MAX_IMAGE_BYTES: usize = 256 * 1024 * 1024;
const MAX_PROJECT_ASSET_BYTES: usize = 4 * 1024 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 100 * 1024 * 1024;
const MAX_TEMPLATE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TEMPLATE_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;

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
    regions: Vec<TemplateRegion>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRegion {
    role: String,
    x: u64,
    y: u64,
    width: u64,
    height: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateLayoutSummary {
    index: usize,
    name: String,
    background_color: Option<String>,
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
    slides: Vec<TemplateSlideSummary>,
    layouts: Vec<TemplateLayoutSummary>,
    warnings: Vec<String>,
}

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

fn current_asset_version(document: &Value) -> String {
    let revision = document
        .pointer("/revisions/document")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    format!("revision-{revision}")
}

fn cleanup_old_asset_versions(path: &Path, keep: &str) {
    let Ok(root) = assets_root(path) else { return };
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.starts_with("revision-") && name != keep {
            let _ = fs::remove_dir_all(entry.path());
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
    atomic_write_json(&path, &document)?;
    cleanup_old_asset_versions(&path, &current_asset_version(&document));
    Ok(())
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
pub fn save_recovery(app: tauri::AppHandle, mut document: Value) -> Result<(), String> {
    let path = recovery_path(&app)?;
    externalize_images(&path, &mut document)?;
    atomic_write_json(&path, &document)?;
    cleanup_old_asset_versions(&path, &current_asset_version(&document));
    Ok(())
}

#[tauri::command]
pub fn load_recovery(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = recovery_path(&app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let file = File::open(&path).map_err(|error| format!("RECOVERY_OPEN_FAILED: {error}"))?;
    let mut document: Value =
        serde_json::from_reader(file).map_err(|error| format!("RECOVERY_JSON_INVALID: {error}"))?;
    hydrate_images(&path, &mut document)?;
    Ok(Some(document))
}

#[tauri::command]
pub fn clear_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("RECOVERY_DELETE_FAILED: {error}"))?;
    }
    let assets = assets_root(&path)?;
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
pub fn import_pptx_template(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<TemplateRecord, String> {
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
    fs::copy(&source, root.join(&id)).map_err(|error| format!("TEMPLATE_COPY_FAILED: {error}"))?;
    Ok(TemplateRecord {
        id,
        name,
        size: metadata.len(),
        imported_at,
    })
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
pub fn get_pptx_template_preview(
    app: tauri::AppHandle,
    template_id: String,
) -> Result<Option<String>, String> {
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

fn extract_template_regions(document: &roxmltree::Document<'_>) -> Vec<TemplateRegion> {
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
            Some(TemplateRegion {
                role: role.into(),
                x,
                y,
                width,
                height,
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

#[tauri::command]
pub fn analyze_pptx_template(
    app: tauri::AppHandle,
    template_id: String,
) -> Result<TemplateAnalysis, String> {
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
                        theme_colors.push(TemplateThemeColor {
                            name: color.tag_name().name().to_owned(),
                            value: format!("#{value}"),
                        });
                    }
                }
            }
        }
        major_font = document
            .descendants()
            .find(|node| node.tag_name().name() == "majorFont")
            .and_then(|node| {
                node.descendants()
                    .find(|child| child.tag_name().name() == "latin")
            })
            .and_then(|node| node.attribute("typeface"))
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        minor_font = document
            .descendants()
            .find(|node| node.tag_name().name() == "minorFont")
            .and_then(|node| {
                node.descendants()
                    .find(|child| child.tag_name().name() == "latin")
            })
            .and_then(|node| node.attribute("typeface"))
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
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
        let layout = read_zip_text(&mut archive, &relationship_name)?.and_then(|relationships| {
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
        let regions = extract_template_regions(&document);
        let background_color = extract_background_color(&document);
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
        let regions = extract_template_regions(&document);
        let background_color = extract_background_color(&document);
        if !regions.is_empty() {
            layouts.push(TemplateLayoutSummary {
                index: number,
                name,
                background_color,
                regions,
            });
        }
    }

    let mut warnings = Vec::new();
    if slide_count == 0 {
        warnings.push("未发现可解析的幻灯片页面".into());
    }
    if theme_count == 0 {
        warnings.push("未发现 OOXML 主题定义".into());
    }
    warnings.push("动画、切换、SmartArt、视频和宏尚未解析".into());
    let default_background_color =
        read_zip_text(&mut archive, "ppt/slideMasters/slideMaster1.xml")?.and_then(|xml| {
            roxmltree::Document::parse(&xml)
                .ok()
                .and_then(|document| extract_background_color(&document))
        });
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
        slides,
        layouts,
        warnings,
    })
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

    #[test]
    fn extracts_title_and_body_regions_from_ooxml_layouts() {
        let xml = r#"<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:sp>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="500" y="600"/><a:ext cx="700" cy="800"/></a:xfrm></p:spPr></p:sp>
          <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></p:spPr></p:sp>
        </p:spTree></p:cSld></p:sldLayout>"#;
        let document = roxmltree::Document::parse(xml).unwrap();
        let regions = extract_template_regions(&document);
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
    fn extracts_direct_and_theme_background_colors() {
        let direct = roxmltree::Document::parse(r#"<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F5F1E8"/></a:solidFill></p:bgPr></p:bg></p:cSld></p:sld>"#).unwrap();
        let themed = roxmltree::Document::parse(r#"<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg></p:cSld></p:sldLayout>"#).unwrap();
        assert_eq!(
            extract_background_color(&direct).as_deref(),
            Some("#F5F1E8")
        );
        assert_eq!(extract_background_color(&themed).as_deref(), Some("bg1"));
    }
}
