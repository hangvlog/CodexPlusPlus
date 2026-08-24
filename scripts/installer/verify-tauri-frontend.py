#!/usr/bin/env python3
"""Fail a release build when its Tauri shell omitted the renderer assets."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ASSET_PATTERN = re.compile(r'(?:src|href)=["\']\.?(/assets/[^"\']+\.(?:js|css))["\']')


def embedded_assets(index_path: Path) -> list[str]:
    index_html = index_path.read_text(encoding="utf-8")
    assets = list(dict.fromkeys(ASSET_PATTERN.findall(index_html)))
    if not any(asset.endswith(".js") for asset in assets):
        raise SystemExit(f"no JavaScript asset found in {index_path}")
    return assets


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("index", type=Path)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()

    assets = embedded_assets(args.index)
    binary = args.binary.read_bytes()
    missing = [asset for asset in assets if asset.encode("utf-8") not in binary]
    if missing:
        formatted = ", ".join(missing)
        raise SystemExit(
            f"{args.binary} does not embed renderer asset paths: {formatted}. "
            "Build the shell through the Tauri CLI, not plain cargo build."
        )

    print(f"verified {len(assets)} embedded renderer assets in {args.binary}")


if __name__ == "__main__":
    main()
