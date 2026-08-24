import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

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

const files = (await readdir(resolve(directory)))
  .filter((name) => /\.(dmg|exe)$/i.test(name));
if (!files.length) throw new Error("没有找到 ClawKit 桌面安装包");

for (const name of files) {
  const data = await readFile(resolve(directory, name));
  const form = new FormData();
  form.append("file", new Blob([data]), basename(name));
  const uploaded = await api(`/admin/releases/${release.data.id}/upload`, {
    method: "POST",
    body: form,
  });
  if (uploaded.code !== 200) throw new Error(`上传 ${name} 失败: ${uploaded.message}`);
}

if (release.data.status !== "published") {
  const published = await api(`/admin/releases/${release.data.id}/publish`, {
    method: "POST",
  });
  if (published.code !== 200) throw new Error(`发布失败: ${published.message}`);
}
console.log(`Published ${productName} ${version} with ${files.length} installers.`);
