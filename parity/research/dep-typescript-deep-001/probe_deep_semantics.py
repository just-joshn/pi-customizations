#!/usr/bin/env python3
"""Rerun typescript@7.0.2 deep-semantics honesty disposition for u-dep-typescript-deep-001."""

from __future__ import annotations

import datetime
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WAVE9 = ROOT / "parity/research/dep-closure-wave-009/npm/typescript-deep-semantics-disposition.json"
ORACLE = ROOT / "parity/research/dep-typescript-oracle-001"
TS_ROOT = (
    ROOT
    / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/node_modules/typescript"
)
TOOLS = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(cmd: list[str], cwd: Path) -> dict:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return {
        "command": cmd,
        "cwd": str(cwd.relative_to(ROOT)),
        "exitCode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


def main() -> None:
    wave9 = json.loads(WAVE9.read_text())
    wave9_sha = sha256_file(WAVE9)
    files = wave9["files"]
    drift: list[dict] = []
    verified: list[dict] = []
    for entry in files:
        rel = entry["path"]
        local_rel = rel[len("package/") :] if rel.startswith("package/") else rel
        local = TS_ROOT / local_rel
        if not local.is_file():
            drift.append({"path": rel, "error": "missing", "expected": entry["sha256"]})
            continue
        got = sha256_file(local)
        record = {
            "path": rel,
            "localPath": str(local.relative_to(ROOT)),
            "expected": entry["sha256"],
            "actual": got,
            "byteLength": local.stat().st_size,
        }
        if got != entry["sha256"]:
            drift.append(record)
        else:
            verified.append(record)

    pkg = json.loads((TS_ROOT / "package.json").read_text())
    shipped_files_field = pkg.get("files")
    has_tests_dir = any(
        (TS_ROOT / name).is_dir() for name in ("tests", "test", "__tests__")
    )
    top_level = sorted(path.name for path in TS_ROOT.iterdir())

    oracle_disp = json.loads((ORACLE / "disposition.json").read_text())
    oracle_exit = json.loads((ORACLE / "tsc-exit.json").read_text())
    oracle_stdout = (ORACLE / "tsc-stdout.txt").read_text().strip()
    oracle_emit = json.loads((ORACLE / "emit-hashes.json").read_text())

    version_probe = run(["bun", "x", "typescript@7.0.2", "tsc", "--version"], TOOLS)
    typecheck_probe = run(["bun", "run", "typecheck"], TOOLS)
    captured_at = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    disposition = {
        "schemaVersion": 1,
        "unit": "u-dep-typescript-deep-001",
        "capturedAt": captured_at,
        "package": "typescript@7.0.2",
        "deepCompilerSemanticsStatus": "still_open",
        "verdict": "still-open-with-merge-note",
        "priorWave009Disposition": str(WAVE9.relative_to(ROOT)),
        "priorWave009Sha256": wave9_sha,
        "priorMinimalOracle": {
            "path": str(ORACLE.relative_to(ROOT)),
            "disposition": oracle_disp,
            "tscExit": oracle_exit,
            "tscStdout": oracle_stdout,
            "emitHashes": oracle_emit,
            "closesDeepSemantics": False,
            "note": (
                "Minimal enums/namespace emit attempt failed "
                "(TS5042 project+source-files mix; exit 1; emitFileCount 0). "
                "Explicitly not deep-semantics closure."
            ),
        },
        "catalogReverify": {
            "deepInternalFileCount": len(files),
            "verifiedCount": len(verified),
            "catalogHashDriftCount": len(drift),
            "catalogHashDrift": drift,
            "note": "Catalog re-verify is not deep compiler-behavior semantics.",
        },
        "npmPackageShipsNoCompilerTests": {
            "packageJsonFilesField": shipped_files_field,
            "topLevelEntries": top_level,
            "hasTestsDirectory": has_tests_dir,
            "note": (
                "Published typescript@7.0.2 tarball lists bin/lib/dist/vendor only. "
                "No compiler-test suite is present in the locked install tree."
            ),
        },
        "nonClosingProbes": {
            "consumerActivationProbe": {
                **version_probe,
                "note": "Package activation only. Not deep compiler-behavior semantics.",
            },
            "consumerTypecheckProbe": {
                **typecheck_probe,
                "note": (
                    "Consumer typecheck via locked typescript. Does not prove "
                    "AST/enum/internal helper semantics for 136 internal dist files."
                ),
            },
        },
        "honesty": {
            "structuralBodyAuditComplete": True,
            "catalogReverifyIsNotDeepSemantics": True,
            "consumerTypecheckIsNotDeepSemantics": True,
            "tscVersionProbeIsNotDeepSemantics": True,
            "minimalEmitOracleIsNotDeepSemantics": True,
            "doNotInventFullConformanceSuiteClaim": True,
            "whatWouldCloseDeepSemantics": (
                "A compiler-test oracle that (1) pins microsoft/TypeScript "
                "(or equivalent) tests to the same 7.0.2 semantics as the locked "
                "npm package, (2) runs a documented suite subset that exercises "
                "AST/enum/helper contracts covering the 136 internal_module_surface "
                "files, (3) records command, exit codes, and path+sha256 evidence "
                "for expected outputs. Absent that oracle, unresolvedReference must "
                "stay open. Do not close on catalogHashDriftCount=0 or typecheck exit 0."
            ),
            "honestStatus": "deep_compiler_semantics_still_open",
            "doNotClaim": [
                "catalogHashDriftCount=0 closes deep semantics",
                "bun run typecheck closes deep semantics",
                "tsc --version closes deep semantics",
                "prior dep-typescript-oracle-001 minimal emit closes deep semantics",
                "full TypeScript conformance suite was run in this unit",
            ],
        },
        "blocker": (
            "No compiler-test oracle exists for typescript@7.0.2 deep semantics. "
            "The npm package ships no tests (files: bin, lib, dist, vendor). "
            "Prior minimal emit under dep-typescript-oracle-001 failed "
            "(exit 1, emitFileCount 0) and does not cover the 136 "
            "internal_module_surface contracts. Catalog re-verify "
            "(catalogHashDriftCount=0) and consumer typecheck (exit 0) remain "
            "non-proof. Closure requires a pinned compiler-test oracle with "
            "path+hash evidence, not catalog/typecheck alone."
        ),
        "disposition": (
            "u-dep-typescript-deep-001 honesty terminal. Re-verified wave-009 "
            "disposition sha256 and all 136 internal file hashes "
            f"(catalogHashDriftCount={len(drift)}). Consumer typecheck and "
            "tsc --version still exit 0. npm tarball has no compiler tests. "
            "Prior minimal emit oracle is not closure. "
            "deepCompilerSemanticsStatus remains still_open."
        ),
    }

    disp_path = OUT / "disposition.json"
    disp_path.write_text(json.dumps(disposition, indent=2) + "\n")
    disp_sha = sha256_file(disp_path)

    old_ref = (
        "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after "
        "wave-009 honesty disposition at "
        "parity/research/dep-closure-wave-009/npm/typescript-deep-semantics-disposition.json "
        "(structuralBodyAuditComplete=true; catalogHashDriftCount=0; consumer "
        "typecheck exit=0; honesty records that catalog re-verify and typecheck "
        "are not deep-semantics proof; no compiler-test oracle)."
    )
    new_ref = (
        "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after "
        "u-dep-typescript-deep-001 at "
        "parity/research/dep-typescript-deep-001/disposition.json "
        f"(sha256 {disp_sha}; catalogHashDriftCount={len(drift)}; consumer "
        f'typecheck exit={typecheck_probe["exitCode"]}; npm package ships no '
        "compiler tests; prior minimal emit oracle dep-typescript-oracle-001 is "
        "not closure; blocker: need pinned compiler-test oracle with path+hash "
        "evidence covering 136 internal_module_surface contracts)."
    )

    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-typescript-deep-001",
        "status": "proposal",
        "createdAt": captured_at,
        "verdict": "still-open-with-merge-note",
        "mergePayloadReady": True,
        "deepCompilerSemanticsStatus": "still_open",
        "targets": {"dependenciesJson": "parity/dependencies.json"},
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": (
            "Must remain false. Deep typescript semantics stay open."
        ),
        "resolvedReferenceCount": 0,
        "resolvedEdgeCount": 0,
        "removeUnresolvedReference": False,
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "npm:typescript@7.0.2",
                    "appendReadingEvidence": [
                        "parity/research/dep-typescript-deep-001/disposition.json",
                        "parity/research/dep-typescript-deep-001/merge-payload.json",
                    ],
                    "set": {
                        "waveDeep001Disposition": disposition["disposition"],
                        "deepCompilerSemanticsStatus": "still_open",
                    },
                    "evidence": [
                        "parity/research/dep-typescript-deep-001/disposition.json",
                    ],
                }
            ],
            "unresolvedReferences": {
                "removeIfPresent": [],
                "keepAndRefresh": [
                    {
                        "matchContains": (
                            "npm:typescript@7.0.2 deep compiler-behavior semantics"
                        ),
                        "prior": old_ref,
                        "replacement": new_ref,
                    }
                ],
                "add": [],
                "note": (
                    "Do NOT remove the typescript deep compiler-behavior "
                    "unresolvedReference. Only refresh the evidence pointer and "
                    "sharper blocker text. Do not set completeDependencyClosure true."
                ),
            },
        },
        "dispositionSha256": disp_sha,
        "fullProposal": "parity/research/dep-typescript-deep-001/merge-payload.json",
    }

    merge_path = OUT / "merge-payload.json"
    merge_path.write_text(json.dumps(merge, indent=2) + "\n")
    merge_sha = sha256_file(merge_path)

    verify = {
        "unit": "u-dep-typescript-deep-001",
        "capturedAt": captured_at,
        "hashes": {
            "wave009Disposition": wave9_sha,
            "disposition": disp_sha,
            "mergePayload": merge_sha,
        },
        "catalogHashDriftCount": len(drift),
        "verifiedInternalFileCount": len(verified),
        "typecheckExit": typecheck_probe["exitCode"],
        "tscVersionExit": version_probe["exitCode"],
        "tscVersionStdout": version_probe["stdout"],
        "verdict": "still-open-with-merge-note",
        "mergePayloadReady": True,
        "removeUnresolvedReference": False,
    }
    (OUT / "verify-hashes.json").write_text(json.dumps(verify, indent=2) + "\n")
    print(json.dumps(verify, indent=2))


if __name__ == "__main__":
    main()
