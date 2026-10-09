#!/usr/bin/env python3
"""Rerun inventory hash check with shasum -a 256. Exit 1 on mismatch."""
import json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
inv = json.loads((Path(__file__).parent / "read-inventory.json").read_text())
bad = 0
for n in inv["nodes"]:
    for s in n["sourcesRead"]:
        path = Path(s["absolutePath"])
        if not path.exists():
            path = ROOT / s["path"]
        out = subprocess.check_output(["shasum", "-a", "256", str(path)], text=True).split()[0]
        if out != s["sha256"]:
            print(f"MISMATCH {n['nodeId']} {path}")
            bad += 1
        else:
            print(f"OK {n['nodeId']} {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
print("VERIFIED" if bad == 0 else f"NOT VERIFIED ({bad})")
sys.exit(0 if bad == 0 else 1)
