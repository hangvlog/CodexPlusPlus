# ClawKit Desktop 3.19.26: restore macOS updates

The 3.19.23 release workflow explicitly skipped macOS while every desktop used the same static Tauri endpoint. The plugin resolves a platform URL even when the remote version is older; macOS therefore reported an update-check failure. The 3.19.25 database repair ZIP was not a signed updater release.

The release now builds Windows x64 and macOS ARM64/x64 together. Both workflows pin the shell to `hangvlog/cc-switch@2316d09008f3bddf8cc81f761158001caff6d1e5` (3.19.26, DB v18). The pinned version is checked before building. The complete pipeline requires all three signed updater artifacts before publishing the shared manifest, and checks each minisign signature against the shell's embedded public key. It uses the existing signing identity.

macOS DMGs include ClawKit Desktop and ClawKit Settings. The Desktop updater archive includes the embedded Codex helper. Its executable remains `cc-switch` so an installed 3.19.25 can re-exec after bundle replacement; `ClawKitDesktop` is retained as a symlink for earlier integrated builds. macOS code signing remains ad-hoc, distinct from the cryptographic Tauri archive signature. No Apple notarization claim is made.

Release: `v3.19.26`, built from this repository's tagged commit by `.github/workflows/release-assets.yml`. No uncommitted shell or launcher changes are included. Backend publication uses existing APIs and credentials; no server code or schema migration is required. Windows installers are mirrored to COS, macOS artifacts registered from the same GitHub Release. Rollback evidence: previous release `v3.19.23`, plus the database-compatible macOS repair archive `hangvlog/cc-switch@clawkit-database-v18-3.19.25`. Do not downgrade to DB-v17 binaries when the local DB is v18.

Acceptance: verify all signed archives and actual manifest platform entries; operate the installed 3.19.25 About page to detect 3.19.26, download/verify/install/restart, then verify version, latest check, SQLite integrity and provider configuration hashes. Exact source SHAs, artifact digests and live results are recorded in the parent chat-all delivery document.

## COS distribution follow-up

Local GitHub downloads were slow during acceptance. The publisher now mirrors macOS DMGs and signed updater archives to the existing COS path as well as Windows EXEs. Existing matching artifacts are skipped, but a missing signature is repaired on retry. A scoped local HTTP fixture verified all three platform uploads and the interrupted-signature recovery path. No client binary or signing identity changes are involved.

`.github/workflows/publish-existing-release.yml` can copy already built release bytes after comparing GitHub size/digest and verifying signatures against the pinned shell public key. This permits distribution repair without rebuilding or replacing immutable release assets. It uses the existing release token and read-only GitHub content permission.
