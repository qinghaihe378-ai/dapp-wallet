#!/usr/bin/env python3
"""从源图生成 Android mipmap 启动图标（中心裁切为正方形）。"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

# 默认：仓库内源图；也可用命令行第一个参数覆盖
DEFAULT_SRC = Path(__file__).resolve().parents[1] / "resources/app-icon-source.png"


def center_square(im: Image.Image) -> Image.Image:
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def corner_color_hex(im: Image.Image) -> str:
    px = im.load()
    w, h = im.size
    samples = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    r = sum(c[0] for c in samples) // len(samples)
    g = sum(c[1] for c in samples) // len(samples)
    b = sum(c[2] for c in samples) // len(samples)
    return f"#{r:02x}{g:02x}{b:02x}"


def resize_save(im: Image.Image, size: int, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.resize((size, size), Image.Resampling.LANCZOS)
    out.save(path, "PNG", optimize=True)


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_file():
        print(f"缺少源图: {src}", file=sys.stderr)
        return 1

    root = Path(__file__).resolve().parents[1]
    res = root / "android/app/src/main/res"

    im = Image.open(src).convert("RGB")
    sq = center_square(im)

    legacy = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    fg = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }

    for folder, size in legacy.items():
        base = res / folder
        resize_save(sq, size, base / "ic_launcher.png")
        resize_save(sq, size, base / "ic_launcher_round.png")
    for folder, size in fg.items():
        resize_save(sq, size, res / folder / "ic_launcher_foreground.png")

    bg_hex = corner_color_hex(sq)
    values_ic = res / "values/ic_launcher_background.xml"
    values_ic.write_text(
        f'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{bg_hex}</color>
</resources>
''',
        encoding="utf-8",
    )
    print(f"已写入 mipmap 图标，背景色 {bg_hex}（来自源图四角平均）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
