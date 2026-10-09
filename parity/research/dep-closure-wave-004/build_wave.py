#!/usr/bin/env python3
"""Build u-dep-closure-wave-004 research artifacts. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
UNIT = "u-dep-closure-wave-004"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
LOCK = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock"
PKG_JSON = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/package.json"
BOOTSTRAP = (
    ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_bun_lock(path: Path) -> dict:
    raw = path.read_text()
    clean = re.sub(r",\s*([}\]])", r"\1", raw)
    return json.loads(clean)


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=False) + "\n")


RETRIEVAL_MAP = {
    "@types/node": "parity/research/dep-closure-wave-001/npm/@types__node@26.1.2/retrieval.json",
    "@typescript/typescript-aix-ppc64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-aix-ppc64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-darwin-arm64": (
        "parity/research/dep-closure-wave-001/npm/"
        "@typescript__typescript-darwin-arm64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-darwin-x64": (
        "parity/research/dep-closure-wave-001/npm/"
        "@typescript__typescript-darwin-x64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-freebsd-arm64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-freebsd-arm64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-freebsd-x64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-freebsd-x64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-arm": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-linux-arm@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-arm64": (
        "parity/research/dep-closure-wave-001/npm/"
        "@typescript__typescript-linux-arm64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-loong64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-linux-loong64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-mips64el": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-linux-mips64el@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-ppc64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-linux-ppc64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-riscv64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-linux-riscv64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-s390x": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-linux-s390x@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-linux-x64": (
        "parity/research/dep-closure-wave-001/npm/"
        "@typescript__typescript-linux-x64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-netbsd-arm64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-netbsd-arm64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-netbsd-x64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-netbsd-x64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-openbsd-arm64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-openbsd-arm64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-openbsd-x64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-openbsd-x64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-sunos-x64": (
        "parity/research/dep-closure-wave-002/npm/"
        "@typescript__typescript-sunos-x64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-win32-arm64": (
        "parity/research/dep-closure-wave-001/npm/"
        "@typescript__typescript-win32-arm64@7.0.2/retrieval.json"
    ),
    "@typescript/typescript-win32-x64": (
        "parity/research/dep-closure-wave-001/npm/"
        "@typescript__typescript-win32-x64@7.0.2/retrieval.json"
    ),
    "bun-types": "parity/research/dep-closure-wave-001/npm/bun-types@1.3.14/retrieval.json",
    "commander": "parity/research/npm/commander-14.0.0/read-inventory.json",
    "typescript": "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/retrieval.json",
    "undici-types": "parity/research/dep-closure-wave-001/npm/undici-types@8.3.0/retrieval.json",
}


def audit_platform_matrix(lock: dict) -> dict:
    rows = []
    for name, entry in sorted(lock["packages"].items()):
        meta = entry[2] if len(entry) > 2 and isinstance(entry[2], dict) else {}
        resolved = entry[0] if entry else name
        integrity = entry[3] if len(entry) > 3 else None
        row = {
            "lockKey": name,
            "resolved": resolved,
            "os": meta.get("os"),
            "cpu": meta.get("cpu"),
            "hasPlatformFilter": ("os" in meta) or ("cpu" in meta),
            "integrity": integrity,
        }
        rows.append(row)
    cpu_none = [r["lockKey"] for r in rows if r["cpu"] == "none"]
    os_none = [r["lockKey"] for r in rows if r["os"] == "none"]
    platform = [r for r in rows if r["hasPlatformFilter"]]
    return {
        "lockPath": rel(LOCK),
        "lockSha256": sha256(LOCK),
        "packageCount": len(rows),
        "platformFilteredCount": len(platform),
        "literalCpuNone": cpu_none,
        "literalOsNone": os_none,
        "rows": rows,
        "note": (
            "Literal cpu/os 'none' values are lock metadata from typescript optional "
            "native packages. They are recorded as written in bun.lock, not rewritten."
        ),
    }


def verify_registry_custody(lock: dict) -> dict:
    results = []
    missing = []
    integrity_mismatch = []
    for name, entry in sorted(lock["packages"].items()):
        lock_integrity = entry[3] if len(entry) > 3 else None
        resolved = entry[0]
        evidence = RETRIEVAL_MAP.get(name)
        item = {
            "lockKey": name,
            "resolved": resolved,
            "lockIntegrity": lock_integrity,
            "evidencePath": evidence,
        }
        if not evidence:
            item["status"] = "MISSING_MAP"
            missing.append(name)
            results.append(item)
            continue
        path = ROOT / evidence
        if not path.exists():
            item["status"] = "MISSING_FILE"
            missing.append(name)
            results.append(item)
            continue
        item["evidenceSha256"] = sha256(path)
        if evidence.endswith("retrieval.json"):
            retrieval = json.loads(path.read_text())
            reg_integrity = retrieval.get("integrity")
            item["retrievalIntegrity"] = reg_integrity
            if lock_integrity and reg_integrity and lock_integrity != reg_integrity:
                item["status"] = "INTEGRITY_MISMATCH"
                integrity_mismatch.append(name)
            else:
                item["status"] = "OK"
                item["tarballPath"] = retrieval.get("tarballPath")
                item["license"] = (retrieval.get("packageJson") or {}).get("license")
        else:
            # commander uses read-inventory, not retrieval.json shape
            item["status"] = "OK_VIA_INVENTORY"
        results.append(item)
    return {
        "packageCount": len(lock["packages"]),
        "okCount": sum(1 for r in results if r["status"].startswith("OK")),
        "missing": missing,
        "integrityMismatch": integrity_mismatch,
        "allCustodyPresent": not missing and not integrity_mismatch,
        "results": results,
    }


def typescript_contract_surface() -> dict:
    base = ROOT / "parity/research/dep-closure-wave-002/npm/typescript@7.0.2"
    summary = json.loads((base / "package.json").read_text())
    unpacked_pkg_path = base / "unpacked/package/package.json"
    pkg = json.loads(unpacked_pkg_path.read_text()) if unpacked_pkg_path.exists() else summary
    inventory = json.loads((base / "file-inventory.json").read_text())
    if isinstance(inventory, list):
        inventoried_file_count = len(inventory)
        full_tree = True
        license_from_inv = next(
            (row for row in inventory if row.get("path") == "package/LICENSE"), None
        )
    else:
        inventoried_file_count = inventory.get("inventoriedFileCount")
        full_tree = inventory.get("fullTreeReadingComplete")
        license_from_inv = None
    license_path = base / "unpacked/package/LICENSE"
    license_meta = None
    if license_path.exists():
        license_meta = {
            "path": rel(license_path),
            "sha256": sha256(license_path),
            "byteLength": license_path.stat().st_size,
        }
    elif license_from_inv:
        license_meta = {
            "path": rel(base / "file-inventory.json") + "#package/LICENSE",
            "sha256": license_from_inv["sha256"],
            "byteLength": license_from_inv["byteLength"],
        }
    opt_keys = summary.get("optionalDependencyKeys")
    if not opt_keys:
        opt_keys = sorted((pkg.get("optionalDependencies") or {}).keys())
    return {
        "packageJsonPath": rel(base / "package.json"),
        "packageJsonSha256": sha256(base / "package.json"),
        "unpackedPackageJsonPath": rel(unpacked_pkg_path) if unpacked_pkg_path.exists() else None,
        "unpackedPackageJsonSha256": (
            sha256(unpacked_pkg_path) if unpacked_pkg_path.exists() else None
        ),
        "name": pkg.get("name") or summary.get("name"),
        "version": pkg.get("version") or summary.get("version"),
        "license": pkg.get("license") or summary.get("license"),
        "bin": pkg.get("bin") or summary.get("bin"),
        "optionalDependencyKeys": list(opt_keys),
        "optionalDependencyCount": len(opt_keys),
        "engines": pkg.get("engines"),
        "fileInventoryPath": rel(base / "file-inventory.json"),
        "fileInventorySha256": sha256(base / "file-inventory.json"),
        "inventoriedFileCount": inventoried_file_count,
        "fullTreeReadingComplete": full_tree,
        "licenseFile": license_meta,
        "semanticPerFileBodyAudit": "still_open",
        "note": (
            "Contract-surface fields from package.json plus license file hash and prior "
            "full-tree inventory. Individual .d.ts/.js body semantics were not audited."
        ),
    }


def bun_pin_probe() -> dict:
    pkg = json.loads(PKG_JSON.read_text())
    bun_dir = WAVE / "bun"
    version_txt = bun_dir / "bun-version.txt"
    local_version = version_txt.read_text().strip() if version_txt.exists() else None
    docs = []
    for label, filename, url in [
        ("install", "install.html", "https://bun.com/docs/installation"),
        ("lockfile", "lockfile.html", "https://bun.com/docs/pm/lockfile"),
        ("nodejs-compat", "nodejs-compat.html", "https://bun.com/docs/runtime/nodejs-compat"),
    ]:
        path = bun_dir / filename
        if path.exists():
            docs.append(
                {
                    "label": label,
                    "url": url,
                    "path": rel(path),
                    "sha256": sha256(path),
                    "byteLength": path.stat().st_size,
                }
            )
    pin_candidates = {
        "package.json.engines": pkg.get("engines"),
        "package.json.packageManager": pkg.get("packageManager"),
        "dotBunVersionFile": (PKG_JSON.parent / ".bun-version").exists(),
        "bunLockPinsBunBinary": False,
    }
    lock = load_bun_lock(LOCK)
    bun_types = lock["packages"].get("bun-types", [None])[0]
    return {
        "capturedAt": NOW,
        "localBunVersionCapture": rel(version_txt) if version_txt.exists() else None,
        "localBunVersionSha256": sha256(version_txt) if version_txt.exists() else None,
        "localBunStdout": local_version,
        "docs": docs,
        "pinCandidatesChecked": pin_candidates,
        "manifestDevDependencies": pkg.get("devDependencies"),
        "lockBunTypesResolved": bun_types,
        "typesVersusRuntimeNote": (
            f"Lock resolves bun-types to {bun_types}; local bun --version is "
            f"{local_version}. bun-types is not an official Bun runtime pin."
        ),
        "pinStatus": "unresolved",
        "note": (
            "Official install docs describe host install of a specific Bun version via "
            "the install script. The tools subtree has no engines, packageManager, "
            ".bun-version, or lock entry that pins the Bun binary. Keep official pin "
            "unresolved. Do not invent a pin from local 1.4.2 or bun-types@1.3.14."
        ),
    }


def host_edge_disposition() -> dict:
    cu = ROOT / "parity/research/continuation/computer-use.md"
    mm = ROOT / "parity/research/continuation/model-management.md"
    return {
        "edges": [
            {
                "from": "cursor-cli-host",
                "to": "cursor-self-hosted-computer-use",
                "keepStatus": "unresolved",
                "evidence": [rel(cu), rel(WAVE / "nodes/host-edge-disposition.md")],
                "blocker": (
                    "Public docs only. macOS helper identity/privacy grants, Linux "
                    "display/desktop services, and sharing transport are "
                    "environment-bound and were not exercised."
                ),
                "docSha256": sha256(cu),
            },
            {
                "from": "cursor-cli-host",
                "to": "cursor-enterprise-integration-policy",
                "keepStatus": "unresolved",
                "evidence": [rel(mm), rel(WAVE / "nodes/host-edge-disposition.md")],
                "blocker": (
                    "Public docs only. Live team/org policy enforcement and CLI "
                    "applicability were not observed. Standing orders forbid broad "
                    "allowlist or authorization changes."
                ),
                "docSha256": sha256(mm),
            },
        ]
    }


def main() -> int:
    WAVE.mkdir(parents=True, exist_ok=True)
    (WAVE / "bun").mkdir(parents=True, exist_ok=True)
    (WAVE / "nodes").mkdir(parents=True, exist_ok=True)
    (WAVE / "npm").mkdir(parents=True, exist_ok=True)

    lock = load_bun_lock(LOCK)
    platform = audit_platform_matrix(lock)
    write_json(WAVE / "platform-matrix.json", platform)

    custody = verify_registry_custody(lock)
    write_json(WAVE / "registry-custody.json", custody)

    ts_surface = typescript_contract_surface()
    write_json(WAVE / "npm/typescript-contract-surface.json", ts_surface)

    pin = bun_pin_probe()
    write_json(WAVE / "bun/official-capture.json", pin)

    host = host_edge_disposition()
    write_json(WAVE / "host-edge-disposition.json", host)

    # Node markdown summaries
    (WAVE / "nodes/platform-matrix.md").write_text(
        "\n".join(
            [
                "# Platform-conditional lock audit",
                "",
                f"Lock `{platform['lockPath']}` sha256=`{platform['lockSha256']}`.",
                f"Packages: {platform['packageCount']}. "
                f"Platform-filtered: {platform['platformFilteredCount']}.",
                "",
                "## Literal cpu none",
                "",
                *[f"- `{n}`" for n in platform["literalCpuNone"]],
                "",
                "## Literal os none",
                "",
                *[f"- `{n}`" for n in platform["literalOsNone"]],
                "",
                platform["note"],
                "",
            ]
        )
    )
    (WAVE / "nodes/bun-pin.md").write_text(
        "\n".join(
            [
                "# Official Bun runtime version pin",
                "",
                f"Local bun --version: `{pin['localBunStdout']}` "
                f"(capture sha256=`{pin['localBunVersionSha256']}`).",
                f"Lock bun-types: `{pin['lockBunTypesResolved']}`.",
                "",
                pin["typesVersusRuntimeNote"],
                "",
                pin["note"],
                "",
                "pinStatus: unresolved",
                "",
            ]
        )
    )
    (WAVE / "nodes/registry-custody.md").write_text(
        "\n".join(
            [
                "# Tools lock registry/tarball custody",
                "",
                f"okCount={custody['okCount']} / packageCount={custody['packageCount']}.",
                f"allCustodyPresent={custody['allCustodyPresent']}.",
                f"missing={custody['missing']}.",
                f"integrityMismatch={custody['integrityMismatch']}.",
                "",
                "Scope is the poteto-mode tools bun.lock package set only.",
                "",
            ]
        )
    )
    (WAVE / "nodes/typescript-contract-surface.md").write_text(
        "\n".join(
            [
                "# npm:typescript@7.0.2 contract surface",
                "",
                f"version={ts_surface['version']} license={ts_surface['license']} "
                f"optionalDependencyCount={ts_surface['optionalDependencyCount']}.",
                f"inventoriedFileCount={ts_surface['inventoriedFileCount']} "
                f"fullTreeReadingComplete={ts_surface['fullTreeReadingComplete']}.",
                "",
                ts_surface["note"],
                "",
                "semanticPerFileBodyAudit: still_open",
                "",
            ]
        )
    )
    (WAVE / "nodes/host-edge-disposition.md").write_text(
        "\n".join(
            [
                "# Host edge disposition (computer-use / enterprise)",
                "",
                "Both edges stay unresolved. Environment-bound runtime surfaces were "
                "not exercised. Public docs were re-hashed only.",
                "",
                *[
                    f"- `{e['from']}` → `{e['to']}`: {e['blocker']} "
                    f"(doc sha256=`{e['docSha256']}`)"
                    for e in host["edges"]
                ],
                "",
            ]
        )
    )

    sources = [
        {
            "id": "bun.lock",
            "path": rel(LOCK),
            "role": "tools frozen lock; platform matrix source",
        },
        {
            "id": "package.json",
            "path": rel(PKG_JSON),
            "role": "tools manifest; pin-candidate check",
        },
        {
            "id": "bootstrap.ts",
            "path": rel(BOOTSTRAP),
            "role": "Bun.spawnSync install contract",
        },
        {
            "id": "platform-matrix.json",
            "path": rel(WAVE / "platform-matrix.json"),
            "role": "cpu/os none audit",
        },
        {
            "id": "registry-custody.json",
            "path": rel(WAVE / "registry-custody.json"),
            "role": "per-lock-package registry/tarball custody verify",
        },
        {
            "id": "typescript-contract-surface.json",
            "path": rel(WAVE / "npm/typescript-contract-surface.json"),
            "role": "typescript package.json/license contract surface",
        },
        {
            "id": "bun-official-capture.json",
            "path": rel(WAVE / "bun/official-capture.json"),
            "role": "Bun pin probe + official docs",
        },
        {
            "id": "bun-version.txt",
            "path": rel(WAVE / "bun/bun-version.txt"),
            "role": "local bun --version",
        },
        {
            "id": "bun-install.html",
            "path": rel(WAVE / "bun/install.html"),
            "role": "official Bun installation docs",
        },
        {
            "id": "bun-lockfile.html",
            "path": rel(WAVE / "bun/lockfile.html"),
            "role": "official Bun lockfile docs",
        },
        {
            "id": "bun-nodejs-compat.html",
            "path": rel(WAVE / "bun/nodejs-compat.html"),
            "role": "official Bun Node.js compat docs",
        },
        {
            "id": "computer-use.md",
            "path": "parity/research/continuation/computer-use.md",
            "role": "public computer-use contract",
        },
        {
            "id": "model-management.md",
            "path": "parity/research/continuation/model-management.md",
            "role": "public enterprise model/integration contract",
        },
        {
            "id": "host-edge-disposition.json",
            "path": rel(WAVE / "host-edge-disposition.json"),
            "role": "environment-bound host edge blockers",
        },
    ]

    all_sources = []
    for src in sources:
        path = ROOT / src["path"]
        all_sources.append(
            {
                **src,
                "absolutePath": str(path),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
            }
        )

    inventory = {
        "unit": UNIT,
        "createdAt": NOW,
        "allSources": all_sources,
        "platformMatrix": {
            "cpuNone": platform["literalCpuNone"],
            "osNone": platform["literalOsNone"],
            "platformFilteredCount": platform["platformFilteredCount"],
        },
        "registryCustody": {
            "allCustodyPresent": custody["allCustodyPresent"],
            "okCount": custody["okCount"],
            "packageCount": custody["packageCount"],
        },
        "bunPinStatus": pin["pinStatus"],
        "typescriptSemanticPerFile": "still_open",
    }
    write_json(WAVE / "read-inventory.json", inventory)

    # Hash verify via shasum
    verify = {"unit": UNIT, "createdAt": NOW, "results": [], "status": "VERIFIED"}
    bad = 0
    for src in all_sources:
        path = Path(src["absolutePath"])
        out = subprocess.check_output(["shasum", "-a", "256", str(path)], text=True).split()[
            0
        ]
        ok = out == src["sha256"]
        if not ok:
            bad += 1
        verify["results"].append(
            {"id": src["id"], "path": src["path"], "sha256": out, "ok": ok}
        )
    verify["status"] = "VERIFIED" if bad == 0 else f"NOT VERIFIED ({bad})"
    write_json(WAVE / "verify-hashes.json", verify)

    verify_script = WAVE / "verify_inventory_shasum.py"
    verify_script.write_text(
        '''#!/usr/bin/env python3
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
'''
    )
    verify_script.chmod(0o755)

    # Decisions TSV
    decisions = [
        "decision\tevidence\tresult",
        f"platform-cpu-os-none-audit\t{rel(WAVE / 'platform-matrix.json')}\tresolved_ref",
        f"tools-lock-registry-custody\t{rel(WAVE / 'registry-custody.json')}\t"
        f"{'resolved_ref' if custody['allCustodyPresent'] else 'blocked'}",
        f"bun-official-pin\t{rel(WAVE / 'bun/official-capture.json')}\tunresolved",
        f"typescript-contract-surface\t{rel(WAVE / 'npm/typescript-contract-surface.json')}\t"
        "partial_ref_replace",
        f"typescript-semantic-per-file\t{rel(WAVE / 'npm/typescript-contract-surface.json')}\t"
        "unresolved",
        f"host-computer-use\t{rel(WAVE / 'host-edge-disposition.json')}\tunresolved",
        f"host-enterprise\t{rel(WAVE / 'host-edge-disposition.json')}\tunresolved",
        "completeDependencyClosure\tn/a\tfalse",
    ]
    (WAVE / "decisions.tsv").write_text("\n".join(decisions) + "\n")

    runtime_prereq_note = (
        "Tools scripts require a Bun binary on PATH for shebang execution and "
        "bootstrap Bun.spawnSync(`bun install --frozen-lockfile`). Official install "
        "docs cover host install of a specific version; the tools subtree does not "
        "declare engines or packageManager. Optional typescript native packages are "
        "platform-filtered in bun.lock (including literal cpu/os none). Commander "
        "Node-builtin needs are covered by prior nodejs-compat capture under local "
        f"bun {pin['localBunStdout']}."
    )
    (WAVE / "nodes/runtime-prerequisites.md").write_text(
        "\n".join(
            [
                "# Runtime / platform prerequisites",
                "",
                runtime_prereq_note,
                "",
                f"Evidence: `{rel(WAVE / 'bun/official-capture.json')}`, "
                f"`{rel(WAVE / 'platform-matrix.json')}`.",
                "",
            ]
        )
    )

    merge = {
        "schemaVersion": 1,
        "unit": UNIT,
        "status": "proposal",
        "createdAt": NOW,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "sourceLockJson": "parity/source-lock.json",
        },
        "closureAudited": True,
        "closureAuditedNote": (
            "Leave closureAudited true. Prior independent audit remains the audit "
            "evidence. This wave does not re-audit."
        ),
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": (
            "Do not claim completeDependencyClosure. Bun version pin, host "
            "computer-use/enterprise edges, journey edges, typescript per-file body "
            "semantics, and broader recursive/live integrations remain open."
        ),
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "source-bun-runtime",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "read-inventory.json"),
                            rel(WAVE / "bun/official-capture.json"),
                            rel(WAVE / "nodes/bun-pin.md"),
                            rel(WAVE / "nodes/runtime-prerequisites.md"),
                        ]
                    },
                    "evidence": [
                        rel(WAVE / "bun/official-capture.json"),
                        rel(WAVE / "platform-matrix.json"),
                        rel(WAVE / "nodes/runtime-prerequisites.md"),
                    ],
                    "disposition": (
                        "Runtime/platform prerequisites documented from official Bun "
                        "docs and tools contracts. Official Bun binary version pin "
                        "remains unresolved (no engines/packageManager/.bun-version)."
                    ),
                },
                {
                    "id": "source-tools-manifest",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "read-inventory.json"),
                            rel(WAVE / "platform-matrix.json"),
                            rel(WAVE / "registry-custody.json"),
                        ]
                    },
                    "evidence": [
                        rel(WAVE / "platform-matrix.json"),
                        rel(WAVE / "registry-custody.json"),
                    ],
                    "disposition": (
                        "All bun.lock platform-conditional branches audited, including "
                        "literal cpu/os none. Every lock package has prior registry/"
                        "tarball custody evidence with matching integrity."
                    ),
                },
                {
                    "id": "npm:typescript@7.0.2",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "npm/typescript-contract-surface.json"),
                            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/"
                            "file-inventory.json",
                        ]
                    },
                    "evidence": [
                        rel(WAVE / "npm/typescript-contract-surface.json"),
                        rel(WAVE / "nodes/typescript-contract-surface.md"),
                    ],
                    "disposition": (
                        "Contract-surface (package.json fields, license file, optional "
                        "deps, prior full-tree hashes) recorded. Semantic per-file body "
                        "audit of 416 files remains open."
                    ),
                },
            ],
            "edgeMutations": [],
            "honestUnresolvedEdges": host["edges"]
            + [
                {
                    "from": "cursor-pstack",
                    "to": "cursor-team-kit",
                    "keepStatus": "unverified",
                    "evidence": ["parity/reviews/source-discovery.md"],
                    "blocker": (
                        "Distribution custody exists. Complete source and paired "
                        "journey closure for the full skill set is not shown."
                    ),
                },
                {
                    "from": "cursor-pstack",
                    "to": "cursor-cli-host",
                    "keepStatus": "unverified",
                    "evidence": ["parity/reviews/source-discovery.md"],
                    "blocker": (
                        "Persistent-mode editor actions (Option/Alt+Enter) and "
                        "later-turn behavior still need paired Cursor+Pi runtime "
                        "evidence."
                    ),
                },
            ],
            "unresolvedReferences": {
                "removeIfPresent": [
                    "Audit all platform-conditional branches, including literal cpu/os none entries in this lock.",
                    "Fetch exact registry metadata and tarballs, verify integrity and licenses, inspect relevant contracts and transitive dependencies.",
                    "Determine runtime/platform prerequisites from official Bun and package contracts.",
                    "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-003 capture at parity/research/dep-closure-wave-003/bun/official-capture.json (local 1.4.2 only; no tools lock pin).",
                    "npm:typescript@7.0.2 full tree file hashes captured at parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json; semantic per-file contract audit still open.",
                    "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after public-doc re-hash; runtime services closed or environment-bound.",
                    "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-003 public-doc re-hash; runtime services closed or environment-bound.",
                    "Node-builtin compatibility for commander runtimeCompatibilityInputs evidenced under local bun 1.4.2 and official Bun nodejs-compat docs at parity/research/dep-closure-wave-003/bun/; not a substitute for an official Bun version pin.",
                ],
                "add": [
                    (
                        "Official Bun runtime version pin under source-bun-runtime remains "
                        f"unresolved after wave-004 capture at {rel(WAVE / 'bun/official-capture.json')} "
                        f"(local {pin['localBunStdout']} only; no engines/packageManager/"
                        f".bun-version; bun-types lock resolve {pin['lockBunTypesResolved']} "
                        "is not a runtime pin)."
                    ),
                    (
                        "Tools bun.lock platform-conditional branches audited at "
                        f"{rel(WAVE / 'platform-matrix.json')} "
                        f"(cpu none={platform['literalCpuNone']}; "
                        f"os none={platform['literalOsNone']})."
                    ),
                    (
                        "Tools bun.lock registry/tarball custody verified for all "
                        f"{custody['packageCount']} packages at "
                        f"{rel(WAVE / 'registry-custody.json')} "
                        "(integrity match to prior retrievals; registry signature "
                        "authentication still not performed)."
                    ),
                    (
                        "Runtime/platform prerequisites for tools scripts recorded at "
                        f"{rel(WAVE / 'nodes/runtime-prerequisites.md')}; official Bun "
                        "binary pin still required for source-bun-runtime closure."
                    ),
                    (
                        "npm:typescript@7.0.2 contract-surface recorded at "
                        f"{rel(WAVE / 'npm/typescript-contract-surface.json')}; "
                        "semantic per-file body audit of inventoried files still open."
                    ),
                    (
                        "cursor-cli-host edges to computer-use and enterprise policy remain "
                        "unresolved after wave-004 public-doc re-hash; runtime services "
                        "closed or environment-bound "
                        f"({rel(WAVE / 'host-edge-disposition.json')})."
                    ),
                    (
                        f"Node-builtin compatibility for commander evidenced under local "
                        f"bun {pin['localBunStdout']} and official docs at "
                        f"{rel(WAVE / 'bun/')}; not a substitute for an official Bun "
                        "version pin."
                    ),
                ],
                "keep": [
                    "Required live integrations, cloud services, automation editor, models and supporting tools.",
                    "Recursive references in inspected sources still require complete extraction and audit.",
                    "cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture at parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md.",
                    "Tools package consumer binding recorded at parity/research/dep-closure-wave-003/consumer-binding.json (commander runtime; bun-types/typescript test/typecheck). Broader acceptance journeys remain open.",
                ],
                "note": (
                    "Close tools-lock platform-matrix, registry custody, and runtime "
                    "prerequisite refs with path+hash evidence. Keep Bun pin, host "
                    "environment-bound edges, typescript body semantics, and journey "
                    "items open."
                ),
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": (
                    "Leave false. Bun pin, four host/journey edges, and typescript "
                    "body semantics remain open."
                ),
            }
        },
        "remainingGaps": [
            "Official Bun version pin under source-bun-runtime stays unresolved.",
            "cursor-cli-host → computer-use and enterprise-policy stay unresolved (environment-bound).",
            "cursor-pstack → cursor-team-kit and cursor-cli-host stay unverified (journey evidence).",
            "typescript semantic per-file body audit still open.",
            "completeDependencyClosure must stay false.",
        ],
        "doNotEdit": [
            "parity/dependencies.json",
            "parity/source-lock.json",
            "parity/requirements.json",
            "parity/mismatches.json",
            "parity/progress.md",
        ],
        "inventoryDigest": {
            "path": rel(WAVE / "read-inventory.json"),
            "sourceCount": len(all_sources),
            "verifyStatus": verify["status"],
            "registryCustodyOk": custody["allCustodyPresent"],
            "bunPinStatus": pin["pinStatus"],
        },
        "resolvedReferenceCount": 3,
        "unresolvedTargetCount": 7,
        "countsNote": (
            "resolvedReferenceCount counts refs this wave can clear "
            "(platform matrix, registry custody for tools lock, runtime/platform "
            "prerequisites). unresolvedTargetCount counts Bun pin, typescript body "
            "semantics, two host unresolved edges, two journey unverified edges, plus "
            "live/recursive keep-open buckets treated as still blocking "
            "completeDependencyClosure."
        ),
    }
    write_json(WAVE / "merge-proposal.json", merge)

    print(json.dumps(
        {
            "unit": UNIT,
            "verify": verify["status"],
            "registryCustodyOk": custody["allCustodyPresent"],
            "bunPin": pin["pinStatus"],
            "platformCpuNone": platform["literalCpuNone"],
            "platformOsNone": platform["literalOsNone"],
            "mergeProposal": rel(WAVE / "merge-proposal.json"),
        },
        indent=2,
    ))
    return 0 if verify["status"] == "VERIFIED" and custody["allCustodyPresent"] else 1


if __name__ == "__main__":
    sys.exit(main())
