import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

// Verify against the key embedded in the exact shell being shipped, not merely
// against a signing command's exit status. Never reads a private key.
const [configPath, ...archives] = process.argv.slice(2);
assert(configPath && archives.length, "usage: verify-updater-signature.mjs tauri.conf.json archive...");
const config = JSON.parse(await readFile(configPath, "utf8"));
const publicLines = Buffer.from(config.plugins.updater.pubkey, "base64").toString().trim().split(/\r?\n/);
const publicPacket = Buffer.from(publicLines[1], "base64");
assert.equal(publicPacket.length, 42);
const key = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicPacket.subarray(10)]),
  type: "spki", format: "der",
});
for (const archive of archives) {
  const bytes = await readFile(archive);
  const lines = Buffer.from((await readFile(`${archive}.sig`, "utf8")).trim(), "base64")
    .toString().trim().split(/\r?\n/);
  const packet = Buffer.from(lines[1], "base64");
  assert.equal(packet.length, 74);
  assert(packet.subarray(2, 10).equals(publicPacket.subarray(2, 10)), "signing key differs from embedded key");
  const algorithm = packet.subarray(0, 2).toString();
  assert(["Ed", "ED"].includes(algorithm), "unsupported minisign algorithm");
  const signed = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  assert(verify(null, signed, key, packet.subarray(10)), "invalid archive signature");
  assert(lines[2].startsWith("trusted comment: "));
  const comment = lines[2].slice("trusted comment: ".length);
  assert(verify(null, Buffer.concat([packet.subarray(10), Buffer.from(comment)]), key, Buffer.from(lines[3], "base64")), "invalid trusted comment signature");
  console.log(`Verified ${archive}: ${bytes.length} bytes, sha256 ${createHash("sha256").update(bytes).digest("hex")}`);
}
