//! AI 服务端口（port）与厂商注册表。
//!
//! 命令层只依赖本模块的厂商无关接口。新增厂商时：新增一个适配器文件，
//! 实现 `ChatProvider`，并在 `PROVIDERS` 中注册；命令层与前端调用方式不变。

pub mod minimax;

use serde::Serialize;
use std::time::Duration;

const CREDENTIAL_SERVICE: &str = "com.pptd.desktop";

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

/// 厂商请求失败时的分类，用于区分是否值得重试。
enum ProviderFailure {
    /// 厂商返回了 HTTP 状态码。
    Status(u16),
    /// 网络或传输层失败。
    Transport(String),
    /// 响应体结构不符合预期。
    Payload(PayloadError),
}

async fn post_chat(
    provider: &dyn ChatProvider,
    client: &reqwest::Client,
    api_key: &str,
    body: &ChatRequest,
) -> Result<serde_json::Value, ProviderFailure> {
    let response = provider
        .apply_auth(client.post(provider.api_base_url()), api_key)
        .json(&provider.build_request(body))
        .send()
        .await
        .map_err(|error| ProviderFailure::Transport(error.to_string()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(ProviderFailure::Status(status));
    }
    response
        .json()
        .await
        .map_err(|error| ProviderFailure::Payload(PayloadError::Invalid(error.to_string())))
}

/// 发送一次对话请求并返回助手正文。
///
/// 限流与厂商侧临时故障会按退避策略重试；`transport_error` 是传输层最终失败时
/// 使用的错误码，由调用方按阶段区分。
pub async fn chat(
    provider: &dyn ChatProvider,
    api_key: &str,
    body: &ChatRequest,
    timeout: Duration,
    transport_error: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("AI_CLIENT_FAILED: {error}"))?;
    for attempt in 0..3_u32 {
        match post_chat(provider, &client, api_key, body).await {
            Ok(payload) => {
                return provider
                    .parse_response(payload)
                    .map_err(|error| match error {
                        PayloadError::Empty => "AI_EMPTY_RESPONSE".to_string(),
                        PayloadError::Invalid(detail) => format!("AI_RESPONSE_INVALID: {detail}"),
                    });
            }
            Err(ProviderFailure::Status(status)) => {
                let retryable = status == 429 || status == 529 || (500..=599).contains(&status);
                if !retryable {
                    return Err(format!("AI_PROVIDER_HTTP_ERROR:{status}"));
                }
                if attempt == 2 {
                    return Err("AI_PROVIDER_BUSY".into());
                }
            }
            Err(ProviderFailure::Transport(error)) => {
                if attempt == 2 {
                    return Err(format!("{transport_error}: {error}"));
                }
            }
            Err(ProviderFailure::Payload(error)) => {
                return Err(match error {
                    PayloadError::Empty => "AI_EMPTY_RESPONSE".to_string(),
                    PayloadError::Invalid(detail) => format!("AI_RESPONSE_INVALID: {detail}"),
                });
            }
        }
        tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt + 1))).await;
    }
    Err("AI_PROVIDER_BUSY".into())
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
}
