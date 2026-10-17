# 3.19.74 signature recovery

The user authorized a one-time GitHub signing exception on 2026-10-17. This workflow signs the existing HANG-built Windows installer, source `282148d0eee422e0121eab2db746f4c272e36553`, SHA-256 `0912b6d0d18d4da2282f0172d42f5c42dcc45b018c9b436036e84c18a4c86ebd`.

It verifies the fixed download digest, uses the original repository signing secrets, verifies the detached signature against the exact shipped public key, rechecks unchanged installer bytes, and returns only the public `.sig` artifact. No application compilation, installer upload to GitHub, GitHub Release creation, or private-key export is performed. Disable the workflow after signature retrieval. The default local/controlled-host build and signing rule remains in force for future releases.

Signing completed successfully in run https://github.com/hangvlog/CodexPlusPlus/actions/runs/39021883724 on 2026-10-17. Signature-only artifact SHA-256: `2e45e84abe5cc242a80436ffb621ab68d2f9a2f4ed5e0f51ccdd881832ea9345`. Reverification on HANG passed against the unchanged installer and original embedded public key. The signature was attached to draft release134. The signing workflow and all legacy build/publish workflows are disabled. No 3.19.75 signing is authorized by this 3.19.74 exception.
