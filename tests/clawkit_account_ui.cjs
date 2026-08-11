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
        return { status: "failed", message: "unexpected route" };
      };
      window.WebSocket = class MockWebSocket {
        static OPEN = 1;
        constructor(url) {
          this.url = url;
          this.readyState = 0;
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.();
            this.onmessage?.({ data: JSON.stringify({ type: "relay.ready", role: "desktop" }) });
            this.onmessage?.({ data: JSON.stringify({ type: "relay.peer", role: "mobile", online: true }) });
          }, 10);
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
    const calls = await page.evaluate(() => window.__clawkitTestCalls);
    assert.deepEqual(
      calls.map((call) => call.route),
      [
        "/clawkit/account/status",
        "/clawkit/account/login",
        "/clawkit/account/socket-ticket",
      ],
    );

    await modal.locator("[data-clawkit-logout]").click();
    await modal.locator("[data-clawkit-login-form]").waitFor({ state: "visible" });
    assert.equal(await entry.locator("[data-clawkit-entry-label]").textContent(), "ClawKit");
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
