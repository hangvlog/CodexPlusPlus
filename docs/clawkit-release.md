# ClawKit Desktop release overlay

This fork keeps upstream Codex++ crate and executable names to make upstream rebases manageable.
Only public application names, bundle identifiers, installer filenames, update UI and release
distribution are branded as ClawKit Desktop.

- Update product: `clawkit-desktop`
- Default update API: `https://clawkit.chat`
- Runtime/build override: `CLAWKIT_UPDATE_API_URL`
- Windows bundle: `clawkit-desktop.exe`, `codex-plus-plus.exe`, and the settings manager
- macOS user-facing bundles: `ClawKit Desktop.app`, `ClawKit Settings.app`
- Codex helper: internal executable bundled inside `ClawKit Desktop.app`; it never gets a separate
  Desktop/Dock/Start Menu entry and never changes the official Codex icon or package metadata.
- Windows installer: `ClawKit-{version}-windows-x64-setup.exe`
- macOS installers: `ClawKit-{version}-macos-{x64|arm64}.dmg`

Installer builds run on local macOS and the SSH-managed high-performance Windows
D-GM12JWEF-1416, using pinned commits, locked dependencies and the existing packaging scripts.
GitHub Actions installer builds are disabled; publishing a release no longer starts a build.
GitHub still hosts source and immutable release assets. The canonical publisher uploads
locally built installers to the existing backend using authorized local credentials. The backend
computes SHA-256 while uploading. The desktop updater rejects a downloaded installer when the
digest does not match the update manifest.

Windows releases are also signed with the long-lived Tauri updater key stored in GitHub Actions
secrets for historical builds; future local builds require the same authorized signing identity.
Missing local signing credentials must be resolved before publication, never bypassed. The publisher
uploads the installer before its matching `.sig` so the backend can atomically attach the signature.

The public installer is an integrated package: the CC Switch-derived shell is the main
`ClawKit Desktop` entry, while the Codex++ launcher remains an internal helper and the optional
settings manager is installed alongside it. No separate Codex-branded replacement is exposed.
Both layers read the same `~/.codex-session-delete/clawkit-account.json` session, so users
sign in once and never paste a gateway URL or API key.

Account login first follows the operating system's network and proxy settings. If the connection
or TLS handshake times out or fails before any HTTP response arrives, both desktop layers retry the
same ClawKit-owned HTTPS endpoint once without the system proxy. A second failure is reported as an
actionable timeout or network/DNS/TLS/proxy error instead of the former generic account-service
message. Invalid credentials and other HTTP responses are not retried.

The ClawKit release version is shared by the CC Switch shell and this fork so a freshly
installed bundle does not immediately report itself as older than the backend manifest.
The complete AGPL-3.0 source remains available at `github.com/hangvlog/CodexPlusPlus`.

The ClawKit Desktop shell must be built through `pnpm tauri build --no-bundle` (with the
matching `--target` on macOS). A plain `cargo build` can produce a runnable Tauri executable
whose WebView opens `about:blank` because the renderer asset metadata was not supplied by the
Tauri CLI. Both PR and release workflows run `scripts/installer/verify-tauri-frontend.py`
before packaging and fail unless the hashed JavaScript and CSS paths from `dist/index.html`
are embedded in the desktop executable.

Draft releases are resolved through the authenticated, paginated release inventory by exact tag.
GitHub's `releases/tags/{tag}` endpoint returns 404 for a draft even when the authenticated
inventory and `gh release view` can see it. Asset uploads preserve release metadata and reject
any existing filename whose size or digest differs. If a release upload fails after Actions
has archived the signed installers, recover those exact artifacts instead of rebuilding or
moving the immutable tag; record both the build commit and upload-recovery commit.

## Local build 3.19.41

Desktop shell source is hangvlog/cc-switch at f8adcc82 (file attachments); pin the full SHA in the build manifest before packaging. Build launcher/settings from this repository commit with pnpm 10.12.3 and Cargo locked dependencies. Use local macOS and managed enterprise Windows only. Original updater signing identity is still required before publication; unsigned build output is not a released update.
