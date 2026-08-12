use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use anyhow::Context;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone)]
struct RelaySnapshot {
    connection: &'static str,
    message: String,
    mobile_online: bool,
}

impl Default for RelaySnapshot {
    fn default() -> Self {
        Self {
            connection: "disconnected",
            message: "远程连接尚未启动".to_string(),
            mobile_online: false,
        }
    }
}

#[derive(Default)]
struct RelayRuntime {
    generation: u64,
    task: Option<JoinHandle<()>>,
    snapshot: RelaySnapshot,
}

static RELAY_RUNTIME: OnceLock<Mutex<RelayRuntime>> = OnceLock::new();

fn runtime() -> &'static Mutex<RelayRuntime> {
    RELAY_RUNTIME.get_or_init(|| Mutex::new(RelayRuntime::default()))
}

pub fn status() -> anyhow::Result<Value> {
    let runtime = runtime()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(snapshot_value(&runtime.snapshot))
}

pub async fn start() -> anyhow::Result<Value> {
    crate::clawkit_remote::start().await?;
    let ticket = crate::clawkit_account::ClawkitAccountClient::default()
        .create_socket_ticket()
        .await?;
    let websocket_url = ticket
        .get("websocket_url")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .context("ClawKit 中继票据缺少 WebSocket 地址")?
        .to_string();

    let generation = {
        let mut runtime = runtime()
            .lock()
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        if let Some(task) = runtime.task.take() {
            task.abort();
        }
        runtime.generation = runtime.generation.wrapping_add(1);
        runtime.snapshot = RelaySnapshot {
            connection: "connecting",
            message: "正在连接 ClawKit 中继服务".to_string(),
            mobile_online: false,
        };
        runtime.generation
    };
    let task = tokio::spawn(run_relay(websocket_url, generation));
    let mut runtime = runtime()
        .lock()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    runtime.task = Some(task);
    Ok(snapshot_value(&runtime.snapshot))
}

pub fn stop() -> anyhow::Result<Value> {
    {
        let mut runtime = runtime()
            .lock()
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        runtime.generation = runtime.generation.wrapping_add(1);
        if let Some(task) = runtime.task.take() {
            task.abort();
        }
        runtime.snapshot = RelaySnapshot::default();
    }
    crate::clawkit_remote::stop()?;
    status()
}

async fn run_relay(websocket_url: String, generation: u64) {
    let result = relay_loop(&websocket_url, generation).await;
    if let Err(error) = result {
        update_snapshot(
            generation,
            "error",
            format!("ClawKit 中继连接已断开：{error}"),
            false,
        );
    }
}

async fn relay_loop(websocket_url: &str, generation: u64) -> anyhow::Result<()> {
    let (mut socket, _) = connect_async(websocket_url)
        .await
        .context("无法连接 ClawKit 中继服务")?;
    update_snapshot(
        generation,
        "waiting",
        "Codex 会话桥已上线，同账号手机会自动发现此设备".to_string(),
        false,
    );
    let mut poll = tokio::time::interval(Duration::from_millis(80));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            message = socket.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        handle_relay_text(text.as_ref(), generation)?;
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        socket.send(Message::Pong(payload)).await?;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame
                            .map(|value| value.reason.to_string())
                            .filter(|value| !value.is_empty())
                            .unwrap_or_else(|| "服务器关闭连接".to_string());
                        anyhow::bail!(reason);
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(error.into()),
                    None => anyhow::bail!("中继连接已结束"),
                }
            }
            _ = poll.tick() => {
                let result = crate::clawkit_remote::poll()?;
                if let Some(messages) = result.get("messages").and_then(Value::as_array) {
                    for payload in messages.iter().filter_map(Value::as_str) {
                        let envelope = json!({ "type": "relay.data", "payload": payload });
                        socket.send(Message::Text(envelope.to_string().into())).await?;
                    }
                }
            }
        }
    }
}

fn handle_relay_text(text: &str, generation: u64) -> anyhow::Result<()> {
    let envelope: Value = serde_json::from_str(text).context("中继消息不是有效 JSON")?;
    match envelope.get("type").and_then(Value::as_str) {
        Some("relay.ready") => update_snapshot(
            generation,
            "waiting",
            "账号连接成功，正在等待同账号手机".to_string(),
            false,
        ),
        Some("relay.peer") if envelope.get("role").and_then(Value::as_str) == Some("mobile") => {
            let online = envelope
                .get("online")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            update_snapshot(
                generation,
                if online { "connected" } else { "waiting" },
                if online {
                    "同账号手机已连接".to_string()
                } else {
                    "手机已离线，桌面端会继续等待".to_string()
                },
                online,
            );
        }
        Some("relay.data") => {
            let payload = envelope
                .get("payload")
                .and_then(Value::as_str)
                .context("中继数据缺少 payload")?;
            crate::clawkit_remote::send(payload)?;
        }
        _ => {}
    }
    Ok(())
}

fn update_snapshot(
    generation: u64,
    connection: &'static str,
    message: String,
    mobile_online: bool,
) {
    let Ok(mut runtime) = runtime().lock() else {
        return;
    };
    if runtime.generation != generation {
        return;
    }
    runtime.snapshot = RelaySnapshot {
        connection,
        message,
        mobile_online,
    };
}

fn snapshot_value(snapshot: &RelaySnapshot) -> Value {
    json!({
        "status": "ok",
        "connection": snapshot.connection,
        "message": snapshot.message,
        "mobile_online": snapshot.mobile_online,
    })
}

#[cfg(test)]
mod tests {
    use super::{RelaySnapshot, handle_relay_text, snapshot_value};

    #[test]
    fn snapshot_does_not_expose_the_socket_ticket() {
        let value = snapshot_value(&RelaySnapshot {
            connection: "connected",
            message: "同账号手机已连接".to_string(),
            mobile_online: true,
        });
        assert_eq!(value["connection"], "connected");
        assert_eq!(value["mobile_online"], true);
        assert!(value.get("websocket_url").is_none());
        assert!(value.get("ticket").is_none());
    }

    #[test]
    fn unrelated_relay_events_are_ignored() {
        handle_relay_text(r#"{"type":"relay.devices","desktops":[]}"#, 999).unwrap();
    }
}
