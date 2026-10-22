//! MiniMax 中国区图像生成适配器。
//!
//! 厂商专属信息（地址、鉴权、请求体字段、响应结构、可信图片域名）只出现在本文件。
//!
//! 规格来源：MiniMax 开放平台「文生图」接口文档
//! <https://platform.minimaxi.com/document/text_to_image>
//! 与「图片生成指南」<https://platform.minimaxi.com/document/guides_image_generation>。
//!
//! 重要：该规格来自官方文档，**未经真实 API 调用验证**。文档声明的请求体字段为
//! `model` / `prompt` / `aspect_ratio` / `width` / `height` / `response_format` /
//! `n` / `seed` / `prompt_optimizer` / `aigc_watermark`，响应体为
//! `data.image_base64`（`response_format=base64`）或 `data.image_urls`
//! （`response_format=url`，链接 24 小时后失效）。

use serde_json::Value;

use super::{ImagePayload, ImageProvider, ImageRequest};

pub const PROVIDER_ID: &str = "minimax";

/// 图像生成接口地址。与对话接口（`/v1/text/chatcompletion_v2`）不是同一个端点。
const MINIMAX_CHINA_IMAGE_URL: &str = "https://api.minimaxi.com/v1/image_generation";

const MINIMAX_DEFAULT_IMAGE_MODEL: &str = "image-01";

/// 官方文档列出的图像模型。`image-01-live` 额外支持画风设置。
const MINIMAX_IMAGE_MODELS: &[&str] = &["image-01", "image-01-live"];

/// 提示词长度上限。官方文档规定 `prompt` 最长 1500 字符，这里按字符数而不是字节数
/// 计算，避免中文提示词被按字节误判为超长。
pub const MAX_PROMPT_CHARS: usize = 1500;

/// 官方文档规定 `width` / `height` 取值范围 [512, 2048] 且必须是 8 的倍数，
/// 并且必须同时设置。
pub const MIN_IMAGE_EDGE: u32 = 512;
pub const MAX_IMAGE_EDGE: u32 = 2048;

/// 未指定尺寸时使用的宽高比。官方文档里 `16:9` 对应 1280x720，贴合演示页面比例。
const DEFAULT_ASPECT_RATIO: &str = "16:9";

/// 下载生成结果时允许的官方域名后缀。
///
/// 厂商返回的图片地址落在自家 CDN 上（官方示例中出现 `cdn.hailuoai.com`），
/// 只允许官方域名，避免把厂商返回的地址当成任意 URL 去请求（SSRF）。
const ALLOWED_IMAGE_HOST_SUFFIXES: &[&str] = &[
    "hailuoai.com",
    "minimax.chat",
    "minimaxi.com",
    "minimax.io",
    "minimax.com",
];

pub static MINIMAX_IMAGE: MiniMaxImageProvider = MiniMaxImageProvider;

#[derive(Clone, Copy)]
pub struct MiniMaxImageProvider;

impl ImageProvider for MiniMaxImageProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn image_endpoint(&self) -> &'static str {
        MINIMAX_CHINA_IMAGE_URL
    }

    fn default_image_model(&self) -> &'static str {
        MINIMAX_DEFAULT_IMAGE_MODEL
    }

    fn image_model_env_var(&self) -> &'static str {
        "MINIMAX_IMAGE_MODEL"
    }

    fn supported_image_models(&self) -> &'static [&'static str] {
        MINIMAX_IMAGE_MODELS
    }

    fn default_image_size(&self) -> (u32, u32) {
        (1280, 720)
    }

    /// 与对话接口同样的 Bearer 鉴权。
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        api_key: &str,
    ) -> reqwest::RequestBuilder {
        request.bearer_auth(api_key)
    }

    fn build_image_request(&self, request: &ImageRequest) -> Value {
        let mut body = serde_json::json!({
            "model": request.model,
            "prompt": request.prompt,
            // 统一取地址再就地转成 data URL：厂商给出的链接 24 小时后失效，
            // 转成 data URL 之后图片才能长期留在项目里。
            "response_format": "url",
            "n": 1,
        });
        let Some(object) = body.as_object_mut() else {
            return body;
        };
        match (request.width, request.height) {
            // 官方文档：同时设置 width/height 时它们优先于 aspect_ratio。
            (Some(width), Some(height)) => {
                object.insert("width".into(), serde_json::json!(width));
                object.insert("height".into(), serde_json::json!(height));
            }
            _ => {
                object.insert("aspect_ratio".into(), serde_json::json!(DEFAULT_ASPECT_RATIO));
            }
        }
        body
    }

    /// 从厂商响应里取出图片。
    ///
    /// 官方结构是 `data.image_base64`（数组）或 `data.image_urls`（数组）；
    /// 为了容忍其它合理形态，这里同时接受单值字段与 OpenAI 风格的
    /// `data.images[].b64_json` / `data.images[].url`。
    fn parse_image_response(&self, payload: Value) -> Result<ImagePayload, String> {
        let empty = Value::Null;
        let data = payload.get("data").unwrap_or(&empty);

        if let Some(image) = data.get("image_base64").and_then(first_string) {
            return Ok(ImagePayload::Base64 {
                data: image,
                mime_type: None,
            });
        }
        if let Some(url) = data.get("image_urls").and_then(first_string) {
            return Ok(ImagePayload::Url { url });
        }
        if let Some(url) = data.get("image_url").and_then(first_string) {
            return Ok(ImagePayload::Url { url });
        }
        if let Some(Value::Array(items)) = data.get("images") {
            for item in items {
                if let Some(image) = item
                    .get("b64_json")
                    .or_else(|| item.get("image_base64"))
                    .and_then(Value::as_str)
                {
                    if !image.trim().is_empty() {
                        return Ok(ImagePayload::Base64 {
                            data: image.to_string(),
                            mime_type: None,
                        });
                    }
                }
                if let Some(url) = item.get("url").and_then(Value::as_str) {
                    if !url.trim().is_empty() {
                        return Ok(ImagePayload::Url {
                            url: url.to_string(),
                        });
                    }
                }
            }
        }
        if let Some(image) = data.get("image").and_then(Value::as_str) {
            let image = image.trim();
            if !image.is_empty() {
                // 单字段形态可能是 data URI、裸 base64，也可能是图片地址。
                if image.starts_with("data:") || looks_like_base64(image) {
                    return Ok(ImagePayload::Base64 {
                        data: image.to_string(),
                        mime_type: None,
                    });
                }
                return Ok(ImagePayload::Url {
                    url: image.to_string(),
                });
            }
        }
        Err("response contains no image".into())
    }

    /// 只允许从厂商官方域名下载生成结果。
    fn ensure_image_url_allowed(&self, url: &str) -> Result<(), String> {
        let parsed =
            reqwest::Url::parse(url).map_err(|_| "AI_IMAGE_DOWNLOAD_FAILED: image url is invalid")?;
        if parsed.scheme() != "https" {
            return Err("AI_IMAGE_DOWNLOAD_FAILED: image url must use https".into());
        }
        // 带用户名密码的地址会把凭据带进请求头，拒绝。
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("AI_IMAGE_DOWNLOAD_FAILED: image url must not carry credentials".into());
        }
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        let allowed = ALLOWED_IMAGE_HOST_SUFFIXES
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
        if !allowed {
            return Err(
                "AI_IMAGE_DOWNLOAD_FAILED: image host is not an official MiniMax domain".into(),
            );
        }
        Ok(())
    }
}

/// 取数组里的第一个非空字符串；字段本身是字符串时直接返回。
fn first_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .find(|text| !text.is_empty())
            .map(str::to_string),
        _ => None,
    }
}

/// 判断字符串是否像 base64 图片数据（只认 base64 允许的字符）。
fn looks_like_base64(value: &str) -> bool {
    value.len() > 32
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_the_request_body_with_the_documented_field_names() {
        let body = MINIMAX_IMAGE.build_image_request(&ImageRequest {
            model: "image-01".into(),
            prompt: "一只在雨中奔跑的柴犬".into(),
            width: None,
            height: None,
        });
        assert_eq!(body["model"], "image-01");
        assert_eq!(body["prompt"], "一只在雨中奔跑的柴犬");
        assert_eq!(body["aspect_ratio"], "16:9");
        assert_eq!(body["response_format"], "url");
        assert_eq!(body["n"], 1);
        // 未指定尺寸时不应发送 width/height。
        assert!(body.get("width").is_none());
        assert!(body.get("height").is_none());
    }

    #[test]
    fn sends_explicit_pixel_size_instead_of_the_aspect_ratio() {
        // 官方文档：同时设置 width/height 时优先于 aspect_ratio。
        let body = MINIMAX_IMAGE.build_image_request(&ImageRequest {
            model: "image-01".into(),
            prompt: "城市夜景".into(),
            width: Some(1024),
            height: Some(768),
        });
        assert_eq!(body["width"], 1024);
        assert_eq!(body["height"], 768);
        assert!(body.get("aspect_ratio").is_none());
    }

    #[test]
    fn reads_a_base64_image_from_the_documented_response() {
        let payload = json!({
            "id": "03ff3cd0820949eb8a410056b5f21d38",
            "data": { "image_base64": ["QUJD", "REVG"] },
            "metadata": { "success_count": 2, "failed_count": 0 },
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        match MINIMAX_IMAGE.parse_image_response(payload).unwrap() {
            ImagePayload::Base64 { data, .. } => assert_eq!(data, "QUJD"),
            other => panic!("expected base64 payload, got {other:?}"),
        }
    }

    #[test]
    fn reads_a_base64_image_given_as_a_single_string() {
        let payload = json!({ "data": { "image_base64": "QUJD" } });
        match MINIMAX_IMAGE.parse_image_response(payload).unwrap() {
            ImagePayload::Base64 { data, .. } => assert_eq!(data, "QUJD"),
            other => panic!("expected base64 payload, got {other:?}"),
        }
    }

    #[test]
    fn keeps_the_data_uri_prefix_for_later_decoding() {
        let payload = json!({ "data": { "image_base64": ["data:image/png;base64,QUJD"] } });
        match MINIMAX_IMAGE.parse_image_response(payload).unwrap() {
            ImagePayload::Base64 { data, .. } => {
                assert_eq!(data, "data:image/png;base64,QUJD")
            }
            other => panic!("expected base64 payload, got {other:?}"),
        }
    }

    #[test]
    fn reads_an_image_url_from_the_documented_response() {
        let payload = json!({
            "data": { "image_urls": ["https://cdn.hailuoai.com/prod/a.jpg", "https://cdn.hailuoai.com/prod/b.jpg"] },
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        match MINIMAX_IMAGE.parse_image_response(payload).unwrap() {
            ImagePayload::Url { url } => assert_eq!(url, "https://cdn.hailuoai.com/prod/a.jpg"),
            other => panic!("expected url payload, got {other:?}"),
        }
    }

    #[test]
    fn reads_an_openai_compatible_image_entry() {
        let payload = json!({ "data": { "images": [{ "b64_json": "QUJD" }] } });
        match MINIMAX_IMAGE.parse_image_response(payload).unwrap() {
            ImagePayload::Base64 { data, .. } => assert_eq!(data, "QUJD"),
            other => panic!("expected base64 payload, got {other:?}"),
        }
        let payload = json!({ "data": { "images": [{ "url": "https://cdn.hailuoai.com/prod/c.jpg" }] } });
        match MINIMAX_IMAGE.parse_image_response(payload).unwrap() {
            ImagePayload::Url { url } => assert_eq!(url, "https://cdn.hailuoai.com/prod/c.jpg"),
            other => panic!("expected url payload, got {other:?}"),
        }
    }

    #[test]
    fn reports_a_response_without_any_image_as_invalid() {
        let payload = json!({
            "data": { "image_urls": [] },
            "base_resp": { "status_code": 0, "status_msg": "success" }
        });
        let error = MINIMAX_IMAGE
            .parse_image_response(payload)
            .expect_err("a response without an image must fail");
        assert!(error.contains("no image"), "{error}");
    }

    #[test]
    fn refuses_to_download_images_over_plain_http() {
        let error = MINIMAX_IMAGE
            .ensure_image_url_allowed("http://cdn.hailuoai.com/prod/a.jpg")
            .expect_err("plain http must be refused");
        assert!(error.contains("https"), "{error}");
    }

    #[test]
    fn refuses_to_download_images_from_foreign_hosts() {
        for url in [
            "https://evil.example.com/a.jpg",
            "https://cdn.hailuoai.com.evil.example/a.jpg",
            "https://127.0.0.1/a.jpg",
        ] {
            let error = MINIMAX_IMAGE
                .ensure_image_url_allowed(url)
                .expect_err("a foreign host must be refused");
            assert!(error.contains("official"), "{error}");
        }
    }

    #[test]
    fn allows_downloads_from_official_image_hosts() {
        for url in [
            "https://cdn.hailuoai.com/prod/a.jpg",
            "https://filecdn.minimax.chat/public/a.png",
            "https://api.minimaxi.com/v1/files/a.png",
        ] {
            MINIMAX_IMAGE
                .ensure_image_url_allowed(url)
                .expect("official hosts must be allowed");
        }
    }

    #[test]
    fn refuses_image_urls_that_carry_credentials() {
        let error = MINIMAX_IMAGE
            .ensure_image_url_allowed("https://user:pass@cdn.hailuoai.com/a.jpg")
            .expect_err("credential-bearing urls must be refused");
        assert!(error.contains("credentials"), "{error}");
    }
}
