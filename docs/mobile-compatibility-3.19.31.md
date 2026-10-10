# ClawKit Desktop 3.19.31

Shell source: hangvlog/cc-switch commit c063593a129d18677a228bbbe14a3aef7badedbe

Remove exact Codex build gating; check IPC and operation protocols. Recognize the new composer placeholder. Add model catalog reading and owner model selection with read-back. Preserve message phase for the mobile reply UI. No changes to launcher execution or relay service.

Validated on Codex 26.1007.21159:20052: project creation, model change and continuation succeeded on a synthetic task. 11 bridge tests passed. Mobile companion version: 0.1.13.

Build with release-assets.yml from this commit. Rollback: retain Desktop 3.19.30 and Mobile 0.1.12 artifacts.
