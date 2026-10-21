//! MiniMax 中国区开放平台适配器。
//!
//! 厂商专属信息（地址、鉴权、响应结构）只出现在本文件。

use super::{ChatProvider, ChatRequest, PayloadError};
use serde::Deserialize;

pub const PROVIDER_ID: &str = "minimax";

const MINIMAX_CHINA_CHAT_URL: &str = "https://api.minimaxi.com/v1/text/chatcompletion_v2";
const MINIMAX_DEFAULT_MODEL: &str = "MiniMax-M3";

pub static MINIMAX: MiniMaxProvider = MiniMaxProvider;

#[derive(Clone, Copy)]
pub struct MiniMaxProvider;

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}

impl ChatProvider for MiniMaxProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn display_name(&self) -> &'static str {
        "MiniMax 中国区"
    }

    fn api_base_url(&self) -> &'static str {
        MINIMAX_CHINA_CHAT_URL
    }

    fn default_model(&self) -> &'static str {
        MINIMAX_DEFAULT_MODEL
    }

    fn model_env_var(&self) -> &'static str {
        "MINIMAX_MODEL"
    }

    fn api_key_env_var(&self) -> &'static str {
        "MINIMAX_API_KEY"
    }

    /// 旧版本把凭据存在以厂商命名的槽位里，迁移时读取一次。
    fn legacy_credential_name(&self) -> Option<&'static str> {
        Some("minimax-api-key")
    }

    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        api_key: &str,
    ) -> reqwest::RequestBuilder {
        request.bearer_auth(api_key)
    }

    fn build_request(&self, request: &ChatRequest) -> serde_json::Value {
        // ChatRequest 的字段与 MiniMax 期望的请求体一致，直接序列化即可。
        serde_json::to_value(request).unwrap_or(serde_json::Value::Null)
    }

    fn parse_response(&self, payload: serde_json::Value) -> Result<String, PayloadError> {
        let response: ChatResponse = serde_json::from_value(payload)
            .map_err(|error| PayloadError::Invalid(error.to_string()))?;
        response
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .ok_or(PayloadError::Empty)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_assistant_content_from_a_chat_response() {
        let provider = MINIMAX;
        let payload = serde_json::json!({
            "choices": [{ "message": { "content": "OK" } }]
        });
        assert_eq!(provider.parse_response(payload).unwrap(), "OK");
    }

    #[test]
    fn reports_an_empty_choice_list_as_an_empty_response() {
        let provider = MINIMAX;
        let payload = serde_json::json!({ "choices": [] });
        assert!(matches!(
            provider.parse_response(payload),
            Err(PayloadError::Empty)
        ));
    }

    #[test]
    fn builds_the_request_body_from_the_shared_chat_request() {
        let provider = MINIMAX;
        let request = ChatRequest {
            model: "MiniMax-M3".into(),
            messages: vec![super::super::ChatMessage {
                role: "user".into(),
                content: "你好".into(),
            }],
            temperature: 0.4,
        };
        let body = provider.build_request(&request);
        assert_eq!(body["model"], "MiniMax-M3");
        assert_eq!(body["messages"][0]["content"], "你好");
        let temperature = body["temperature"]
            .as_f64()
            .expect("temperature must be numeric");
        assert!((temperature - 0.4).abs() < 0.000_001);
    }
}
