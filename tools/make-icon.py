from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.html"
PNG_OUT = ROOT / "build" / "icon.png"
ICO_OUT = ROOT / "build" / "icon.ico"
SIZE = 1024
ICO_SIZES = [(size, size) for size in (16, 24, 32, 48, 64, 128, 256)]

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

def find_browser() -> str:
    for candidate in BROWSERS:
        if Path(candidate).exists():
            return candidate
    raise SystemExit("no Edge or Chrome found to render the icon")

def render(browser: str, destination: Path) -> None:
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--default-background-color=00000000",
                f"--user-data-dir={profile}",
                f"--window-size={SIZE},{SIZE}",
                f"--screenshot={destination}",
                SOURCE.as_uri(),
            ],
            check=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

def main() -> int:
    if not SOURCE.exists():
        raise SystemExit(f"missing {SOURCE}")

    with tempfile.TemporaryDirectory() as staging:
        shot = Path(staging) / "icon.png"
        render(find_browser(), shot)
        if not shot.exists():
            raise SystemExit("the browser produced no screenshot")
        shutil.copyfile(shot, PNG_OUT)

    image = Image.open(PNG_OUT).convert("RGBA")
    image.save(ICO_OUT, format="ICO", sizes=ICO_SIZES)

    print(f"icon.png  {image.size[0]}x{image.size[1]}")
    print(f"icon.ico  {', '.join(str(size[0]) for size in ICO_SIZES)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
