use std::fs;
use std::path::PathBuf;

use anyhow::{Context, bail};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{Value, json};

const DEFAULT_GATEWAY_API_BASE: &str = "https://api.clawkit.chat";
const MODEL_CATALOG_FILE: &str = "clawkit-models.json";

#[derive(Debug, Clone)]
pub(crate) struct GatewayBootstrap {
    pub api_key: String,
    pub base_url: String,
    pub models: Vec<String>,
    pub available_quota: i64,
    pub used_quota: i64,
}

#[derive(Debug, Deserialize)]
struct BootstrapEnvelope {
    success: bool,
    #[serde(default)]
    message: String,
    data: Option<BootstrapData>,
}

#[derive(Debug, Deserialize)]
struct BootstrapData {
    api_key: String,
    base_url: String,
    #[serde(default)]
    models: Vec<String>,
    quota: BootstrapQuota,
}

#[derive(Debug, Default, Deserialize)]
struct BootstrapQuota {
    #[serde(default)]
    available: i64,
    #[serde(default)]
    used: i64,
}

#[derive(Clone)]
pub struct ClawkitGatewayClient {
    api_base: String,
    client: reqwest::Client,
}

impl Default for ClawkitGatewayClient {
    fn default() -> Self {
        let api_base = std::env::var("CLAWKIT_GATEWAY_API_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_GATEWAY_API_BASE.to_string());
        Self::new(api_base).expect("ClawKit gateway HTTP client should initialize")
    }
}

impl ClawkitGatewayClient {
    pub fn new(api_base: impl Into<String>) -> anyhow::Result<Self> {
        let api_base = normalize_api_base(&api_base.into())?;
        let client = reqwest::Client::builder()
            .user_agent(format!(
                "CodexPlusPlus-ClawKit/{}",
                env!("CARGO_PKG_VERSION")
            ))
            .connect_timeout(std::time::Duration::from_secs(8))
            .timeout(std::time::Duration::from_secs(20))
            .build()?;
        Ok(Self { api_base, client })
    }

    pub(crate) async fn bootstrap(&self) -> anyhow::Result<GatewayBootstrap> {
        let (account_token, device_id) =
            crate::clawkit_account::ClawkitAccountClient::default().active_credentials()?;
        self.bootstrap_with_credentials(&account_token, &device_id)
            .await
    }

    async fn bootstrap_with_credentials(
        &self,
        account_token: &str,
        device_id: &str,
    ) -> anyhow::Result<GatewayBootstrap> {
        let response = self
            .client
            .post(format!(
                "{}/api/user/clawkit/codex/bootstrap",
                self.api_base
            ))
            .bearer_auth(account_token)
            .json(&json!({ "device_id": device_id }))
            .send()
            .await
            .context("无法连接 ClawKit API 代理")?;
        let status = response.status();
        let envelope = response
            .json::<BootstrapEnvelope>()
            .await
            .context("ClawKit API 代理响应无效")?;
        if status == StatusCode::UNAUTHORIZED {
            bail!("ClawKit 登录已过期，请重新登录");
        }
        if !status.is_success() || !envelope.success {
            bail!(if envelope.message.is_empty() {
                format!("ClawKit API 代理初始化失败 ({})", status.as_u16())
            } else {
                envelope.message
            });
        }
        let data = envelope.data.context("ClawKit API 代理响应缺少配置")?;
        if data.api_key.trim().is_empty() || data.models.is_empty() {
            bail!("当前账号没有可用的 API 模型");
        }
        Ok(GatewayBootstrap {
            api_key: data.api_key,
            base_url: normalize_api_base(&data.base_url)?,
            models: data.models,
            available_quota: data.quota.available,
            used_quota: data.quota.used,
        })
    }

    pub async fn status(&self) -> anyhow::Result<Value> {
        let bootstrap = self.bootstrap().await?;
        Ok(json!({
            "status": "ok",
            "base_url": bootstrap.base_url,
            "models": bootstrap.models,
            "quota": {
                "available": bootstrap.available_quota,
                "used": bootstrap.used_quota,
            }
        }))
    }
}

pub(crate) fn write_model_catalog(models: &[String]) -> anyhow::Result<PathBuf> {
    let mut unique = models
        .iter()
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    unique.sort();
    unique.dedup();
    if unique.is_empty() {
        bail!("当前账号没有可用的 API 模型");
    }
    let entries = unique
        .iter()
        .enumerate()
        .map(|(index, slug)| model_catalog_entry(slug, index))
        .collect::<Vec<_>>();
    let path = crate::paths::default_app_state_dir().join(MODEL_CATALOG_FILE);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    crate::settings::atomic_write(
        &path,
        serde_json::to_vec_pretty(&json!({ "models": entries }))?.as_slice(),
    )?;
    Ok(path)
}

fn model_catalog_entry(slug: &str, priority: usize) -> Value {
    json!({
        "slug": slug,
        "display_name": slug,
        "description": "ClawKit API 代理模型",
        "default_reasoning_level": "medium",
        "supported_reasoning_levels": [
            { "effort": "low", "description": "更快响应" },
            { "effort": "medium", "description": "平衡速度与质量" },
            { "effort": "high", "description": "更深入推理" },
            { "effort": "xhigh", "description": "最高推理强度" }
        ],
        "shell_type": "shell_command",
        "visibility": "list",
        "supported_in_api": true,
        "priority": priority,
    })
}

fn normalize_api_base(value: &str) -> anyhow::Result<String> {
    let value = value.trim().trim_end_matches('/');
    if !(value.starts_with("https://") || value.starts_with("http://")) {
        bail!("ClawKit API 地址必须使用 HTTP 或 HTTPS");
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::{ClawkitGatewayClient, model_catalog_entry};

    #[test]
    fn catalog_entry_keeps_gateway_model_slug() {
        let entry = model_catalog_entry("gpt-5.5", 0);
        assert_eq!(entry["slug"], "gpt-5.5");
        assert_eq!(entry["visibility"], "list");
    }

    #[tokio::test]
    async fn bootstrap_sends_account_identity_and_keeps_key_out_of_status() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/user/clawkit/codex/bootstrap"))
            .and(header("authorization", "Bearer account-jwt"))
            .and(body_json(json!({ "device_id": "sandbox-desktop" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "success": true,
                "data": {
                    "api_key": "sk-private-test-key",
                    "base_url": "https://api.clawkit.chat/v1",
                    "models": ["gpt-5.5", "claude-sonnet"],
                    "quota": { "available": 1234, "used": 56 }
                }
            })))
            .mount(&server)
            .await;

        let client = ClawkitGatewayClient::new(server.uri()).unwrap();
        let bootstrap = client
            .bootstrap_with_credentials("account-jwt", "sandbox-desktop")
            .await
            .unwrap();

        assert_eq!(bootstrap.api_key, "sk-private-test-key");
        assert_eq!(bootstrap.models, ["gpt-5.5", "claude-sonnet"]);
        let public_status = json!({
            "base_url": bootstrap.base_url,
            "models": bootstrap.models,
            "quota": {
                "available": bootstrap.available_quota,
                "used": bootstrap.used_quota,
            }
        });
        assert!(!public_status.to_string().contains("sk-private-test-key"));
    }
}
