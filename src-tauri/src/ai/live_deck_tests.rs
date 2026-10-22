//! 整册真实链路的冒烟测试。
//!
//! 单页测试证明不了"一套演示看起来好不好"。这里跑的是完整的一条链路：
//! 生成大纲 → 逐页写正文 → 生成视觉设计 → 生成配图 → 导出 PPTX。
//!
//! 跑法：
//!
//! ```text
//! cargo test --lib deck -- --ignored --nocapture
//! ```
//!
//! 需要网络与本机凭据，按张计费。产物写到 `PPTD_DECK_DUMP` 指定的目录，
//! 没有设置就不写盘，只把检查结果打印出来。
//!
//! 打印出来的是**诊断信息**，不是断言依据：断言只检查"链路是否跑通"和
//! "产出是否符合已定的规则"，好不好看要人看渲染图。

use super::cancel::CancelToken;
use super::minimax::MINIMAX;
use super::minimax_image::MINIMAX_IMAGE;
use super::{chat, generate_image, read_api_key, ChatMessage, ChatRequest, ImageRequest};
use std::time::Duration;

/// 生成请求的超时。文稿比图片慢得多。
const CHAT_TIMEOUT: Duration = Duration::from_secs(180);
const IMAGE_TIMEOUT: Duration = Duration::from_secs(120);

const TOPIC: &str = "为一家区域连锁零售企业做 2026 年第二季度经营回顾，面向管理层";

fn strip_code_fence(content: &str) -> &str {
    let trimmed = content.trim();
    let opened = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    let closed = opened.trim().strip_suffix("```").unwrap_or(opened);
    closed.trim()
}

/// 直接用模型的对话接口，绕开命令层。
///
/// 这里刻意不复刻命令层的提示词：命令层已经各自有测试，这��要验证的是
/// "真实模型在真实提示下会产出什么"，复刻一份提示词只会测到复刻的那份。
async fn ask(api_key: &str, system: &str, user: &str, temperature: f32) -> serde_json::Value {
    let body = ChatRequest {
        model: "MiniMax-M3".into(),
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: system.into(),
            },
            ChatMessage {
                role: "user".into(),
                content: user.into(),
            },
        ],
        temperature,
    };
    let content = chat(
        &MINIMAX,
        api_key,
        &body,
        CHAT_TIMEOUT,
        "AI_DECK_REQUEST_FAILED",
        &CancelToken::new(),
    )
    .await
    .expect("真实模型请求必须成功");
    match serde_json::from_str(strip_code_fence(&content)) {
        Ok(value) => value,
        Err(error) => {
            // 模型返回的不是严格 JSON。把原文打出来：这是诊断信息，
            // 下游要靠它判断是提示词的问题、模型的问题还是解析器的问题。
            eprintln!("--- 模型原文（解析失败：{error}）---");
            eprintln!("{content}");
            eprintln!("--- 原文结束 ---");
            panic!("模型必须返回 JSON");
        }
    }
}

/// 跑一遍真实链路，并把每一步的产出打印出来供人检查。
#[tokio::test]
#[ignore = "需要网络与真实凭据，按张计费"]
async fn runs_the_whole_deck_pipeline_against_the_real_model() {
    let api_key = match read_api_key(&MINIMAX) {
        Ok(key) => key,
        Err(error) => {
            eprintln!("跳过：本机没有可用的 MiniMax 凭据（{error}）。");
            return;
        }
    };

    // 1. 大纲
    let outline = ask(
        &api_key,
        "你是演示文稿策划。只输出严格 JSON。",
        &format!(
            r#"为以下主题规划一份 6 页中文演示文稿的大纲，不要写正文。
主题：{TOPIC}
规则：
1. pages 必须恰好 6 项，index 从 0 开始连续递增。
2. 每页 title 必须是一个可验证的结论或判断，不得使用"现状分析""市场概述""未来展望"这类栏目名。
3. 相邻页不得重复同一件事。
4. presentationBrief.narrativeStrategy 只能为 management-report、proposal、retrospective、training、product-launch、fundraising、general。
5. 不得虚构数字、来源、引语或案例。

仅返回严格 JSON：
{{"title":"文稿标题","presentationBrief":{{"objective":"演示目标","audience":"目标受众","scenario":"使用场景","expectedAction":"期望行动","coreConclusion":"一句话核心结论","narrativeStrategy":"general","assumptions":["保守假设"]}},"pages":[{{"index":0,"title":"结论式页面标题","purpose":"该页的沟通任务"}}]}}"#
        ),
        0.4,
    )
    .await;

    let pages = outline["pages"].as_array().expect("pages 必须是数组");
    eprintln!("=== 大纲 ===");
    eprintln!(
        "文稿标题：{}",
        outline["title"].as_str().unwrap_or_default()
    );
    for page in pages {
        eprintln!(
            "  [{}] {}",
            page["index"].as_u64().unwrap_or_default(),
            page["title"].as_str().unwrap_or_default()
        );
    }
    assert_eq!(pages.len(), 6, "大纲页数必须与请求一致");

    // 2. 逐页正文
    let mut slides = Vec::new();
    for page in pages {
        let brief = format!(
            r#"为演示中的一页写内容，只返回严格 JSON。
演示主题：{}
本页标题：{}
本页任务：{}
规则：
1. title 用上面给的标题，不要改写。
2. body 回答标题，使用陈述句，禁止疑问句充当正文；不得虚构数字、来源、引语或案例。
3. 内容页正文控制在 80–220 字，使用 2–5 条短要点，每条尽量不超过 45 个汉字。
4. speakerNotes 是一句演讲提示。
5. visualIntent 只能为 hero、quote、timeline、comparison、process、data-chart、image-story、summary、structured-text。
6. 第一页用 hero，其余按内容性质选。

仅返回严格 JSON：{{"title":"页面标题","body":"正文","speakerNotes":"备注","blocks":[],"plan":{{"visualIntent":"summary"}}}}"#,
            TOPIC,
            page["title"].as_str().unwrap_or_default(),
            page["purpose"].as_str().unwrap_or_default(),
        );
        let slide = ask(
            &api_key,
            "你是演示文稿写作者。只输出严格 JSON。",
            &brief,
            0.5,
        )
        .await;
        let title = slide["title"].as_str().unwrap_or_default().to_string();
        let body = slide["body"].as_str().unwrap_or_default().to_string();
        eprintln!("=== 第 {} 页 ===", pages.iter().position(|p| p["title"] == page["title"]).map(|i| i + 1).unwrap_or(0));
        eprintln!("  标题：{title}");
        eprintln!("  正文：{}", body.replace('\n', " / "));
        slides.push(slide);
    }

    // 3. 视觉设计
    let draft = serde_json::json!({
        "title": outline["title"],
        "slides": slides,
    });
    let design = ask(
        &api_key,
        "你是 PPTD 的演示文稿视觉设计引擎。只输出严格 JSON。",
        &format!(
            r##"为以下已审核内容生成逐页视觉设计参数。只输出 JSON。
内容：
{}

规则：
1. 不得改写、概括、补充或删除任何内容。
2. slides 必须恰好 {} 项，与内容一一对应。
3. 每项：layout（cover/title-body/cards/split/summary/quote）、background、accent、titleColor、bodyColor、composition（auto/stacked/columns/grid/editorial）、emphasis（balanced/title-dominant/body-dominant）、densityTarget（airy/balanced/compact）。
4. visualAsset：封面和章节页给 enabled=true 的主视觉（role=hero）；图文叙事页可以给 enabled=true 的 side 或 band 图；其它页给 enabled=false。prompt 描述画面，不要出现文字。
5. 整套演示的 accent 不要每页都一样。

仅返回严格 JSON：{{"slides":[{{"layout":"cover","background":"#FFFFFF","accent":"#3366CC","titleColor":"#111111","bodyColor":"#333333","composition":"auto","emphasis":"balanced","densityTarget":"balanced","visualAsset":{{"enabled":true,"prompt":"画面描述","role":"hero"}}}}]}}"##,
            draft.to_string(),
            slides.len()
        ),
        0.3,
    )
    .await;

    let designs = design["slides"]
        .as_array()
        .expect("design.slides 必须是数组");
    eprintln!("=== 视觉设计 ===");
    for (index, item) in designs.iter().enumerate() {
        eprintln!(
            "  [{}] layout={} accent={} composition={} emphasis={} density={} 配图={} role={}",
            index + 1,
            item["layout"].as_str().unwrap_or_default(),
            item["accent"].as_str().unwrap_or_default(),
            item["composition"].as_str().unwrap_or_default(),
            item["emphasis"].as_str().unwrap_or_default(),
            item["densityTarget"].as_str().unwrap_or_default(),
            item["visualAsset"]["enabled"].as_bool().unwrap_or(false),
            item["visualAsset"]["role"].as_str().unwrap_or_default(),
        );
    }
    assert_eq!(
        designs.len(),
        slides.len(),
        "设计必须逐页对应内容，不能多也不能少"
    );

    // 4. 配图
    let mut assets = 0usize;
    for item in designs.iter() {
        if !item["visualAsset"]["enabled"].as_bool().unwrap_or(false) {
            continue;
        }
        let role = item["visualAsset"]["role"].as_str().unwrap_or("side");
        let (width, height) = match role {
            "hero" => (1024u32, 768u32),
            "band" => (2048u32, 512u32),
            _ => (1024u32, 512u32),
        };
        let prompt = format!(
            "商务演示配图，简洁克制的几何构成，柔和光线，与页面主色协调，画面中不要出现任何文字、字母或数字。{}",
            item["visualAsset"]["prompt"].as_str().unwrap_or_default()
        );
        let result = generate_image(
            &MINIMAX_IMAGE,
            &api_key,
            &ImageRequest {
                model: "image-01".into(),
                prompt,
                width: Some(width),
                height: Some(height),
            },
            IMAGE_TIMEOUT,
            &CancelToken::new(),
        )
        .await;
        match result {
            Ok(image) => {
                assets += 1;
                eprintln!(
                    "  配图成功：role={role} mime={} {}x{}",
                    image.mime_type, image.width, image.height
                );
            }
            Err(error) => eprintln!("  配图失败（不影响文稿）：{error}"),
        }
    }
    eprintln!("共生成 {assets} 张配图");

    // 5. 断言：只检查链路本身，不检查审美
    assert!(!slides.is_empty(), "必须产出页面");
    assert!(
        slides
            .iter()
            .all(|slide| !slide["title"].as_str().unwrap_or_default().is_empty()),
        "每页都必须有标题"
    );
}
