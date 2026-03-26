use serde::{Deserialize, Serialize};
use crate::organizer::{FileItem, Category};
use futures_util::StreamExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProvider {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub host: Option<String>,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

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
            reqwest::get(&url).await.map(|r| r.status().is_success()).unwrap_or(false)
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
        _ => false,
    }
}

/// 流式分类文件，支持实时回调 thinking 内容
pub async fn classify_file_stream<F>(
    file: &FileItem,
    provider: &AIProvider,
    categories: &[Category],
    mut on_thinking: F,
) -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    let category_names: Vec<&str> = categories.iter().map(|c| c.name.as_str()).collect();
    
    let system_prompt = "你是一个文件分类助手。根据文件名，将文件分类到最合适的类别中。只返回类别名称，不要其他内容。";
    
    let user_prompt = format!(
        "请将文件 \"{}\" 分类到以下类别之一：{}\n只返回类别名称，不要解释。",
        file.name,
        category_names.join(", ")
    );

    let response = match provider.provider_type.as_str() {
        "ollama" => call_ollama_stream(provider, system_prompt, &user_prompt, &mut on_thinking).await?,
        "openai" => call_openai(provider, system_prompt, &user_prompt).await?,
        "claude" => call_claude(provider, system_prompt, &user_prompt).await?,
        _ => return Err("不支持的 AI 提供商".into()),
    };

    // 解析响应，找到匹配的类别
    let response_lower = response.to_lowercase();
    for cat in categories {
        if response_lower.contains(&cat.name.to_lowercase()) {
            return Ok((cat.name.clone(), "AI 智能分类".to_string()));
        }
    }

    Ok(("其他".to_string(), "AI 无法确定分类".to_string()))
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
    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await?;

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
        max_tokens: 100,
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

    Ok(response.choices.first()
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
        "max_tokens": 100,
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
