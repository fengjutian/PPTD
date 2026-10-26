//! AI 服务端口（port）与厂商注册表。
//!
//! 命令层只依赖本模块的厂商无关接口。新增厂商时：新增一个适配器文件，
//! 实现 `ChatProvider`，并在 `PROVIDERS` 中注册；命令层与前端调用方式不变。

pub mod cancel;
pub mod minimax;
pub mod minimax_image;
pub mod stream;

#[cfg(test)]
mod live_deck_tests;
#[cfg(test)]
mod live_image_tests;

use base64::Engine;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub use cancel::{CancelRegistry, CancelToken};
use stream::SseParser;

const CREDENTIAL_SERVICE: &str = "com.pptd.desktop";

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageStats {
    pub request_count: u64,
    pub reported_request_count: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Default)]
struct TokenUsageStore {
    stats: TokenUsageStats,
    database_path: Option<PathBuf>,
}

static TOKEN_USAGE: OnceLock<Mutex<TokenUsageStore>> = OnceLock::new();

fn token_usage_store() -> &'static Mutex<TokenUsageStore> {
    TOKEN_USAGE.get_or_init(|| Mutex::new(TokenUsageStore::default()))
}

pub fn initialize_token_usage(database_path: &Path) -> Result<(), String> {
    let connection = Connection::open(database_path)
        .map_err(|error| format!("TOKEN_USAGE_OPEN_FAILED: {error}"))?;
    let stats = connection
        .query_row(
            "SELECT request_count, reported_request_count, input_tokens, output_tokens, total_tokens
             FROM token_usage WHERE id = 1",
            [],
            |row| {
                Ok(TokenUsageStats {
                    request_count: row.get(0)?,
                    reported_request_count: row.get(1)?,
                    input_tokens: row.get(2)?,
                    output_tokens: row.get(3)?,
                    total_tokens: row.get(4)?,
                })
            },
        )
        .map_err(|error| format!("TOKEN_USAGE_READ_FAILED: {error}"))?;
    let mut store = token_usage_store()
        .lock()
        .map_err(|_| "TOKEN_USAGE_LOCK_FAILED".to_string())?;
    store.stats = stats;
    store.database_path = Some(database_path.to_path_buf());
    Ok(())
}

fn persist_token_usage(store: &TokenUsageStore) -> Result<(), String> {
    let Some(path) = store.database_path.as_deref() else {
        return Ok(());
    };
    let connection = Connection::open(path)
        .map_err(|error| format!("TOKEN_USAGE_OPEN_FAILED: {error}"))?;
    connection
        .execute(
            "UPDATE token_usage SET request_count = ?1, reported_request_count = ?2,
             input_tokens = ?3, output_tokens = ?4, total_tokens = ?5 WHERE id = 1",
            params![
                store.stats.request_count,
                store.stats.reported_request_count,
                store.stats.input_tokens,
                store.stats.output_tokens,
                store.stats.total_tokens
            ],
        )
        .map_err(|error| format!("TOKEN_USAGE_WRITE_FAILED: {error}"))?;
    Ok(())
}

fn record_token_usage(payload: &serde_json::Value) {
    let usage = payload.get("usage");
    let input = usage
        .and_then(|value| {
            value
                .get("prompt_tokens")
                .or_else(|| value.get("input_tokens"))
        })
        .and_then(serde_json::Value::as_u64);
    let output = usage
        .and_then(|value| {
            value
                .get("completion_tokens")
                .or_else(|| value.get("output_tokens"))
        })
        .and_then(serde_json::Value::as_u64);
    let total = usage
        .and_then(|value| value.get("total_tokens"))
        .and_then(serde_json::Value::as_u64)
        .or_else(|| Some(input? + output?));
    if let Ok(mut store) = token_usage_store().lock() {
        store.stats.request_count += 1;
        if let (Some(input), Some(output), Some(total)) = (input, output, total) {
            store.stats.reported_request_count += 1;
            store.stats.input_tokens += input;
            store.stats.output_tokens += output;
            store.stats.total_tokens += total;
        }
        let _ = persist_token_usage(&store);
    }
}

fn record_unreported_token_usage() {
    if let Ok(mut store) = token_usage_store().lock() {
        store.stats.request_count += 1;
        let _ = persist_token_usage(&store);
    }
}

pub fn token_usage_stats() -> TokenUsageStats {
    token_usage_store()
        .lock()
        .map(|store| store.stats)
        .unwrap_or_default()
}

pub fn clear_token_usage_stats() -> Result<TokenUsageStats, String> {
    let mut store = token_usage_store()
        .lock()
        .map_err(|_| "TOKEN_USAGE_LOCK_FAILED".to_string())?;
    let previous = store.stats;
    store.stats = TokenUsageStats::default();
    if let Err(error) = persist_token_usage(&store) {
        store.stats = previous;
        return Err(error);
    }
    Ok(store.stats)
}

/// 厂商无关的对话请求。
///
/// 字段与 OpenAI 风格协议一致，便于多数厂商直接复用；协议不同的厂商在适配器里转换。
#[derive(Clone, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
}

#[derive(Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone)]
pub struct VisionRequest {
    pub model: String,
    pub prompt: String,
    pub image_data_urls: Vec<String>,
    pub temperature: f32,
}

/// 厂商响应体不符合预期时的分类。
#[derive(Debug)]
pub enum PayloadError {
    /// 请求成功但没有可用正文。
    Empty,
    /// 响应体结构无法解析。
    Invalid(String),
}

/// AI 服务端口。
///
/// 实现方负责厂商专属的一切：地址、鉴权、请求体构造与响应解析。
pub trait ChatProvider: Send + Sync {
    /// 稳定的厂商标识，前端用它选择服务。
    fn id(&self) -> &'static str;
    /// 界面展示名称。
    fn display_name(&self) -> &'static str;
    /// 服务地址。
    fn api_base_url(&self) -> &'static str;
    /// 默认模型。前端目录中的 `defaultModel` 必须与此保持一致。
    fn default_model(&self) -> &'static str;
    /// 覆盖默认模型的环境变量名。
    fn model_env_var(&self) -> &'static str;
    /// 覆盖凭据的环境变量名。
    fn api_key_env_var(&self) -> &'static str;
    /// 旧版本凭据槽位名，用于迁移历史用户已保存的 Key。
    fn legacy_credential_name(&self) -> Option<&'static str> {
        None
    }
    /// 附加厂商要求的鉴权信息。
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        api_key: &str,
    ) -> reqwest::RequestBuilder;
    /// 构造厂商请求体。
    fn build_request(&self, request: &ChatRequest) -> serde_json::Value;
    /// 构造厂商的流式请求体。默认在普通请求体上打开 `stream`。
    fn build_stream_request(&self, request: &ChatRequest) -> serde_json::Value {
        let mut payload = self.build_request(request);
        if let Some(object) = payload.as_object_mut() {
            object.insert("stream".into(), serde_json::Value::Bool(true));
        }
        payload
    }
    fn supports_vision(&self) -> bool {
        false
    }
    fn build_vision_request(&self, _request: &VisionRequest) -> Result<serde_json::Value, String> {
        Err(format!("AI_VISION_UNSUPPORTED:{}", self.id()))
    }
    /// 从厂商响应中取出助手正文。
    fn parse_response(&self, payload: serde_json::Value) -> Result<String, PayloadError>;
}

/// 已注册的厂商。新增厂商只在此处登记。
pub const PROVIDERS: &[&dyn ChatProvider] = &[&minimax::MINIMAX];

/// 未显式指定厂商时使用的厂商。
pub const DEFAULT_PROVIDER_ID: &str = minimax::PROVIDER_ID;

/// 按标识解析厂商；未知标识返回 `AI_PROVIDER_UNKNOWN:{id}`。
pub fn resolve(provider_id: Option<&str>) -> Result<&'static dyn ChatProvider, String> {
    let id = provider_id.unwrap_or(DEFAULT_PROVIDER_ID);
    PROVIDERS
        .iter()
        .copied()
        .find(|provider| provider.id() == id)
        .ok_or_else(|| format!("AI_PROVIDER_UNKNOWN:{id}"))
}

/// 解析本次请求使用的模型：请求指定优先，其次环境变量，最后厂商默认值。
pub fn resolve_model(provider: &dyn ChatProvider, model: Option<String>) -> Result<String, String> {
    let model = model
        .or_else(|| std::env::var(provider.model_env_var()).ok())
        .unwrap_or_else(|| provider.default_model().to_string());
    validate_model(&model)?;
    Ok(model)
}

/// 模型名会进入请求体，必须限制为不含空白与控制字符的短标识。
fn validate_model(model: &str) -> Result<(), String> {
    if model.is_empty()
        || model.len() > 80
        || !model
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
    {
        return Err("AI_MODEL_INVALID".into());
    }
    Ok(())
}

/// 图像生成请求（厂商无关）。
///
/// 与对话请求分开：图像接口的模型、参数与错误语义都和文本模型不同，
/// 混在同一个结构里会让两端都背上对方的约束。
#[derive(Clone)]
pub struct ImageRequest {
    pub model: String,
    pub prompt: String,
    /// 明确指定像素宽度。与 `height` 同时出现才生效。
    pub width: Option<u32>,
    /// 明确指定像素高度。与 `width` 同时出现才生效。
    pub height: Option<u32>,
}

/// 图像生成结果。
///
/// 图片以 data URL 内联返回：厂商给出的下载地址有有效期，页面里的图片需要长期
/// 留在项目文件里，不能依赖外部链接。
#[derive(Clone, Debug)]
pub struct ImageResult {
    pub data_url: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
}

/// 从厂商响应里取出的图片，可能是内嵌数据，也可能还需要下载。
#[derive(Clone, Debug)]
pub enum ImagePayload {
    /// 内嵌的 base64 数据，可能带 `data:` 前缀。
    Base64 {
        data: String,
        mime_type: Option<String>,
    },
    /// 需要下载的图片地址。
    Url { url: String },
}

/// 厂商对图像请求的长度与尺寸限制。
///
/// 这些数字来自厂商各自的接口文档，放在适配器里；命令层只按端口给出的限制校验，
/// 免得换一个厂商就要改命令层的常量。
#[derive(Clone, Copy)]
pub struct ImageLimits {
    /// 提示词字符数上限。
    pub max_prompt_chars: usize,
    /// 像素边长下限。
    pub min_edge: u32,
    /// 像素边长上限。
    pub max_edge: u32,
    /// 像素边长的步进。
    pub edge_step: u32,
}

/// 图像生成端口。
///
/// 与 [`ChatProvider`] 平行：同一个厂商可以只支持对话、只支持图像，或两者都支持。
pub trait ImageProvider: Send + Sync {
    /// 稳定的厂商标识，与对应 [`ChatProvider`] 的标识一致。
    fn id(&self) -> &'static str;
    /// 图像生成接口地址。
    fn image_endpoint(&self) -> &'static str;
    /// 默认图像模型。
    fn default_image_model(&self) -> &'static str;
    /// 覆盖默认图像模型的环境变量名。
    fn image_model_env_var(&self) -> &'static str;
    /// 厂商支持的图像模型白名单。
    fn supported_image_models(&self) -> &'static [&'static str];
    /// 未指定尺寸时的默认像素尺寸。
    fn default_image_size(&self) -> (u32, u32);
    /// 厂商对提示词长度与像素尺寸的限制。
    fn image_limits(&self) -> ImageLimits;
    /// 附加厂商鉴权。
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        api_key: &str,
    ) -> reqwest::RequestBuilder;
    /// 构造厂商请求体。
    fn build_image_request(&self, request: &ImageRequest) -> serde_json::Value;
    /// 从厂商响应中取出图片。
    fn parse_image_response(&self, payload: serde_json::Value) -> Result<ImagePayload, String>;
    /// 校验图片下载地址，只允许厂商官方域名。
    fn ensure_image_url_allowed(&self, url: &str) -> Result<(), String>;
}

/// 支持图像生成的厂商。新增厂商只在这里登记。
pub const IMAGE_PROVIDERS: &[&dyn ImageProvider] = &[&minimax_image::MINIMAX_IMAGE];

/// 找到厂商对应的图像生成实现；厂商不支持图像时返回 `AI_IMAGE_UNSUPPORTED:{id}`。
pub fn resolve_image_provider(
    provider: &dyn ChatProvider,
) -> Result<&'static dyn ImageProvider, String> {
    IMAGE_PROVIDERS
        .iter()
        .copied()
        .find(|image_provider| image_provider.id() == provider.id())
        .ok_or_else(|| format!("AI_IMAGE_UNSUPPORTED:{}", provider.id()))
}

/// 解析本次图像请求使用的模型。
///
/// 与 [`resolve_model`] 分开：对话模型和图像模型是两套命名，把对话模型名传给
/// 图像接口只会换来厂商的参数错误，不如在本地就拦住。
pub fn resolve_image_model(
    provider: &dyn ImageProvider,
    model: Option<String>,
) -> Result<String, String> {
    let model = model
        .or_else(|| std::env::var(provider.image_model_env_var()).ok())
        .unwrap_or_else(|| provider.default_image_model().to_string());
    if !provider.supported_image_models().contains(&model.as_str()) {
        return Err(format!("AI_IMAGE_MODEL_UNSUPPORTED:{model}"));
    }
    Ok(model)
}

/// 厂商请求失败时的分类，用于区分是否值得重试。
enum ProviderFailure {
    /// 厂商返回了 HTTP 状态码，附带厂商自己给出的原因。
    Status(u16, String),
    /// 网络或传输层失败。`timed_out` 标记请求是被超时切断的。
    Transport { detail: String, timed_out: bool },
    /// 响应体结构不符合预期。
    Payload(PayloadError),
    /// 用户取消了任务。
    Cancelled,
}

/// 请求超时的稳定错误码。前端据此提示"减少页数"而不是"检查网络"。
const REQUEST_TIMEOUT_ERROR: &str = "AI_REQUEST_TIMEOUT";
/// 任务被取消的稳定错误码。
const REQUEST_CANCELLED_ERROR: &str = "AI_REQUEST_CANCELLED";

async fn post_chat_raw(
    provider: &dyn ChatProvider,
    client: &reqwest::Client,
    api_key: &str,
    payload: &serde_json::Value,
) -> Result<reqwest::Response, ProviderFailure> {
    let response = provider
        .apply_auth(client.post(provider.api_base_url()), api_key)
        .json(payload)
        .send()
        .await
        .map_err(|error| ProviderFailure::Transport {
            detail: error.to_string(),
            timed_out: error.is_timeout(),
        })?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(ProviderFailure::Status(
            status,
            provider_error_detail(response).await,
        ));
    }
    Ok(response)
}

async fn post_chat(
    provider: &dyn ChatProvider,
    client: &reqwest::Client,
    api_key: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, ProviderFailure> {
    post_chat_raw(provider, client, api_key, payload)
        .await?
        .json()
        .await
        .map_err(|error| ProviderFailure::Payload(PayloadError::Invalid(error.to_string())))
}

/// 厂商失败时通常会说明原因（错误码加一句提示）。
///
/// 只取 `base_resp` 里的稳定错误码和提示，不把响应正文原样回传：
/// 响应体可能带上请求内容，而请求里包含用户正文。
async fn provider_error_detail(response: reqwest::Response) -> String {
    let Ok(bytes) = response.bytes().await else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) else {
        return String::new();
    };
    let Some(base) = payload.get("base_resp") else {
        return String::new();
    };
    let code = base.get("status_code").and_then(serde_json::Value::as_i64);
    let message = base
        .get("status_msg")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim();
    match (code, message.is_empty()) {
        (Some(code), true) => format!(":{code}"),
        (Some(code), false) => format!(":{code} {message}"),
        (None, false) => format!(": {message}"),
        (None, true) => String::new(),
    }
}

/// 发送一次对话请求并返回助手正文。
///
/// 限流与厂商侧临时故障会按退避策略重试；`transport_error` 是传输层最终失败时
/// 使用的错误码，由调用方按阶段区分。请求超时不会重试：重试同一份大输出只会
/// 让用户多等一轮，正确的做法是缩短单次生成规模。`cancel` 会在任务取消时立刻
/// 打断在途请求，而不是等厂商把整份草稿写完。
pub async fn chat(
    provider: &dyn ChatProvider,
    api_key: &str,
    body: &ChatRequest,
    timeout: Duration,
    transport_error: &str,
    cancel: &CancelToken,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("AI_CLIENT_FAILED: {error}"))?;
    for attempt in 0..3_u32 {
        let payload = provider.build_request(body);
        let outcome = tokio::select! {
            biased;
            () = cancel.cancelled() => Err(ProviderFailure::Cancelled),
            result = post_chat(provider, &client, api_key, &payload) => result,
        };
        match outcome {
            Ok(payload) => {
                record_token_usage(&payload);
                return provider
                    .parse_response(payload)
                    .map_err(|error| match error {
                        PayloadError::Empty => "AI_EMPTY_RESPONSE".to_string(),
                        PayloadError::Invalid(detail) => format!("AI_RESPONSE_INVALID: {detail}"),
                    });
            }
            Err(ProviderFailure::Status(status, detail)) => {
                let retryable = status == 429 || status == 529 || (500..=599).contains(&status);
                if !retryable {
                    return Err(format!("AI_PROVIDER_HTTP_ERROR:{status}{detail}"));
                }
                if attempt == 2 {
                    return Err("AI_PROVIDER_BUSY".into());
                }
            }
            Err(ProviderFailure::Transport { detail, timed_out }) => {
                // 超时说明这一次生成量超出了预算，重试只会把同一份输出再写一遍，
                // 等待时间成倍放大。立即返回，让调用方缩短请求规模。
                if timed_out {
                    return Err(REQUEST_TIMEOUT_ERROR.into());
                }
                if attempt == 2 {
                    return Err(format!("{transport_error}: {detail}"));
                }
            }
            Err(ProviderFailure::Payload(error)) => {
                return Err(match error {
                    PayloadError::Empty => "AI_EMPTY_RESPONSE".to_string(),
                    PayloadError::Invalid(detail) => format!("AI_RESPONSE_INVALID: {detail}"),
                });
            }
            Err(ProviderFailure::Cancelled) => {
                return Err(REQUEST_CANCELLED_ERROR.into());
            }
        }
        sleep_with_cancellation(Duration::from_secs(2_u64.pow(attempt + 1)), cancel).await?;
    }
    Err("AI_PROVIDER_BUSY".into())
}

/// 流式请求失败时的错误前缀。
///
/// 流式只是进度反馈的增强，不该让生成失败：调用方看到带这个前缀的错误时，
/// 应当退回一次性请求重新生成。
const STREAM_FAILED_ERROR: &str = "AI_STREAM_FAILED";

/// 发送一次流式对话请求，边收边回调增量片段，最后返回完整正文。
///
/// 与 [`chat`] 的区别只有两点：响应按 SSE 逐块读取，以及每收到一段正文就调用
/// Decodes the next bytes of a stream without breaking a UTF-8 character.
///
/// `response.chunk()` may split a three-byte CJK character in half. Decoding
/// each chunk on its own with `from_utf8_lossy` turned both halves into U+FFFD
/// and silently corrupted the generated copy; the remainder is therefore kept
/// until the next chunk completes it.
fn decode_stream_chunk(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    match std::str::from_utf8(pending) {
        Ok(text) => {
            let decoded = text.to_owned();
            pending.clear();
            decoded
        }
        Err(error) if error.error_len().is_none() => {
            let valid = error.valid_up_to();
            let decoded = std::str::from_utf8(&pending[..valid])
                .unwrap_or_default()
                .to_owned();
            pending.drain(..valid);
            decoded
        }
        Err(_) => {
            let decoded = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            decoded
        }
    }
}

/// Sleeps between retries, but wakes up immediately when the task is cancelled.
///
/// The retry backoff used to be a bare `sleep`: cancelling during a 2–4s wait
/// still made the user wait for the whole delay before the request reported
/// that it had been cancelled.
async fn sleep_with_cancellation(duration: Duration, cancel: &CancelToken) -> Result<(), String> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(REQUEST_CANCELLED_ERROR.into()),
        () = tokio::time::sleep(duration) => Ok(()),
    }
}

/// `on_delta`。协议层面的失败一律带 `AI_STREAM_FAILED` 前缀，由调用方决定是否
/// 退回一次性请求。
pub async fn chat_stream(
    provider: &dyn ChatProvider,
    api_key: &str,
    body: &ChatRequest,
    timeout: Duration,
    transport_error: &str,
    cancel: &CancelToken,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("AI_CLIENT_FAILED: {error}"))?;
    let payload = provider.build_stream_request(body);
    let mut response = match tokio::select! {
        biased;
        () = cancel.cancelled() => return Err(REQUEST_CANCELLED_ERROR.into()),
        result = post_chat_raw(provider, &client, api_key, &payload) => result,
    } {
        Ok(response) => response,
        Err(ProviderFailure::Status(status, detail)) => {
            return Err(format!("{STREAM_FAILED_ERROR}: HTTP {status}{detail}"));
        }
        Err(ProviderFailure::Transport { detail, timed_out }) => {
            if timed_out {
                return Err(REQUEST_TIMEOUT_ERROR.into());
            }
            return Err(format!(
                "{STREAM_FAILED_ERROR}: {transport_error}: {detail}"
            ));
        }
        Err(ProviderFailure::Payload(error)) => {
            return Err(format!("{STREAM_FAILED_ERROR}: {error:?}"));
        }
        Err(ProviderFailure::Cancelled) => return Err(REQUEST_CANCELLED_ERROR.into()),
    };
    let mut parser = SseParser::new();
    let mut content = String::new();
    let mut pending_utf8 = Vec::new();
    loop {
        let chunk = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(REQUEST_CANCELLED_ERROR.into()),
            result = response.chunk() => result,
        };
        let Some(chunk) = chunk.map_err(|error| format!("{STREAM_FAILED_ERROR}: {error}"))? else {
            break;
        };
        let text = decode_stream_chunk(&mut pending_utf8, &chunk);
        for delta in parser.push(&text) {
            content.push_str(&delta);
            on_delta(&delta);
        }
    }
    if !pending_utf8.is_empty() {
        // An unfinished character at the end of the stream is a protocol error;
        // keep the readable part instead of dropping the whole response.
        let text = String::from_utf8_lossy(&pending_utf8).into_owned();
        for delta in parser.push(&text) {
            content.push_str(&delta);
            on_delta(&delta);
        }
    }
    for delta in parser.finish() {
        content.push_str(&delta);
        on_delta(&delta);
    }
    if content.trim().is_empty() {
        return Err(format!("{STREAM_FAILED_ERROR}: no content in stream"));
    }
    record_unreported_token_usage();
    Ok(content)
}

pub async fn vision_chat(
    provider: &dyn ChatProvider,
    api_key: &str,
    body: &VisionRequest,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<String, String> {
    if !provider.supports_vision() {
        return Err(format!("AI_VISION_UNSUPPORTED:{}", provider.id()));
    }
    let payload = provider.build_vision_request(body)?;
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("AI_CLIENT_FAILED: {error}"))?;
    for attempt in 0..3_u32 {
        let outcome = tokio::select! {
            biased;
            () = cancel.cancelled() => Err(ProviderFailure::Cancelled),
            result = post_chat(provider, &client, api_key, &payload) => result,
        };
        match outcome {
            Ok(response) => {
                record_token_usage(&response);
                return provider
                    .parse_response(response)
                    .map_err(|error| match error {
                        PayloadError::Empty => "AI_EMPTY_RESPONSE".to_string(),
                        PayloadError::Invalid(detail) => format!("AI_RESPONSE_INVALID: {detail}"),
                    });
            }
            Err(ProviderFailure::Status(status, _))
                if status == 429 || status == 529 || (500..=599).contains(&status) =>
            {
                if attempt == 2 {
                    return Err("AI_PROVIDER_BUSY".into());
                }
            }
            Err(ProviderFailure::Status(status, detail)) => {
                return Err(format!("AI_PROVIDER_HTTP_ERROR:{status}{detail}"))
            }
            Err(ProviderFailure::Transport { detail, timed_out }) => {
                if timed_out {
                    return Err(REQUEST_TIMEOUT_ERROR.into());
                }
                if attempt == 2 {
                    return Err(format!("AI_VISION_REQUEST_FAILED: {detail}"));
                }
            }
            Err(ProviderFailure::Payload(error)) => {
                return Err(match error {
                    PayloadError::Empty => "AI_EMPTY_RESPONSE".into(),
                    PayloadError::Invalid(detail) => format!("AI_RESPONSE_INVALID: {detail}"),
                })
            }
            Err(ProviderFailure::Cancelled) => {
                return Err(REQUEST_CANCELLED_ERROR.into());
            }
        }
        sleep_with_cancellation(Duration::from_secs(2_u64.pow(attempt + 1)), cancel).await?;
    }
    Err("AI_PROVIDER_BUSY".into())
}

/// 下载生成结果时允许的最大体积。超过这个体积的图片对页面没有价值，
/// 而且会把内存和磁盘撑满。
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// 厂商在 200 响应里报告的业务错误。
///
/// MiniMax 系列的接口即使失败也可能返回 200，真正的错误码放在 `base_resp` 里。
/// 只看 HTTP 状态码会把失败当成功。
fn base_resp_failure(payload: &serde_json::Value) -> Option<(i64, String)> {
    let base = payload.get("base_resp")?;
    let code = match base.get("status_code") {
        Some(serde_json::Value::Number(number)) => number.as_i64()?,
        Some(serde_json::Value::String(text)) => text.trim().parse::<i64>().ok()?,
        _ => return None,
    };
    if code == 0 {
        return None;
    }
    let message = base
        .get("status_msg")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .chars()
        .take(200)
        .collect::<String>();
    Some((code, message))
}

/// 发送一次图像生成请求。
async fn post_image(
    provider: &dyn ImageProvider,
    client: &reqwest::Client,
    api_key: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, ProviderFailure> {
    let response = provider
        .apply_auth(client.post(provider.image_endpoint()), api_key)
        .json(payload)
        .send()
        .await
        .map_err(|error| ProviderFailure::Transport {
            detail: error.to_string(),
            timed_out: error.is_timeout(),
        })?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(ProviderFailure::Status(
            status,
            provider_error_detail(response).await,
        ));
    }
    response
        .json()
        .await
        .map_err(|error| ProviderFailure::Payload(PayloadError::Invalid(error.to_string())))
}

/// 下载厂商给出的图片。
///
/// 这里刻意不带任何鉴权头：图片地址是厂商自己给出的公开地址，把 API Key 发过去
/// 等于把凭据交给图片服务器。只允许厂商官方域名，避免厂商返回的地址被当成
/// 任意 URL 去请求。
async fn download_image(
    provider: &dyn ImageProvider,
    client: &reqwest::Client,
    url: &str,
    cancel: &CancelToken,
) -> Result<(Vec<u8>, Option<String>), String> {
    provider.ensure_image_url_allowed(url)?;
    let response = tokio::select! {
        biased;
        () = cancel.cancelled() => return Err(REQUEST_CANCELLED_ERROR.into()),
        result = client.get(url).send() => result,
    }
    .map_err(|error| format!("AI_IMAGE_DOWNLOAD_FAILED: {error}"))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("AI_IMAGE_DOWNLOAD_FAILED: HTTP {status}"));
    }
    read_image_body(response, cancel).await
}

/// 读取下载好的图片，并检查体积上限。
async fn read_image_body(
    mut response: reqwest::Response,
    cancel: &CancelToken,
) -> Result<(Vec<u8>, Option<String>), String> {
    if let Some(length) = response.content_length() {
        ensure_image_size(length)?;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());
    // Read in chunks so a response without Content-Length cannot force the
    // whole body into memory before the size check runs.
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(REQUEST_CANCELLED_ERROR.into()),
            result = response.chunk() => result,
        }
        .map_err(|error| format!("AI_IMAGE_DOWNLOAD_FAILED: {error}"))?;
        let Some(chunk) = chunk else {
            break;
        };
        bytes.extend_from_slice(&chunk);
        ensure_image_size(bytes.len() as u64)?;
    }
    Ok((bytes, content_type))
}

/// 图片体积上限检查。
fn ensure_image_size(length: u64) -> Result<(), String> {
    if length > MAX_IMAGE_BYTES as u64 {
        return Err("AI_IMAGE_DOWNLOAD_FAILED: image is too large".into());
    }
    Ok(())
}

/// 从图片字节里识别常见格式。
pub fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// 从图片字节里读取像素尺寸。
///
/// 页面里摆放图片需要真实尺寸：厂商返回的地址不带尺寸信息，
/// 而尺寸又要参与版式计算，只能从图片头里读。
pub fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    // PNG 的 IHDR 块固定在文件头之后，宽高是大端 u32。
    if bytes.len() >= 24 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        return Some((width, height));
    }
    jpeg_dimensions(bytes)
}

/// 从 JPEG 字节里读取像素尺寸。
fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut index = 2usize;
    while index < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        // 标记前允许有若干 0xff 填充字节。
        while index < bytes.len() && bytes[index] == 0xff {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let marker = bytes[index];
        index += 1;
        match marker {
            // 这些标记后面没有长度字段，直接继续。
            0x01 | 0xd0..=0xd9 => continue,
            // 图像数据开始，后面不再有尺寸信息。
            0xda => break,
            _ => {}
        }
        if index + 1 >= bytes.len() {
            break;
        }
        let length = u16::from_be_bytes([bytes[index], bytes[index + 1]]) as usize;
        if length < 2 {
            break;
        }
        // SOF 段里依次是精度、高度、宽度。
        let is_frame_header = matches!(
            marker,
            0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
        );
        if is_frame_header {
            if index + 6 >= bytes.len() {
                return None;
            }
            let height = u16::from_be_bytes([bytes[index + 3], bytes[index + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            return Some((width, height));
        }
        index += length;
    }
    None
}

/// 拆开 `data:image/png;base64,xxxx` 形式的内联图片。
fn split_data_uri(value: &str) -> Option<(Option<String>, &str)> {
    let rest = value.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let mime = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .map(str::to_string);
    Some((mime, payload))
}

/// 把厂商给出的图片变成 data URL。
///
/// 尺寸优先从图片头里读；读不出来时退回请求时的尺寸：厂商可能按比例做了微调，
/// 但页面里至少需要一个能用的尺寸。
async fn materialize_image(
    provider: &dyn ImageProvider,
    client: &reqwest::Client,
    image: ImagePayload,
    cancel: &CancelToken,
    fallback_size: (u32, u32),
) -> Result<ImageResult, String> {
    let (bytes, mime_hint) = match image {
        ImagePayload::Base64 { data, mime_type } => {
            let (mime, payload) = match split_data_uri(&data) {
                Some((mime, payload)) => (mime.or(mime_type), payload.to_string()),
                None => (mime_type, data),
            };
            if payload.len() as u64 > (MAX_IMAGE_BYTES as u64).saturating_mul(4) / 3 + 8 {
                return Err("AI_IMAGE_RESPONSE_INVALID: image is too large".into());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(payload.as_bytes())
                .map_err(|_| "AI_IMAGE_RESPONSE_INVALID: image payload is not valid base64")?;
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err("AI_IMAGE_RESPONSE_INVALID: image is too large".into());
            }
            (bytes, mime)
        }
        ImagePayload::Url { url } => {
            let (bytes, content_type) = download_image(provider, client, &url, cancel).await?;
            (bytes, content_type)
        }
    };
    let mime_type = mime_hint
        .filter(|value| value.starts_with("image/"))
        .or_else(|| detect_image_mime(&bytes).map(str::to_string))
        .unwrap_or_else(|| "image/png".to_string());
    let (width, height) = image_dimensions(&bytes).unwrap_or(fallback_size);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ImageResult {
        data_url: format!("data:{mime_type};base64,{encoded}"),
        mime_type,
        width,
        height,
    })
}

/// 生成一张图片。
///
/// 重试策略与 [`chat`] 一致：只对限流、服务端错误和传输层抖动重试。HTTP 4xx
/// 与响应解析失败不重试——重试只会把同一份失败再写一遍，而图片生成是按张计费的。
pub async fn generate_image(
    provider: &dyn ImageProvider,
    api_key: &str,
    body: &ImageRequest,
    timeout: Duration,
    cancel: &CancelToken,
) -> Result<ImageResult, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        // 图片地址的域名白名单只校验第一跳。跟随 302 会把请求带到内网或
        // 未校验的域名，因此这个 client 不自动跟随重定向。
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("AI_CLIENT_FAILED: {error}"))?;
    let fallback_size = match (body.width, body.height) {
        (Some(width), Some(height)) => (width, height),
        _ => provider.default_image_size(),
    };
    for attempt in 0..3_u32 {
        let payload = provider.build_image_request(body);
        let outcome = tokio::select! {
            biased;
            () = cancel.cancelled() => Err(ProviderFailure::Cancelled),
            result = post_image(provider, &client, api_key, &payload) => result,
        };
        match outcome {
            Ok(response) => {
                if let Some((code, message)) = base_resp_failure(&response) {
                    // 1002 是厂商的限流码，值得退避后重试；其余错误重试没有意义。
                    if code != 1002 {
                        return Err(if message.is_empty() {
                            format!("AI_IMAGE_PROVIDER_ERROR:{code}")
                        } else {
                            format!("AI_IMAGE_PROVIDER_ERROR:{code} {message}")
                        });
                    }
                    if attempt == 2 {
                        return Err("AI_IMAGE_PROVIDER_BUSY".into());
                    }
                } else {
                    let image = provider
                        .parse_image_response(response)
                        .map_err(|detail| format!("AI_IMAGE_RESPONSE_INVALID: {detail}"))?;
                    return materialize_image(provider, &client, image, cancel, fallback_size)
                        .await;
                }
            }
            Err(ProviderFailure::Status(status, detail)) => {
                let retryable = status == 429 || status == 529 || (500..=599).contains(&status);
                if !retryable {
                    return Err(format!("AI_IMAGE_REQUEST_FAILED: HTTP {status}{detail}"));
                }
                if attempt == 2 {
                    return Err("AI_IMAGE_PROVIDER_BUSY".into());
                }
            }
            Err(ProviderFailure::Transport { detail, timed_out }) => {
                if timed_out {
                    return Err(REQUEST_TIMEOUT_ERROR.into());
                }
                if attempt == 2 {
                    return Err(format!("AI_IMAGE_REQUEST_FAILED: {detail}"));
                }
            }
            Err(ProviderFailure::Payload(error)) => {
                return Err(match error {
                    PayloadError::Empty => "AI_IMAGE_RESPONSE_INVALID: empty body".into(),
                    PayloadError::Invalid(detail) => {
                        format!("AI_IMAGE_RESPONSE_INVALID: {detail}")
                    }
                });
            }
            Err(ProviderFailure::Cancelled) => {
                return Err(REQUEST_CANCELLED_ERROR.into());
            }
        }
        sleep_with_cancellation(Duration::from_secs(2_u64.pow(attempt + 1)), cancel).await?;
    }
    Err("AI_IMAGE_PROVIDER_BUSY".into())
}

/// 厂商凭据槽位。每个厂商一个槽位，互不覆盖。
fn credential_slot(provider: &dyn ChatProvider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, &format!("ai-api-key/{}", provider.id()))
        .map_err(|error| format!("CREDENTIAL_STORE_UNAVAILABLE: {error}"))
}

/// 旧版本按厂商命名的凭据槽位，仅用于读取迁移与清理。
fn legacy_credential_slot(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, name)
        .map_err(|error| format!("CREDENTIAL_STORE_UNAVAILABLE: {error}"))
}

/// 读取凭据：当前槽位 → 旧槽位 → 环境变量。
pub fn read_api_key(provider: &dyn ChatProvider) -> Result<String, String> {
    if let Ok(key) = credential_slot(provider)?.get_password() {
        return Ok(key);
    }
    if let Some(legacy) = provider.legacy_credential_name() {
        if let Ok(key) = legacy_credential_slot(legacy)?.get_password() {
            return Ok(key);
        }
    }
    std::env::var(provider.api_key_env_var()).map_err(|_| "AI_API_KEY_MISSING".into())
}

/// 保存凭据，并清理同一密钥在旧槽位中的副本。
pub fn save_api_key(provider: &dyn ChatProvider, api_key: &str) -> Result<(), String> {
    credential_slot(provider)?
        .set_password(api_key)
        .map_err(|error| format!("CREDENTIAL_SAVE_FAILED: {error}"))?;
    if let Some(legacy) = provider.legacy_credential_name() {
        let _ = legacy_credential_slot(legacy)?.delete_credential();
    }
    Ok(())
}

/// 删除凭据，包括旧槽位残留。
pub fn delete_api_key(provider: &dyn ChatProvider) -> Result<(), String> {
    match credential_slot(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(format!("CREDENTIAL_DELETE_FAILED: {error}")),
    }
    if let Some(legacy) = provider.legacy_credential_name() {
        let _ = legacy_credential_slot(legacy)?.delete_credential();
    }
    Ok(())
}

/// 是否已经配置了可用凭据。
pub fn api_key_configured(provider: &dyn ChatProvider) -> bool {
    if credential_slot(provider)
        .map(|slot| slot.get_password().is_ok())
        .unwrap_or(false)
    {
        return true;
    }
    if let Some(legacy) = provider.legacy_credential_name() {
        if legacy_credential_slot(legacy)
            .map(|slot| slot.get_password().is_ok())
            .unwrap_or(false)
        {
            return true;
        }
    }
    std::env::var(provider.api_key_env_var()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_default_provider_and_rejects_unknown_ids() {
        assert_eq!(resolve(None).unwrap().id(), DEFAULT_PROVIDER_ID);
        assert_eq!(resolve(Some("minimax")).unwrap().id(), "minimax");
        let error = resolve(Some("not-a-provider"))
            .err()
            .expect("unknown provider must fail");
        assert_eq!(error, "AI_PROVIDER_UNKNOWN:not-a-provider");
    }

    #[test]
    fn rejects_model_names_that_could_inject_request_fields() {
        let provider = resolve(None).unwrap();
        assert!(resolve_model(provider, Some("MiniMax-M3".into())).is_ok());
        assert!(resolve_model(provider, Some("MiniMax M3".into())).is_err());
        assert!(resolve_model(provider, Some(String::new())).is_err());
        assert_eq!(
            resolve_model(provider, Some("bad name".into())).unwrap_err(),
            "AI_MODEL_INVALID"
        );
    }

    #[test]
    fn decodes_a_cjk_character_split_across_stream_chunks() {
        let bytes = "岳阳楼".as_bytes();
        let mut pending = Vec::new();
        let mut decoded = String::new();
        // 3-byte characters split at 2 and 5 bytes: both boundaries fall inside
        // a UTF-8 sequence.
        for chunk in [&bytes[..2], &bytes[2..5], &bytes[5..]] {
            decoded.push_str(&decode_stream_chunk(&mut pending, chunk));
        }
        assert_eq!(decoded, "岳阳楼");
        assert!(pending.is_empty());
    }

    /// 图像生成相关测试。
    mod image_tests {
        use super::*;

        /// 构造一个只有文件头的 PNG，用来验证尺寸解析。
        fn png_bytes(width: u32, height: u32) -> Vec<u8> {
            let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
            bytes.extend_from_slice(&13u32.to_be_bytes());
            bytes.extend_from_slice(b"IHDR");
            bytes.extend_from_slice(&width.to_be_bytes());
            bytes.extend_from_slice(&height.to_be_bytes());
            bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
            bytes.extend_from_slice(&0u32.to_be_bytes());
            bytes
        }

        /// 构造一个带 SOF0 段的 JPEG，用来验证尺寸解析。
        fn jpeg_bytes(width: u16, height: u16) -> Vec<u8> {
            let mut bytes = vec![0xff, 0xd8, 0xff, 0xc0];
            bytes.extend_from_slice(&17u16.to_be_bytes());
            bytes.push(8);
            bytes.extend_from_slice(&height.to_be_bytes());
            bytes.extend_from_slice(&width.to_be_bytes());
            bytes.extend_from_slice(&[3, 1, 0x11, 0]);
            bytes.extend_from_slice(&[0xff, 0xd9]);
            bytes
        }

        fn image_provider() -> &'static dyn ImageProvider {
            let provider = resolve(None).expect("默认厂商必须存在");
            resolve_image_provider(provider).expect("默认厂商必须支持图像生成")
        }

        #[test]
        fn resolves_the_image_model_and_rejects_unknown_ones() {
            let provider = image_provider();
            assert_eq!(
                resolve_image_model(provider, None).unwrap(),
                provider.default_image_model()
            );
            assert_eq!(
                resolve_image_model(provider, Some("image-01-live".into())).unwrap(),
                "image-01-live"
            );
            // 对话模型名不能传给图像接口。
            let error = resolve_image_model(provider, Some("MiniMax-M3".into())).unwrap_err();
            assert!(error.starts_with("AI_IMAGE_MODEL_UNSUPPORTED"), "{error}");
        }

        #[test]
        fn reports_a_provider_error_hidden_inside_a_successful_response() {
            let payload = serde_json::json!({
                "data": { "image_base64": ["QUJD"] },
                "base_resp": { "status_code": 1008, "status_msg": "insufficient balance" }
            });
            let (code, message) = base_resp_failure(&payload).expect("必须识别出厂商错误码");
            assert_eq!(code, 1008);
            assert_eq!(message, "insufficient balance");
            let ok =
                serde_json::json!({ "base_resp": { "status_code": 0, "status_msg": "success" } });
            assert!(base_resp_failure(&ok).is_none());
        }

        #[test]
        fn reads_the_pixel_size_of_png_and_jpeg_bytes() {
            assert_eq!(image_dimensions(&png_bytes(1280, 720)), Some((1280, 720)));
            assert_eq!(image_dimensions(&jpeg_bytes(640, 480)), Some((640, 480)));
            assert_eq!(detect_image_mime(&png_bytes(1, 1)), Some("image/png"));
            assert_eq!(detect_image_mime(&jpeg_bytes(1, 1)), Some("image/jpeg"));
            assert_eq!(detect_image_mime(b"not an image"), None);
        }

        #[tokio::test]
        async fn turns_a_base64_response_into_a_data_url() {
            let provider = image_provider();
            let client = reqwest::Client::new();
            let cancel = CancelToken::new();
            let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes(1280, 720));
            let result = materialize_image(
                provider,
                &client,
                ImagePayload::Base64 {
                    data: format!("data:image/png;base64,{encoded}"),
                    mime_type: None,
                },
                &cancel,
                (800, 600),
            )
            .await
            .expect("内嵌图片必须能转成 data URL");
            assert_eq!(result.mime_type, "image/png");
            assert_eq!((result.width, result.height), (1280, 720));
            assert!(result.data_url.starts_with("data:image/png;base64,"));
        }

        #[tokio::test]
        async fn refuses_an_image_body_that_is_too_large() {
            // 只回一次响应头的本地服务器：体积上限必须在读正文之前生效。
            let url = spawn_static_server(
                "HTTP/1.1 200 OK\r\nContent-Length: 30000000\r\nContent-Type: image/png\r\n\r\n",
            );
            let response = reqwest::get(&url).await.expect("本地服务器必须应答");
            let error = read_image_body(response, &CancelToken::new())
                .await
                .expect_err("超大响应体必须被拒绝");
            assert!(error.contains("too large"), "{error}");
        }

        #[tokio::test]
        async fn refuses_to_download_an_image_from_a_foreign_host() {
            // 地址检查发生在发请求之前：厂商返回的地址不能被当成任意 URL。
            let provider = image_provider();
            let client = reqwest::Client::new();
            let error = download_image(
                provider,
                &client,
                "https://evil.example.com/a.png",
                &CancelToken::new(),
            )
            .await
            .expect_err("非官方域名必须被拒绝");
            assert!(error.contains("official"), "{error}");
        }

        #[tokio::test]
        async fn refuses_to_download_an_image_over_plain_http() {
            let url = spawn_static_server("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\nx");
            let provider = image_provider();
            let client = reqwest::Client::new();
            let error = download_image(provider, &client, &url, &CancelToken::new())
                .await
                .expect_err("明文地址必须被拒绝");
            assert!(error.contains("https"), "{error}");
        }

        #[tokio::test]
        async fn image_generation_gives_up_immediately_when_the_task_was_cancelled() {
            let provider = image_provider();
            let cancel = CancelToken::new();
            cancel.cancel();
            let body = ImageRequest {
                model: provider.default_image_model().to_string(),
                prompt: "取消测试".into(),
                width: None,
                height: None,
            };
            let error = generate_image(
                provider,
                "unused-key",
                &body,
                Duration::from_secs(30),
                &cancel,
            )
            .await
            .expect_err("已取消的任务不能产出图片");
            assert_eq!(error, REQUEST_CANCELLED_ERROR);
        }
    }

    /// 起一个只回一次固定响应的本地服务器，返回它的地址。
    fn spawn_static_server(response: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a test port");
        let address = listener.local_addr().expect("read the test address");
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            use std::io::{Read, Write};
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        });
        format!("http://{address}/image")
    }

    #[tokio::test]
    async fn chat_gives_up_immediately_when_the_task_was_cancelled() {
        // 取消后不应该再发出请求，也不应该等待厂商把整份草稿写完。
        let provider = resolve(None).unwrap();
        let cancel = CancelToken::new();
        cancel.cancel();
        let body = ChatRequest {
            model: "MiniMax-M3".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "取消测试".into(),
            }],
            temperature: 0.0,
        };
        let error = chat(
            provider,
            "unused-key",
            &body,
            Duration::from_secs(30),
            "AI_TEST_REQUEST_FAILED",
            &cancel,
        )
        .await
        .expect_err("a cancelled task must not produce content");
        assert_eq!(error, REQUEST_CANCELLED_ERROR);
    }

    /// 指向本地测试服务器的假厂商。
    struct FakeProvider {
        url: &'static str,
    }

    impl ChatProvider for FakeProvider {
        fn id(&self) -> &'static str {
            "fake"
        }
        fn display_name(&self) -> &'static str {
            "本地测试厂商"
        }
        fn api_base_url(&self) -> &'static str {
            self.url
        }
        fn default_model(&self) -> &'static str {
            "Fake-Model"
        }
        fn model_env_var(&self) -> &'static str {
            "FAKE_MODEL"
        }
        fn api_key_env_var(&self) -> &'static str {
            "FAKE_API_KEY"
        }
        fn apply_auth(
            &self,
            request: reqwest::RequestBuilder,
            _api_key: &str,
        ) -> reqwest::RequestBuilder {
            request
        }
        fn build_request(&self, request: &ChatRequest) -> serde_json::Value {
            serde_json::to_value(request).unwrap_or(serde_json::Value::Null)
        }
        fn parse_response(&self, _payload: serde_json::Value) -> Result<String, PayloadError> {
            // 流式请求不走这里。
            Err(PayloadError::Empty)
        }
    }

    /// 起一个只回一次 SSE 响应的本地服务器。
    ///
    /// 响应分两次写出，中间停一下：这样一次 SSE 行会被切在两个网络分片里，
    /// 正好覆盖流式解析最容易出错的地方。
    fn spawn_sse_server(first: &str, second: &str) -> &'static str {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a test port");
        let address = listener.local_addr().expect("read the test address");
        let first = first.to_string();
        let second = second.to_string();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            use std::io::{Read, Write};
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let body = format!("{first}{second}");
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let split = body.len() / 2;
            let _ = stream.write_all(&body.as_bytes()[..split]);
            let _ = stream.flush();
            std::thread::sleep(Duration::from_millis(30));
            let _ = stream.write_all(&body.as_bytes()[split..]);
        });
        let url = format!("http://{address}/chat");
        Box::leak(url.into_boxed_str())
    }

    #[tokio::test]
    async fn reads_a_streamed_answer_across_network_pieces() {
        let url = spawn_sse_server(
            "data: {\"choices\":[{\"delta\":{\"content\":\"岳阳\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"cont",
            "ent\":\"楼记\"}}]}\n\ndata: [DONE]\n\n",
        );
        let provider = FakeProvider { url };
        let body = ChatRequest {
            model: "Fake-Model".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "测试".into(),
            }],
            temperature: 0.0,
        };
        let cancel = CancelToken::new();
        let mut deltas: Vec<String> = Vec::new();

        let content = chat_stream(
            &provider,
            "unused-key",
            &body,
            Duration::from_secs(10),
            "AI_TEST_REQUEST_FAILED",
            &cancel,
            &mut |delta: &str| deltas.push(delta.to_string()),
        )
        .await
        .expect("the stream must be read");

        assert_eq!(content, "岳阳楼记");
        assert_eq!(deltas, vec!["岳阳", "楼记"]);
    }

    #[tokio::test]
    async fn reports_a_stream_failure_so_the_caller_can_fall_back() {
        // 服务器不存在的地址：流式必须报可退回的错误，而不是假装成功。
        let provider = FakeProvider {
            url: "http://127.0.0.1:1/chat",
        };
        let body = ChatRequest {
            model: "Fake-Model".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "测试".into(),
            }],
            temperature: 0.0,
        };
        let cancel = CancelToken::new();

        let error = chat_stream(
            &provider,
            "unused-key",
            &body,
            Duration::from_secs(5),
            "AI_TEST_REQUEST_FAILED",
            &cancel,
            &mut |_delta: &str| {},
        )
        .await
        .expect_err("a dead server must not produce content");

        assert!(error.starts_with(STREAM_FAILED_ERROR), "{error}");
    }
}
