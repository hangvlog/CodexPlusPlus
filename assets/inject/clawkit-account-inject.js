(() => {
  const VERSION = "3";
  if (window.__clawkitAccount?.version === VERSION) {
    window.__clawkitAccount.ensureEntry?.();
    return;
  }

  const state = {
    authenticated: false,
    user: null,
    connection: "disconnected",
    message: "尚未登录",
    reconnectTimer: null,
    pollTimer: null,
    pollBusy: false,
    stopped: false,
  };

  async function call(path, payload = {}) {
    if (typeof window.__codexSessionDeleteBridge !== "function") {
      throw new Error("ClawKit 本地桥接尚未就绪，请从 ClawKit 启动器重新打开 Codex");
    }
    const result = await window.__codexSessionDeleteBridge(path, payload);
    if (!result || result.status !== "ok") {
      throw new Error(result?.message || "ClawKit 请求失败");
    }
    return result;
  }

  function displayName() {
    return state.user?.nickname || state.user?.username || "ClawKit 用户";
  }

  function connectionLabel() {
    if (!state.authenticated) return "未登录";
    if (state.connection === "connected") return "手机已连接";
    if (state.connection === "waiting") return "等待同账号手机";
    if (state.connection === "connecting") return "正在连接";
    if (state.connection === "error") return "连接异常";
    return "准备连接";
  }

  function updateUi() {
    const entry = document.getElementById("clawkit-account-entry");
    if (entry) {
      entry.dataset.state = state.connection;
      entry.setAttribute("aria-label", `ClawKit：${connectionLabel()}`);
      entry.title = `ClawKit · ${connectionLabel()}`;
      const label = entry.querySelector("[data-clawkit-entry-label]");
      if (label) label.textContent = state.authenticated ? displayName() : "ClawKit";
    }
    const modal = document.querySelector("[data-clawkit-account-modal]");
    if (!modal) return;
    const status = modal.querySelector("[data-clawkit-status]");
    const detail = modal.querySelector("[data-clawkit-detail]");
    const form = modal.querySelector("[data-clawkit-login-form]");
    const account = modal.querySelector("[data-clawkit-account-view]");
    if (status) {
      status.textContent = connectionLabel();
      status.dataset.state = state.connection;
    }
    if (detail) detail.textContent = state.message;
    if (form) form.hidden = state.authenticated;
    if (account) {
      account.hidden = !state.authenticated;
      const name = account.querySelector("[data-clawkit-user-name]");
      if (name) name.textContent = displayName();
    }
  }

  function disconnect(stop = false) {
    state.stopped = stop;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    if (state.authenticated && stop) {
      state.connection = "disconnected";
      state.message = "连接已停止";
    }
    updateUi();
  }

  async function pollRemote() {
    if (state.pollBusy || !state.authenticated) return;
    state.pollBusy = true;
    try {
      const result = await call("/clawkit/relay/status");
      state.connection = result.connection || "error";
      state.message = result.message || "ClawKit 连接状态未知";
      updateUi();
      if (state.connection === "error") scheduleReconnect();
    } catch (error) {
      state.connection = "error";
      state.message = error?.message || String(error);
      updateUi();
      scheduleReconnect();
    } finally {
      state.pollBusy = false;
    }
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => void pollRemote(), 500);
    void pollRemote();
  }

  function scheduleReconnect() {
    if (!state.authenticated || state.stopped || state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      void connect();
    }, 2500);
  }

  async function connect() {
    if (!state.authenticated) return;
    disconnect(false);
    state.connection = "connecting";
    state.message = "正在申请一次性安全连接票据";
    updateUi();
    try {
      const result = await call("/clawkit/relay/start");
      if (!state.authenticated) return;
      state.connection = result.connection || "connecting";
      state.message = result.message || "正在连接 ClawKit 中继服务";
      startPolling();
      updateUi();
    } catch (error) {
      state.connection = "error";
      state.message = error?.message || String(error);
      updateUi();
      scheduleReconnect();
    }
  }

  async function refresh() {
    try {
      const result = await call("/clawkit/account/status");
      state.authenticated = !!result.authenticated;
      state.user = result.user || null;
      state.message = state.authenticated ? "登录状态有效" : "登录同一个 ClawKit 账号即可连接手机";
      updateUi();
      if (state.authenticated) void connect();
    } catch (error) {
      state.connection = "error";
      state.message = error?.message || String(error);
      updateUi();
    }
  }

  function installStyles() {
    if (document.getElementById("clawkit-account-styles")) return;
    if (!document.head) return;
    const style = document.createElement("style");
    style.id = "clawkit-account-styles";
    style.textContent = `
      #clawkit-account-entry { position:fixed; top:10px; right:72px; z-index:2147483000; height:30px; display:flex; align-items:center; gap:7px; padding:0 10px; border:1px solid rgba(127,127,127,.28); border-radius:7px; color:inherit; background:color-mix(in srgb, Canvas 92%, transparent); box-shadow:0 1px 4px rgba(0,0,0,.12); font:500 12px/1 system-ui,sans-serif; cursor:pointer; backdrop-filter:blur(12px) }
      #clawkit-account-entry:hover { background:color-mix(in srgb, CanvasText 7%, Canvas) }
      #clawkit-account-entry .clawkit-dot { width:7px; height:7px; border-radius:50%; background:#8a8a8a }
      #clawkit-account-entry[data-state="waiting"] .clawkit-dot { background:#d99a28 }
      #clawkit-account-entry[data-state="connected"] .clawkit-dot { background:#22a06b }
      #clawkit-account-entry[data-state="connecting"] .clawkit-dot { background:#4d8df7 }
      #clawkit-account-entry[data-state="error"] .clawkit-dot { background:#d84b4b }
      .clawkit-account-overlay { position:fixed; inset:0; z-index:2147483600; display:grid; place-items:center; padding:24px; background:rgba(0,0,0,.42); backdrop-filter:blur(3px) }
      .clawkit-account-dialog { width:min(420px,calc(100vw - 32px)); color:CanvasText; background:Canvas; border:1px solid rgba(127,127,127,.28); border-radius:10px; box-shadow:0 24px 70px rgba(0,0,0,.28); font:14px/1.45 system-ui,sans-serif; overflow:hidden }
      .clawkit-account-head { display:flex; justify-content:space-between; align-items:center; padding:16px 18px; border-bottom:1px solid rgba(127,127,127,.2) }
      .clawkit-account-title { font-size:16px; font-weight:650 }
      .clawkit-account-close { width:28px; height:28px; border:0; border-radius:6px; color:inherit; background:transparent; font-size:20px; cursor:pointer }
      .clawkit-account-close:hover { background:rgba(127,127,127,.14) }
      .clawkit-account-body { display:grid; gap:16px; padding:18px }
      .clawkit-account-status { display:flex; align-items:center; justify-content:space-between; gap:12px }
      .clawkit-account-badge { padding:3px 8px; border-radius:999px; background:rgba(127,127,127,.13); font-size:12px }
      .clawkit-account-badge[data-state="connected"] { color:#16855a; background:rgba(34,160,107,.14) }
      .clawkit-account-detail { color:color-mix(in srgb, CanvasText 62%, transparent); font-size:12px }
      .clawkit-account-form { display:grid; gap:12px }
      .clawkit-account-field { display:grid; gap:6px }
      .clawkit-account-field span { font-size:12px; font-weight:600 }
      .clawkit-account-field input { box-sizing:border-box; width:100%; height:38px; padding:0 11px; border:1px solid rgba(127,127,127,.36); border-radius:7px; color:inherit; background:transparent; outline:none }
      .clawkit-account-field input:focus { border-color:#4d8df7; box-shadow:0 0 0 3px rgba(77,141,247,.14) }
      .clawkit-account-actions { display:flex; justify-content:flex-end; gap:8px }
      .clawkit-account-button { min-height:34px; padding:0 12px; border:1px solid rgba(127,127,127,.3); border-radius:7px; color:inherit; background:transparent; font-weight:600; cursor:pointer }
      .clawkit-account-button.primary { color:white; border-color:#1f6feb; background:#1f6feb }
      .clawkit-account-button:disabled { opacity:.55; cursor:default }
      .clawkit-account-user { font-weight:650 }
    `;
    document.head.appendChild(style);
  }

  function openModal() {
    document.querySelector("[data-clawkit-account-modal]")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "clawkit-account-overlay";
    overlay.dataset.clawkitAccountModal = "true";
    overlay.innerHTML = `
      <section class="clawkit-account-dialog" role="dialog" aria-modal="true" aria-label="ClawKit 账号">
        <header class="clawkit-account-head"><div class="clawkit-account-title">ClawKit 账号</div><button class="clawkit-account-close" type="button" aria-label="关闭">×</button></header>
        <div class="clawkit-account-body">
          <div><div class="clawkit-account-status"><strong>手机远程连接</strong><span class="clawkit-account-badge" data-clawkit-status></span></div><div class="clawkit-account-detail" data-clawkit-detail></div></div>
          <form class="clawkit-account-form" data-clawkit-login-form>
            <label class="clawkit-account-field"><span>账号</span><input name="username" autocomplete="username" placeholder="用户名 / 手机号 / 邮箱" required></label>
            <label class="clawkit-account-field"><span>密码</span><input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></label>
            <div class="clawkit-account-actions"><button class="clawkit-account-button primary" type="submit">登录并连接</button></div>
          </form>
          <div data-clawkit-account-view hidden><div>已登录 <span class="clawkit-account-user" data-clawkit-user-name></span></div><div class="clawkit-account-actions"><button class="clawkit-account-button" data-clawkit-reconnect type="button">重新连接</button><button class="clawkit-account-button" data-clawkit-logout type="button">退出账号</button></div></div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector(".clawkit-account-close")?.addEventListener("click", close);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    overlay.querySelector("[data-clawkit-reconnect]")?.addEventListener("click", () => void connect());
    overlay.querySelector("[data-clawkit-logout]")?.addEventListener("click", async () => {
      disconnect(true);
      try { await call("/clawkit/relay/stop"); } catch (_) {}
      try { await call("/clawkit/account/logout"); } catch (_) {}
      state.authenticated = false;
      state.user = null;
      state.message = "已退出 ClawKit 账号";
      updateUi();
    });
    overlay.querySelector("form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      const data = new FormData(form);
      button.disabled = true;
      state.connection = "connecting";
      state.message = "正在验证账号";
      updateUi();
      try {
        const result = await call("/clawkit/account/login", { username: data.get("username"), password: data.get("password") });
        form.querySelector("input[name=password]").value = "";
        state.authenticated = true;
        state.user = result.user || null;
        state.stopped = false;
        state.message = "登录成功，正在连接手机";
        updateUi();
        await connect();
      } catch (error) {
        state.connection = "error";
        state.message = error?.message || String(error);
        updateUi();
      } finally {
        button.disabled = false;
      }
    });
    updateUi();
    overlay.querySelector(state.authenticated ? "[data-clawkit-reconnect]" : "input[name=username]")?.focus();
  }

  function ensureEntry() {
    if (!document.body || !document.head || document.getElementById("clawkit-account-entry")) return;
    installStyles();
    const button = document.createElement("button");
    button.id = "clawkit-account-entry";
    button.type = "button";
    button.innerHTML = '<span class="clawkit-dot" aria-hidden="true"></span><span data-clawkit-entry-label>ClawKit</span>';
    button.addEventListener("click", openModal);
    document.body.appendChild(button);
    updateUi();
  }

  window.__clawkitAccount = { version: VERSION, state, ensureEntry, openModal, refresh, connect, disconnect, pollRemote };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureEntry, { once: true });
  else ensureEntry();
  if (document.documentElement && typeof MutationObserver === "function") {
    new MutationObserver(ensureEntry).observe(document.documentElement, { childList: true, subtree: true });
  }
  void refresh();
})();
