const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROME_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ colorScheme: "dark" });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await page.goto("data:text/html,<html><head><title>Codex Mock</title></head><body><main>Codex</main></body></html>");
    await page.evaluate(() => {
      window.__clawkitTestCalls = [];
      window.__clawkitPolled = false;
      window.__codexSessionDeleteBridge = async (route, payload) => {
        window.__clawkitTestCalls.push({ route, payload });
        if (route === "/clawkit/account/status") {
          return { status: "ok", authenticated: false };
        }
        if (route === "/clawkit/account/login") {
          if (payload.username !== "alice@example.com" || payload.password !== "secret") {
            return { status: "failed", message: "账号错误" };
          }
          return {
            status: "ok",
            authenticated: true,
            user: { username: "alice", nickname: "Alice" },
          };
        }
        if (route === "/clawkit/account/socket-ticket") {
          return { status: "ok", websocket_url: "ws://mock.test/account?ticket=once" };
        }
        if (route === "/clawkit/account/logout") {
          return { status: "ok", authenticated: false };
        }
        if (route === "/clawkit/remote/start") {
          return { status: "ok", running: true };
        }
        if (route === "/clawkit/remote/send") {
          return { status: "ok" };
        }
        if (route === "/clawkit/remote/poll") {
          if (window.__clawkitPolled) return { status: "ok", messages: [] };
          window.__clawkitPolled = true;
          return { status: "ok", messages: ['{"id":1,"result":{"ok":true}}'] };
        }
        if (route === "/clawkit/remote/stop") {
          return { status: "ok", running: false };
        }
        return { status: "failed", message: "unexpected route" };
      };
      window.WebSocket = class MockWebSocket {
        static OPEN = 1;
        static instances = [];
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          this.sent = [];
          window.WebSocket.instances.push(this);
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.();
            this.onmessage?.({ data: JSON.stringify({ type: "relay.ready", role: "desktop" }) });
            this.onmessage?.({ data: JSON.stringify({ type: "relay.peer", role: "mobile", online: true }) });
            this.onmessage?.({ data: JSON.stringify({ type: "relay.data", payload: '{"id":2,"method":"thread/list","params":{}}' }) });
          }, 10);
        }
        send(payload) {
          this.sent.push(payload);
        }
        close() {
          this.readyState = 3;
          this.onclose?.();
        }
      };
    });
    await page.addScriptTag({
      path: path.resolve(__dirname, "../assets/inject/clawkit-account-inject.js"),
    });

    const entry = page.locator("#clawkit-account-entry");
    await entry.waitFor({ state: "visible" });
    assert.equal(await entry.textContent(), "ClawKit");
    await entry.click();

    const modal = page.locator("[data-clawkit-account-modal]");
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.locator("input").count(), 2, "弹窗不应要求填写中继地址");
    await modal.locator("input[name=username]").fill("alice@example.com");
    await modal.locator("input[name=password]").fill("secret");
    await modal.locator("button[type=submit]").click();

    await modal.getByText("手机已连接", { exact: true }).waitFor();
    assert.equal(await modal.locator("[data-clawkit-user-name]").textContent(), "Alice");
    assert.equal(await modal.locator("input[name=password]").inputValue(), "");
    assert.equal(await entry.locator("[data-clawkit-entry-label]").textContent(), "Alice");
    await page.waitForFunction(() =>
      window.__clawkitTestCalls.some((call) => call.route === "/clawkit/remote/send") &&
      window.WebSocket.instances[0]?.sent.length > 0,
    );
    const calls = await page.evaluate(() => window.__clawkitTestCalls);
    assert.deepEqual(
      calls.map((call) => call.route).filter((route) => route !== "/clawkit/remote/poll"),
      [
        "/clawkit/account/status",
        "/clawkit/account/login",
        "/clawkit/remote/start",
        "/clawkit/account/socket-ticket",
        "/clawkit/remote/send",
      ],
    );
    const sent = await page.evaluate(() => window.WebSocket.instances[0].sent);
    assert.deepEqual(JSON.parse(sent[0]), {
      type: "relay.data",
      payload: '{"id":1,"result":{"ok":true}}',
    });

    await modal.locator("[data-clawkit-logout]").click();
    await modal.locator("[data-clawkit-login-form]").waitFor({ state: "visible" });
    assert.equal(await entry.locator("[data-clawkit-entry-label]").textContent(), "ClawKit");
    await page.waitForFunction(() =>
      window.__clawkitTestCalls.some((call) => call.route === "/clawkit/remote/stop") &&
      window.__clawkitTestCalls.some((call) => call.route === "/clawkit/account/logout"),
    );
    assert.deepEqual(browserErrors, []);
    console.log("clawkit-account-ui: passed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
