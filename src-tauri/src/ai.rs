mod classification;
mod local_cli;

pub use classification::{parse_ai_classification, AIClassification};

use crate::organizer::{Category, FileItem};
use classification::{
    classification_output_schema, classification_system_prompt, file_classification_prompt,
};
use futures_util::StreamExt;
use local_cli::{call_local_cli_stream, call_local_cli_stream_with_schema, local_cli_ready};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProvider {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub host: Option<String>,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    pub executable: Option<String>,
}

pub const AI_CLASSIFICATION_PROMPT_VERSION: &str = "stowmind-classification-v2";
pub const MIN_AI_CLASSIFICATION_CONFIDENCE: f32 = 0.75;

#[derive(Debug, Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
    think: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaResponseMessage>,
    done: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct OllamaResponseMessage {
    content: Option<String>,
    thinking: Option<String>,
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    max_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessage,
}

pub async fn test_connection(provider: &AIProvider) -> bool {
    match provider.provider_type.as_str() {
        "ollama" => {
            let host = provider.host.as_deref().unwrap_or("http://localhost:11434");
            let url = format!("{}/api/tags", host);
            reqwest::get(&url)
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        }
        "openai" => {
            if let Some(api_key) = &provider.api_key {
                let client = reqwest::Client::new();
                client
                    .get("https://api.openai.com/v1/models")
                    .header("Authorization", format!("Bearer {}", api_key))
                    .send()
                    .await
                    .map(|r| r.status().is_success())
                    .unwrap_or(false)
            } else {
                false
            }
        }
        "claude" => {
            if let Some(api_key) = &provider.api_key {
                let client = reqwest::Client::new();
                client
                    .get("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .send()
                    .await
                    .map(|r| r.status().is_success() || r.status().as_u16() == 405)
                    .unwrap_or(false)
            } else {
                false
            }
        }
        "local_codex" | "local_claude_code" => local_cli_ready(provider),
        _ => false,
    }
}

/// Run a text request and report output chunks as they arrive.
pub async fn classify_text_stream<F>(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
    on_output: &mut F,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    match provider.provider_type.as_str() {
        "ollama" => call_ollama_stream(provider, system, prompt, on_output).await,
        "openai" => {
            let result = call_openai(provider, system, prompt).await?;
            if !result.is_empty() {
                on_output(result.clone());
            }
            Ok(result)
        }
        "claude" => {
            let result = call_claude(provider, system, prompt).await?;
            if !result.is_empty() {
                on_output(result.clone());
            }
            Ok(result)
        }
        "local_codex" | "local_claude_code" => {
            call_local_cli_stream(provider, system, prompt, on_output).await
        }
        _ => Err("不支持的 AI 提供商".into()),
    }
}

/// Run a category classification request and enforce a structured, allowlisted result.
pub async fn classify_category_stream<F>(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
    allowed_categories: &[String],
    on_output: &mut F,
) -> Result<AIClassification, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    if allowed_categories.is_empty() {
        return Err("AI 分类至少需要一个允许类别".into());
    }
    let schema = classification_output_schema(allowed_categories);
    let response = match provider.provider_type.as_str() {
        "ollama" => call_ollama_stream(provider, system, prompt, on_output).await?,
        "openai" => {
            let result = call_openai(provider, system, prompt).await?;
            if !result.is_empty() {
                on_output(result.clone());
            }
            result
        }
        "claude" => {
            let result = call_claude(provider, system, prompt).await?;
            if !result.is_empty() {
                on_output(result.clone());
            }
            result
        }
        "local_codex" | "local_claude_code" => {
            call_local_cli_stream_with_schema(provider, system, prompt, &schema, on_output).await?
        }
        _ => return Err("不支持的 AI 提供商".into()),
    };

    parse_ai_classification(&response, allowed_categories).map_err(Into::into)
}

/// 流式分类文件，支持实时回调 thinking 内容
pub async fn classify_file_stream<F>(
    file: &FileItem,
    provider: &AIProvider,
    categories: &[Category],
    mut on_thinking: F,
) -> Result<AIClassification, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    let category_names = categories
        .iter()
        .map(|category| category.name.clone())
        .collect::<Vec<_>>();
    let user_prompt = file_classification_prompt(file, categories)?;
    classify_category_stream(
        provider,
        classification_system_prompt(),
        &user_prompt,
        &category_names,
        &mut on_thinking,
    )
    .await
}

/// Ollama 流式调用，实时输出 thinking
async fn call_ollama_stream<F>(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
    on_thinking: &mut F,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    let host = provider.host.as_deref().unwrap_or("http://localhost:11434");
    let url = format!("{}/api/chat", host);

    let request = OllamaChatRequest {
        model: provider.model.clone(),
        messages: vec![
            OllamaMessage {
                role: "system".to_string(),
                content: system.to_string(),
            },
            OllamaMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            },
        ],
        stream: true,
        think: true,
    };

    let client = reqwest::Client::new();
    let response = client.post(&url).json(&request).send().await?;

    let mut stream = response.bytes_stream();
    let mut full_content = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // 处理可能的多行 JSON
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.trim().is_empty() {
                continue;
            }

            if let Ok(resp) = serde_json::from_str::<OllamaChatResponse>(&line) {
                if let Some(msg) = resp.message {
                    // 输出 thinking 内容
                    if let Some(thinking) = msg.thinking {
                        if !thinking.is_empty() {
                            on_thinking(thinking);
                        }
                    }
                    // 收集 content
                    if let Some(content) = msg.content {
                        full_content.push_str(&content);
                    }
                }

                if resp.done == Some(true) {
                    break;
                }
            }
        }
    }

    Ok(full_content)
}

async fn call_openai(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let api_key = provider.api_key.as_ref().ok_or("缺少 API Key")?;

    let request = OpenAIRequest {
        model: provider.model.clone(),
        messages: vec![
            OpenAIMessage {
                role: "system".to_string(),
                content: system.to_string(),
            },
            OpenAIMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            },
        ],
        max_tokens: 200,
    };

    let client = reqwest::Client::new();
    let response: OpenAIResponse = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request)
        .send()
        .await?
        .json()
        .await?;

    Ok(response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .unwrap_or_default())
}

async fn call_claude(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let api_key = provider.api_key.as_ref().ok_or("缺少 API Key")?;

    let body = serde_json::json!({
        "model": provider.model,
        "max_tokens": 200,
        "system": system,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    });

    let client = reqwest::Client::new();
    let response: serde_json::Value = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?
        .json()
        .await?;

    Ok(response["content"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string())
}
