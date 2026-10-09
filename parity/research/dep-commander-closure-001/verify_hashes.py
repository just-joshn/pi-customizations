#!/usr/bin/env python3
"""Re-verify commander@14.0.0 tarball, inventory files, and consumers. Exit 1 on mismatch."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REF = ROOT / "parity/reference/npm/commander-14.0.0"
UNPACKED = REF / "unpacked/package"
INV_PATH = ROOT / "parity/research/npm/commander-14.0.0/read-inventory.json"
CURSOR = ROOT / "parity/reference/cursor-plugins"
OUT_DIR = Path(__file__).resolve().parent

EXPECTED_TARBALL_SHA256 = "eaef3a697e7173c7347ca4c1e60dd2bc1d38214d2aaecce89d70881a51d7fde7"


def sha256_file(path: Path) -> str:
    return subprocess.check_output(["shasum", "-a", "256", str(path)], text=True).split()[0]


def main() -> int:
    inv = json.loads(INV_PATH.read_text())
    rows: list[dict] = []
    bad = 0

    tarball = REF / "package.tgz"
    got_tarball = sha256_file(tarball)
    tarball_ok = got_tarball == EXPECTED_TARBALL_SHA256 == inv["tarballSha256FromReceipt"]
    rows.append(
        {
            "kind": "tarball",
            "path": str(tarball.relative_to(ROOT)),
            "expected": EXPECTED_TARBALL_SHA256,
            "actual": got_tarball,
            "ok": tarball_ok,
        }
    )
    if not tarball_ok:
        bad += 1
        print(f"MISMATCH tarball {got_tarball}")
    else:
        print(f"OK tarball {got_tarball}")

    for entry in inv["files"]:
        rel = entry["path"]
        path = UNPACKED / rel
        actual = sha256_file(path)
        ok = actual == entry["sha256"]
        rows.append(
            {
                "kind": "package-file",
                "path": str(path.relative_to(ROOT)),
                "inventoryPath": rel,
                "expected": entry["sha256"],
                "actual": actual,
                "ok": ok,
            }
        )
        if not ok:
            bad += 1
            print(f"MISMATCH {rel} expected={entry['sha256']} actual={actual}")
        else:
            print(f"OK {rel} {actual}")

    for entry in inv["consumers"]:
        rel = entry["path"]
        path = CURSOR / rel
        actual = sha256_file(path)
        ok = actual == entry["sha256"]
        rows.append(
            {
                "kind": "consumer",
                "path": str(path.relative_to(ROOT)),
                "inventoryPath": rel,
                "expected": entry["sha256"],
                "actual": actual,
                "ok": ok,
            }
        )
        if not ok:
            bad += 1
            print(f"MISMATCH consumer {rel} expected={entry['sha256']} actual={actual}")
        else:
            print(f"OK consumer {rel} {actual}")

    for name, expected in inv.get("metadataSha256", {}).items():
        path = REF / name
        actual = sha256_file(path)
        ok = actual == expected
        rows.append(
            {
                "kind": "metadata",
                "path": str(path.relative_to(ROOT)),
                "expected": expected,
                "actual": actual,
                "ok": ok,
            }
        )
        if not ok:
            bad += 1
            print(f"MISMATCH metadata {name}")
        else:
            print(f"OK metadata {name} {actual}")

    inventory_sha = sha256_file(INV_PATH)
    summary = {
        "status": "VERIFIED" if bad == 0 else "NOT_VERIFIED",
        "mismatchCount": bad,
        "inventorySha256": inventory_sha,
        "inventoryPath": str(INV_PATH.relative_to(ROOT)),
        "tarballSha256": got_tarball,
        "fileCount": len(inv["files"]),
        "consumerCount": len(inv["consumers"]),
        "rows": rows,
    }
    out_json = OUT_DIR / "hash-verify.json"
    out_json.write_text(json.dumps(summary, indent=2) + "\n")
    checklist = OUT_DIR / "hash-verify.shasum.txt"
    lines = []
    for row in rows:
        lines.append(f"{row['actual']}  {row['path']}")
    checklist.write_text("\n".join(lines) + "\n")
    print(f"inventory_sha256 {inventory_sha}")
    print(summary["status"] if bad == 0 else f"NOT VERIFIED ({bad})")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
