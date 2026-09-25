#!/usr/bin/env python3
"""Run one case corpus against a reference and a candidate CLI through probe.py, then compare them.

  differential.py run CASES.json --reference 'tool' --candidate '/abs/path/new-tool' [--out DIR] [--only ID ...]
  differential.py compare [--out DIR] [--triage TRIAGE.json]

CASES.json is a list of {"id", "label", "args": [...], "probe": [probe.py options]}.
Seed paths in "probe" resolve relative to CASES.json. Commands run from the sandbox work/
directory under --isolate, so give the candidate as an absolute path or a PATH entry.

TRIAGE.json maps a case id to {"class": "EXPECTED_DIFFERENCE" | "REFERENCE_NONDETERMINISM", "reason": "..."}.
compare exits 1 while any case differs without triage, is missing from one side, or no records exist.
Unix only. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

SIDES = ("reference", "candidate")
FIELDS = ("exit_code", "signal", "timed_out", "stdout", "stderr", "fs_diff")
SANDBOX = "<SANDBOX>"
DEFAULT_PROBE = Path(__file__).resolve().parents[2] / "reverse-engineer-cli" / "scripts" / "probe.py"


def run(a: argparse.Namespace) -> int:
    cases_path = Path(a.cases).resolve()
    cases = json.loads(cases_path.read_text())
    if a.only:
        cases = [c for c in cases if c["id"] in a.only]
    out = Path(a.out).resolve()
    for case in cases:
        for side, prefix in (("reference", a.reference), ("candidate", a.candidate)):
            side_out = out / side
            shutil.rmtree(side_out / "sandboxes" / case["id"], ignore_errors=True)
            cmd = [sys.executable, str(a.probe), "--out", str(side_out), "--id", case["id"],
                   "--label", case.get("label", ""), *case.get("probe", []),
                   "--", *shlex.split(prefix), *case["args"]]
            done = subprocess.run(cmd, cwd=cases_path.parent, capture_output=True, text=True)
            if done.returncode != 0:
                sys.stderr.write(f"probe failed for {side} {case['id']}:\n{done.stderr}")
                return 2
            print(f"{side:9} {done.stdout.strip()}")
    return 0


def latest_records(path: Path) -> dict[str, dict]:
    records: dict[str, dict] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                records[rec["id"]] = rec
    return records


def observed(rec: dict) -> dict:
    # Each side runs in its own sandbox root by construction, so that root is the one normalized value.
    root = rec.get("sandbox")

    def stream(name: str) -> bytes:
        data = Path(rec[name]["path"]).read_bytes()
        return data.replace(root.encode(), SANDBOX.encode()) if root else data

    return {
        "exit_code": rec["exit_code"],
        "signal": rec["signal"],
        "timed_out": rec["timed_out"],
        "stdout": stream("stdout"),
        "stderr": stream("stderr"),
        "fs_diff": {(SANDBOX if k == root else k): v for k, v in rec["fs_diff"].items()},
    }


def describe(field: str, ref, cand) -> str:
    if isinstance(ref, bytes):
        i = next((n for n, (x, y) in enumerate(zip(ref, cand)) if x != y), min(len(ref), len(cand)))
        lo = max(i - 20, 0)
        return (f"{field}: first difference at byte {i} (reference {len(ref)} bytes, candidate {len(cand)} bytes)\n"
                f"      reference {ref[lo:i + 40]!r}\n      candidate {cand[lo:i + 40]!r}")
    if field == "fs_diff":
        lines = [f"{field}:"]
        for root in sorted(ref.keys() | cand.keys()):
            r, c = ref.get(root, {}), cand.get(root, {})
            for kind in ("created", "deleted", "modified"):
                rk, ck = r.get(kind, {}), c.get(kind, {})
                for p in sorted(rk.keys() | ck.keys()):
                    if rk.get(p) != ck.get(p):
                        lines.append(f"      {kind} {root}/{p}: reference {rk.get(p)} candidate {ck.get(p)}")
        return "\n".join(lines)
    return f"{field}: reference {ref!r} candidate {cand!r}"


def compare(a: argparse.Namespace) -> int:
    out = Path(a.out).resolve()
    ref, cand = (latest_records(out / side / "probes.jsonl") for side in SIDES)
    triage = json.loads(Path(a.triage).read_text()) if a.triage else {}
    counts = {k: 0 for k in ("MATCH", "EXPECTED_DIFFERENCE", "REFERENCE_NONDETERMINISM", "UNCLASSIFIED", "MISSING")}

    for cid in sorted(ref.keys() | cand.keys()):
        if cid not in ref or cid not in cand:
            counts["MISSING"] += 1
            print(f"MISSING {cid}: no {'candidate' if cid in ref else 'reference'} record")
            continue
        r, c = observed(ref[cid]), observed(cand[cid])
        diffs = [f for f in FIELDS if r[f] != c[f]]
        entry = triage.get(cid)
        if not diffs:
            counts["MATCH"] += 1
            print(f"MATCH {cid}" + (" (stale triage entry, remove it)" if entry else ""))
            continue
        status = entry["class"] if entry else "UNCLASSIFIED"
        counts[status] += 1
        print(f"{status} {cid}: {', '.join(diffs)}" + (f" ({entry['reason']})" if entry else ""))
        for f in diffs:
            print("    " + describe(f, r[f], c[f]))

    print(f"\nCASES {sum(counts.values())}  " + "  ".join(f"{k} {v}" for k, v in counts.items()))
    return 1 if counts["UNCLASSIFIED"] or counts["MISSING"] or not (ref or cand) else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="run every case against both CLIs")
    r.add_argument("cases")
    r.add_argument("--reference", required=True, help="reference command prefix, shell-split")
    r.add_argument("--candidate", required=True, help="candidate command prefix, shell-split")
    r.add_argument("--only", nargs="+", help="run only these case ids")
    r.add_argument("--probe", type=Path, default=DEFAULT_PROBE, help=f"probe.py path (default {DEFAULT_PROBE})")
    c = sub.add_parser("compare", help="compare the latest record per case id")
    c.add_argument("--triage", help="TRIAGE.json classifying explained differences")
    for p in (r, c):
        p.add_argument("--out", default="re/90_impl/differential", help="output directory")
    a = ap.parse_args()
    return run(a) if a.command == "run" else compare(a)


if __name__ == "__main__":
    sys.exit(main())
