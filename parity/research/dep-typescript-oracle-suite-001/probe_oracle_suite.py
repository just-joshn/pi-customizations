#!/usr/bin/env python3
"""Rerun typescript@7.0.2 compiler-test oracle checks for u-dep-typescript-oracle-suite-001."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WAVE9 = ROOT / "parity/research/dep-closure-wave-009/npm/typescript-deep-semantics-disposition.json"
TS_ROOT = (
    ROOT
    / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/node_modules/typescript"
)
GO_ROOT = OUT / "go-fetch/typescript-go-2bd066d87f5bafd315be9f40889d0a60b9e58e0b"
BUILT = GO_ROOT / "_packages/native-preview"
PIN_SHA = "2bd066d87f5bafd315be9f40889d0a60b9e58e0b"
MAPCODE = GO_ROOT / "_submodules/TypeScript/src/services/mapCode.ts"
MAPCODE_URL = (
    "https://raw.githubusercontent.com/microsoft/TypeScript/"
    "4d4f005c8541e0255a9d8791205fdce326e462bc/src/services/mapCode.ts"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> dict:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=merged)
    return {
        "command": cmd,
        "cwd": str(cwd.relative_to(ROOT)) if cwd.is_relative_to(ROOT) else str(cwd),
        "exitCode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def compare_136() -> dict:
    wave9 = json.loads(WAVE9.read_text())
    rows = []
    built_match = 0
    catalog_pub_drift = 0
    for entry in wave9["files"]:
        rel = entry["path"]
        local_rel = rel[len("package/") :] if rel.startswith("package/") else rel
        expected = entry["sha256"]
        pub = TS_ROOT / local_rel
        built = BUILT / local_rel
        row = {
            "path": rel,
            "catalogSha256": expected,
            "publishedPresent": pub.is_file(),
            "builtPresent": built.is_file(),
        }
        if pub.is_file():
            pub_h = sha256_file(pub)
            row["publishedSha256"] = pub_h
            row["publishedMatchesCatalog"] = pub_h == expected
            if pub_h != expected:
                catalog_pub_drift += 1
        else:
            row["publishedMatchesCatalog"] = False
        if built.is_file():
            built_h = sha256_file(built)
            row["builtSha256"] = built_h
            row["builtMatchesCatalog"] = built_h == expected
            row["builtMatchesPublished"] = bool(
                pub.is_file() and built_h == row.get("publishedSha256")
            )
            if row["builtMatchesPublished"]:
                built_match += 1
        else:
            row["builtMatchesCatalog"] = False
            row["builtMatchesPublished"] = False
        rows.append(row)
    summary = {
        "catalogCount": len(wave9["files"]),
        "builtMatchesPublishedCount": built_match,
        "catalogVsPublishedDriftCount": catalog_pub_drift,
        "builtPresentCount": sum(1 for r in rows if r["builtPresent"]),
        "publishedPresentCount": sum(1 for r in rows if r["publishedPresent"]),
    }
    payload = {"summary": summary, "files": rows}
    (OUT / "built-vs-published-136.json").write_text(json.dumps(payload, indent=2) + "\n")
    return summary


def ensure_mapcode() -> dict:
    if MAPCODE.is_file() and MAPCODE.stat().st_size > 0:
        return {
            "action": "present",
            "path": str(MAPCODE.relative_to(ROOT)),
            "sha256": sha256_file(MAPCODE),
            "byteLength": MAPCODE.stat().st_size,
        }
    MAPCODE.parent.mkdir(parents=True, exist_ok=True)
    fetch = run(["curl", "-fsSL", "-o", str(MAPCODE), MAPCODE_URL], OUT)
    return {
        "action": "fetched",
        "url": MAPCODE_URL,
        "submoduleCommit": "4d4f005c8541e0255a9d8791205fdce326e462bc",
        "curlExit": fetch["exitCode"],
        "path": str(MAPCODE.relative_to(ROOT)),
        "sha256": sha256_file(MAPCODE) if MAPCODE.is_file() else None,
        "byteLength": MAPCODE.stat().st_size if MAPCODE.is_file() else 0,
    }


def main() -> None:
    captured_at = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    pkg = json.loads((TS_ROOT / "package.json").read_text())
    pin_ok = pkg.get("gitHead") == PIN_SHA
    mapcode = ensure_mapcode()

    runs_dir = OUT / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    log_path = runs_dir / "test-api-verify.log"
    env = {"PATH": f"{Path.home()}/.local/share/mise/shims:" + os.environ.get("PATH", "")}
    test_run = run(["npx", "hereby", "test:api"], GO_ROOT, env=env)
    log_path.write_text(
        test_run["stdout"] + ("\n" + test_run["stderr"] if test_run["stderr"] else "")
    )
    log_sha = sha256_file(log_path)

    stdout = test_run["stdout"]
    pass_count = None
    test_count = None
    fail_count = None
    for line in stdout.splitlines():
        if line.startswith("ℹ tests "):
            test_count = int(line.split()[-1])
        elif line.startswith("ℹ pass "):
            pass_count = int(line.split()[-1])
        elif line.startswith("ℹ fail "):
            fail_count = int(line.split()[-1])

    compare = compare_136()
    closed = (
        pin_ok
        and test_run["exitCode"] == 0
        and fail_count == 0
        and pass_count is not None
        and pass_count == test_count
        and compare["builtMatchesPublishedCount"] == 136
        and compare["catalogVsPublishedDriftCount"] == 0
        and "Skipping astnav tests" not in stdout
    )

    disposition = {
        "schemaVersion": 1,
        "unit": "u-dep-typescript-oracle-suite-001",
        "capturedAt": captured_at,
        "package": "typescript@7.0.2",
        "deepCompilerSemanticsStatus": "closed_with_oracle" if closed else "still_open",
        "verdict": "closed-with-oracle" if closed else "still-open",
        "pin": {
            "repo": "https://github.com/microsoft/typescript-go",
            "sha": PIN_SHA,
            "source": "npm typescript@7.0.2 package.json gitHead",
            "packageGitHeadMatches": pin_ok,
            "note": (
                "microsoft/TypeScript tag v7.0.2 is not the semantic pin. "
                "That archive's package.json version is 6.0.0. "
                "gitHead resolves on microsoft/typescript-go only."
            ),
        },
        "oracle": {
            "suite": "hereby test:api",
            "cwd": str(GO_ROOT.relative_to(ROOT)),
            "exitCode": test_run["exitCode"],
            "tests": test_count,
            "pass": pass_count,
            "fail": fail_count,
            "logPath": str(log_path.relative_to(ROOT)),
            "logSha256": log_sha,
            "mapCode": mapcode,
            "covers": (
                "JS API tests for dist/ast, dist/enums, dist/internal "
                "(unstable AST/enum/helper contracts)"
            ),
            "notRun": "hereby test (full Go conformance against TypeScript submodule cases)",
        },
        "builtVsPublished136": compare,
        "honesty": {
            "npmPackageShipsNoTests": True,
            "consumerTypecheckIsNotDeepSemantics": True,
            "catalogHashAloneIsNotDeepSemantics": True,
            "oracleIsPinnedTypescriptGoTestApi": True,
            "builtDistByteIdenticalToPublished136": compare["builtMatchesPublishedCount"]
            == 136,
            "doNotClaim": [
                "full hereby test Go conformance suite was run",
                "microsoft/TypeScript tag v7.0.2 package.json version 7.0.2",
                "closure from consumer typecheck alone",
            ],
        },
        "removeUnresolvedReference": closed,
        "blocker": None
        if closed
        else (
            "Oracle did not meet closed predicate "
            "(pin match, test:api exit 0 with astnav, 136/136 built==published)."
        ),
    }

    (OUT / "disposition.json").write_text(json.dumps(disposition, indent=2) + "\n")
    disp_sha = sha256_file(OUT / "disposition.json")

    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-typescript-oracle-suite-001",
        "status": "proposal",
        "createdAt": captured_at,
        "verdict": disposition["verdict"],
        "mergePayloadReady": True,
        "deepCompilerSemanticsStatus": disposition["deepCompilerSemanticsStatus"],
        "targets": {"dependenciesJson": "parity/dependencies.json"},
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": (
            "Other unresolvedReferences may remain. Only typescript deep-semantics "
            "line is addressed by this payload."
        ),
        "resolvedReferenceCount": 1 if closed else 0,
        "resolvedEdgeCount": 0,
        "removeUnresolvedReference": closed,
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "npm:typescript@7.0.2",
                    "appendReadingEvidence": [
                        "parity/research/dep-typescript-oracle-suite-001/disposition.json",
                        "parity/research/dep-typescript-oracle-suite-001/merge-payload.json",
                        "parity/research/dep-typescript-oracle-suite-001/built-vs-published-136.json",
                        "parity/briefs/reports/u-dep-typescript-oracle-suite-001-report.md",
                    ],
                    "set": {
                        "deepCompilerSemanticsStatus": disposition[
                            "deepCompilerSemanticsStatus"
                        ],
                        "waveOracleSuite001Disposition": (
                            "u-dep-typescript-oracle-suite-001 closed-with-oracle. "
                            f"Pinned microsoft/typescript-go@{PIN_SHA} (= npm gitHead). "
                            "hereby test:api "
                            f"{pass_count}/{test_count} pass exit {test_run['exitCode']}. "
                            "Built dist matches published catalog 136/136 "
                            f"(disposition sha256 {disp_sha})."
                            if closed
                            else disposition["blocker"]
                        ),
                    },
                    "evidence": [
                        "parity/research/dep-typescript-oracle-suite-001/disposition.json"
                    ],
                }
            ],
            "unresolvedReferences": {
                "removeIfPresent": [
                    {
                        "matchContains": "npm:typescript@7.0.2 deep compiler-behavior semantics",
                        "reason": (
                            "Pinned typescript-go test:api oracle with 136/136 "
                            "built==published path+hash evidence."
                            if closed
                            else "Do not remove; oracle closed predicate failed."
                        ),
                    }
                ]
                if closed
                else [],
                "keepAndRefresh": []
                if closed
                else [
                    {
                        "matchContains": "npm:typescript@7.0.2 deep compiler-behavior semantics",
                        "replacement": (
                            "npm:typescript@7.0.2 deep compiler-behavior semantics remain open "
                            "after u-dep-typescript-oracle-suite-001 at "
                            f"parity/research/dep-typescript-oracle-suite-001/disposition.json "
                            f"(sha256 {disp_sha}; {disposition['blocker']})."
                        ),
                    }
                ],
                "add": [],
                "note": (
                    "Remove the typescript deep compiler-behavior unresolvedReference."
                    if closed
                    else "Keep the typescript deep compiler-behavior unresolvedReference."
                ),
            },
        },
        "dispositionSha256": disp_sha,
        "fullProposal": "parity/research/dep-typescript-oracle-suite-001/merge-payload.json",
    }
    (OUT / "merge-payload.json").write_text(json.dumps(merge, indent=2) + "\n")
    merge_sha = sha256_file(OUT / "merge-payload.json")

    verify = {
        "capturedAt": captured_at,
        "verdict": disposition["verdict"],
        "removeUnresolvedReference": closed,
        "pinOk": pin_ok,
        "testApiExit": test_run["exitCode"],
        "tests": test_count,
        "pass": pass_count,
        "fail": fail_count,
        "builtMatchesPublishedCount": compare["builtMatchesPublishedCount"],
        "catalogVsPublishedDriftCount": compare["catalogVsPublishedDriftCount"],
        "dispositionSha256": disp_sha,
        "mergePayloadSha256": merge_sha,
        "testApiLogSha256": log_sha,
        "astnavSkipped": "Skipping astnav tests" in stdout,
    }
    (OUT / "verify-hashes.json").write_text(json.dumps(verify, indent=2) + "\n")
    print(json.dumps(verify, indent=2))


if __name__ == "__main__":
    main()
