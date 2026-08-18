use super::AIProvider;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{timeout, Duration};

const LOCAL_CLI_TIMEOUT: Duration = Duration::from_secs(90);

fn is_local_cli(provider: &AIProvider) -> bool {
    matches!(
        provider.provider_type.as_str(),
        "local_codex" | "local_claude_code"
    )
}

fn local_cli_name(provider: &AIProvider) -> Option<&'static str> {
    match provider.provider_type.as_str() {
        "local_codex" => Some("codex"),
        "local_claude_code" => Some("claude"),
        _ => None,
    }
}

pub(super) fn local_cli_ready(provider: &AIProvider) -> bool {
    let Ok(executable) = resolve_local_executable(provider) else {
        return false;
    };
    let mut command = std::process::Command::new(executable);
    match provider.provider_type.as_str() {
        "local_codex" => {
            command.arg("login").arg("status");
        }
        "local_claude_code" => {
            command.arg("auth").arg("status").arg("--json");
        }
        _ => return false,
    }

    let Ok(output) = command.output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    if provider.provider_type == "local_claude_code" {
        return serde_json::from_slice::<serde_json::Value>(&output.stdout)
            .ok()
            .and_then(|value| {
                value
                    .get("loggedIn")
                    .and_then(|logged_in| logged_in.as_bool())
            })
            .unwrap_or(false);
    }
    true
}

fn resolve_local_executable(provider: &AIProvider) -> Result<PathBuf, String> {
    let name = local_cli_name(provider).ok_or("不是本地 CLI provider")?;
    let requested = provider
        .executable
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(name);

    let requested_path = Path::new(requested);
    if requested_path.is_absolute() {
        if requested_path.is_file() {
            return Ok(requested_path.to_path_buf());
        }
        return Err(format!("找不到本地 AI CLI：{}", requested_path.display()));
    }

    if let Some(path_var) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path_var) {
            let candidate = directory.join(requested);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    let mut fallback_directories = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        fallback_directories.push(PathBuf::from(home.clone()).join(".local/bin"));
        fallback_directories.push(PathBuf::from(home).join("bin"));
    }

    for directory in fallback_directories {
        let candidate = directory.join(requested);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!("找不到本地 AI CLI：{}", requested))
}

fn schema_file_path(provider: &AIProvider) -> PathBuf {
    let provider_name = local_cli_name(provider).unwrap_or("ai");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!(
        "stowmind-{provider_name}-{stamp}-{}.schema.json",
        std::process::id()
    ))
}

fn local_output_schema() -> &'static str {
    r#"{
  "type": "string"
}"#
}

fn build_local_command(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
    schema_path: &Path,
    output_schema: &str,
) -> Result<Command, String> {
    let executable = resolve_local_executable(provider)?;
    let mut command = Command::new(executable);
    command
        .current_dir(std::env::temp_dir())
        .env("NO_COLOR", "1")
        .env("TERM", "dumb");

    let request = format!(
        "系统约束：{system}\n\n用户请求：{prompt}\n\n只输出最终答案，不要调用工具，不要输出 Markdown。"
    );

    match provider.provider_type.as_str() {
        "local_codex" => {
            command
                .arg("--sandbox")
                .arg("read-only")
                .arg("--ask-for-approval")
                .arg("never");
            if !provider.model.trim().is_empty() {
                command.arg("--model").arg(provider.model.trim());
            }
            command
                .arg("exec")
                .arg("--ephemeral")
                .arg("--ignore-user-config")
                .arg("--skip-git-repo-check")
                .arg("--json")
                .arg("--output-schema")
                .arg(schema_path)
                .arg(request);
        }
        "local_claude_code" => {
            command
                .arg("--safe-mode")
                .arg("--print")
                .arg("--no-session-persistence")
                .arg("--tools")
                .arg("")
                .arg("--output-format")
                .arg("stream-json")
                .arg("--include-partial-messages")
                .arg("--verbose")
                .arg("--system-prompt")
                .arg(system)
                .arg("--json-schema")
                .arg(output_schema);
            if !provider.model.trim().is_empty() {
                command.arg("--model").arg(provider.model.trim());
            }
            command.arg(prompt);
        }
        _ => return Err("不是本地 CLI provider".to_string()),
    }

    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    Ok(command)
}

fn emit_local_line<F>(provider: &AIProvider, line: &str, on_output: &mut F, collected: &mut String)
where
    F: FnMut(String) + Send,
{
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let mut chunks = Vec::new();
        collect_stream_text(&value, &mut chunks);
        if chunks.is_empty() {
            if let Some(status) = stream_status_message(provider, &value) {
                on_output(status);
            }
        }
        for chunk in chunks {
            if chunk.is_empty() {
                continue;
            }
            collected.push_str(&chunk);
            on_output(chunk);
        }
        return;
    }

    // Some older CLI builds can emit a plain final line even with JSON enabled.
    if !is_local_cli(provider) {
        return;
    }
    collected.push_str(trimmed);
    on_output(trimmed.to_string());
}

fn stream_status_message(provider: &AIProvider, value: &serde_json::Value) -> Option<String> {
    let event_type = value.get("type")?.as_str()?;
    let message = match (provider.provider_type.as_str(), event_type) {
        ("local_codex", "thread.started") => "Codex 会话已启动\n",
        ("local_codex", "turn.started") => "Codex 正在分析…\n",
        ("local_codex", "item.started") => "Codex 正在生成结果…\n",
        ("local_codex", "turn.completed") => "Codex 已完成\n",
        ("local_claude_code", "system") => "Claude Code 会话已启动\n",
        ("local_claude_code", "assistant") => "Claude Code 正在生成结果…\n",
        _ => return None,
    };
    Some(message.to_string())
}

fn collect_stream_text(value: &serde_json::Value, chunks: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(result) = object.get("result") {
                match result {
                    serde_json::Value::String(result) if !result.is_empty() => {
                        chunks.push(result.clone())
                    }
                    serde_json::Value::Null => {}
                    result => chunks.push(result.to_string()),
                }
            }
            if let Some(text) = object.get("text").and_then(|value| value.as_str()) {
                if !text.is_empty() {
                    chunks.push(text.to_string());
                }
            }
            if let Some(delta) = object.get("delta") {
                if let Some(text) = delta.get("text").and_then(|value| value.as_str()) {
                    if !text.is_empty() {
                        chunks.push(text.to_string());
                    }
                }
            }
            if let Some(item) = object.get("item") {
                collect_stream_text(item, chunks);
            }
            if let Some(event) = object.get("event") {
                collect_stream_text(event, chunks);
            }
            if let Some(content) = object.get("content") {
                collect_stream_text(content, chunks);
            }
            if let Some(structured_output) = object.get("structured_output") {
                match structured_output {
                    serde_json::Value::String(value) if !value.is_empty() => {
                        chunks.push(value.clone())
                    }
                    serde_json::Value::Null => {}
                    value => chunks.push(value.to_string()),
                }
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                collect_stream_text(value, chunks);
            }
        }
        _ => {}
    }
}

async fn wait_for_local_cli(
    mut child: Child,
    provider: &AIProvider,
    on_output: &mut (impl FnMut(String) + Send),
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let stdout = child.stdout.take().ok_or("本地 AI CLI 没有标准输出")?;
    let stderr = child.stderr.take().ok_or("本地 AI CLI 没有错误输出")?;
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    let mut collected = String::new();
    let mut errors = String::new();

    let result = timeout(LOCAL_CLI_TIMEOUT, async {
        while !stdout_closed || !stderr_closed {
            tokio::select! {
                line = stdout_lines.next_line(), if !stdout_closed => {
                    match line? {
                        Some(line) => emit_local_line(provider, &line, on_output, &mut collected),
                        None => stdout_closed = true,
                    }
                }
                line = stderr_lines.next_line(), if !stderr_closed => {
                    match line? {
                        Some(line) => {
                            if !errors.is_empty() {
                                errors.push('\n');
                            }
                            errors.push_str(&line);
                            on_output(format!("[stderr] {line}\n"));
                        }
                        None => stderr_closed = true,
                    }
                }
            }
        }
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(child.wait().await?)
    })
    .await;

    let status = match result {
        Ok(status) => status?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(format!("本地 AI CLI 超时（{} 秒）", LOCAL_CLI_TIMEOUT.as_secs()).into());
        }
    };

    if !status.success() {
        let detail = if errors.trim().is_empty() {
            format!("退出码：{}", status.code().unwrap_or(-1))
        } else {
            errors.trim().to_string()
        };
        return Err(format!("本地 AI CLI 执行失败：{detail}").into());
    }

    if collected.trim().is_empty() {
        return Err("本地 AI CLI 没有返回内容".into());
    }
    Ok(collected)
}

pub(super) async fn call_local_cli_stream<F>(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
    on_output: &mut F,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    call_local_cli_stream_with_schema(provider, system, prompt, local_output_schema(), on_output)
        .await
}

pub(super) async fn call_local_cli_stream_with_schema<F>(
    provider: &AIProvider,
    system: &str,
    prompt: &str,
    output_schema: &str,
    on_output: &mut F,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(String) + Send,
{
    let schema_path = schema_file_path(provider);
    std::fs::write(&schema_path, output_schema)?;

    let mut command =
        match build_local_command(provider, system, prompt, &schema_path, output_schema) {
            Ok(command) => command,
            Err(error) => {
                let _ = std::fs::remove_file(&schema_path);
                return Err(error.into());
            }
        };

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_file(&schema_path);
            return Err(format!("无法启动本地 AI CLI：{error}").into());
        }
    };

    let result = wait_for_local_cli(child, provider, on_output).await;
    let _ = std::fs::remove_file(&schema_path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(provider_type: &str) -> AIProvider {
        AIProvider {
            provider_type: provider_type.to_string(),
            host: None,
            model: String::new(),
            api_key: None,
            executable: None,
        }
    }

    #[test]
    fn local_provider_names_are_stable() {
        assert_eq!(local_cli_name(&provider("local_codex")), Some("codex"));
        assert_eq!(
            local_cli_name(&provider("local_claude_code")),
            Some("claude")
        );
        assert_eq!(local_cli_name(&provider("ollama")), None);
    }

    #[test]
    fn stream_text_parser_accepts_codex_and_claude_shapes() {
        let mut chunks = Vec::new();
        collect_stream_text(
            &serde_json::json!({
                "type": "stream_event",
                "event": {
                    "delta": {"text": "效率"}
                }
            }),
            &mut chunks,
        );
        collect_stream_text(
            &serde_json::json!({
                "type": "item.completed",
                "item": {"text": "分类完成"}
            }),
            &mut chunks,
        );
        collect_stream_text(
            &serde_json::json!({
                "type": "result",
                "result": {
                    "category": "效率",
                    "confidence": 0.9,
                    "reason": "任务工具"
                }
            }),
            &mut chunks,
        );
        assert_eq!(&chunks[..2], ["效率", "分类完成"]);
        let structured: serde_json::Value = serde_json::from_str(&chunks[2]).unwrap();
        assert_eq!(structured["category"], "效率");
    }
}
