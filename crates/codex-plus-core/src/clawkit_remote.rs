use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, bail};
use serde_json::{Value, json};

const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_QUEUED_MESSAGES: usize = 1_000;
const MAX_POLL_MESSAGES: usize = 100;

struct ServerProcess {
    child: Child,
    stdin: ChildStdin,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct RemoteState {
    process: Option<ServerProcess>,
    output: Arc<Mutex<VecDeque<String>>>,
}

static REMOTE_STATE: OnceLock<Mutex<RemoteState>> = OnceLock::new();

fn remote_state() -> &'static Mutex<RemoteState> {
    REMOTE_STATE.get_or_init(|| Mutex::new(RemoteState::default()))
}

fn refresh_process(state: &mut RemoteState) -> anyhow::Result<bool> {
    let exited = state
        .process
        .as_mut()
        .map(|process| process.child.try_wait())
        .transpose()?
        .flatten()
        .is_some();
    if exited {
        state.process.take();
    }
    Ok(state.process.is_some())
}

pub fn status() -> anyhow::Result<Value> {
    let mut state = remote_state()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(json!({ "status": "ok", "running": refresh_process(&mut state)? }))
}

pub async fn start() -> anyhow::Result<Value> {
    let gateway = crate::clawkit_gateway::ClawkitGatewayClient::default()
        .bootstrap()
        .await?;
    let catalog_path = crate::clawkit_gateway::write_model_catalog(&gateway.models)?;
    let default_model =
        preferred_default_model(&gateway.models).context("当前账号没有可用的 API 模型")?;
    let mut state = remote_state()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    if refresh_process(&mut state)? {
        return Ok(json!({ "status": "ok", "running": true }));
    }

    state
        .output
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?
        .clear();
    let binary = std::env::var("CODEX_REMOTE_CODEX_BIN").unwrap_or_else(|_| "codex".to_string());
    let mut command = Command::new(&binary);
    command
        .arg("-c")
        .arg(toml_override("model_provider", "clawkit"))
        .arg("-c")
        .arg(toml_override("model", default_model))
        .arg("-c")
        .arg(toml_override(
            "model_catalog_json",
            catalog_path.to_string_lossy().as_ref(),
        ))
        .arg("-c")
        .arg(toml_override("model_providers.clawkit.name", "ClawKit API"))
        .arg("-c")
        .arg(toml_override(
            "model_providers.clawkit.base_url",
            &gateway.base_url,
        ))
        .arg("-c")
        .arg(toml_override(
            "model_providers.clawkit.env_key",
            "CLAWKIT_CODEX_API_KEY",
        ))
        .arg("-c")
        .arg(toml_override(
            "model_providers.clawkit.wire_api",
            "responses",
        ))
        .arg("-c")
        .arg("model_providers.clawkit.requires_openai_auth=false")
        .arg("app-server")
        .env("CLAWKIT_CODEX_API_KEY", gateway.api_key)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .with_context(|| format!("无法启动 Codex app-server：{binary}"))?;
    let stdin = child
        .stdin
        .take()
        .context("Codex app-server stdin 不可用")?;
    let stdout = child
        .stdout
        .take()
        .context("Codex app-server stdout 不可用")?;
    let output = Arc::clone(&state.output);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(payload) = line else { break };
            let Ok(mut queue) = output.lock() else { break };
            if queue.len() >= MAX_QUEUED_MESSAGES {
                queue.pop_front();
            }
            queue.push_back(payload);
        }
    });
    state.process = Some(ServerProcess { child, stdin });
    Ok(json!({ "status": "ok", "running": true }))
}

fn preferred_default_model(models: &[String]) -> Option<&str> {
    const PREFERRED: &[&str] = &["gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.2"];
    PREFERRED
        .iter()
        .find_map(|preferred| models.iter().find(|model| model.as_str() == *preferred))
        .or_else(|| models.first())
        .map(String::as_str)
}

fn toml_override(key: &str, value: &str) -> String {
    format!(
        "{key}={}",
        serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
    )
}

pub fn send(payload: &str) -> anyhow::Result<Value> {
    let normalized = normalize_protocol_payload(payload)?;
    let mut state = remote_state()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    if !refresh_process(&mut state)? {
        bail!("Codex app-server 尚未启动");
    }
    let process = state
        .process
        .as_mut()
        .context("Codex app-server 尚未启动")?;
    process.stdin.write_all(normalized.as_bytes())?;
    process.stdin.write_all(b"\n")?;
    process.stdin.flush()?;
    Ok(json!({ "status": "ok" }))
}

pub fn poll() -> anyhow::Result<Value> {
    let state = remote_state()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let mut output = state
        .output
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let count = output.len().min(MAX_POLL_MESSAGES);
    let messages = output.drain(..count).collect::<Vec<_>>();
    Ok(json!({ "status": "ok", "messages": messages }))
}

pub fn stop() -> anyhow::Result<Value> {
    let mut state = remote_state()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    state.process.take();
    state
        .output
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?
        .clear();
    Ok(json!({ "status": "ok", "running": false }))
}

fn normalize_protocol_payload(payload: &str) -> anyhow::Result<String> {
    if payload.len() > MAX_MESSAGE_BYTES {
        bail!("Codex 协议消息过大");
    }
    let value: Value = serde_json::from_str(payload).context("Codex 协议消息不是有效 JSON")?;
    if !value.is_object() {
        bail!("Codex 协议消息必须是 JSON 对象");
    }
    Ok(serde_json::to_string(&value)?)
}

#[cfg(test)]
mod tests {
    use super::{normalize_protocol_payload, preferred_default_model, toml_override};

    #[test]
    fn protocol_payload_is_normalized_to_one_json_line() {
        assert_eq!(
            normalize_protocol_payload("{\n  \"id\": 1, \"method\": \"thread/list\"\n}").unwrap(),
            r#"{"id":1,"method":"thread/list"}"#
        );
    }

    #[test]
    fn protocol_payload_rejects_non_objects() {
        assert!(normalize_protocol_payload("[]").is_err());
        assert!(normalize_protocol_payload("not-json").is_err());
    }

    #[test]
    fn gateway_overrides_keep_secrets_out_of_process_arguments() {
        assert_eq!(
            toml_override(
                "model_providers.clawkit.base_url",
                "https://api.clawkit.chat/v1"
            ),
            r#"model_providers.clawkit.base_url="https://api.clawkit.chat/v1""#
        );
        assert_eq!(
            preferred_default_model(&["claude-sonnet".into(), "gpt-5.5".into()]),
            Some("gpt-5.5")
        );
    }
}
