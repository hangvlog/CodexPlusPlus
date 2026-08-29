import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const [directory = "installers"] = process.argv.slice(2);
const apiBase = process.env.API_BASE?.replace(/\/+$/, "");
const token = process.env.RELEASE_TOKEN;
const version = process.env.TAG?.replace(/^v/i, "");
const productName = "clawkit-desktop";

if (!apiBase || !token || !version) {
  throw new Error("API_BASE、RELEASE_TOKEN 和 TAG 均为必填项");
}

async function api(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return payload;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function upload(path, filePath) {
  const config = [
    `url = "${apiBase}${path}"`,
    'request = "POST"',
    `header = "Authorization: Bearer ${token}"`,
    `form = "file=@${filePath}"`,
    "connect-timeout = 30",
    "max-time = 1800",
    "retry = 2",
    "retry-delay = 5",
    "retry-all-errors",
    "fail-with-body",
    "silent",
    "show-error",
  ].join("\n");

  const child = spawn("curl", ["--config", "-"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(config);

  const exitCode = await new Promise((finish, reject) => {
    child.once("error", reject);
    child.once("close", finish);
  });
  if (exitCode !== 0) {
    throw new Error(`${path}: curl exited ${exitCode}: ${stderr.trim()}`);
  }
  const payload = JSON.parse(stdout);
  if (payload.code !== 200) {
    throw new Error(`${path}: ${payload.message || "upload failed"}`);
  }
  return payload;
}

const notes = (process.env.RELEASE_BODY || "")
  .split("\n")
  .map((line) => line.replace(/^[-*]\s*/, "").trim())
  .filter(Boolean);
let release = await api("/admin/releases/create", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    product_name: productName,
    version,
    changelog: notes,
    force_update: false,
  }),
});

if (release.code !== 200) {
  const existing = await api(
    `/admin/releases/list?product_name=${productName}&page=1&page_size=100`,
  );
  release = {
    code: 200,
    data: existing.data?.list?.find((item) => item.version === version),
  };
}
if (!release.data?.id) throw new Error(`无法创建或找到 ${productName} ${version}`);

const entries = await readdir(resolve(directory));
const files = entries.filter((name) => /\.(dmg|exe)$/i.test(name)).sort();
const signatures = entries.filter((name) => /\.exe\.sig$/i.test(name)).sort();
const windowsInstallers = files.filter((name) => /\.exe$/i.test(name));
if (!files.length) throw new Error("没有找到 ClawKit 桌面安装包");
if (windowsInstallers.length !== 1 || signatures.length !== 1) {
  throw new Error("Windows 安装包和 Tauri 签名必须各有且仅有一个");
}
if (signatures[0] !== `${windowsInstallers[0]}.sig`) {
  throw new Error(`签名 ${signatures[0]} 与安装包 ${windowsInstallers[0]} 不匹配`);
}

for (const name of [...files, ...signatures]) {
  const filePath = resolve(directory, name);
  if (!name.endsWith(".sig")) {
    const [{ size }, digest] = await Promise.all([stat(filePath), sha256(filePath)]);
    const existing = release.data.artifacts?.find(
      (artifact) => artifact.filename === name
        && artifact.file_size === size
        && artifact.sha256 === digest,
    );
    if (existing) {
      console.log(`Skipping already uploaded ${name}.`);
      continue;
    }
  }
  const uploaded = await upload(`/admin/releases/${release.data.id}/upload`, filePath);
  if (uploaded.code !== 200) throw new Error(`上传 ${name} 失败: ${uploaded.message}`);
  release.data = uploaded.data;
}

if (release.data.status !== "published") {
  const published = await api(`/admin/releases/${release.data.id}/publish`, {
    method: "POST",
  });
  if (published.code !== 200) throw new Error(`发布失败: ${published.message}`);
}
console.log(
  `Published ${productName} ${version} with ${files.length} installers and ${signatures.length} updater signature.`,
);
