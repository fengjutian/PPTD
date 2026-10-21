use serde::{Deserialize, Serialize};
use std::time::Duration;

const MINIMAX_CHINA_CHAT_URL: &str = "https://api.minimaxi.com/v1/text/chatcompletion_v2";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    topic: String,
    slide_count: u8,
    model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDesignRequest {
    draft: serde_json::Value,
    template: serde_json::Value,
    model: Option<String>,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f32,
}

fn validate_model(model: &str) -> Result<(), String> {
    if model.is_empty()
        || model.len() > 80
        || !model
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
    {
        return Err("MINIMAX_MODEL_INVALID".into());
    }
    Ok(())
}

#[derive(Serialize)]
struct Message {
    role: &'static str,
    content: String,
}

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

#[tauri::command]
pub async fn generate_presentation(request: GenerateRequest) -> Result<serde_json::Value, String> {
    if request.topic.trim().is_empty()
        || request.topic.chars().count() > 4_000
        || !(1..=20).contains(&request.slide_count)
    {
        return Err("AI_REQUEST_INVALID".into());
    }
    let api_key = read_api_key()?;
    let model = request
        .model
        .or_else(|| std::env::var("MINIMAX_MODEL").ok())
        .unwrap_or_else(|| "MiniMax-M3".into());
    validate_model(&model)?;
    let prompt = format!(
        "为以下主题生成 {} 页中文演示文稿。仅返回严格 JSON，不要 Markdown：{{\"title\":\"文稿标题\",\"slides\":[{{\"title\":\"页面标题\",\"body\":\"3-5条简洁要点\",\"speakerNotes\":\"演讲备注\"}}]}}。slides 必须恰好 {} 项。主题：{}",
        request.slide_count, request.slide_count, request.topic.trim()
    );
    let body = ChatRequest {
        model,
        messages: vec![Message {
            role: "user",
            content: prompt,
        }],
        temperature: 0.4,
    };
    let response = reqwest::Client::new()
        .post(MINIMAX_CHINA_CHAT_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MINIMAX_REQUEST_FAILED: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("MINIMAX_HTTP_ERROR: {}", response.status()));
    }
    let payload: ChatResponse = response
        .json()
        .await
        .map_err(|error| format!("MINIMAX_RESPONSE_INVALID: {error}"))?;
    let content = payload
        .choices
        .first()
        .ok_or("MINIMAX_EMPTY_RESPONSE")?
        .message
        .content
        .trim();
    let content = content
        .strip_prefix("```json")
        .or_else(|| content.strip_prefix("```"))
        .unwrap_or(content)
        .strip_suffix("```")
        .unwrap_or(content)
        .trim();
    serde_json::from_str(content).map_err(|error| format!("MINIMAX_JSON_INVALID: {error}"))
}

#[tauri::command]
pub async fn generate_presentation_design(
    request: GenerateDesignRequest,
) -> Result<serde_json::Value, String> {
    let draft = serde_json::to_string(&request.draft).map_err(|_| "AI_DESIGN_REQUEST_INVALID")?;
    let template =
        serde_json::to_string(&request.template).map_err(|_| "AI_DESIGN_REQUEST_INVALID")?;
    if draft.len() > 120_000 || template.len() > 120_000 {
        return Err("AI_DESIGN_REQUEST_TOO_LARGE".into());
    }
    let api_key = read_api_key()?;
    let model = request
        .model
        .or_else(|| std::env::var("MINIMAX_MODEL").ok())
        .unwrap_or_else(|| "MiniMax-M3".into());
    validate_model(&model)?;
    let prompt = format!(
        "你是演示文稿视觉设计器。依据模板分析和已审核内容，为每页生成设计参数。禁止改写或返回标题、正文、数字和备注。仅返回严格 JSON，不要 Markdown。格式：{{\"slides\":[{{\"background\":\"#FFFFFF\",\"title\":{{\"frame\":{{\"x\":0.07,\"y\":0.08,\"width\":0.86,\"height\":0.16}},\"fontSizePt\":30,\"color\":\"#111111\",\"bold\":true,\"align\":\"left\"}},\"body\":{{\"frame\":{{\"x\":0.08,\"y\":0.30,\"width\":0.84,\"height\":0.58}},\"fontSizePt\":20,\"color\":\"#333333\",\"bold\":false,\"align\":\"left\"}},\"accents\":[{{\"frame\":{{\"x\":0,\"y\":0,\"width\":0.02,\"height\":1}},\"shape\":\"rectangle\",\"fill\":\"#3366CC\"}}]}}]}}。frame 是 0 到 1 的页面比例；slides 数量必须与内容页数完全一致。模板分析：{}。已审核内容仅用于判断信息密度：{}",
        template, draft
    );
    let body = ChatRequest {
        model,
        messages: vec![Message {
            role: "user",
            content: prompt,
        }],
        temperature: 0.25,
    };
    let response = reqwest::Client::new()
        .post(MINIMAX_CHINA_CHAT_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MINIMAX_DESIGN_REQUEST_FAILED: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("MINIMAX_HTTP_ERROR: {}", response.status()));
    }
    let payload: ChatResponse = response
        .json()
        .await
        .map_err(|error| format!("MINIMAX_RESPONSE_INVALID: {error}"))?;
    let content = payload
        .choices
        .first()
        .ok_or("MINIMAX_EMPTY_RESPONSE")?
        .message
        .content
        .trim();
    let content = content
        .strip_prefix("```json")
        .or_else(|| content.strip_prefix("```"))
        .unwrap_or(content)
        .strip_suffix("```")
        .unwrap_or(content)
        .trim();
    serde_json::from_str(content).map_err(|error| format!("MINIMAX_DESIGN_JSON_INVALID: {error}"))
}

#[tauri::command]
pub async fn test_minimax_connection(model: String) -> Result<String, String> {
    validate_model(&model)?;
    let api_key = read_api_key()?;
    let body = ChatRequest {
        model: model.clone(),
        messages: vec![Message {
            role: "user",
            content: "请仅回复 OK".into(),
        }],
        temperature: 0.0,
    };
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("MINIMAX_CLIENT_FAILED: {error}"))?
        .post(MINIMAX_CHINA_CHAT_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("MINIMAX_CONNECTION_FAILED: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("MINIMAX_HTTP_ERROR: {}", response.status()));
    }
    Ok(format!("{model} 连接成功"))
}

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.pptd.desktop", "minimax-api-key")
        .map_err(|error| format!("CREDENTIAL_STORE_UNAVAILABLE: {error}"))
}

fn read_api_key() -> Result<String, String> {
    credential()?
        .get_password()
        .or_else(|_| std::env::var("MINIMAX_API_KEY"))
        .map_err(|_| "MINIMAX_API_KEY_MISSING".into())
}

#[tauri::command]
pub fn save_minimax_api_key(api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.len() < 8 || key.len() > 512 {
        return Err("MINIMAX_API_KEY_INVALID".into());
    }
    credential()?
        .set_password(key)
        .map_err(|error| format!("CREDENTIAL_SAVE_FAILED: {error}"))
}

#[tauri::command]
pub fn delete_minimax_api_key() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("CREDENTIAL_DELETE_FAILED: {error}")),
    }
}

#[tauri::command]
pub fn minimax_api_key_configured() -> Result<bool, String> {
    Ok(credential()?.get_password().is_ok() || std::env::var("MINIMAX_API_KEY").is_ok())
}
