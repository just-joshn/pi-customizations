#!/usr/bin/env python3
"""Re-check sample-sha256.txt against on-disk fetched bodies."""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

WAVE = Path(__file__).resolve().parent
SAMPLE = WAVE / "sample-sha256.txt"
REPO = WAVE.parents[2]


def main() -> int:
    proc = subprocess.run(
        ["shasum", "-a", "256", "-c", str(SAMPLE.relative_to(REPO))],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        return proc.returncode

    # Independent python re-hash of the same sample lines.
    for line in SAMPLE.read_text().splitlines():
        if not line.strip():
            continue
        digest, rel_path = line.split("  ", 1)
        data = (REPO / rel_path).read_bytes()
        got = hashlib.sha256(data).hexdigest()
        if got != digest:
            print(f"MISMATCH {rel_path}: expected {digest} got {got}", file=sys.stderr)
            return 1
        print(f"PYTHON_OK {rel_path}")
    print("VERIFIED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
