# ClawKit Desktop release overlay

This fork keeps upstream Codex++ crate and executable names to make upstream rebases manageable.
Only public application names, bundle identifiers, installer filenames, update UI and release
distribution are branded as ClawKit Desktop.

- Update product: `clawkit-desktop`
- Default update API: `https://clawkit.chat`
- Runtime/build override: `CLAWKIT_UPDATE_API_URL`
- Windows bundle: `clawkit-desktop.exe`, `codex-plus-plus.exe`, and the settings manager
- macOS bundles: `ClawKit Desktop.app`, `ClawKit Codex.app`, `ClawKit Settings.app`
- Windows installer: `ClawKit-{version}-windows-x64-setup.exe`
- macOS installers: `ClawKit-{version}-macos-{x64|arm64}.dmg`

The release workflow uses pnpm and uploads installers to the existing backend when
`CLAWKIT_API_BASE` and `CLAWKIT_RELEASE_TOKEN` repository secrets are configured. The backend
computes SHA-256 while uploading. The desktop updater rejects a downloaded installer when the
digest does not match the update manifest.

The public installer is an integrated package: the CC Switch-derived shell is the main
`ClawKit Desktop` entry, while the Codex++ launcher and manager are installed alongside it.
Both layers read the same `~/.codex-session-delete/clawkit-account.json` session, so users
sign in once and never paste a gateway URL or API key.

The ClawKit release version is shared by the CC Switch shell and this fork so a freshly
installed bundle does not immediately report itself as older than the backend manifest.
The complete AGPL-3.0 source remains available at `github.com/hangvlog/CodexPlusPlus`.
