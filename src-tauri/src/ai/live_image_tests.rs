//! 真实接口冒烟测试。
//!
//! 这些测试会真的调用 MiniMax 的图像生成接口，因此默认不运行：
//! 它们需要网络、需要本机凭据，而且按张计费。
//!
//! 运行方式：
//!
//! ```text
//! cargo test --lib live -- --ignored --nocapture
//! ```
//!
//! 存在的理由：图像接口的规格来自官方文档，文档会变、厂商会改字段名。
//! 适配器里那些"看起来对"的字段名和解析分支，只有跑过一次真实响应才算数。

use super::cancel::CancelToken;
use super::minimax::MINIMAX;
use super::minimax_image::MINIMAX_IMAGE;
use super::{generate_image, read_api_key, ImageProvider, ImageRequest};
use std::time::Duration;

/// 冒烟用的提示词。短、明确、不含品牌词，避免触发厂商的敏感内容拦截。
const SMOKE_PROMPT: &str = "简洁的商务风格抽象插画，蓝白配色，柔和渐变背景，无文字";

/// 真实调用一次，把厂商响应的结构打印出来。
///
/// 只打印字段名和截断后的值：响应里可能有 base64 图片数据，整段打印会淹没终端，
/// 但我们要看的只是"字段叫什么、值长什么样"。
#[tokio::test]
#[ignore = "需要网络与真实凭据，且按张计费"]
async fn probe_the_live_response_shape() {
    let api_key = match read_api_key(&MINIMAX) {
        Ok(key) => key,
        Err(error) => {
            eprintln!("跳过：本机没有可用的 MiniMax 凭据（{error}）。");
            return;
        }
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .expect("client");
    let body = MINIMAX_IMAGE.build_image_request(&ImageRequest {
        model: MINIMAX_IMAGE.default_image_model().to_string(),
        prompt: SMOKE_PROMPT.to_string(),
        width: None,
        height: None,
    });

    eprintln!(
        "请求体字段：{:?}",
        body.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );

    let response = MINIMAX_IMAGE
        .apply_auth(client.post(MINIMAX_IMAGE.image_endpoint()), &api_key)
        .json(&body)
        .send()
        .await
        .expect("请求失败");
    let status = response.status();
    let payload: serde_json::Value = response.json().await.expect("响应不是 JSON");

    eprintln!("HTTP 状态：{status}");
    eprintln!(
        "顶层字段：{:?}",
        payload.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );
    if let Some(data) = payload.get("data") {
        eprintln!(
            "data 字段：{:?}",
            data.as_object().map(|o| o.keys().collect::<Vec<_>>())
        );
    }
    if let Some(base_resp) = payload.get("base_resp") {
        eprintln!("base_resp：{base_resp}");
    }
    if let Some(metadata) = payload.get("metadata") {
        eprintln!("metadata：{metadata}");
    }
    // 图片地址本身要打：域名决定了下载白名单对不对。
    // 但只打主机与路径：地址带 OSS 签名参数，整条打出来等于把签名写进日志。
    if let Some(urls) = payload.get("data").and_then(|d| d.get("image_urls")) {
        eprintln!("image_urls 主机与路径：{:?}", redact_urls(urls));
    }
    // base64 太大，只报长度和前缀。
    if let Some(base64) = payload.get("data").and_then(|d| d.get("image_base64")) {
        eprintln!("image_base64 存在，长度约 {}", base64.to_string().len());
    }
}

/// 走完整链路：请求 → 解析 → 下载 → 嗅探格式与尺寸。
#[tokio::test]
#[ignore = "需要网络与真实凭据，且按张计费"]
async fn generates_a_real_image_through_the_full_pipeline() {
    let api_key = match read_api_key(&MINIMAX) {
        Ok(key) => key,
        Err(error) => {
            eprintln!("跳过：本机没有可用的 MiniMax 凭据（{error}）。");
            return;
        }
    };

    let result = generate_image(
        &MINIMAX_IMAGE,
        &api_key,
        &ImageRequest {
            model: MINIMAX_IMAGE.default_image_model().to_string(),
            prompt: SMOKE_PROMPT.to_string(),
            width: None,
            height: None,
        },
        Duration::from_secs(120),
        &CancelToken::new(),
    )
    .await
    .expect("真实生成必须成功");

    eprintln!(
        "生成成功：mime={} {}x{} data_url 长度={}",
        result.mime_type,
        result.width,
        result.height,
        result.data_url.len()
    );
    assert!(
        result.data_url.starts_with("data:image/"),
        "返回的必须是内联图片，实际前缀：{}",
        &result.data_url[..result.data_url.len().min(40)]
    );
    assert!(
        result.mime_type == "image/png" || result.mime_type == "image/jpeg",
        "实际格式：{}",
        result.mime_type
    );
    assert!(result.width > 0 && result.height > 0, "尺寸必须为正");
}

/// 只保留地址的主机与路径，去掉查询参数。
///
/// 厂商返回的是带签名的临时地址，签名参数属于凭据，不能进日志。
fn redact_urls(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|url| match reqwest::Url::parse(url) {
                    Ok(parsed) => format!(
                        "{}://{}{}",
                        parsed.scheme(),
                        parsed.host_str().unwrap_or_default(),
                        parsed.path()
                    ),
                    Err(_) => "<无法解析的地址>".to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 显式指定 width/height 时厂商是否真的按这个尺寸出图。
///
/// 文档说"同时设置 width/height 时它们优先于 aspect_ratio"，但这是会改变
/// 整份文稿配图比例的分支：前端按角色请求不同尺寸（通栏是横条、主视觉近方形），
/// 尺寸不对，填充裁剪会把画面吃掉一大半。这个分支必须用真实响应验证。
#[tokio::test]
#[ignore = "需要网络与真实凭据，且按张计费"]
async fn honours_an_explicit_pixel_size() {
    let api_key = match read_api_key(&MINIMAX) {
        Ok(key) => key,
        Err(error) => {
            eprintln!("跳过：本机没有可用的 MiniMax 凭据（{error}）。");
            return;
        }
    };

    for (width, height) in [(1024u32, 1024u32), (1280, 720), (2048, 512)] {
        let result = generate_image(
            &MINIMAX_IMAGE,
            &api_key,
            &ImageRequest {
                model: MINIMAX_IMAGE.default_image_model().to_string(),
                prompt: SMOKE_PROMPT.to_string(),
                width: Some(width),
                height: Some(height),
            },
            Duration::from_secs(120),
            &CancelToken::new(),
        )
        .await
        .unwrap_or_else(|error| panic!("请求 {width}x{height} 失败：{error}"));

        eprintln!(
            "请求 {width}x{height} → 实际 {}x{}",
            result.width, result.height
        );
        assert_eq!(
            (result.width, result.height),
            (width, height),
            "厂商必须按请求的像素尺寸出图"
        );
    }
}
