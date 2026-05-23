"""Platform helpers for local desktop actions."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def reveal_in_explorer(path: Path) -> None:
    """Open a Loom path in the host file manager."""
    resolved = path.expanduser().resolve()
    loom_root = (Path.home() / ".loom").resolve()
    try:
        resolved.relative_to(loom_root)
    except ValueError as exc:
        raise ValueError("Path is outside ~/.loom") from exc

    if not resolved.exists():
        raise FileNotFoundError(str(resolved))

    if sys.platform == "darwin":
        args = ["open", str(resolved)]
    elif sys.platform == "win32":
        args = ["explorer", str(resolved)]
    elif sys.platform.startswith("linux"):
        args = ["xdg-open", str(resolved)]
    else:
        raise RuntimeError(f"Unsupported platform: {sys.platform}")

    subprocess.run(args, check=True, shell=False)
