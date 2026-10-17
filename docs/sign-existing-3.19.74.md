# 3.19.74 signature recovery

The user authorized a one-time GitHub signing exception on 2026-10-17. This workflow signs the existing HANG-built Windows installer, source `282148d0eee422e0121eab2db746f4c272e36553`, SHA-256 `0912b6d0d18d4da2282f0172d42f5c42dcc45b018c9b436036e84c18a4c86ebd`.

It verifies the fixed download digest, uses the original repository signing secrets, verifies the detached signature against the exact shipped public key, rechecks unchanged installer bytes, and returns only the public `.sig` artifact. No application compilation, installer upload to GitHub, GitHub Release creation, or private-key export is performed. Disable the workflow after signature retrieval. The default local/controlled-host build and signing rule remains in force for future releases.
