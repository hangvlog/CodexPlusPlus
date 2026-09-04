import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const [directory = "installers"] = process.argv.slice(2);
const apiBase = process.env.API_BASE?.replace(/\/+$/, "");
const token = process.env.RELEASE_TOKEN;
const version = process.env.TAG?.replace(/^v/i, "");
const tag = process.env.TAG;
const releaseRepository = process.env.RELEASE_REPOSITORY;
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
const files = entries
  .filter((name) => /(\.dmg|\.exe|\.app\.tar\.gz)$/i.test(name))
  .sort();
const signatures = entries.filter((name) => /\.sig$/i.test(name)).sort();
const windowsInstallers = files.filter((name) => /\.exe$/i.test(name));
const macUpdaterArchives = files.filter((name) => /\.app\.tar\.gz$/i.test(name));
if (!files.length) throw new Error("没有找到 ClawKit 桌面安装包");
if (windowsInstallers.length !== 1) {
  throw new Error("Windows 安装包必须有且仅有一个");
}
if (!macUpdaterArchives.length) {
  throw new Error("缺少 macOS 更新包（ClawKit-*.app.tar.gz）");
}

// Windows setup.exe 与每个 macOS .app.tar.gz 都必须有对应的 Tauri 更新签名
const updaterTargets = [...windowsInstallers, ...macUpdaterArchives];
const signatureByFile = new Map();
for (const target of updaterTargets) {
  const sigName = `${target}.sig`;
  if (!signatures.includes(sigName)) {
    throw new Error(`缺少 Tauri 签名文件 ${sigName}`);
  }
  signatureByFile.set(
    target,
    (await readFile(resolve(directory, sigName), "utf8")).trim(),
  );
}
const orphanSignatures = signatures.filter(
  (name) => !signatureByFile.has(name.replace(/\.sig$/i, "")),
);
if (orphanSignatures.length) {
  throw new Error(`签名文件缺少对应产物: ${orphanSignatures.join(", ")}`);
}

function coordinates(name) {
  const platform = name.toLowerCase().endsWith(".exe") ? "windows" : "macos";
  const arch = /arm64|aarch64/i.test(name) ? "arm64" : "x64";
  return { platform, arch };
}

for (const name of releaseRepository ? files : [...files, ...signatures]) {
  const filePath = resolve(directory, name);
  const [{ size }, digest] = await Promise.all([stat(filePath), sha256(filePath)]);
  if (releaseRepository) {
    const { platform, arch } = coordinates(name);
    const registered = await api(`/admin/releases/${release.data.id}/artifacts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        arch,
        channel: "stable",
        filename: name,
        download_url: `https://github.com/${releaseRepository}/releases/download/${tag}/${encodeURIComponent(name)}`,
        sha256: digest,
        signature: signatureByFile.get(name) ?? null,
        file_size: size,
      }),
    });
    if (registered.code !== 200) {
      throw new Error(`登记 ${name} 失败: ${registered.message}`);
    }
    release.data = registered.data;
    continue;
  }
  if (!name.endsWith(".sig")) {
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
  `Published ${productName} ${version} with ${files.length} installers and ${signatures.length} updater signatures.`,
);
