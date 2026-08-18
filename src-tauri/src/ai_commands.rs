use crate::ai::{self, classify_text_stream, AIProvider};
use serde::Serialize;
use tauri::Window;

#[derive(Clone, Serialize)]
pub struct AiStreamEvent {
    pub provider: String,
    pub status: String,
    pub chunk: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiTestResult {
    pub ok: bool,
    pub detail: String,
}

#[tauri::command]
pub async fn check_ollama(host: String) -> bool {
    let url = format!("{}/api/tags", host);
    match reqwest::get(&url).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn test_api_connection(provider: AIProvider) -> bool {
    ai::test_connection(&provider).await
}

#[tauri::command]
pub async fn ai_test_provider(window: Window, provider: AIProvider) -> AiTestResult {
    let provider_name = provider.provider_type.clone();
    let _ = window.emit(
        "ai-stream",
        AiStreamEvent {
            provider: provider_name.clone(),
            status: "started".to_string(),
            chunk: None,
            message: Some("正在启动 AI provider".to_string()),
        },
    );

    let is_local_cli = matches!(
        provider.provider_type.as_str(),
        "local_codex" | "local_claude_code"
    );

    if !is_local_cli {
        let ok = ai::test_connection(&provider).await;
        let detail = if ok {
            "连接成功".to_string()
        } else {
            "连接失败，请检查配置".to_string()
        };
        let _ = window.emit(
            "ai-stream",
            AiStreamEvent {
                provider: provider_name,
                status: if ok {
                    "completed".to_string()
                } else {
                    "error".to_string()
                },
                chunk: None,
                message: Some(detail.clone()),
            },
        );
        return AiTestResult { ok, detail };
    }

    let stream_window = window.clone();
    let stream_provider = provider.provider_type.clone();
    let mut on_output = move |chunk: String| {
        let _ = stream_window.emit(
            "ai-stream",
            AiStreamEvent {
                provider: stream_provider.clone(),
                status: "chunk".to_string(),
                chunk: Some(chunk),
                message: None,
            },
        );
    };

    let result = classify_text_stream(
        &provider,
        "你是 StowMind 的本地 AI 连接测试助手。不要调用任何工具。",
        "请只回复：StowMind 本地 AI 已连接。",
        &mut on_output,
    )
    .await;

    match result {
        Ok(detail) => {
            let detail = detail.trim().to_string();
            let _ = window.emit(
                "ai-stream",
                AiStreamEvent {
                    provider: provider.provider_type,
                    status: "completed".to_string(),
                    chunk: None,
                    message: Some(detail.clone()),
                },
            );
            AiTestResult {
                ok: !detail.is_empty(),
                detail,
            }
        }
        Err(error) => {
            let detail = error.to_string();
            let _ = window.emit(
                "ai-stream",
                AiStreamEvent {
                    provider: provider.provider_type,
                    status: "error".to_string(),
                    chunk: None,
                    message: Some(detail.clone()),
                },
            );
            AiTestResult { ok: false, detail }
        }
    }
}
