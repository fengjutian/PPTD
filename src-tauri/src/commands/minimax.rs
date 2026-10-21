use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    topic: String,
    slide_count: u8,
    model: Option<String>,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f32,
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
    if model.is_empty()
        || model.len() > 80
        || !model
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
    {
        return Err("MINIMAX_MODEL_INVALID".into());
    }
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
        .post("https://api.minimax.io/v1/text/chatcompletion_v2")
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
