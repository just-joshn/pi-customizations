#!/usr/bin/env python3
"""Run one case corpus against a reference and a candidate CLI through probe.py, then compare them.

  differential.py run CASES.json --reference 'tool' --candidate '/abs/path/new-tool' [--out DIR] [--only ID ...]
  differential.py compare [--out DIR] [--triage TRIAGE.json]

CASES.json is a list of {"id", "label", "args": [...], "probe": [probe.py options]}.
Seed paths in "probe" resolve relative to CASES.json. Commands run from the sandbox work/
directory under --isolate, so give the candidate as an absolute path or a PATH entry.

TRIAGE.json maps a case id to {"class": <accepted>, "reason": "..."}.
Accepted classes: INTENTIONAL_CHANGE, NONDETERMINISM, and aliases EXPECTED_DIFFERENCE,
REFERENCE_NONDETERMINISM. compare exits 1 while any case differs without triage, is missing
from one side, or no records exist. Unix only. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

SIDES = ("reference", "candidate")
FIELDS = ("exit_code", "signal", "timed_out", "stdout", "stderr", "fs_diff")
SANDBOX = "<SANDBOX>"
DEFAULT_PROBE = Path(__file__).resolve().parents[2] / "reverse-engineer-cli" / "scripts" / "probe.py"
DEFAULT_OUT = ".re/impl/differential"
# Standing differences allowed in triage.json. Aliases keep older packets working.
TRIAGE_CANONICAL = {
    "INTENTIONAL_CHANGE": "INTENTIONAL_CHANGE",
    "EXPECTED_DIFFERENCE": "INTENTIONAL_CHANGE",
    "NONDETERMINISM": "NONDETERMINISM",
    "REFERENCE_NONDETERMINISM": "NONDETERMINISM",
}
PROBE_FLAGS = frozenset({"--isolate", "--clean-env"})
PROBE_VALUES = frozenset({"--cwd", "--seed", "--env", "--unset", "--stdin-text", "--stdin-file",
                          "--stdin-mode", "--tty", "--cols", "--rows", "--snapshot", "--timeout",
                          "--send-signal", "--after"})


def string_list(value: object, field: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and "\0" not in item for item in value):
        raise ValueError(f"{field} must be an array of strings without NUL bytes")
    return value


def validate_probe(options: list[str]) -> None:
    index = 0
    while index < len(options):
        option, separator, _ = options[index].partition("=")
        if option in PROBE_FLAGS and not separator:
            index += 1
        elif option in PROBE_VALUES:
            if not separator and (index + 1 == len(options) or options[index + 1].startswith("--")):
                raise ValueError(f"probe option {option} requires a value")
            index += 1 if separator else 2
        else:
            raise ValueError(f"unsupported probe option {option}; record identity and output are managed by differential")


def validate_cases(value: object) -> list[dict]:
    if not isinstance(value, list) or not value:
        raise ValueError("cases must be a nonempty array")
    for case in value:
        if not isinstance(case, dict):
            raise ValueError("each case must be an object")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", case_id):
            raise ValueError("case id must be a safe file component")
        string_list(case.get("args"), "args")
        label = case.get("label", "")
        if not isinstance(label, str) or "\0" in label:
            raise ValueError("label must be a string without NUL bytes")
        validate_probe(string_list(case.get("probe", []), "probe"))
    if len({case["id"] for case in value}) != len(value):
        raise ValueError("case ids must be unique")
    return value


def validate_output(out: Path) -> None:
    for side in SIDES:
        for suffix in ("", "raw", "sandboxes", "probes.jsonl"):
            path = out / side / suffix
            if path.is_symlink():
                raise ValueError("differential output paths must not be symbolic links")


def run(a: argparse.Namespace) -> int:
    cases_path = Path(a.cases).resolve()
    cases = validate_cases(json.loads(cases_path.read_text()))
    if a.only:
        if set(a.only) - {case["id"] for case in cases}:
            raise ValueError("--only contains an unknown case id")
        cases = [c for c in cases if c["id"] in a.only]
    out = Path(a.out).resolve()
    prefixes = tuple((side, shlex.split(prefix)) for side, prefix in
                     (("reference", a.reference), ("candidate", a.candidate)))
    if any(not prefix for _, prefix in prefixes):
        raise ValueError("reference and candidate commands must not be empty")
    validate_output(out)
    for case in cases:
        for side, prefix in prefixes:
            validate_output(out)
            side_out = out / side
            cmd = [sys.executable, str(a.probe), "--out", str(side_out), "--id", case["id"],
                   "--label", case.get("label", ""), *case.get("probe", []),
                   "--", *prefix, *case["args"]]
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
                rec = validate_record(json.loads(line))
                records[rec["id"]] = rec
    return records


def validate_record(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"]:
        raise ValueError("probe record must be an object with a nonempty string id")
    if not all(field in value for field in FIELDS):
        raise ValueError("probe record is missing required observation fields")
    if value.get("launch_error") is not None:
        raise ValueError("probe launch failed; comparison requires an executed target")
    if value.get("capture_complete", True) is not True:
        raise ValueError("probe capture is incomplete; comparison requires complete output")
    if value["exit_code"] is not None and type(value["exit_code"]) is not int:
        raise ValueError("probe exit_code must be an integer or null")
    if value["signal"] is not None and not isinstance(value["signal"], str):
        raise ValueError("probe signal must be a string or null")
    if not isinstance(value["timed_out"], bool):
        raise ValueError("probe timed_out must be a boolean")
    if value.get("sandbox") is not None and not isinstance(value["sandbox"], str):
        raise ValueError("probe sandbox must be a string or null")
    for field in ("stdout", "stderr"):
        stream = value[field]
        if not isinstance(stream, dict) or not isinstance(stream.get("path"), str) or not stream["path"]:
            raise ValueError(f"probe {field} must contain a nonempty string path")
    validate_fs_diff(value["fs_diff"])
    return value


def validate_fs_diff(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("probe fs_diff must be an object")
    for changes in value.values():
        if not isinstance(changes, dict) or any(not isinstance(changes.get(kind, {}), dict)
                                               for kind in ("created", "deleted", "modified")):
            raise ValueError("probe filesystem changes must contain created/deleted/modified objects")


def validate_triage(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("triage must be an object keyed by case id")
    for entry in value.values():
        if not isinstance(entry, dict) or any(not isinstance(entry.get(field), str) or not entry[field].strip()
                                             for field in ("class", "reason")):
            raise ValueError("triage entries must contain nonempty string class and reason fields")
    return value


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


def describe_filesystem(ref: dict, cand: dict) -> str:
    lines = ["fs_diff:"]
    for root in sorted(ref.keys() | cand.keys()):
        r, c = ref.get(root, {}), cand.get(root, {})
        for kind in ("created", "deleted", "modified"):
            rk, ck = r.get(kind, {}), c.get(kind, {})
            for path in sorted(rk.keys() | ck.keys()):
                if rk.get(path) != ck.get(path):
                    lines.append(f"      {kind} {root}/{path}: reference {rk.get(path)} candidate {ck.get(path)}")
    return "\n".join(lines)


def describe(field: str, ref, cand) -> str:
    if isinstance(ref, bytes):
        i = next((n for n, (x, y) in enumerate(zip(ref, cand)) if x != y), min(len(ref), len(cand)))
        lo = max(i - 20, 0)
        return (f"{field}: first difference at byte {i} (reference {len(ref)} bytes, candidate {len(cand)} bytes)\n"
                f"      reference {ref[lo:i + 40]!r}\n      candidate {cand[lo:i + 40]!r}")
    if field == "fs_diff":
        return describe_filesystem(ref, cand)
    return f"{field}: reference {ref!r} candidate {cand!r}"


def compare(a: argparse.Namespace) -> int:
    out = Path(a.out).resolve()
    ref, cand = (latest_records(out / side / "probes.jsonl") for side in SIDES)
    triage = validate_triage(json.loads(Path(a.triage).read_text())) if a.triage else {}
    counts = {k: 0 for k in ("MATCH", "INTENTIONAL_CHANGE", "NONDETERMINISM", "UNCLASSIFIED", "MISSING")}

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
        raw = entry["class"] if entry else "UNCLASSIFIED"
        status = TRIAGE_CANONICAL.get(raw, "UNCLASSIFIED") if entry else "UNCLASSIFIED"
        if entry and raw not in TRIAGE_CANONICAL:
            print(f"UNCLASSIFIED {cid}: triage class {raw!r} is not accepted; use "
                  f"{', '.join(sorted(set(TRIAGE_CANONICAL)))}")
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
        p.add_argument("--out", default=DEFAULT_OUT, help="output directory")
    a = ap.parse_args()
    try:
        return run(a) if a.command == "run" else compare(a)
    except (OSError, ValueError) as error:
        sys.stderr.write(f"differential: {error}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
