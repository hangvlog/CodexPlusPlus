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

The release workflow uses pnpm and uploads installers to the existing backend when
`CLAWKIT_API_BASE` and `CLAWKIT_RELEASE_TOKEN` repository secrets are configured. The backend
computes SHA-256 while uploading. The desktop updater rejects a downloaded installer when the
digest does not match the update manifest.

Windows releases are also signed with the long-lived Tauri updater key stored in GitHub Actions
secrets. The workflow fails if the signing or backend publishing configuration is missing, and it
uploads the installer before its matching `.sig` so the backend can atomically attach the signature.

The public installer is an integrated package: the CC Switch-derived shell is the main
`ClawKit Desktop` entry, while the Codex++ launcher remains an internal helper and the optional
settings manager is installed alongside it. No separate Codex-branded replacement is exposed.
Both layers read the same `~/.codex-session-delete/clawkit-account.json` session, so users
sign in once and never paste a gateway URL or API key.

The ClawKit release version is shared by the CC Switch shell and this fork so a freshly
installed bundle does not immediately report itself as older than the backend manifest.
The complete AGPL-3.0 source remains available at `github.com/hangvlog/CodexPlusPlus`.

The ClawKit Desktop shell must be built through `pnpm tauri build --no-bundle` (with the
matching `--target` on macOS). A plain `cargo build` can produce a runnable Tauri executable
whose WebView opens `about:blank` because the renderer asset metadata was not supplied by the
Tauri CLI. Both PR and release workflows run `scripts/installer/verify-tauri-frontend.py`
before packaging and fail unless the hashed JavaScript and CSS paths from `dist/index.html`
are embedded in the desktop executable.
