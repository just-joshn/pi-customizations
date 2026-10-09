#!/usr/bin/env python3
"""Re-verify wave-007 live inventory sha256. Exit 0 on match."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
EXPECTED = "63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4"


def main() -> int:
    actual = hashlib.sha256(INVENTORY.read_bytes()).hexdigest()
    ok = actual == EXPECTED
    print(
        json.dumps(
            {
                "path": str(INVENTORY.relative_to(ROOT)),
                "expected": EXPECTED,
                "actual": actual,
                "verified": ok,
            },
            indent=2,
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
