use codex_plus_core::clawkit_account::ClawkitAccountClient;
use serde_json::json;
use tempfile::tempdir;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn login_persists_only_session_and_creates_desktop_ticket() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/login"))
        .and(body_json(json!({
            "username": "alice@example.com",
            "password": "secret-value",
            "device_id": "clawkit-codex-test-device",
            "product": "codex-remote",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "code": 200,
            "message": "登录成功",
            "data": {
                "token": "jwt-for-test",
                "expires_in": 3600,
                "user": { "id": 7, "username": "alice", "nickname": "Alice" }
            }
        })))
        .mount(&server)
        .await;

    let dir = tempdir().unwrap();
    let session_path = dir.path().join("clawkit-account.json");
    std::fs::write(
        &session_path,
        serde_json::to_vec(&json!({
            "token": "old-token",
            "user": { "username": "old" },
            "device_id": "clawkit-codex-test-device",
            "expires_at": u64::MAX,
        }))
        .unwrap(),
    )
    .unwrap();
    let client = ClawkitAccountClient::new(server.uri(), &session_path).unwrap();
    let logged_in = client
        .login("alice@example.com", "secret-value")
        .await
        .unwrap();

    assert_eq!(logged_in["authenticated"], true);
    assert_eq!(logged_in["user"]["nickname"], "Alice");
    assert!(logged_in.get("token").is_none());
    let stored = std::fs::read_to_string(&session_path).unwrap();
    assert!(stored.contains("jwt-for-test"));
    assert!(!stored.contains("secret-value"));

    Mock::given(method("POST"))
        .and(path("/api/codex-remote/account/socket-ticket"))
        .and(header("authorization", "Bearer jwt-for-test"))
        .and(body_json(json!({
            "role": "desktop",
            "device_id": "clawkit-codex-test-device",
            "device_name": "ClawKit Codex Desktop",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "ticket": "one-time-ticket",
            "expires_at": 123456,
        })))
        .mount(&server)
        .await;

    let ticket = client.create_socket_ticket().await.unwrap();
    assert_eq!(
        ticket["websocket_url"],
        format!(
            "{}/api/codex-remote/account/ws?ticket=one-time-ticket",
            server.uri().replacen("http://", "ws://", 1)
        )
    );
    assert!(ticket.get("token").is_none());
}

#[tokio::test]
async fn failed_login_does_not_create_a_session_file() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "code": 0,
            "message": "用户名或密码错误"
        })))
        .mount(&server)
        .await;
    let dir = tempdir().unwrap();
    let session_path = dir.path().join("clawkit-account.json");
    let client = ClawkitAccountClient::new(server.uri(), &session_path).unwrap();

    let error = client.login("alice", "wrong").await.unwrap_err();

    assert!(error.to_string().contains("用户名或密码错误"));
    assert!(!session_path.exists());
}

#[test]
fn status_and_logout_do_not_expose_the_jwt() {
    let dir = tempdir().unwrap();
    let session_path = dir.path().join("clawkit-account.json");
    std::fs::write(
        &session_path,
        serde_json::to_vec(&json!({
            "token": "private-jwt",
            "user": { "username": "alice" },
            "device_id": "clawkit-codex-test-device",
            "expires_at": u64::MAX,
        }))
        .unwrap(),
    )
    .unwrap();
    let client = ClawkitAccountClient::new("https://example.test", &session_path).unwrap();

    let status = client.status();

    assert_eq!(status["authenticated"], true);
    assert!(status.get("token").is_none());
    assert_eq!(client.logout().unwrap()["authenticated"], false);
    assert!(!session_path.exists());
}

#[test]
fn injection_bundle_contains_clawkit_account_entry() {
    let script = codex_plus_core::assets::injection_script(57321);

    assert!(script.contains("clawkit-account-entry"));
    assert!(script.contains("/clawkit/account/login"));
    assert!(script.contains("/clawkit/relay/start"));
    assert!(script.contains("/clawkit/relay/status"));
    assert!(script.contains("/clawkit/relay/stop"));
    assert!(!script.contains("new WebSocket("));
}
