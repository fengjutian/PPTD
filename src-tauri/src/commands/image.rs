//! 图片生成的 Tauri 命令。
//!
//! 命令只做三件事：校验请求、解析厂商与凭据、把结果整成前端能直接用的 data URL。
//! 厂商协议细节都在 `ai` 层。

use crate::ai::{self, CancelRegistry, ImageRequest};
use serde::Deserialize;
use serde::Serialize;
use std::time::Duration;

/// 图像生成的超时。图像模型比对话模型慢得多，但也不该无限等。
const IMAGE_TIMEOUT: Duration = Duration::from_secs(120);

/// 提示词长度上限，取厂商文档规定的 1500 字符。
///
/// 这里用字符数而不是字节数：中文提示词按字节算会被误判为超长。
const MAX_PROMPT_CHARS: usize = 1500;

/// 像素尺寸的取值范围与步进，取自厂商文档。
const MIN_IMAGE_EDGE: u32 = 512;
const MAX_IMAGE_EDGE: u32 = 2048;
const IMAGE_EDGE_STEP: u32 = 8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageRequest {
    prompt: String,
    /// 目标像素宽度。与 `height` 同时给出才生效。
    width: Option<u32>,
    /// 目标像素高度。与 `width` 同时给出才生效。
    height: Option<u32>,
    model: Option<String>,
    provider: Option<String>,
    /// 生成任务号：同一任务的所有请求共享它，取消时一并中断。
    task_id: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageResponse {
    /// 图片的 data URL，可直接放进画布或导出流程。
    data_url: String,
    mime_type: String,
    width: u32,
    height: u32,
}

/// 校验请求参数。
///
/// 校验放在命令层而不是只依赖厂商：厂商的参数错误码没有覆盖所有情况
/// （例如只给宽不给高），本地先拦住能省掉一次计费请求。
fn validate_request(request: &GenerateImageRequest) -> Result<(), String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("AI_IMAGE_REQUEST_INVALID: prompt is empty".into());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(format!(
            "AI_IMAGE_REQUEST_INVALID: prompt is longer than {MAX_PROMPT_CHARS} characters"
        ));
    }
    match (request.width, request.height) {
        (None, None) => {}
        (Some(width), Some(height)) => {
            for edge in [width, height] {
                if !(MIN_IMAGE_EDGE..=MAX_IMAGE_EDGE).contains(&edge) || edge % IMAGE_EDGE_STEP != 0 {
                    return Err(format!(
                        "AI_IMAGE_REQUEST_INVALID: width and height must be between {MIN_IMAGE_EDGE} and {MAX_IMAGE_EDGE} and a multiple of {IMAGE_EDGE_STEP}"
                    ));
                }
            }
        }
        _ => {
            return Err(
                "AI_IMAGE_REQUEST_INVALID: width and height must be provided together".into(),
            )
        }
    }
    Ok(())
}

/// 根据提示词生成一张图片。
///
/// 返回的是图片的 data URL，而不是厂商的下载地址：厂商给出的链接有有效期，
/// 图片要跟着项目文件长期存在。
#[tauri::command]
pub async fn generate_presentation_image(
    request: GenerateImageRequest,
    cancels: tauri::State<'_, CancelRegistry>,
) -> Result<GenerateImageResponse, String> {
    let cancel = cancels.token_for(request.task_id);
    validate_request(&request)?;

    let provider = ai::resolve(request.provider.as_deref())?;
    // 先确认厂商支持图像生成，再去读凭据：能力不支持时不该碰用户的密钥存储。
    let image_provider = ai::resolve_image_provider(provider)?;
    let api_key = ai::read_api_key(provider)?;
    let model = ai::resolve_image_model(image_provider, request.model)?;

    let result = ai::generate_image(
        image_provider,
        &api_key,
        &ImageRequest {
            model,
            prompt: request.prompt.trim().to_string(),
            width: request.width,
            height: request.height,
        },
        IMAGE_TIMEOUT,
        &cancel,
    )
    .await?;

    Ok(GenerateImageResponse {
        data_url: result.data_url,
        mime_type: result.mime_type,
        width: result.width,
        height: result.height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(prompt: &str, width: Option<u32>, height: Option<u32>) -> GenerateImageRequest {
        GenerateImageRequest {
            prompt: prompt.to_string(),
            width,
            height,
            model: None,
            provider: None,
            task_id: None,
        }
    }

    #[test]
    fn rejects_an_empty_prompt() {
        let error = validate_request(&request("   ", None, None)).expect_err("空提示词必须被拒绝");
        assert!(error.starts_with("AI_IMAGE_REQUEST_INVALID"), "{error}");
    }

    #[test]
    fn rejects_a_prompt_longer_than_the_provider_limit() {
        let long = "描".repeat(MAX_PROMPT_CHARS + 1);
        let error = validate_request(&request(&long, None, None)).expect_err("超长提示词必须被拒绝");
        assert!(error.starts_with("AI_IMAGE_REQUEST_INVALID"), "{error}");
    }

    #[test]
    fn accepts_a_prompt_at_the_provider_limit() {
        let limit = "描".repeat(MAX_PROMPT_CHARS);
        validate_request(&request(&limit, None, None)).expect("边界长度必须通过");
    }

    #[test]
    fn rejects_a_size_that_is_given_only_once() {
        let error =
            validate_request(&request("配图", Some(1024), None)).expect_err("只给宽必须被拒绝");
        assert!(error.starts_with("AI_IMAGE_REQUEST_INVALID"), "{error}");
    }

    #[test]
    fn rejects_a_size_outside_the_documented_range() {
        let error = validate_request(&request("配图", Some(100), Some(100)))
            .expect_err("越界尺寸必须被拒绝");
        assert!(error.starts_with("AI_IMAGE_REQUEST_INVALID"), "{error}");
        let error = validate_request(&request("配图", Some(1023), Some(768)))
            .expect_err("非 8 的倍数必须被拒绝");
        assert!(error.starts_with("AI_IMAGE_REQUEST_INVALID"), "{error}");
    }

    #[test]
    fn accepts_a_size_inside_the_documented_range() {
        validate_request(&request("配图", Some(1024), Some(768))).expect("合法尺寸必须通过");
    }
}
