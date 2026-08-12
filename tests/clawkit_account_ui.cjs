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
        if (route === "/clawkit/account/logout") {
          return { status: "ok", authenticated: false };
        }
        if (route === "/clawkit/relay/start") {
          return { status: "ok", connection: "waiting", message: "等待同账号手机" };
        }
        if (route === "/clawkit/relay/status") {
          return { status: "ok", connection: "connected", message: "同账号手机已连接", mobile_online: true };
        }
        if (route === "/clawkit/relay/stop") {
          return { status: "ok", connection: "disconnected" };
        }
        return { status: "failed", message: "unexpected route" };
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
      window.__clawkitTestCalls.some((call) => call.route === "/clawkit/relay/status"),
    );
    const calls = await page.evaluate(() => window.__clawkitTestCalls);
    assert.deepEqual(
      calls.map((call) => call.route).filter((route) => route !== "/clawkit/relay/status"),
      [
        "/clawkit/account/status",
        "/clawkit/account/login",
        "/clawkit/relay/start",
      ],
    );

    await modal.locator("[data-clawkit-logout]").click();
    await modal.locator("[data-clawkit-login-form]").waitFor({ state: "visible" });
    assert.equal(await entry.locator("[data-clawkit-entry-label]").textContent(), "ClawKit");
    await page.waitForFunction(() =>
      window.__clawkitTestCalls.some((call) => call.route === "/clawkit/relay/stop") &&
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
