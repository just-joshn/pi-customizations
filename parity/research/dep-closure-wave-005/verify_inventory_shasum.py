#!/usr/bin/env python3
"""Rerun inventory hash check with shasum -a 256. Exit 1 on mismatch."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
inv = json.loads((Path(__file__).parent / "read-inventory.json").read_text())
bad = 0
for src in inv["allSources"]:
    path = Path(src["absolutePath"])
    if not path.exists():
        path = ROOT / src["path"]
    out = subprocess.check_output(["shasum", "-a", "256", str(path)], text=True).split()[0]
    if out != src["sha256"]:
        print(f"MISMATCH {src['id']} {path}")
        bad += 1
    else:
        try:
            shown = path.relative_to(ROOT)
        except ValueError:
            shown = path
        print(f"OK {src['id']} {shown}")
print("VERIFIED" if bad == 0 else f"NOT VERIFIED ({bad})")
sys.exit(0 if bad == 0 else 1)
