//! Level A PPTX content import.
//!
//! The template importer only reads a deck's design language. This module reads
//! the page content itself: page size and order, text, pictures, basic shapes,
//! basic tables, theme colours/fonts and speaker notes. Everything it cannot
//! map into the editor's document model is reported instead of being guessed.
//!
//! Security is handled before any XML is parsed: file size, ZIP entry count,
//! uncompressed size, entry paths, external relationships and media size are
//! all bounded here.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use roxmltree::{Document, Node};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};
use zip::ZipArchive;

const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 4_096;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 20 * 1024 * 1024;
const MAX_SLIDES: usize = 200;
const MAX_ELEMENTS_PER_SLIDE: usize = 500;
const MAX_MEDIA_BYTES: usize = 20 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES: usize = 200 * 1024 * 1024;
const DEFAULT_PAGE_WIDTH: i64 = 12_192_000;
const DEFAULT_PAGE_HEIGHT: i64 = 6_858_000;

const REL_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Tracks which import requests the user has cancelled.
///
/// The reader checks between pages, which is enough to stop a large deck before
/// it spends time on the remaining slides without making the XML parser
/// re-entrant or cancellable mid-node.
#[derive(Default, Clone)]
pub struct ImportCancellation {
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl ImportCancellation {
    fn cancel(&self, request_id: &str) {
        if let Ok(mut set) = self.cancelled.lock() {
            set.insert(request_id.to_string());
        }
    }

    fn is_cancelled(&self, request_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|set| set.contains(request_id))
            .unwrap_or(false)
    }

    fn release(&self, request_id: &str) {
        if let Ok(mut set) = self.cancelled.lock() {
            set.remove(request_id);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    request_id: String,
    current: usize,
    total: usize,
    stage: String,
}

struct ImportSession {
    app: AppHandle,
    request_id: String,
    cancellation: ImportCancellation,
}

impl ImportSession {
    fn check(&self) -> Result<(), String> {
        if self.cancellation.is_cancelled(&self.request_id) {
            Err("PPTX_IMPORT_CANCELLED".into())
        } else {
            Ok(())
        }
    }

    fn progress(&self, current: usize, total: usize) {
        let _ = self.app.emit(
            "pptx-import-progress",
            ImportProgress {
                request_id: self.request_id.clone(),
                current,
                total,
                stage: "slides".into(),
            },
        );
    }
}

#[derive(Debug, Serialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFrame {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDeck {
    pub title: String,
    pub page_size: ImportedSize,
    pub slides: Vec<ImportedSlide>,
    pub theme: Option<ImportedTheme>,
    pub report: ImportReport,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSize {
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSlide {
    pub index: usize,
    pub title: Option<String>,
    pub body: Option<String>,
    pub speaker_notes: String,
    pub elements: Vec<ImportedElement>,
    /// Indexes into `elements` for each imported selection group.
    pub groups: Vec<Vec<usize>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTextStyle {
    pub font_family: String,
    pub font_size_pt: f64,
    pub color: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub align: String,
    pub vertical_align: String,
    pub line_height: Option<f64>,
    pub bullet: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRun {
    pub start: usize,
    pub end: usize,
    pub bold: bool,
    pub color: String,
    pub underline: bool,
}

#[derive(Debug, Serialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCrop {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportedElement {
    Text {
        frame: ImportedFrame,
        rotation_milli_degree: i64,
        text: String,
        style: ImportedTextStyle,
        runs: Vec<ImportedRun>,
        content_ref: Option<String>,
    },
    Image {
        frame: ImportedFrame,
        rotation_milli_degree: i64,
        data_url: String,
        mime_type: String,
        alt_text: String,
        crop: Option<ImportedCrop>,
    },
    Shape {
        frame: ImportedFrame,
        rotation_milli_degree: i64,
        shape: String,
        fill: String,
        stroke: String,
        stroke_width_pt: f64,
        radius_pt: f64,
    },
    Line {
        frame: ImportedFrame,
        rotation_milli_degree: i64,
        direction: String,
        stroke: String,
        stroke_width_pt: f64,
        dashed: bool,
        start_arrow: bool,
        end_arrow: bool,
    },
    Table {
        frame: ImportedFrame,
        rotation_milli_degree: i64,
        header: Vec<String>,
        rows: Vec<Vec<String>>,
        merges: Vec<ImportedTableMerge>,
    },
    Chart {
        frame: ImportedFrame,
        rotation_milli_degree: i64,
        kind: String,
        categories: Vec<String>,
        values: Vec<f64>,
        colors: Vec<String>,
        show_legend: bool,
        show_values: bool,
    },
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTableMerge {
    pub section: String,
    pub row: usize,
    pub column: usize,
    pub row_span: usize,
    pub column_span: usize,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportCounts {
    pub text: usize,
    pub image: usize,
    pub shape: usize,
    pub table: usize,
    pub chart: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportUnsupported {
    pub slide_index: usize,
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssets {
    pub extracted: usize,
    pub skipped: usize,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub format: String,
    pub compatibility: String,
    pub slide_count: usize,
    pub counts: ImportCounts,
    pub unsupported: Vec<ImportUnsupported>,
    pub warnings: Vec<String>,
    pub assets: ImportAssets,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedColor {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTheme {
    pub major_font: Option<String>,
    pub minor_font: Option<String>,
    pub colors: Vec<ImportedColor>,
}

#[derive(Clone, Debug)]
struct Rel {
    target: String,
    external: bool,
    kind: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct PlaceholderKey {
    idx: String,
    ph_type: String,
}

#[derive(Clone, Debug)]
struct TextBody {
    text: String,
    style: ImportedTextStyle,
    runs: Vec<ImportedRun>,
}

#[derive(Default)]
struct DeckReport {
    unsupported: Vec<ImportUnsupported>,
    warnings: Vec<String>,
    counts: ImportCounts,
    assets: ImportAssets,
    has_level_b: bool,
    has_level_c: bool,
}

impl DeckReport {
    fn unsupported(&mut self, slide_index: usize, kind: &str, detail: &str) {
        let kind_lower = kind.to_ascii_lowercase();
        if kind_lower.contains("smartart") || kind_lower.contains("ole") {
            self.has_level_c = true;
        } else {
            self.has_level_b = true;
        }
        self.unsupported.push(ImportUnsupported {
            slide_index,
            kind: kind.to_string(),
            detail: detail.to_string(),
        });
    }

    fn warning(&mut self, message: impl Into<String>) {
        self.warnings.push(message.into());
    }
}

/// Import the content of a `.pptx` into a neutral, editor-agnostic structure.
#[tauri::command]
pub async fn import_pptx_content(
    app: AppHandle,
    cancellation: State<'_, ImportCancellation>,
    path: String,
    request_id: String,
    source_format: Option<String>,
) -> Result<ImportedDeck, String> {
    let cancellation = cancellation.inner().clone();
    let session_registry = cancellation.clone();
    let session_id = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let session = ImportSession {
            app,
            request_id: session_id,
            cancellation: session_registry,
        };
        let mut deck = import_sync(Path::new(&path), Some(&session))?;
        // A `.ppt` is converted to a temporary `.pptx` before parsing. The
        // report must say that the user opened the legacy format, not hide the
        // conversion behind a file that happens to be called `.pptx` here.
        if source_format.as_deref() == Some("ppt") {
            deck.report.format = "ppt".into();
            deck.report.warnings.push(
                "旧版 .ppt 已通过本机 PowerPoint 转换为 .pptx 后导入；转换失败时不会回退到其他转换器"
                    .into(),
            );
        }
        Ok::<ImportedDeck, String>(deck)
    })
    .await;
    cancellation.release(&request_id);
    match result {
        Ok(value) => value,
        Err(error) => Err(format!("PPTX_IMPORT_TASK_FAILED: {error}")),
    }
}

/// Ask a running import to stop after the current page.
#[tauri::command]
pub fn cancel_pptx_import(
    cancellation: State<'_, ImportCancellation>,
    request_id: String,
) -> Result<(), String> {
    cancellation.cancel(&request_id);
    Ok(())
}

fn import_sync(source: &Path, session: Option<&ImportSession>) -> Result<ImportedDeck, String> {
    let source = validate_source(source)?;
    let file = File::open(&source).map_err(|error| format!("PPTX_IMPORT_OPEN_FAILED: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("PPTX_ARCHIVE_INVALID: {error}"))?;
    validate_archive(&mut archive)?;

    let presentation_xml =
        read_xml(&mut archive, "ppt/presentation.xml")?.ok_or("PPTX_PRESENTATION_MISSING")?;
    let presentation_rels = read_relationships(&mut archive, "ppt/presentation.xml");
    let (page_size, slide_relations) = parse_presentation(&presentation_xml)?;
    if slide_relations.is_empty() {
        return Err("PPTX_NO_SLIDES".into());
    }
    if slide_relations.len() > MAX_SLIDES {
        return Err("PPTX_TOO_MANY_SLIDES".into());
    }

    let theme = read_theme(&mut archive);
    let mut report = DeckReport::default();
    let mut media_cache: HashMap<String, (String, String)> = HashMap::new();
    let mut slides = Vec::new();

    let total_slides = slide_relations.len();
    if let Some(session) = session {
        session.check()?;
        session.progress(0, total_slides);
    }

    for (index, relation_id) in slide_relations.iter().enumerate() {
        if let Some(session) = session {
            session.check()?;
        }
        let Some(rel) = presentation_rels.get(relation_id) else {
            report.unsupported(index, "slide", "页面关系缺失");
            continue;
        };
        if rel.external {
            report.unsupported(index, "slide", "外部页面关系已跳过");
            continue;
        }
        let target = resolve_target("ppt/presentation.xml", &rel.target);
        let Some(xml) = read_xml(&mut archive, &target)? else {
            report.unsupported(index, "slide", "页面 XML 缺失");
            continue;
        };
        let slide = parse_slide(
            index,
            &xml,
            &target,
            &mut archive,
            &mut media_cache,
            &theme,
            &mut report,
            session,
        )?;
        slides.push(slide);
        if let Some(session) = session {
            session.progress(index + 1, total_slides);
        }
    }

    if slides.is_empty() {
        return Err("PPTX_NO_READABLE_SLIDES".into());
    }

    let compatibility = if report.has_level_c {
        "C"
    } else if report.has_level_b {
        "B"
    } else {
        "A"
    };

    let slide_count = slides.len();

    Ok(ImportedDeck {
        title: source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("导入的演示文稿")
            .to_string(),
        page_size,
        slides,
        theme,
        report: ImportReport {
            format: "pptx".into(),
            compatibility: compatibility.into(),
            slide_count,
            counts: report.counts,
            unsupported: report.unsupported,
            warnings: report.warnings,
            assets: report.assets,
        },
    })
}

fn validate_source(source: &Path) -> Result<PathBuf, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "pptx" {
        return Err("PPTX_IMPORT_EXTENSION_INVALID".into());
    }
    let canonical =
        fs::canonicalize(source).map_err(|error| format!("PPTX_IMPORT_PATH_INVALID: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("PPTX_IMPORT_METADATA_FAILED: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES {
        return Err("PPTX_IMPORT_SIZE_INVALID".into());
    }
    let mut signature = [0_u8; 2];
    File::open(&canonical)
        .and_then(|mut file| file.read_exact(&mut signature))
        .map_err(|error| format!("PPTX_IMPORT_READ_FAILED: {error}"))?;
    if signature != *b"PK" {
        return Err("PPTX_ZIP_SIGNATURE_INVALID".into());
    }
    Ok(canonical)
}

fn validate_archive(archive: &mut ZipArchive<File>) -> Result<(), String> {
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("PPTX_ARCHIVE_TOO_MANY_ENTRIES".into());
    }
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("PPTX_ARCHIVE_READ_FAILED: {error}"))?;
        let name = entry.name().replace('\\', "/");
        if name.starts_with('/')
            || name.contains('\0')
            || name
                .split('/')
                .any(|component| component == ".." || component == ".")
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
    for required in ["[Content_Types].xml", "ppt/presentation.xml"] {
        if archive.by_name(required).is_err() {
            return Err(format!("PPTX_REQUIRED_ENTRY_MISSING:{required}"));
        }
    }
    Ok(())
}

fn read_entry(
    archive: &mut ZipArchive<File>,
    name: &str,
    limit: u64,
) -> Result<Option<Vec<u8>>, String> {
    let Ok(entry) = archive.by_name(name) else {
        return Ok(None);
    };
    if entry.size() > limit {
        return Err("PPTX_ENTRY_TOO_LARGE".into());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("PPTX_ENTRY_READ_FAILED: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err("PPTX_ENTRY_TOO_LARGE".into());
    }
    Ok(Some(bytes))
}

fn read_xml(archive: &mut ZipArchive<File>, name: &str) -> Result<Option<String>, String> {
    let Some(bytes) = read_entry(archive, name, MAX_XML_BYTES)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "PPTX_XML_ENCODING_INVALID".into())
}

fn parse_presentation(xml: &str) -> Result<(ImportedSize, Vec<String>), String> {
    let document = Document::parse(xml).map_err(|_| "PPTX_PRESENTATION_XML_INVALID")?;
    let root = document.root_element();
    let mut page_size = ImportedSize {
        width: DEFAULT_PAGE_WIDTH,
        height: DEFAULT_PAGE_HEIGHT,
    };
    if let Some(size) = root.descendants().find(|node| node.has_tag_name("sldSz")) {
        let width = size
            .attribute("cx")
            .and_then(|value| value.parse::<i64>().ok());
        let height = size
            .attribute("cy")
            .and_then(|value| value.parse::<i64>().ok());
        if let (Some(width), Some(height)) = (width, height) {
            if width > 0 && height > 0 {
                page_size = ImportedSize { width, height };
            }
        }
    }
    let mut relations = Vec::new();
    for slide in root.descendants().filter(|node| node.has_tag_name("sldId")) {
        if let Some(id) = relationship_attr(slide, "id") {
            relations.push(id.to_string());
        }
    }
    Ok((page_size, relations))
}

fn relationship_attr<'a>(node: Node<'a, 'a>, name: &str) -> Option<&'a str> {
    node.attributes()
        .find(|attribute| attribute.name() == name && attribute.namespace() == Some(REL_NS))
        .map(|attribute| attribute.value())
}

fn attribute_any<'a>(node: Node<'a, 'a>, name: &str) -> Option<&'a str> {
    node.attributes()
        .find(|attribute| attribute.name() == name)
        .map(|attribute| attribute.value())
}

fn child<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<Node<'a, 'input>> {
    node.children().find(|child| child.has_tag_name(name))
}

fn descendant<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<Node<'a, 'input>> {
    node.descendants().find(|child| child.has_tag_name(name))
}

fn parse_i64(node: Node<'_, '_>, name: &str) -> Option<i64> {
    node.attribute(name)
        .and_then(|value| value.parse::<i64>().ok())
}

fn relationships_path(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None => format!("_rels/{part}.rels"),
    }
}

fn read_relationships(archive: &mut ZipArchive<File>, part: &str) -> HashMap<String, Rel> {
    let path = relationships_path(part);
    let Ok(Some(xml)) = read_xml(archive, &path) else {
        return HashMap::new();
    };
    let Ok(document) = Document::parse(&xml) else {
        return HashMap::new();
    };
    let mut result = HashMap::new();
    for node in document
        .root_element()
        .descendants()
        .filter(|node| node.has_tag_name("Relationship"))
    {
        let Some(id) = attribute_any(node, "Id") else {
            continue;
        };
        let Some(target) = attribute_any(node, "Target") else {
            continue;
        };
        let kind = attribute_any(node, "Type").unwrap_or_default().to_string();
        let external = attribute_any(node, "TargetMode")
            .map(|mode| mode.eq_ignore_ascii_case("External"))
            .unwrap_or(false);
        result.insert(
            id.to_string(),
            Rel {
                target: target.to_string(),
                external,
                kind,
            },
        );
    }
    result
}

fn resolve_target(part: &str, target: &str) -> String {
    let base = if target.starts_with('/') {
        String::new()
    } else {
        part.rsplit_once('/')
            .map(|(dir, _)| format!("{dir}/"))
            .unwrap_or_default()
    };
    let joined = format!("{base}{}", target.trim_start_matches('/'));
    let mut components: Vec<&str> = Vec::new();
    for component in joined.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                components.pop();
            }
            value => components.push(value),
        }
    }
    components.join("/")
}

/// Finds the theme part through the slide master that references it.
///
/// `ppt/theme/theme1.xml` is the conventional location, but the relationship
/// is the authority: a template may carry several themes and number them in
/// any order. Reading the master's `.rels` avoids importing the wrong palette
/// from a file whose first theme belongs to a different master.
fn theme_part_path(archive: &mut ZipArchive<File>) -> Option<String> {
    let presentation_rels = read_relationships(archive, "ppt/presentation.xml");
    let mut masters: Vec<String> = presentation_rels
        .values()
        .filter(|rel| !rel.external && rel.kind.ends_with("/slideMaster"))
        .map(|rel| resolve_target("ppt/presentation.xml", &rel.target))
        .collect();
    // The first master is the deck's primary theme; sorting keeps the choice
    // stable regardless of how the relationship map happens to iterate.
    masters.sort();
    for master in masters {
        let rels = read_relationships(archive, &master);
        if let Some(theme) = rels
            .values()
            .find(|rel| !rel.external && rel.kind.ends_with("/theme"))
        {
            return Some(resolve_target(&master, &theme.target));
        }
    }
    None
}

fn parse_theme_xml(xml: &str) -> Option<ImportedTheme> {
    let document = Document::parse(xml).ok()?;
    let root = document.root_element();
    let mut theme = ImportedTheme::default();
    if let Some(scheme) = descendant(root, "clrScheme") {
        for color in scheme.children().filter(Node::is_element) {
            let name = color.tag_name().name().to_string();
            let value = descendant(color, "srgbClr")
                .and_then(|node| node.attribute("val"))
                .map(|value| format!("#{}", value.to_ascii_uppercase()))
                .or_else(|| {
                    descendant(color, "sysClr")
                        .and_then(|node| node.attribute("lastClr"))
                        .map(|value| format!("#{}", value.to_ascii_uppercase()))
                });
            if let Some(value) = value {
                theme.colors.push(ImportedColor { name, value });
            }
        }
    }
    if let Some(scheme) = descendant(root, "fontScheme") {
        theme.major_font = descendant(scheme, "majorFont")
            .and_then(|node| descendant(node, "latin"))
            .and_then(|node| node.attribute("typeface"))
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        theme.minor_font = descendant(scheme, "minorFont")
            .and_then(|node| descendant(node, "latin"))
            .and_then(|node| node.attribute("typeface"))
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }
    Some(theme)
}

fn read_theme_at(archive: &mut ZipArchive<File>, path: &str) -> Option<ImportedTheme> {
    read_xml(archive, path)
        .ok()
        .flatten()
        .and_then(|xml| parse_theme_xml(&xml))
}

fn read_theme(archive: &mut ZipArchive<File>) -> Option<ImportedTheme> {
    theme_part_path(archive)
        .and_then(|path| read_theme_at(archive, &path))
        .or_else(|| read_theme_at(archive, "ppt/theme/theme1.xml"))
}

/// Theme override parts are intentionally partial. Missing fonts or colour
/// slots inherit from the deck theme instead of resetting to editor defaults.
fn merge_theme(
    base: &Option<ImportedTheme>,
    override_theme: ImportedTheme,
) -> Option<ImportedTheme> {
    let mut merged = base.clone().unwrap_or_default();
    if override_theme.major_font.is_some() {
        merged.major_font = override_theme.major_font;
    }
    if override_theme.minor_font.is_some() {
        merged.minor_font = override_theme.minor_font;
    }
    for color in override_theme.colors {
        if let Some(existing) = merged
            .colors
            .iter_mut()
            .find(|item| item.name == color.name)
        {
            *existing = color;
        } else {
            merged.colors.push(color);
        }
    }
    Some(merged)
}

fn theme_for_part(
    archive: &mut ZipArchive<File>,
    part: &str,
    rels: &HashMap<String, Rel>,
    base: &Option<ImportedTheme>,
) -> Option<ImportedTheme> {
    let override_path = rels
        .values()
        .find(|rel| !rel.external && rel.kind.ends_with("/themeOverride"))
        .map(|rel| resolve_target(part, &rel.target));
    override_path
        .and_then(|path| read_theme_at(archive, &path))
        .map(|theme| merge_theme(base, theme))
        .unwrap_or_else(|| base.clone())
}

fn theme_color(theme: &Option<ImportedTheme>, name: &str) -> Option<String> {
    let theme = theme.as_ref()?;
    let key = match name {
        "bg1" => "lt1",
        "tx1" => "dk1",
        "bg2" => "lt2",
        "tx2" => "dk2",
        other => other,
    };
    theme
        .colors
        .iter()
        .find(|color| color.name == key)
        .map(|color| color.value.clone())
}

fn parse_color(node: Node<'_, '_>, theme: &Option<ImportedTheme>) -> Option<String> {
    let fill = descendant(node, "solidFill")?;
    if let Some(node) = descendant(fill, "srgbClr") {
        return node
            .attribute("val")
            .map(|value| format!("#{}", value.to_ascii_uppercase()));
    }
    if let Some(node) = descendant(fill, "schemeClr") {
        return node
            .attribute("val")
            .and_then(|name| theme_color(theme, name));
    }
    None
}

/// A 2D affine transform of the group's child coordinate space.
///
/// Rotation is part of the matrix rather than a separate flag: a group can be
/// rotated, scaled and nested, and composing two "scale then translate" pairs
/// cannot express a rotated child. The matrix also keeps the child's centre
/// correct, which is what makes a rotated group look like one object.
#[derive(Clone, Copy)]
struct GroupTransform {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
    /// Rotation in the document's milli-degree unit (1/1000 degree).
    rotation_milli_degree: i64,
    /// The model has no flip flag, so a flipped group is reported, not faked.
    flipped: bool,
}

impl GroupTransform {
    fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }

    /// Length of the transformed x axis, used for width and type scaling.
    fn scale_x(&self) -> f64 {
        self.a.hypot(self.b)
    }

    /// Length of the transformed y axis, used for height and type scaling.
    fn scale_y(&self) -> f64 {
        self.c.hypot(self.d)
    }
}

fn group_transform(group: Node<'_, '_>) -> Option<GroupTransform> {
    let group_shape = child(group, "grpSpPr")?;
    let transform = child(group_shape, "xfrm")?;
    let offset = child(transform, "off")?;
    let extent = child(transform, "ext")?;
    let child_offset = child(transform, "chOff")?;
    let child_extent = child(transform, "chExt")?;
    let x = parse_i64(offset, "x")? as f64;
    let y = parse_i64(offset, "y")? as f64;
    let width = parse_i64(extent, "cx")? as f64;
    let height = parse_i64(extent, "cy")? as f64;
    let child_x = parse_i64(child_offset, "x")? as f64;
    let child_y = parse_i64(child_offset, "y")? as f64;
    let child_width = parse_i64(child_extent, "cx")? as f64;
    let child_height = parse_i64(child_extent, "cy")? as f64;
    if child_width.abs() < 1.0 || child_height.abs() < 1.0 {
        return None;
    }
    let flip_h = transform.attribute("flipH") == Some("1");
    let flip_v = transform.attribute("flipV") == Some("1");
    // The sign flip mirrors around the child centre; the rotation below then
    // applies to the mirrored geometry, in the same order as DrawingML.
    let scale_x = width / child_width * if flip_h { -1.0 } else { 1.0 };
    let scale_y = height / child_height * if flip_v { -1.0 } else { 1.0 };
    let rotation = parse_i64(transform, "rot").unwrap_or(0);
    let theta = (rotation as f64 / 60_000.0).to_radians();
    let (sin, cos) = theta.sin_cos();
    let center_x = child_x + child_width / 2.0;
    let center_y = child_y + child_height / 2.0;
    let group_center_x = x + width / 2.0;
    let group_center_y = y + height / 2.0;
    let a = cos * scale_x;
    let b = sin * scale_x;
    let c = -sin * scale_y;
    let d = cos * scale_y;
    Some(GroupTransform {
        a,
        b,
        c,
        d,
        e: group_center_x - (a * center_x + c * center_y),
        f: group_center_y - (b * center_x + d * center_y),
        rotation_milli_degree: rotation / 60,
        flipped: flip_h || flip_v,
    })
}

fn apply_group_transform(element: &mut ImportedElement, transform: GroupTransform) {
    let type_scale = transform.scale_x().min(transform.scale_y()).max(0.01);
    let (frame, rotation) = match element {
        ImportedElement::Text {
            frame,
            rotation_milli_degree,
            style,
            ..
        } => {
            // Group scaling also scales the type; keeping the original point size
            // would make text spill out of a shrunk group.
            style.font_size_pt = (style.font_size_pt * type_scale).clamp(1.0, 400.0);
            (frame, rotation_milli_degree)
        }
        ImportedElement::Image {
            frame,
            rotation_milli_degree,
            ..
        }
        | ImportedElement::Table {
            frame,
            rotation_milli_degree,
            ..
        }
        | ImportedElement::Chart {
            frame,
            rotation_milli_degree,
            ..
        } => (frame, rotation_milli_degree),
        ImportedElement::Shape {
            frame,
            rotation_milli_degree,
            stroke_width_pt,
            radius_pt,
            ..
        } => {
            *stroke_width_pt = (*stroke_width_pt * type_scale).max(0.0);
            *radius_pt = (*radius_pt * type_scale).max(0.0);
            (frame, rotation_milli_degree)
        }
        ImportedElement::Line {
            frame,
            rotation_milli_degree,
            stroke_width_pt,
            ..
        } => {
            *stroke_width_pt = (*stroke_width_pt * type_scale).max(0.0);
            (frame, rotation_milli_degree)
        }
    };
    let center_x = frame.x as f64 + frame.width as f64 / 2.0;
    let center_y = frame.y as f64 + frame.height as f64 / 2.0;
    let (next_center_x, next_center_y) = transform.apply(center_x, center_y);
    let width = (frame.width as f64 * transform.scale_x()).abs().max(1.0);
    let height = (frame.height as f64 * transform.scale_y()).abs().max(1.0);
    frame.width = width.round() as i64;
    frame.height = height.round() as i64;
    frame.x = (next_center_x - width / 2.0).round() as i64;
    frame.y = (next_center_y - height / 2.0).round() as i64;
    // The group's rotation composes with the child's own rotation.
    *rotation += transform.rotation_milli_degree;
}

fn parse_frame(shape: Node<'_, '_>) -> Option<ImportedFrame> {
    let transform = descendant(shape, "xfrm")?;
    let offset = child(transform, "off")?;
    let extent = child(transform, "ext")?;
    let x = parse_i64(offset, "x")?;
    let y = parse_i64(offset, "y")?;
    let width = parse_i64(extent, "cx")?;
    let height = parse_i64(extent, "cy")?;
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(ImportedFrame {
        x,
        y,
        width,
        height,
    })
}

fn rotation_milli_degree(shape: Node<'_, '_>) -> i64 {
    descendant(shape, "xfrm")
        .and_then(|transform| parse_i64(transform, "rot"))
        .map(|value| value / 60)
        .unwrap_or(0)
}

fn placeholder(shape: Node<'_, '_>) -> Option<PlaceholderKey> {
    let ph = descendant(shape, "ph")?;
    Some(PlaceholderKey {
        idx: ph.attribute("idx").unwrap_or("0").to_string(),
        ph_type: ph.attribute("type").unwrap_or("obj").to_string(),
    })
}

fn placeholder_content_ref(key: &PlaceholderKey) -> Option<String> {
    match key.ph_type.as_str() {
        "title" | "ctrTitle" => Some("title".into()),
        "body" | "subTitle" => Some("body".into()),
        _ => None,
    }
}

fn is_title_placeholder(key: &PlaceholderKey) -> bool {
    matches!(key.ph_type.as_str(), "title" | "ctrTitle")
}

fn parse_layout_frames(
    archive: &mut ZipArchive<File>,
    layout_target: &str,
) -> HashMap<PlaceholderKey, ImportedFrame> {
    let mut frames = HashMap::new();
    let Some(xml) = read_xml(archive, layout_target).ok().flatten() else {
        return frames;
    };
    collect_placeholder_frames(&xml, &mut frames);
    let layout_rels = read_relationships(archive, layout_target);
    if let Some(master) = layout_rels
        .values()
        .find(|rel| rel.kind.ends_with("/slideMaster"))
    {
        let target = resolve_target(layout_target, &master.target);
        if let Some(master_xml) = read_xml(archive, &target).ok().flatten() {
            let mut master_frames = HashMap::new();
            collect_placeholder_frames(&master_xml, &mut master_frames);
            for (key, frame) in master_frames {
                frames.entry(key).or_insert(frame);
            }
        }
    }
    frames
}

fn collect_placeholder_frames(xml: &str, frames: &mut HashMap<PlaceholderKey, ImportedFrame>) {
    let Ok(document) = Document::parse(xml) else {
        return;
    };
    for shape in document
        .root_element()
        .descendants()
        .filter(|node| node.has_tag_name("sp"))
    {
        let Some(key) = placeholder(shape) else {
            continue;
        };
        if let Some(frame) = parse_frame(shape) {
            frames.entry(key).or_insert(frame);
        }
    }
}

// The parser needs the archive, the shared report, the media cache, the theme
// and the cancellation session. Bundling them in a temporary struct would only
// move the same borrows behind a name, so the explicit parameters are clearer.
#[allow(clippy::too_many_arguments)]
fn parse_slide(
    index: usize,
    xml: &str,
    part: &str,
    archive: &mut ZipArchive<File>,
    media_cache: &mut HashMap<String, (String, String)>,
    theme: &Option<ImportedTheme>,
    report: &mut DeckReport,
    session: Option<&ImportSession>,
) -> Result<ImportedSlide, String> {
    let document = Document::parse(xml).map_err(|_| "PPTX_SLIDE_XML_INVALID")?;
    let rels = read_relationships(archive, part);
    let slide_theme = theme_for_part(archive, part, &rels, theme);
    let layout_rel = rels.values().find(|rel| rel.kind.ends_with("/slideLayout"));
    let layout_frames = layout_rel
        .map(|rel| {
            let target = resolve_target(part, &rel.target);
            parse_layout_frames(archive, &target)
        })
        .unwrap_or_default();

    let mut slide = ImportedSlide {
        index,
        speaker_notes: String::new(),
        ..Default::default()
    };
    let tree = document
        .root_element()
        .descendants()
        .find(|node| node.has_tag_name("spTree"));
    let Some(tree) = tree else {
        report.unsupported(index, "slide", "页面缺少 spTree");
        return Ok(slide);
    };

    for node in tree.children().filter(Node::is_element) {
        // Checking inside the page, not only between pages, makes "cancel"
        // responsive on a slide with hundreds of objects or large pictures.
        // The check is cheap relative to parsing a shape or decoding media.
        if let Some(session) = session {
            session.check()?;
        }
        if slide.elements.len() >= MAX_ELEMENTS_PER_SLIDE {
            report.unsupported(index, "slide", "单页对象超过上限");
            break;
        }
        match node.tag_name().name() {
            "sp" => {
                if let Some(element) =
                    parse_shape(index, node, &layout_frames, &slide_theme, report)
                {
                    push_element(&mut slide, element, report);
                }
            }
            "pic" => {
                if let Some(element) =
                    parse_picture(index, node, part, &rels, archive, media_cache, report)?
                {
                    push_element(&mut slide, element, report);
                }
            }
            "graphicFrame" => {
                if let Some(element) =
                    parse_graphic_frame(index, node, part, &rels, archive, report)
                {
                    push_element(&mut slide, element, report);
                }
            }
            "cxnSp" => {
                if let Some(element) = parse_connector(node, &layout_frames, &slide_theme) {
                    push_element(&mut slide, element, report);
                }
            }
            "grpSp" => {
                let start = slide.elements.len();
                let parser = GroupParser {
                    index,
                    part,
                    rels: &rels,
                    layout_frames: &layout_frames,
                    theme: &slide_theme,
                    session,
                };
                parser.parse_children(node, None, &mut slide, archive, media_cache, report)?;
                if slide.elements.len().saturating_sub(start) >= 2 {
                    slide.groups.push((start..slide.elements.len()).collect());
                }
            }
            "nvGrpSpPr" | "grpSpPr" | "extLst" => {}
            other => report.unsupported(index, other, "未支持的对象类型"),
        }
    }

    if let Some(notes) = notes_for_slide(archive, part, &rels)? {
        slide.speaker_notes = notes;
    }
    Ok(slide)
}

fn compose_transforms(
    parent: Option<GroupTransform>,
    child: Option<GroupTransform>,
) -> Option<GroupTransform> {
    match (parent, child) {
        (None, None) => None,
        (Some(parent), None) => Some(parent),
        (None, Some(child)) => Some(child),
        (Some(parent), Some(child)) => Some(GroupTransform {
            // Parent ∘ child: the child maps into the parent's child space,
            // then the parent maps that space onto the page.
            a: parent.a * child.a + parent.c * child.b,
            c: parent.a * child.c + parent.c * child.d,
            e: parent.a * child.e + parent.c * child.f + parent.e,
            b: parent.b * child.a + parent.d * child.b,
            d: parent.b * child.c + parent.d * child.d,
            f: parent.b * child.e + parent.d * child.f + parent.f,
            rotation_milli_degree: parent.rotation_milli_degree + child.rotation_milli_degree,
            flipped: parent.flipped || child.flipped,
        }),
    }
}

struct GroupParser<'a> {
    index: usize,
    part: &'a str,
    rels: &'a HashMap<String, Rel>,
    layout_frames: &'a HashMap<PlaceholderKey, ImportedFrame>,
    theme: &'a Option<ImportedTheme>,
    session: Option<&'a ImportSession>,
}

impl GroupParser<'_> {
    fn parse_children(
        &self,
        group: Node<'_, '_>,
        parent: Option<GroupTransform>,
        slide: &mut ImportedSlide,
        archive: &mut ZipArchive<File>,
        media_cache: &mut HashMap<String, (String, String)>,
        report: &mut DeckReport,
    ) -> Result<(), String> {
        let own = group_transform(group);
        let transform = compose_transforms(parent, own);
        if transform
            .map(|transform| transform.flipped)
            .unwrap_or(false)
        {
            // A flip cannot be expressed by the element model: mirroring a text
            // box would also mirror its glyphs. The geometry still follows the
            // group, but the mirror is not silently turned into a rotation.
            report.unsupported(
                self.index,
                "group-flip",
                "组合翻转未保留，成员按未翻转几何导入",
            );
        }
        for child_node in group.children().filter(Node::is_element) {
            if let Some(session) = self.session {
                session.check()?;
            }
            if slide.elements.len() >= MAX_ELEMENTS_PER_SLIDE {
                report.unsupported(self.index, "slide", "单页对象超过上限");
                break;
            }
            let element = match child_node.tag_name().name() {
                "sp" => parse_shape(
                    self.index,
                    child_node,
                    self.layout_frames,
                    self.theme,
                    report,
                ),
                "pic" => parse_picture(
                    self.index,
                    child_node,
                    self.part,
                    self.rels,
                    archive,
                    media_cache,
                    report,
                )?,
                "graphicFrame" => parse_graphic_frame(
                    self.index, child_node, self.part, self.rels, archive, report,
                ),
                "cxnSp" => parse_connector(child_node, self.layout_frames, self.theme),
                "grpSp" => {
                    self.parse_children(
                        child_node,
                        transform,
                        slide,
                        archive,
                        media_cache,
                        report,
                    )?;
                    None
                }
                "nvGrpSpPr" | "grpSpPr" | "extLst" => None,
                other => {
                    report.unsupported(self.index, other, "组合内未支持的对象类型");
                    None
                }
            };
            if let Some(mut element) = element {
                if let Some(transform) = transform {
                    apply_group_transform(&mut element, transform);
                }
                push_element(slide, element, report);
            }
        }
        Ok(())
    }
}

fn push_element(slide: &mut ImportedSlide, element: ImportedElement, report: &mut DeckReport) {
    report.counts.text += usize::from(matches!(element, ImportedElement::Text { .. }));
    report.counts.image += usize::from(matches!(element, ImportedElement::Image { .. }));
    report.counts.shape += usize::from(matches!(element, ImportedElement::Shape { .. }));
    report.counts.table += usize::from(matches!(element, ImportedElement::Table { .. }));
    report.counts.chart += usize::from(matches!(element, ImportedElement::Chart { .. }));
    if let Some(value) = text_content(&element) {
        if slide.title.is_none() && content_ref(&element).as_deref() == Some("title") {
            slide.title = Some(value.clone());
        }
        if slide.body.is_none() && content_ref(&element).as_deref() == Some("body") {
            slide.body = Some(value);
        }
    }
    slide.elements.push(element);
}

fn text_content(element: &ImportedElement) -> Option<String> {
    match element {
        ImportedElement::Text { text, .. } if !text.trim().is_empty() => Some(text.clone()),
        _ => None,
    }
}

fn content_ref(element: &ImportedElement) -> Option<String> {
    match element {
        ImportedElement::Text { content_ref, .. } => content_ref.clone(),
        _ => None,
    }
}

fn parse_shape(
    index: usize,
    shape: Node<'_, '_>,
    layout_frames: &HashMap<PlaceholderKey, ImportedFrame>,
    theme: &Option<ImportedTheme>,
    report: &mut DeckReport,
) -> Option<ImportedElement> {
    let key = placeholder(shape);
    let frame = parse_frame(shape)
        .or_else(|| key.as_ref().and_then(|key| layout_frames.get(key).copied()))
        .unwrap_or_else(|| {
            // Placeholders often inherit their geometry from a layout we could
            // not read. These page-relative defaults keep the text visible and
            // ordered instead of stacking every inherited box at 0,0.
            if key.as_ref().map(is_title_placeholder).unwrap_or(false) {
                ImportedFrame {
                    x: 914_400,
                    y: 609_600,
                    width: 10_972_800,
                    height: 1_371_600,
                }
            } else {
                ImportedFrame {
                    x: 914_400,
                    y: 2_286_000,
                    width: 10_972_800,
                    height: 3_657_600,
                }
            }
        });
    let rotation = rotation_milli_degree(shape);
    let text = parse_text_body(
        shape,
        theme,
        key.as_ref().map(is_title_placeholder).unwrap_or(false),
    );
    if let Some(text) = text {
        return Some(ImportedElement::Text {
            frame,
            rotation_milli_degree: rotation,
            text: text.text,
            style: text.style,
            runs: text.runs,
            content_ref: key.as_ref().and_then(placeholder_content_ref),
        });
    }

    let preset = descendant(shape, "prstGeom")
        .and_then(|node| node.attribute("prst"))
        .unwrap_or("rect");
    let is_line = preset == "line";
    let stroke_color = descendant(shape, "ln")
        .and_then(|line| parse_color(line, theme))
        .unwrap_or_else(|| "#000000".into());
    let stroke_width = descendant(shape, "ln")
        .and_then(|line| parse_i64(line, "w"))
        .map(|value| (value as f64 / 12_700.0).clamp(0.0, 100.0))
        .unwrap_or(1.0);
    if is_line {
        let direction = if frame.height <= 20_000 {
            "horizontal"
        } else if frame.width <= 20_000 {
            "vertical"
        } else {
            "diagonal"
        };
        return Some(ImportedElement::Line {
            frame,
            rotation_milli_degree: rotation,
            direction: direction.into(),
            stroke: stroke_color,
            stroke_width_pt: stroke_width,
            dashed: descendant(shape, "prstDash").is_some(),
            start_arrow: false,
            end_arrow: false,
        });
    }
    let fill = descendant(shape, "spPr")
        .and_then(|sp_pr| parse_color(sp_pr, theme))
        .unwrap_or_else(|| "#FFFFFF".into());
    let shape_type = match preset {
        "ellipse" => "ellipse",
        // A rounded rectangle is a rectangle with a radius, not a third kind.
        "roundRect" | "rect" => "rectangle",
        "triangle" | "rtTriangle" => "triangle",
        "diamond" => "diamond",
        "pentagon" => "pentagon",
        "hexagon" => "hexagon",
        "chevron" => "chevron",
        "rightArrow" => "arrow",
        "star5" => "star",
        "parallelogram" => "parallelogram",
        "trapezoid" | "nonIsoscelesTrapezoid" => "trapezoid",
        other => {
            report.warning(format!("第 {} 页形状 {other} 按矩形导入", index + 1));
            "rectangle"
        }
    };
    Some(ImportedElement::Shape {
        frame,
        rotation_milli_degree: rotation,
        shape: shape_type.into(),
        fill,
        stroke: stroke_color,
        stroke_width_pt: stroke_width,
        radius_pt: if preset == "roundRect" { 8.0 } else { 0.0 },
    })
}

fn parse_connector(
    shape: Node<'_, '_>,
    layout_frames: &HashMap<PlaceholderKey, ImportedFrame>,
    theme: &Option<ImportedTheme>,
) -> Option<ImportedElement> {
    let key = placeholder(shape);
    let frame = parse_frame(shape)
        .or_else(|| key.as_ref().and_then(|key| layout_frames.get(key).copied()))
        .unwrap_or(ImportedFrame {
            x: 457_200,
            y: 2_000_000,
            width: 3_657_600,
            height: 0,
        });
    let stroke = descendant(shape, "ln")
        .and_then(|line| parse_color(line, theme))
        .unwrap_or_else(|| "#000000".into());
    let width = descendant(shape, "ln")
        .and_then(|line| parse_i64(line, "w"))
        .map(|value| (value as f64 / 12_700.0).clamp(0.0, 100.0))
        .unwrap_or(1.0);
    let direction = if frame.height <= 20_000 {
        "horizontal"
    } else if frame.width <= 20_000 {
        "vertical"
    } else {
        "diagonal"
    };
    Some(ImportedElement::Line {
        frame,
        rotation_milli_degree: rotation_milli_degree(shape),
        direction: direction.into(),
        stroke,
        stroke_width_pt: width,
        dashed: descendant(shape, "prstDash").is_some(),
        start_arrow: descendant(shape, "headEnd").is_some(),
        end_arrow: descendant(shape, "tailEnd").is_some(),
    })
}

fn parse_text_body(
    shape: Node<'_, '_>,
    theme: &Option<ImportedTheme>,
    is_title: bool,
) -> Option<TextBody> {
    let body = descendant(shape, "txBody")?;
    let mut text = String::new();
    let mut style: Option<ImportedTextStyle> = None;
    let mut runs: Vec<ImportedRun> = Vec::new();
    let mut bullet = "none".to_string();
    let mut line_height = None;
    let mut paragraph_align: Option<String> = None;
    let paragraphs: Vec<Node<'_, '_>> = body
        .children()
        .filter(|node| node.has_tag_name("p"))
        .collect();
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        if paragraph_index > 0 {
            text.push('\n');
        }
        if let Some(props) = child(*paragraph, "pPr") {
            if let Some(value) = props.attribute("algn") {
                let align = match value {
                    "ctr" => "center",
                    "r" => "right",
                    _ => "left",
                };
                paragraph_align = Some(align.into());
                if let Some(style) = style.as_mut() {
                    style.align = align.into();
                }
            }
            if descendant(props, "buAutoNum").is_some() {
                bullet = "number".into();
            } else if descendant(props, "buChar").is_some() {
                bullet = "dot".into();
            }
            if let Some(spacing) = descendant(props, "spcPct") {
                if let Some(value) = spacing
                    .attribute("val")
                    .and_then(|value| value.parse::<f64>().ok())
                {
                    let multiple = value / 100_000.0;
                    if (0.5..=3.0).contains(&multiple) {
                        line_height = Some(multiple);
                    }
                }
            }
        }
        for child_node in paragraph.children().filter(Node::is_element) {
            match child_node.tag_name().name() {
                "r" | "fld" => {
                    let Some(run_text) = descendant(child_node, "t").and_then(|node| node.text())
                    else {
                        continue;
                    };
                    let start = text.encode_utf16().count();
                    text.push_str(run_text);
                    let end = text.encode_utf16().count();
                    let run_style =
                        child(child_node, "rPr").map(|props| parse_run_style(props, theme));
                    let current = style.get_or_insert_with(|| default_text_style(theme, is_title));
                    if let Some(run_style) = run_style {
                        let run_color = run_style
                            .color
                            .clone()
                            .unwrap_or_else(|| current.color.clone());
                        let bold = run_style.bold.unwrap_or(false);
                        let underline = run_style.underline.unwrap_or(false);
                        let explicit_color = run_style.color.is_some();
                        if let Some(value) = run_style.font_size_pt {
                            current.font_size_pt = value;
                        }
                        if let Some(value) = run_style.color {
                            current.color = value;
                        }
                        if let Some(value) = run_style.bold {
                            current.bold = value;
                        }
                        if let Some(value) = run_style.italic {
                            current.italic = value;
                        }
                        if let Some(value) = run_style.underline {
                            current.underline = value;
                        }
                        if let Some(value) = run_style.strikethrough {
                            current.strikethrough = value;
                        }
                        if let Some(value) = run_style.font_family {
                            current.font_family = value;
                        }
                        if (bold || explicit_color || underline) && runs.len() < 200 {
                            runs.push(ImportedRun {
                                start,
                                end,
                                bold,
                                color: run_color,
                                underline,
                            });
                        }
                    }
                }
                "br" => text.push('\n'),
                _ => {}
            }
        }
    }
    if text.trim().is_empty() {
        return None;
    }
    let mut style = style.unwrap_or_else(|| default_text_style(theme, is_title));
    if let Some(align) = paragraph_align {
        style.align = align;
    }
    style.bullet = bullet;
    style.line_height = line_height;
    if let Some(body_pr) = child(body, "bodyPr") {
        style.vertical_align = match body_pr.attribute("anchor") {
            Some("ctr") => "middle",
            Some("b") => "bottom",
            _ => "top",
        }
        .into();
    }
    Some(TextBody { text, style, runs })
}

struct RunStyle {
    font_size_pt: Option<f64>,
    font_family: Option<String>,
    color: Option<String>,
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strikethrough: Option<bool>,
}

fn parse_run_style(props: Node<'_, '_>, theme: &Option<ImportedTheme>) -> RunStyle {
    RunStyle {
        font_size_pt: props
            .attribute("sz")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|value| (value / 100.0).clamp(1.0, 400.0)),
        font_family: descendant(props, "latin")
            .and_then(|node| node.attribute("typeface"))
            .map(str::to_string),
        color: parse_color(props, theme),
        bold: props.attribute("b").map(|value| value == "1"),
        italic: props.attribute("i").map(|value| value == "1"),
        underline: props
            .attribute("u")
            .map(|value| value != "none")
            .or(Some(false)),
        strikethrough: props
            .attribute("strike")
            .map(|value| value != "noStrike")
            .or(Some(false)),
    }
}

fn default_text_style(theme: &Option<ImportedTheme>, title: bool) -> ImportedTextStyle {
    ImportedTextStyle {
        font_family: theme
            .as_ref()
            .and_then(|theme| {
                if title {
                    theme
                        .major_font
                        .clone()
                        .or_else(|| theme.minor_font.clone())
                } else {
                    theme
                        .minor_font
                        .clone()
                        .or_else(|| theme.major_font.clone())
                }
            })
            .unwrap_or_else(|| "Microsoft YaHei".into()),
        font_size_pt: if title { 32.0 } else { 18.0 },
        color: theme_color(theme, "tx1").unwrap_or_else(|| "#17181c".into()),
        bold: title,
        italic: false,
        underline: false,
        strikethrough: false,
        align: "left".into(),
        vertical_align: "top".into(),
        line_height: None,
        bullet: "none".into(),
    }
}

fn media_mime(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
    } else {
        None
    }
}

fn parse_picture(
    index: usize,
    picture: Node<'_, '_>,
    part: &str,
    rels: &HashMap<String, Rel>,
    archive: &mut ZipArchive<File>,
    media_cache: &mut HashMap<String, (String, String)>,
    report: &mut DeckReport,
) -> Result<Option<ImportedElement>, String> {
    let embed = descendant(picture, "blip")
        .and_then(|blip| relationship_attr(blip, "embed"))
        .map(str::to_string);
    let Some(embed) = embed else {
        report.unsupported(index, "picture", "图片关系缺失");
        return Ok(None);
    };
    let Some(rel) = rels.get(&embed) else {
        report.unsupported(index, "picture", "图片关系未找到");
        return Ok(None);
    };
    if rel.external {
        report.unsupported(index, "picture", "外部图片已跳过");
        return Ok(None);
    }
    let target = resolve_target(part, &rel.target);
    let Some(mime) = media_mime(&target) else {
        report.unsupported(index, "picture", "不支持的图片格式");
        return Ok(None);
    };
    let (data_url, mime_type) = if let Some(cached) = media_cache.get(&target) {
        cached.clone()
    } else {
        let Some(bytes) = read_entry(archive, &target, MAX_MEDIA_BYTES as u64)? else {
            report.unsupported(index, "picture", "图片文件缺失");
            return Ok(None);
        };
        if bytes.len() > MAX_MEDIA_BYTES {
            report.assets.skipped += 1;
            report.unsupported(index, "picture", "图片超过大小上限");
            return Ok(None);
        }
        if report.assets.bytes + bytes.len() > MAX_TOTAL_MEDIA_BYTES {
            report.assets.skipped += 1;
            report.unsupported(index, "picture", "媒体总量超过上限");
            return Ok(None);
        }
        report.assets.bytes += bytes.len();
        let data_url = format!("data:{mime};base64,{}", BASE64.encode(&bytes));
        report.assets.extracted += 1;
        media_cache.insert(target.clone(), (data_url.clone(), mime.to_string()));
        (data_url, mime.to_string())
    };
    let frame = parse_frame(picture).unwrap_or(ImportedFrame {
        x: 914_400,
        y: 914_400,
        width: 3_657_600,
        height: 2_743_200,
    });
    let alt_text = truncate_chars(
        picture
            .descendants()
            .find(|node| node.has_tag_name("cNvPr"))
            .and_then(|node| node.attribute("descr"))
            .filter(|value| !value.is_empty())
            .unwrap_or("导入的图片")
            .to_string(),
        500,
    );
    let crop = picture
        .descendants()
        .find(|node| node.has_tag_name("srcRect"))
        .and_then(|node| {
            let left = node
                .attribute("l")
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            let top = node
                .attribute("t")
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            let right = node
                .attribute("r")
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            let bottom = node
                .attribute("b")
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            if left + right >= 100_000.0 || top + bottom >= 100_000.0 {
                return None;
            }
            let crop = ImportedCrop {
                left: left / 100_000.0,
                top: top / 100_000.0,
                right: right / 100_000.0,
                bottom: bottom / 100_000.0,
            };
            (crop.left + crop.right + crop.top + crop.bottom > 0.0).then_some(crop)
        });
    Ok(Some(ImportedElement::Image {
        frame,
        rotation_milli_degree: rotation_milli_degree(picture),
        data_url,
        mime_type,
        alt_text,
        crop,
    }))
}

fn parse_graphic_frame(
    index: usize,
    frame_node: Node<'_, '_>,
    part: &str,
    rels: &HashMap<String, Rel>,
    archive: &mut ZipArchive<File>,
    report: &mut DeckReport,
) -> Option<ImportedElement> {
    if let Some(chart_node) = descendant(frame_node, "chart") {
        return parse_chart_frame(index, frame_node, chart_node, part, rels, archive, report);
    }
    let Some(table) = descendant(frame_node, "tbl") else {
        report.unsupported(index, "graphicFrame", "嵌入图形未导入");
        return None;
    };
    report.warning(format!("第 {} 页表格按默认表格样式导入", index + 1));
    let frame = parse_frame(frame_node).unwrap_or(ImportedFrame {
        x: 914_400,
        y: 914_400,
        width: 4_572_000,
        height: 1_828_800,
    });
    let declared_columns = table
        .descendants()
        .filter(|node| node.has_tag_name("gridCol"))
        .count();
    if declared_columns == 0 {
        report.unsupported(index, "table", "表格没有列");
        return None;
    }
    let columns = declared_columns.min(12);
    if declared_columns > 12 {
        report.unsupported(index, "table-size", "表格超过 12 列，超出部分未导入");
    }
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut merges: Vec<ImportedTableMerge> = Vec::new();
    let mut truncated = false;
    for (row_index, row) in table
        .children()
        .filter(|node| node.has_tag_name("tr"))
        .enumerate()
    {
        if rows.len() >= 51 {
            truncated = true;
            break;
        }
        let mut cells: Vec<String> = Vec::new();
        let mut column = 0usize;
        for cell in row.children().filter(|node| node.has_tag_name("tc")) {
            let column_span = cell
                .attribute("gridSpan")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1)
                .clamp(1, columns);
            let row_span = cell
                .attribute("rowSpan")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1)
                .clamp(1, 50);
            let covered =
                cell.attribute("hMerge") == Some("1") || cell.attribute("vMerge") == Some("1");
            if covered {
                // A covered cell carries no copy of its own; the top-left cell
                // of the merge is the one the reviewer approved.
                column += 1;
                continue;
            }
            while cells.len() < column {
                cells.push(String::new());
            }
            cells.push(truncate_chars(cell_text(cell), 500));
            for _ in 1..column_span {
                cells.push(String::new());
            }
            if column_span > 1 || row_span > 1 {
                let section = if row_index == 0 { "header" } else { "body" };
                // A merge cannot cross the one-row header in this model.
                let row_span = if section == "header" { 1 } else { row_span };
                merges.push(ImportedTableMerge {
                    section: section.into(),
                    row: row_index.saturating_sub(1),
                    column,
                    row_span,
                    column_span,
                });
            }
            column += column_span;
        }
        while cells.len() < columns {
            cells.push(String::new());
        }
        cells.truncate(columns);
        rows.push(cells);
    }
    if truncated {
        report.unsupported(index, "table-size", "表格超过 50 行，超出部分未导入");
    }
    if rows.is_empty() {
        return None;
    }
    let header = rows.remove(0);
    let header = header
        .into_iter()
        .enumerate()
        .map(|(column, value)| {
            if value.trim().is_empty() {
                format!("列 {}", column + 1)
            } else {
                truncate_chars(value, 200)
            }
        })
        .collect();
    if rows.is_empty() {
        rows.push(vec![String::new(); columns]);
    }
    rows.truncate(50);
    Some(ImportedElement::Table {
        frame,
        rotation_milli_degree: 0,
        header,
        rows,
        merges,
    })
}

fn truncate_chars(value: String, max: usize) -> String {
    if value.chars().count() <= max {
        value
    } else {
        value.chars().take(max).collect()
    }
}

struct ParsedChart {
    kind: String,
    categories: Vec<String>,
    values: Vec<f64>,
    colors: Vec<String>,
    show_legend: bool,
    show_values: bool,
    series_count: usize,
}

fn parse_chart_frame(
    index: usize,
    frame_node: Node<'_, '_>,
    chart_node: Node<'_, '_>,
    part: &str,
    rels: &HashMap<String, Rel>,
    archive: &mut ZipArchive<File>,
    report: &mut DeckReport,
) -> Option<ImportedElement> {
    let Some(relation_id) = relationship_attr(chart_node, "id") else {
        report.unsupported(index, "chart", "图表关系缺失");
        return None;
    };
    let Some(rel) = rels.get(relation_id) else {
        report.unsupported(index, "chart", "图表关系未找到");
        return None;
    };
    if rel.external {
        report.unsupported(index, "chart", "外部图表关系已跳过");
        return None;
    }
    let target = resolve_target(part, &rel.target);
    let Some(xml) = read_xml(archive, &target).ok().flatten() else {
        report.unsupported(index, "chart", "图表 XML 缺失");
        return None;
    };
    let mut parsed = match parse_chart_xml(&xml) {
        Ok(parsed) => parsed,
        Err(message) => {
            report.unsupported(index, "chart", &message);
            return None;
        }
    };
    if parsed.series_count > 1 {
        report.unsupported(index, "chart-multi-series", "多序列图表只导入第一个序列");
    }
    if parsed.values.len() > 32 {
        parsed.values.truncate(32);
        parsed.categories.truncate(32);
        report.unsupported(index, "chart-size", "图表超过 32 个数据点，超出部分未导入");
    }
    let frame = parse_frame(frame_node).unwrap_or(ImportedFrame {
        x: 914_400,
        y: 2_286_000,
        width: 5_486_400,
        height: 3_200_400,
    });
    Some(ImportedElement::Chart {
        frame,
        rotation_milli_degree: rotation_milli_degree(frame_node),
        kind: parsed.kind,
        categories: parsed.categories,
        values: parsed.values,
        colors: parsed.colors,
        show_legend: parsed.show_legend,
        show_values: parsed.show_values,
    })
}

fn parse_chart_xml(xml: &str) -> Result<ParsedChart, String> {
    let document = Document::parse(xml).map_err(|_| "图表 XML 无效".to_string())?;
    let root = document.root_element();
    let chart = descendant(root, "chart").ok_or("图表缺少 chart 节点")?;
    let plot = descendant(chart, "plotArea").ok_or("图表缺少绘图区")?;
    let (kind, chart_type) = if let Some(bar) = descendant(plot, "barChart") {
        let direction = child(bar, "barDir")
            .and_then(|node| node.attribute("val"))
            .unwrap_or("col");
        (if direction == "bar" { "bar" } else { "column" }, bar)
    } else if let Some(line) = descendant(plot, "lineChart") {
        ("line", line)
    } else if let Some(pie) = descendant(plot, "pieChart") {
        ("pie", pie)
    } else {
        return Err("图表类型未支持".into());
    };
    let series: Vec<Node<'_, '_>> = chart_type
        .children()
        .filter(|node| node.has_tag_name("ser"))
        .collect();
    if series.is_empty() {
        return Err("图表没有数据序列".into());
    }
    let first = series[0];
    let categories = chart_categories(first);
    let mut values = chart_values(first);
    if values.is_empty() {
        return Err("图表没有缓存数值".into());
    }
    let mut categories = if categories.len() >= values.len() {
        categories
    } else {
        let mut padded = categories;
        while padded.len() < values.len() {
            padded.push(format!("分类 {}", padded.len() + 1));
        }
        padded
    };
    values.truncate(categories.len());
    categories.truncate(values.len());
    let colors = child(first, "spPr")
        .and_then(|shape| parse_color(shape, &None))
        .into_iter()
        .collect();
    let show_legend = descendant(chart, "legend").is_some();
    let show_values = descendant(first, "showVal")
        .and_then(|node| node.attribute("val"))
        .map(|value| value == "1")
        .unwrap_or(false);
    Ok(ParsedChart {
        kind: kind.into(),
        categories,
        values,
        colors,
        show_legend,
        show_values,
        series_count: series.len(),
    })
}

fn chart_categories(series: Node<'_, '_>) -> Vec<String> {
    let Some(categories) = child(series, "cat") else {
        return Vec::new();
    };
    let container = descendant(categories, "multiLvlStrCache")
        .and_then(|cache| child(cache, "lvl"))
        .unwrap_or(categories);
    let mut points: Vec<(i64, String)> = container
        .descendants()
        .filter(|node| node.has_tag_name("pt"))
        .map(|point| {
            let index = point
                .attribute("idx")
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(0);
            let text = descendant(point, "v")
                .and_then(|value| value.text())
                .unwrap_or_default()
                .to_string();
            (index, truncate_chars(text, 200))
        })
        .collect();
    points.sort_by_key(|(index, _)| *index);
    points.into_iter().map(|(_, text)| text).collect()
}

fn chart_values(series: Node<'_, '_>) -> Vec<f64> {
    let Some(values) = child(series, "val") else {
        return Vec::new();
    };
    let mut points: Vec<(i64, f64)> = values
        .descendants()
        .filter(|node| node.has_tag_name("pt"))
        .filter_map(|point| {
            let index = point
                .attribute("idx")
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(0);
            let value = descendant(point, "v")
                .and_then(|value| value.text())
                .and_then(|value| value.parse::<f64>().ok())?;
            Some((index, value))
        })
        .collect();
    points.sort_by_key(|(index, _)| *index);
    points.into_iter().map(|(_, value)| value).collect()
}

fn cell_text(cell: Node<'_, '_>) -> String {
    let Some(body) = child(cell, "txBody") else {
        return String::new();
    };
    let mut text = String::new();
    let paragraphs: Vec<Node<'_, '_>> = body
        .children()
        .filter(|node| node.has_tag_name("p"))
        .collect();
    for (index, paragraph) in paragraphs.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        for node in paragraph
            .descendants()
            .filter(|node| node.has_tag_name("t"))
        {
            if let Some(value) = node.text() {
                text.push_str(value);
            }
        }
    }
    text
}

fn notes_for_slide(
    archive: &mut ZipArchive<File>,
    part: &str,
    rels: &HashMap<String, Rel>,
) -> Result<Option<String>, String> {
    let Some(rel) = rels.values().find(|rel| rel.kind.ends_with("/notesSlide")) else {
        return Ok(None);
    };
    if rel.external {
        return Ok(None);
    }
    let target = resolve_target(part, &rel.target);
    let Some(xml) = read_xml(archive, &target)? else {
        return Ok(None);
    };
    let document = Document::parse(&xml).map_err(|_| "PPTX_NOTES_XML_INVALID")?;
    let mut text = String::new();
    for shape in document
        .root_element()
        .descendants()
        .filter(|node| node.has_tag_name("sp"))
    {
        let Some(key) = placeholder(shape) else {
            continue;
        };
        if key.ph_type != "body" {
            continue;
        }
        if let Some(body) = parse_text_body(shape, &None, false) {
            if !body.text.trim().is_empty() {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(body.text.trim());
            }
        }
    }
    Ok((!text.is_empty()).then_some(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_a_partial_slide_theme_override_with_the_deck_theme() {
        let base = parse_theme_xml(
            r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:themeElements>
                    <a:clrScheme name="Base">
                        <a:dk1><a:srgbClr val="111111"/></a:dk1>
                        <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
                        <a:accent1><a:srgbClr val="3366CC"/></a:accent1>
                    </a:clrScheme>
                    <a:fontScheme name="Base">
                        <a:majorFont><a:latin typeface="Base Display"/></a:majorFont>
                        <a:minorFont><a:latin typeface="Base Text"/></a:minorFont>
                    </a:fontScheme>
                </a:themeElements>
            </a:theme>"#,
        );
        let override_theme = parse_theme_xml(
            r#"<a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:clrScheme name="Override">
                    <a:accent1><a:srgbClr val="EE3344"/></a:accent1>
                </a:clrScheme>
                <a:fontScheme name="Override">
                    <a:minorFont><a:latin typeface="Override Text"/></a:minorFont>
                </a:fontScheme>
            </a:themeOverride>"#,
        )
        .expect("override theme");

        let merged = merge_theme(&base, override_theme).expect("merged theme");
        assert_eq!(
            theme_color(&Some(merged.clone()), "accent1").as_deref(),
            Some("#EE3344")
        );
        assert_eq!(
            theme_color(&Some(merged.clone()), "tx1").as_deref(),
            Some("#111111")
        );
        assert_eq!(merged.major_font.as_deref(), Some("Base Display"));
        assert_eq!(merged.minor_font.as_deref(), Some("Override Text"));
    }

    #[test]
    fn reads_the_theme_referenced_by_the_slide_master() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("themed.pptx");
        let presentation = r#"<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>"#;
        let presentation_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/>
        </Relationships>"#;
        let master = r#"<?xml version="1.0" encoding="UTF-8"?>
        <p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>"#;
        let master_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/>
        </Relationships>"#;
        let theme = r#"<?xml version="1.0" encoding="UTF-8"?>
        <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Theme">
            <a:themeElements>
                <a:clrScheme name="Theme">
                    <a:dk1><a:srgbClr val="111111"/></a:dk1>
                    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
                    <a:accent1><a:srgbClr val="AABBCC"/></a:accent1>
                </a:clrScheme>
                <a:fontScheme name="Theme">
                    <a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>
                    <a:minorFont><a:latin typeface="Aptos"/></a:minorFont>
                </a:fontScheme>
            </a:themeElements>
        </a:theme>"#;

        let file = File::create(&path).expect("create");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, contents) in [
            ("ppt/presentation.xml", presentation.as_bytes()),
            (
                "ppt/_rels/presentation.xml.rels",
                presentation_rels.as_bytes(),
            ),
            ("ppt/slideMasters/slideMaster2.xml", master.as_bytes()),
            (
                "ppt/slideMasters/_rels/slideMaster2.xml.rels",
                master_rels.as_bytes(),
            ),
            ("ppt/theme/theme2.xml", theme.as_bytes()),
        ] {
            zip.start_file(name, options).expect("start file");
            zip.write_all(contents).expect("write file");
        }
        zip.finish().expect("finish");

        let file = File::open(&path).expect("open");
        let mut archive = ZipArchive::new(file).expect("archive");
        let theme = read_theme(&mut archive).expect("theme");
        assert_eq!(
            theme
                .colors
                .iter()
                .find(|color| color.name == "accent1")
                .map(|color| color.value.as_str()),
            Some("#AABBCC")
        );
    }

    #[test]
    fn imports_a_minimal_level_a_deck() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("level-a.pptx");
        let png = BASE64
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=")
            .expect("png");
        let presentation = r#"<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <p:sldSz cx="12192000" cy="6858000"/>
            <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        </p:presentation>"#;
        let presentation_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>"#;
        let slide = r#"<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <p:cSld><p:spTree>
                <p:sp>
                    <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                    <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr>
                    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="3366CC"/></a:solidFill></a:rPr><a:t>Hello</a:t></a:r></a:p></p:txBody>
                </p:sp>
                <p:pic>
                    <p:nvPicPr><p:cNvPr id="3" name="Picture" descr="Sample"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                    <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
                    <p:spPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="1828800" cy="1828800"/></a:xfrm></p:spPr>
                </p:pic>
                <p:graphicFrame>
                    <p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
                    <p:xfrm><a:off x="914400" y="3657600"/><a:ext cx="3657600" cy="1371600"/></p:xfrm>
                    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
                        <a:tbl>
                            <a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid>
                            <a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>项目</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>数值</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
                            <a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>样本量</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>38万</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
                        </a:tbl>
                    </a:graphicData></a:graphic>
                </p:graphicFrame>
                <p:grpSp>
                    <p:grpSpPr>
                        <a:xfrm>
                            <a:off x="0" y="0"/><a:ext cx="200" cy="200"/>
                            <a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/>
                        </a:xfrm>
                    </p:grpSpPr>
                    <p:sp>
                        <p:spPr><a:xfrm><a:off x="10" y="10"/><a:ext cx="20" cy="20"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
                    </p:sp>
                    <p:sp>
                        <p:spPr><a:xfrm><a:off x="30" y="30"/><a:ext cx="20" cy="20"/></a:xfrm><a:prstGeom prst="ellipse"/></p:spPr>
                    </p:sp>
                </p:grpSp>
                <p:graphicFrame>
                    <p:nvGraphicFramePr><p:cNvPr id="5" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
                    <p:xfrm><a:off x="914400" y="5029200"/><a:ext cx="4572000" cy="1828800"/></p:xfrm>
                    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                        <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/>
                    </a:graphicData></a:graphic>
                </p:graphicFrame>
            </p:spTree></p:cSld>
        </p:sld>"#;
        let slide_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
            <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
        </Relationships>"#;
        let chart = r#"<?xml version="1.0" encoding="UTF-8"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                        <c:ser>
                            <c:idx val="0"/>
                            <c:spPr><a:solidFill><a:srgbClr val="3366CC"/></a:solidFill></c:spPr>
                            <c:dLbls><c:showVal val="1"/></c:dLbls>
                            <c:cat><c:multiLvlStrRef><c:multiLvlStrCache>
                                <c:lvl><c:pt idx="0"><c:v>一月</c:v></c:pt>
                                <c:pt idx="1"><c:v>二月</c:v></c:pt></c:lvl>
                            </c:multiLvlStrCache></c:multiLvlStrRef></c:cat>
                            <c:val><c:numRef><c:numCache>
                                <c:pt idx="0"><c:v>12</c:v></c:pt>
                                <c:pt idx="1"><c:v>18</c:v></c:pt>
                            </c:numCache></c:numRef></c:val>
                        </c:ser>
                    </c:barChart>
                    <c:legend/>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;
        let theme = r#"<?xml version="1.0" encoding="UTF-8"?>
        <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Theme">
            <a:themeElements>
                <a:clrScheme name="Theme">
                    <a:dk1><a:srgbClr val="111111"/></a:dk1>
                    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
                    <a:accent1><a:srgbClr val="3366CC"/></a:accent1>
                </a:clrScheme>
                <a:fontScheme name="Theme">
                    <a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont>
                    <a:minorFont><a:latin typeface="Aptos"/></a:minorFont>
                </a:fontScheme>
            </a:themeElements>
        </a:theme>"#;
        let content_types = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#;

        let file = File::create(&path).expect("create");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, contents) in [
            ("[Content_Types].xml", content_types.as_bytes()),
            ("ppt/presentation.xml", presentation.as_bytes()),
            (
                "ppt/_rels/presentation.xml.rels",
                presentation_rels.as_bytes(),
            ),
            ("ppt/slides/slide1.xml", slide.as_bytes()),
            ("ppt/slides/_rels/slide1.xml.rels", slide_rels.as_bytes()),
            ("ppt/theme/theme1.xml", theme.as_bytes()),
            ("ppt/media/image1.png", png.as_slice()),
            ("ppt/charts/chart1.xml", chart.as_bytes()),
        ] {
            zip.start_file(name, options).expect("start file");
            zip.write_all(contents).expect("write file");
        }
        zip.finish().expect("finish");

        let before = fs::read(&path).expect("read source before");
        let imported = import_sync(&path, None).expect("import");
        let after = fs::read(&path).expect("read source after");
        assert_eq!(before, after, "import must not modify its source");
        assert_eq!(imported.page_size.width, 12_192_000);
        assert_eq!(imported.page_size.height, 6_858_000);
        assert_eq!(imported.slides.len(), 1);
        let slide = &imported.slides[0];
        assert_eq!(slide.title.as_deref(), Some("Hello"));
        assert_eq!(slide.speaker_notes, "");
        assert_eq!(imported.report.counts.image, 1);
        assert_eq!(imported.report.counts.table, 1);
        assert_eq!(imported.report.counts.chart, 1);
        match slide
            .elements
            .iter()
            .find(|element| matches!(element, ImportedElement::Chart { .. }))
        {
            Some(ImportedElement::Chart {
                categories,
                values,
                kind,
                colors,
                show_values,
                ..
            }) => {
                assert_eq!(categories, &["一月", "二月"]);
                assert_eq!(values, &[12.0, 18.0]);
                assert_eq!(kind, "column");
                assert_eq!(colors.first().map(String::as_str), Some("#3366CC"));
                assert!(*show_values);
            }
            _ => panic!("chart expected"),
        }
        assert_eq!(slide.groups.len(), 1);
        let group = &slide.groups[0];
        assert_eq!(group.len(), 2);
        match &slide.elements[group[0]] {
            ImportedElement::Shape { frame, shape, .. } => {
                assert_eq!(frame.x, 20);
                assert_eq!(frame.y, 20);
                assert_eq!(frame.width, 40);
                assert_eq!(frame.height, 40);
                assert_eq!(shape, "rectangle");
            }
            _ => panic!("grouped shape expected"),
        }
        assert!(slide.elements.iter().any(|element| matches!(element, ImportedElement::Image { data_url, .. } if data_url.starts_with("data:image/png;base64,"))));
        assert!(slide.elements.iter().any(|element| matches!(element, ImportedElement::Table { header, rows, .. } if header == &["项目", "数值"] && rows[0][1] == "38万")));
        assert_eq!(
            imported
                .theme
                .as_ref()
                .and_then(|theme| theme.major_font.as_deref()),
            Some("Aptos Display")
        );
    }

    #[test]
    fn rejects_archive_entries_that_escape_the_package() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("hostile.pptx");
        let file = File::create(&path).expect("create");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("../evil.xml", SimpleFileOptions::default())
            .expect("start");
        zip.write_all(b"<x/>").expect("write");
        zip.finish().expect("finish");

        let file = File::open(&path).expect("open");
        let mut archive = ZipArchive::new(file).expect("archive");
        assert_eq!(
            validate_archive(&mut archive),
            Err("PPTX_ARCHIVE_ENTRY_PATH_INVALID".into())
        );
    }

    #[test]
    fn serializes_the_typescript_contract_in_camel_case() {
        let element = ImportedElement::Text {
            frame: ImportedFrame {
                x: 1,
                y: 2,
                width: 3,
                height: 4,
            },
            rotation_milli_degree: 0,
            text: "hello".into(),
            style: default_text_style(&None, false),
            runs: Vec::new(),
            content_ref: Some("title".into()),
        };
        let value = serde_json::to_value(element).expect("json");
        assert_eq!(value["type"], "text");
        assert_eq!(value["frame"]["width"], 3);
        assert_eq!(value["rotationMilliDegree"], 0);
        assert_eq!(value["contentRef"], "title");
        assert_eq!(value["style"]["fontSizePt"], 18.0);

        let table = ImportedElement::Table {
            frame: ImportedFrame {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            rotation_milli_degree: 0,
            header: vec!["a".into()],
            rows: vec![vec!["b".into()]],
            merges: vec![],
        };
        let value = serde_json::to_value(table).expect("json");
        assert_eq!(value["type"], "table");
        assert_eq!(value["header"][0], "a");

        let slide = ImportedSlide {
            index: 0,
            groups: vec![vec![0, 1]],
            ..Default::default()
        };
        let value = serde_json::to_value(slide).expect("json");
        assert_eq!(value["groups"][0][1], 1);
    }

    #[test]
    fn cancellation_is_scoped_to_one_request() {
        let registry = ImportCancellation::default();
        assert!(!registry.is_cancelled("a"));
        registry.cancel("a");
        assert!(registry.is_cancelled("a"));
        assert!(!registry.is_cancelled("b"));
        registry.release("a");
        assert!(!registry.is_cancelled("a"));
    }

    #[test]
    fn composes_group_child_coordinates_into_slide_space() {
        let xml = r#"
            <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <p:grpSpPr>
                    <a:xfrm>
                        <a:off x="1000" y="2000"/><a:ext cx="2000" cy="4000"/>
                        <a:chOff x="0" y="0"/><a:chExt cx="1000" cy="2000"/>
                    </a:xfrm>
                </p:grpSpPr>
                <p:sp>
                    <p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/></a:xfrm></p:spPr>
                </p:sp>
            </p:grpSp>
        "#;
        let document = Document::parse(xml).expect("xml");
        let transform = group_transform(document.root_element()).expect("transform");
        let mut element = ImportedElement::Shape {
            frame: ImportedFrame {
                x: 10,
                y: 20,
                width: 100,
                height: 200,
            },
            rotation_milli_degree: 0,
            shape: "rectangle".into(),
            fill: "#FFFFFF".into(),
            stroke: "#000000".into(),
            stroke_width_pt: 1.0,
            radius_pt: 0.0,
        };
        apply_group_transform(&mut element, transform);
        match element {
            ImportedElement::Shape { frame, .. } => {
                assert_eq!(frame.x, 1020);
                assert_eq!(frame.y, 2040);
                assert_eq!(frame.width, 200);
                assert_eq!(frame.height, 400);
            }
            _ => panic!("shape expected"),
        }
    }

    #[test]
    fn composes_nested_group_transforms() {
        let transform = compose_transforms(
            Some(GroupTransform {
                a: 2.0,
                b: 0.0,
                c: 0.0,
                d: 2.0,
                e: 1000.0,
                f: 2000.0,
                rotation_milli_degree: 0,
                flipped: false,
            }),
            Some(GroupTransform {
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 1.0,
                e: 100.0,
                f: 100.0,
                rotation_milli_degree: 0,
                flipped: false,
            }),
        )
        .expect("composed");
        let mut element = ImportedElement::Shape {
            frame: ImportedFrame {
                x: 10,
                y: 10,
                width: 100,
                height: 200,
            },
            rotation_milli_degree: 0,
            shape: "rectangle".into(),
            fill: "#FFFFFF".into(),
            stroke: "#000000".into(),
            stroke_width_pt: 1.0,
            radius_pt: 0.0,
        };
        apply_group_transform(&mut element, transform);
        match element {
            ImportedElement::Shape { frame, .. } => {
                assert_eq!(frame.x, 1220);
                assert_eq!(frame.y, 2220);
                assert_eq!(frame.width, 200);
                assert_eq!(frame.height, 400);
            }
            _ => panic!("shape expected"),
        }
    }

    #[test]
    fn keeps_a_preset_shape_instead_of_degrading_it_to_a_rectangle() {
        let xml = r#"
            <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <p:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
                    <a:prstGeom prst="triangle"/>
                </p:spPr>
            </p:sp>
        "#;
        let document = Document::parse(xml).expect("xml");
        let mut report = DeckReport::default();
        let element = parse_shape(
            0,
            document.root_element(),
            &HashMap::new(),
            &Option::<ImportedTheme>::None,
            &mut report,
        )
        .expect("shape");
        match element {
            ImportedElement::Shape { shape, .. } => assert_eq!(shape, "triangle"),
            _ => panic!("shape expected"),
        }
        assert!(report.warnings.is_empty());
    }

    #[test]
    fn keeps_a_rotated_group_as_a_rotated_child() {
        let xml = r#"
            <p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <p:grpSpPr>
                    <a:xfrm rot="5400000">
                        <a:off x="1000" y="2000"/><a:ext cx="200" cy="200"/>
                        <a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/>
                    </a:xfrm>
                </p:grpSpPr>
            </p:grpSp>
        "#;
        let document = Document::parse(xml).expect("xml");
        let transform = group_transform(document.root_element()).expect("transform");
        assert_eq!(transform.rotation_milli_degree, 90_000);
        let mut element = ImportedElement::Shape {
            frame: ImportedFrame {
                x: 0,
                y: 0,
                width: 20,
                height: 20,
            },
            rotation_milli_degree: 0,
            shape: "rectangle".into(),
            fill: "#FFFFFF".into(),
            stroke: "#000000".into(),
            stroke_width_pt: 1.0,
            radius_pt: 0.0,
        };
        apply_group_transform(&mut element, transform);
        match element {
            ImportedElement::Shape {
                frame,
                rotation_milli_degree,
                ..
            } => {
                // The child centre (10,10) is offset (-40,-40) from the child
                // space centre (50,50). After scaling by 2 and rotating 90°
                // clockwise the offset becomes (80,-80), so the frame moves
                // around the group centre (1100,2100) to (1180,2020).
                assert_eq!(frame.x, 1160);
                assert_eq!(frame.y, 2000);
                assert_eq!(frame.width, 40);
                assert_eq!(frame.height, 40);
                assert_eq!(rotation_milli_degree, 90_000);
            }
            _ => panic!("shape expected"),
        }
    }

    #[test]
    fn resolves_relative_part_targets() {
        assert_eq!(
            resolve_target("ppt/slides/slide1.xml", "../media/image1.png"),
            "ppt/media/image1.png"
        );
        assert_eq!(
            resolve_target("ppt/presentation.xml", "slides/slide1.xml"),
            "ppt/slides/slide1.xml"
        );
        assert_eq!(
            resolve_target("ppt/slides/slide1.xml", "/ppt/slides/slide2.xml"),
            "ppt/slides/slide2.xml"
        );
    }

    #[test]
    fn reads_page_size_and_slide_order() {
        let xml = r#"
            <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                <p:sldSz cx="12192000" cy="6858000"/>
                <p:sldIdLst>
                    <p:sldId id="256" r:id="rId2"/>
                    <p:sldId id="257" r:id="rId3"/>
                </p:sldIdLst>
            </p:presentation>
        "#;
        let (size, slides) = parse_presentation(xml).expect("presentation");
        assert_eq!(size.width, 12_192_000);
        assert_eq!(size.height, 6_858_000);
        assert_eq!(slides, vec!["rId2", "rId3"]);
    }

    #[test]
    fn reads_text_runs_and_paragraph_alignment() {
        let xml = r#"
            <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <p:txBody>
                    <a:p>
                        <a:pPr algn="ctr"/>
                        <a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="3366CC"/></a:solidFill></a:rPr><a:t>标题</a:t></a:r>
                        <a:br/>
                        <a:r><a:t>第二行</a:t></a:r>
                    </a:p>
                </p:txBody>
            </p:sp>
        "#;
        let document = Document::parse(xml).expect("xml");
        let body = parse_text_body(document.root_element(), &None, false).expect("text");
        assert_eq!(body.text, "标题\n第二行");
        assert_eq!(body.style.align, "center");
        assert_eq!(body.style.font_size_pt, 24.0);
        assert!(body.style.bold);
        assert_eq!(body.runs[0].start, 0);
        assert_eq!(body.runs[0].end, 2);
    }
}
