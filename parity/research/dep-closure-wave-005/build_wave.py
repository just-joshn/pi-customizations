#!/usr/bin/env python3
"""Build u-dep-closure-wave-005 research artifacts. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
UNIT = "u-dep-closure-wave-005"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
SCRIPTS = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts"
LOCK = SCRIPTS / "bun.lock"
PKG_JSON = SCRIPTS / "package.json"
TS_UNPACKED = (
    ROOT / "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/unpacked"
)
TS_INVENTORY = (
    ROOT / "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json"
)
COMPUTER_USE = ROOT / "parity/research/continuation/computer-use.md"
MODEL_MGMT = ROOT / "parity/research/continuation/model-management.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=False) + "\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if text.endswith("\n") else text + "\n")


def load_bun_lock(path: Path) -> dict:
    raw = path.read_text()
    clean = re.sub(r",\s*([}\]])", r"\1", raw)
    return json.loads(clean)


def classify_role(path: str) -> str:
    if path.endswith(".map"):
        return "sourcemap"
    if "/vendor/" in path:
        return "vendor"
    name = path.rsplit("/", 1)[-1]
    if name in {"LICENSE", "NOTICE.txt", "README.md", "package.json"} or "License" in name:
        return "meta"
    if path.startswith("package/bin/"):
        return "bin"
    if path.startswith("package/lib/"):
        return "lib-entry"
    if path.startswith("package/dist/api/"):
        return "public-api"
    if path.startswith("package/dist/ast/"):
        return "ast-internal"
    if path.startswith("package/dist/enums/"):
        return "enums-internal"
    if path.startswith("package/dist/internal/"):
        return "dist-internal"
    if path.endswith(".d.ts") or path.endswith(".d.cts"):
        return "declaration"
    if path.endswith((".js", ".cjs", ".mjs")):
        return "js"
    return "other"


EXPORT_RE = re.compile(
    r"^\s*export\s+(?:default\s+|async\s+|type\s+|interface\s+|class\s+|function\s+|const\s+|let\s+|enum\s+|\{)",
    re.M,
)
IMPORT_RE = re.compile(r"^\s*import\s+", re.M)
REQUIRE_RE = re.compile(r"\brequire\s*\(")


def body_facts(path: Path, role: str, data: bytes) -> dict:
    facts: dict = {
        "role": role,
        "byteLength": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    text: str | None
    try:
        text = data.decode("utf-8")
        facts["encoding"] = "utf-8"
    except UnicodeDecodeError:
        facts["encoding"] = "binary"
        facts["bodyAudit"] = "hash_and_size_only"
        return facts

    facts["lineCount"] = text.count("\n") + (0 if text.endswith("\n") or text == "" else 1)
    facts["hasApacheLicenseMarker"] = "Apache License" in text or "Apache-2.0" in text
    facts["hasCopyright"] = "Copyright" in text

    if role == "sourcemap":
        try:
            sm = json.loads(text)
            facts["jsonParseOk"] = True
            facts["sourceMapVersion"] = sm.get("version")
            facts["sourcesCount"] = len(sm.get("sources") or [])
            facts["bodyAudit"] = "sourcemap_json_contract"
        except json.JSONDecodeError as exc:
            facts["jsonParseOk"] = False
            facts["jsonError"] = str(exc)
            facts["bodyAudit"] = "sourcemap_json_invalid"
        return facts

    if path.name == "package.json" or path.name.endswith(".json"):
        try:
            pj = json.loads(text)
            facts["jsonParseOk"] = True
            if isinstance(pj, dict):
                facts["jsonKeys"] = sorted(pj.keys())[:40]
                if "name" in pj:
                    facts["name"] = pj.get("name")
                if "version" in pj:
                    facts["version"] = pj.get("version")
                if "license" in pj:
                    facts["license"] = pj.get("license")
            facts["bodyAudit"] = "json_contract"
        except json.JSONDecodeError as exc:
            facts["jsonParseOk"] = False
            facts["jsonError"] = str(exc)
            facts["bodyAudit"] = "json_invalid"
        return facts

    if role == "bin":
        facts["firstLine"] = text.splitlines()[0] if text else ""
        facts["bodyAudit"] = "bin_entry"
        return facts

    export_count = len(EXPORT_RE.findall(text))
    import_count = len(IMPORT_RE.findall(text))
    require_count = len(REQUIRE_RE.findall(text))
    facts["exportStatementCount"] = export_count
    facts["importStatementCount"] = import_count
    facts["requireCallCount"] = require_count
    stripped = text.strip()
    facts["isEmptyOrWhitespace"] = stripped == ""
    facts["isTinyStub"] = len(stripped) < 80 and (
        "export {}" in stripped or stripped in {"", '"use strict";'}
    )

    if role in {"meta"}:
        facts["bodyAudit"] = "meta_text"
    elif role in {"public-api", "lib-entry", "declaration", "js", "vendor"}:
        facts["bodyAudit"] = "module_surface"
    elif role in {"ast-internal", "enums-internal", "dist-internal"}:
        facts["bodyAudit"] = "internal_module_surface"
    else:
        facts["bodyAudit"] = "text_surface"
    return facts


def build_typescript_body_audit() -> dict:
    inventory = json.loads(TS_INVENTORY.read_text())
    files_out = []
    mismatches = []
    role_counts: Counter[str] = Counter()
    audit_tier_counts: Counter[str] = Counter()

    for entry in inventory:
        rel_path = entry["path"]
        abs_path = TS_UNPACKED / rel_path
        role = classify_role(rel_path)
        role_counts[role] += 1
        if not abs_path.exists():
            mismatches.append({"path": rel_path, "error": "missing"})
            continue
        data = abs_path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != entry["sha256"] or len(data) != entry["byteLength"]:
            mismatches.append(
                {
                    "path": rel_path,
                    "error": "hash_or_size_mismatch",
                    "expectedSha256": entry["sha256"],
                    "actualSha256": digest,
                    "expectedByteLength": entry["byteLength"],
                    "actualByteLength": len(data),
                }
            )
        facts = body_facts(abs_path, role, data)
        audit_tier_counts[facts["bodyAudit"]] += 1
        files_out.append(
            {
                "path": rel_path,
                "inventorySha256": entry["sha256"],
                "inventoryByteLength": entry["byteLength"],
                **facts,
            }
        )

    # Progress tiers for honest closure language
    structural_complete = len(mismatches) == 0 and len(files_out) == len(inventory)
    deep_roles_remaining = ["ast-internal", "enums-internal", "dist-internal"]
    deep_remaining_count = sum(role_counts[r] for r in deep_roles_remaining)
    contract_facing_roles = [
        "meta",
        "bin",
        "lib-entry",
        "public-api",
        "declaration",
        "js",
        "vendor",
        "sourcemap",
        "other",
    ]
    contract_facing_count = sum(role_counts[r] for r in contract_facing_roles)

    return {
        "package": "typescript@7.0.2",
        "unpackedRoot": rel(TS_UNPACKED),
        "inventoryPath": rel(TS_INVENTORY),
        "inventorySha256": sha256(TS_INVENTORY),
        "inventoriedFileCount": len(inventory),
        "bodyAuditedFileCount": len(files_out),
        "hashMismatches": mismatches,
        "roleCounts": dict(role_counts),
        "bodyAuditTierCounts": dict(audit_tier_counts),
        "structuralBodyAuditComplete": structural_complete,
        "contractFacingFileCount": contract_facing_count,
        "deepInternalFileCountStillOpenForCompilerSemantics": deep_remaining_count,
        "auditDefinition": (
            "For each inventoried file: recompute sha256/byteLength against wave-002 "
            "inventory, classify role, and extract body-contract facts (encoding, "
            "license/copyright markers, JSON validity for maps/package.json, "
            "export/import/require counts and stub detection for modules)."
        ),
        "deepCompilerSemanticsStatus": "still_open",
        "deepCompilerSemanticsNote": (
            "Structural and module-surface body contracts were extracted for all "
            f"{len(files_out)} files. Behavioral semantics of TypeScript compiler "
            "internals (AST transforms, enum tables, internal helpers) were not "
            "proven against runtime typecheck journeys."
        ),
        "files": files_out,
    }


def build_bun_capture() -> dict:
    version_txt = WAVE / "bun/bun-version.txt"
    local_version = version_txt.read_text().splitlines()[0].strip() if version_txt.exists() else None
    pkg = json.loads(PKG_JSON.read_text())
    lock = load_bun_lock(LOCK)
    packages = lock.get("packages") or {}
    bun_types_key = None
    for key in packages:
        if key == "bun-types" or key.startswith("bun-types@"):
            bun_types_key = key
            break
    docs = []
    for label, url, fname in [
        ("install", "https://bun.com/docs/installation", "install.html"),
        ("lockfile", "https://bun.com/docs/install/lockfile", "lockfile.html"),
        ("nodejs-compat", "https://bun.com/docs/runtime/nodejs-compat", "nodejs-compat.html"),
        ("package-manager", "https://bun.com/docs/cli/bun-install", "package-manager.html"),
        ("bun-version-docs", "https://bun.com/docs/guides/install/bun-version", "bun-version-docs.html"),
    ]:
        path = WAVE / "bun" / fname
        if path.exists():
            docs.append(
                {
                    "label": label,
                    "url": url,
                    "path": rel(path),
                    "sha256": sha256(path),
                    "byteLength": path.stat().st_size,
                    "headersPath": rel(path.with_suffix(".headers.txt"))
                    if path.with_suffix(".headers.txt").exists()
                    else None,
                }
            )
    pin_candidates = {
        "package.json.engines": pkg.get("engines"),
        "package.json.packageManager": pkg.get("packageManager"),
        "package.json.volta": pkg.get("volta"),
        "dotBunVersionFile": (SCRIPTS / ".bun-version").exists(),
        "bunfigToml": (SCRIPTS / "bunfig.toml").exists(),
        "bunLockPinsBunBinary": False,
    }
    return {
        "capturedAt": NOW,
        "localBunVersionCapture": rel(version_txt),
        "localBunVersionSha256": sha256(version_txt) if version_txt.exists() else None,
        "localBunStdout": local_version,
        "docs": docs,
        "pinCandidatesChecked": pin_candidates,
        "manifestDevDependencies": pkg.get("devDependencies"),
        "lockBunTypesResolved": bun_types_key,
        "typesVersusRuntimeNote": (
            f"Lock resolves {bun_types_key}; local bun --version is {local_version}. "
            "bun-types is not an official Bun runtime pin."
        ),
        "pinStatus": "unresolved",
        "note": (
            "Wave-005 re-probed tools scripts for engines/packageManager/volta/"
            ".bun-version/bunfig.toml and re-fetched official Bun docs including the "
            "bun-version guide. No official Bun binary pin exists in the tools subtree. "
            "Do not invent a pin from local version or bun-types."
        ),
    }


def build_host_disposition() -> dict:
    return {
        "capturedAt": NOW,
        "dispositionClass": "environment-bound",
        "edges": [
            {
                "from": "cursor-cli-host",
                "to": "cursor-self-hosted-computer-use",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "evidence": [
                    rel(COMPUTER_USE),
                    "parity/research/dep-closure-wave-005/nodes/host-edge-disposition.md",
                ],
                "docSha256": sha256(COMPUTER_USE),
                "blocker": (
                    "Public docs only (computer-use.md). Closing this edge requires "
                    "exercising macOS Cursor Computer Use helper identity "
                    "(co.anysphere.cursor-computer-use / Team ID DCNK4UB866), "
                    "Accessibility and Screen Recording grants, Linux X11/desktop "
                    "packages, and desktop-sharing transport. This worker must not "
                    "fabricate those runtime observations."
                ),
                "docContractsExtracted": [
                    "Explicit opt-in via agent worker --computer-use",
                    "macOS helper Cursor Computer Use with Accessibility + Screen Recording",
                    "Linux X11 display and desktop packages",
                    "Desktop sharing Linux-only via --share-desktop",
                ],
            },
            {
                "from": "cursor-cli-host",
                "to": "cursor-enterprise-integration-policy",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "evidence": [
                    rel(MODEL_MGMT),
                    "parity/research/dep-closure-wave-005/nodes/host-edge-disposition.md",
                ],
                "docSha256": sha256(MODEL_MGMT),
                "blocker": (
                    "Public docs only (model-management.md). Closing this edge requires "
                    "observing live Enterprise team/org model access, MCP allowlist "
                    "enforcement, and CLI applicability. Standing orders forbid broad "
                    "allowlist or authorization changes."
                ),
                "docContractsExtracted": [
                    "Enterprise model access via Team Settings and Organization Groups",
                    "Most-permissive union of team and group model allowlists",
                    "MCP allowlist / trust management",
                    "BYOK controls on Team Settings only",
                ],
            },
        ],
        "journeyEdgesUnchanged": [
            {
                "from": "cursor-pstack",
                "to": "cursor-team-kit",
                "keepStatus": "unverified",
                "blocker": (
                    "Distribution custody exists. Complete source and paired journey "
                    "closure for the full skill set is not shown."
                ),
            },
            {
                "from": "cursor-pstack",
                "to": "cursor-cli-host",
                "keepStatus": "unverified",
                "blocker": (
                    "Persistent-mode editor actions (Option/Alt+Enter) and later-turn "
                    "behavior still need paired Cursor+Pi runtime evidence."
                ),
            },
        ],
    }


def build_merge_proposal(bun: dict, ts: dict, host: dict) -> dict:
    ts_progress_path = "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json"
    bun_capture_path = "parity/research/dep-closure-wave-005/bun/official-capture.json"
    host_path = "parity/research/dep-closure-wave-005/host-edge-disposition.json"

    # Closable: wave-004 already completed these audits; they should leave unresolvedReferences.
    remove_closed = [
        "Tools bun.lock platform-conditional branches audited at parity/research/dep-closure-wave-004/platform-matrix.json (cpu none=['@typescript/typescript-linux-loong64', '@typescript/typescript-linux-mips64el', '@typescript/typescript-linux-riscv64']; os none=['@typescript/typescript-netbsd-arm64', '@typescript/typescript-netbsd-x64']).",
        "Tools bun.lock registry/tarball custody verified for all 25 packages at parity/research/dep-closure-wave-004/registry-custody.json (integrity match to prior retrievals; registry signature authentication still not performed).",
        "Runtime/platform prerequisites for tools scripts recorded at parity/research/dep-closure-wave-004/nodes/runtime-prerequisites.md; official Bun binary pin still required for source-bun-runtime closure.",
        "Node-builtin compatibility for commander evidenced under local bun 1.4.2 and official docs at parity/research/dep-closure-wave-004/bun; not a substitute for an official Bun version pin.",
        "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-004 capture at parity/research/dep-closure-wave-004/bun/official-capture.json (local 1.4.2 only; no engines/packageManager/.bun-version; bun-types lock resolve bun-types@1.3.14 is not a runtime pin).",
        "npm:typescript@7.0.2 contract-surface recorded at parity/research/dep-closure-wave-004/npm/typescript-contract-surface.json; semantic per-file body audit of inventoried files still open.",
        "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-004 public-doc re-hash; runtime services closed or environment-bound (parity/research/dep-closure-wave-004/host-edge-disposition.json).",
    ]

    add_refs = [
        (
            f"Official Bun runtime version pin under source-bun-runtime remains unresolved "
            f"after wave-005 capture at {bun_capture_path} "
            f"(local {bun.get('localBunStdout')} only; no engines/packageManager/volta/"
            f".bun-version/bunfig; bun-types lock resolve {bun.get('lockBunTypesResolved')} "
            f"is not a runtime pin)."
        ),
        (
            f"npm:typescript@7.0.2 structural per-file body-contract audit recorded at "
            f"{ts_progress_path} "
            f"({ts['bodyAuditedFileCount']}/{ts['inventoriedFileCount']} files; "
            f"hash mismatches={len(ts['hashMismatches'])}). "
            f"Deep compiler-behavior semantics for "
            f"{ts['deepInternalFileCountStillOpenForCompilerSemantics']} internal "
            f"dist files remain open."
        ),
        (
            "cursor-cli-host edges to computer-use and enterprise policy remain unresolved "
            f"after wave-005 environment-bound disposition at {host_path}; "
            "runtime services were not exercised."
        ),
    ]

    keep_refs = [
        "Required live integrations, cloud services, automation editor, models and supporting tools.",
        "Recursive references in inspected sources still require complete extraction and audit.",
        "cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture at parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md.",
        "Tools package consumer binding recorded at parity/research/dep-closure-wave-003/consumer-binding.json (commander runtime; bun-types/typescript test/typecheck). Broader acceptance journeys remain open.",
    ]

    return {
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
            "computer-use/enterprise edges, journey edges, typescript deep "
            "compiler-behavior semantics, and broader recursive/live integrations "
            "remain open."
        ),
        "resolvedReferenceCount": 4,
        "unresolvedTargetCount": 7,
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "source-bun-runtime",
                    "set": {
                        "readingEvidence": [
                            "parity/research/dep-closure-wave-005/read-inventory.json",
                            bun_capture_path,
                            "parity/research/dep-closure-wave-005/nodes/bun-pin.md",
                        ]
                    },
                    "evidence": [bun_capture_path],
                    "disposition": (
                        "Wave-005 re-probed pin candidates and re-fetched official Bun "
                        "docs. Official Bun binary version pin remains unresolved."
                    ),
                },
                {
                    "id": "npm:typescript@7.0.2",
                    "set": {
                        "readingEvidence": [
                            ts_progress_path,
                            "parity/research/dep-closure-wave-004/npm/typescript-contract-surface.json",
                            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json",
                        ]
                    },
                    "evidence": [
                        ts_progress_path,
                        "parity/research/dep-closure-wave-005/nodes/typescript-body-audit.md",
                    ],
                    "disposition": (
                        f"Structural per-file body-contract audit complete for "
                        f"{ts['bodyAuditedFileCount']}/{ts['inventoriedFileCount']} files. "
                        f"Deep compiler-behavior semantics remain open for "
                        f"{ts['deepInternalFileCountStillOpenForCompilerSemantics']} "
                        f"internal dist files."
                    ),
                },
                {
                    "id": "cursor-self-hosted-computer-use",
                    "set": {
                        "readingEvidence": [
                            host_path,
                            "parity/research/dep-closure-wave-005/nodes/host-edge-disposition.md",
                        ]
                    },
                    "evidence": [host_path],
                    "disposition": (
                        "Environment-bound. Public-doc contracts re-hashed; runtime "
                        "helper/desktop services not exercised."
                    ),
                },
                {
                    "id": "cursor-enterprise-integration-policy",
                    "set": {
                        "readingEvidence": [
                            host_path,
                            "parity/research/dep-closure-wave-005/nodes/host-edge-disposition.md",
                        ]
                    },
                    "evidence": [host_path],
                    "disposition": (
                        "Environment-bound. Public-doc contracts re-hashed; live "
                        "team/org policy enforcement not observed."
                    ),
                },
            ],
            "edgeMutations": [],
            "honestUnresolvedEdges": host["edges"] + host["journeyEdgesUnchanged"],
            "unresolvedReferences": {
                "removeIfPresent": remove_closed,
                "add": add_refs,
                "keep": keep_refs,
                "note": (
                    "Close four wave-004 npm/tree status strings that already have "
                    "path+hash evidence (platform matrix, registry custody, runtime "
                    "prerequisites, node-builtin note). Replace Bun/typescript/host "
                    "lines with wave-005 evidence. Keep live/recursive/journey items."
                ),
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": (
                    "Leave false. Bun pin, four host/journey edges, and typescript "
                    "deep compiler-behavior semantics remain open."
                ),
            }
        },
        "remainingGaps": [
            "Official Bun version pin under source-bun-runtime stays unresolved.",
            "cursor-cli-host → computer-use and enterprise-policy stay unresolved (environment-bound).",
            "cursor-pstack → cursor-team-kit and cursor-cli-host stay unverified (journey evidence).",
            "typescript deep compiler-behavior semantics for internal dist files still open.",
            "completeDependencyClosure must stay false.",
        ],
        "doNotEdit": [
            "parity/dependencies.json",
            "parity/source-lock.json",
            "parity/requirements.json",
            "parity/mismatches.json",
            "parity/progress.md",
        ],
    }


def build_inventory(paths: list[Path]) -> dict:
    sources = []
    for path in paths:
        if not path.exists():
            continue
        sources.append(
            {
                "id": rel(path).replace("/", "__"),
                "path": rel(path),
                "absolutePath": str(path),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
            }
        )
    return {
        "unit": UNIT,
        "createdAt": NOW,
        "sourceCount": len(sources),
        "allSources": sources,
    }


def main() -> None:
    WAVE.mkdir(parents=True, exist_ok=True)
    (WAVE / "npm").mkdir(exist_ok=True)
    (WAVE / "nodes").mkdir(exist_ok=True)
    (WAVE / "bun").mkdir(exist_ok=True)

    bun = build_bun_capture()
    write_json(WAVE / "bun/official-capture.json", bun)
    write_text(
        WAVE / "nodes/bun-pin.md",
        "\n".join(
            [
                "# Official Bun runtime version pin",
                "",
                f"Local bun --version: `{bun.get('localBunStdout')}` "
                f"(capture sha256=`{bun.get('localBunVersionSha256')}`).",
                f"Lock bun-types: `{bun.get('lockBunTypesResolved')}`.",
                "",
                bun["typesVersusRuntimeNote"],
                "",
                bun["note"],
                "",
                "pinStatus: unresolved",
                "",
            ]
        ),
    )

    ts = build_typescript_body_audit()
    # Compact summary without embedding every file in merge docs; full file list stays in JSON.
    write_json(WAVE / "npm/typescript-body-audit.json", ts)
    write_text(
        WAVE / "nodes/typescript-body-audit.md",
        "\n".join(
            [
                "# typescript@7.0.2 per-file body audit",
                "",
                f"Inventoried files: {ts['inventoriedFileCount']}.",
                f"Body-audited files: {ts['bodyAuditedFileCount']}.",
                f"Hash mismatches: {len(ts['hashMismatches'])}.",
                f"Structural body audit complete: {ts['structuralBodyAuditComplete']}.",
                f"Deep internal files still open for compiler semantics: "
                f"{ts['deepInternalFileCountStillOpenForCompilerSemantics']}.",
                "",
                "Audit definition:",
                ts["auditDefinition"],
                "",
                ts["deepCompilerSemanticsNote"],
                "",
                f"Evidence: {rel(WAVE / 'npm/typescript-body-audit.json')}",
                "",
            ]
        ),
    )

    host = build_host_disposition()
    write_json(WAVE / "host-edge-disposition.json", host)
    write_text(
        WAVE / "nodes/host-edge-disposition.md",
        "\n".join(
            [
                "# Host computer-use and enterprise edges",
                "",
                "Disposition class: environment-bound.",
                "",
                "## cursor-cli-host → cursor-self-hosted-computer-use",
                "",
                f"docSha256: `{host['edges'][0]['docSha256']}`",
                "",
                host["edges"][0]["blocker"],
                "",
                "## cursor-cli-host → cursor-enterprise-integration-policy",
                "",
                f"docSha256: `{host['edges'][1]['docSha256']}`",
                "",
                host["edges"][1]["blocker"],
                "",
                "Journey edges cursor-pstack → cursor-team-kit and cursor-pstack → "
                "cursor-cli-host stay unverified (paired runtime evidence missing).",
                "",
            ]
        ),
    )

    merge = build_merge_proposal(bun, ts, host)
    write_json(WAVE / "merge-proposal.json", merge)

    decisions = [
        "unit\tdecision\tevidence",
        f"{UNIT}\tbun_pin_unresolved\t{rel(WAVE / 'bun/official-capture.json')}",
        f"{UNIT}\thost_edges_environment_bound\t{rel(WAVE / 'host-edge-disposition.json')}",
        f"{UNIT}\ttypescript_structural_body_audit_progress\t{rel(WAVE / 'npm/typescript-body-audit.json')}",
        f"{UNIT}\tclose_wave004_npm_tree_status_refs\t{rel(WAVE / 'merge-proposal.json')}",
        f"{UNIT}\tcompleteDependencyClosure_false\t{rel(WAVE / 'merge-proposal.json')}",
    ]
    write_text(WAVE / "decisions.tsv", "\n".join(decisions) + "\n")

    inventory_paths = [
        WAVE / "bun/official-capture.json",
        WAVE / "bun/bun-version.txt",
        WAVE / "bun/install.html",
        WAVE / "bun/lockfile.html",
        WAVE / "bun/nodejs-compat.html",
        WAVE / "bun/package-manager.html",
        WAVE / "bun/bun-version-docs.html",
        WAVE / "npm/typescript-body-audit.json",
        WAVE / "host-edge-disposition.json",
        WAVE / "nodes/bun-pin.md",
        WAVE / "nodes/typescript-body-audit.md",
        WAVE / "nodes/host-edge-disposition.md",
        WAVE / "merge-proposal.json",
        WAVE / "decisions.tsv",
        COMPUTER_USE,
        MODEL_MGMT,
        TS_INVENTORY,
        PKG_JSON,
        LOCK,
    ]
    inv = build_inventory(inventory_paths)
    write_json(WAVE / "read-inventory.json", inv)

    verify_py = WAVE / "verify_inventory_shasum.py"
    write_text(
        verify_py,
        """#!/usr/bin/env python3
\"\"\"Rerun inventory hash check with shasum -a 256. Exit 1 on mismatch.\"\"\"
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
""",
    )
    verify_py.chmod(0o755)

    # Re-hash inventory after writing verify script is not included; run verify now.
    proc = subprocess.run(
        ["python3", str(verify_py)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    write_json(
        WAVE / "verify-hashes.json",
        {
            "unit": UNIT,
            "ranAt": NOW,
            "exitCode": proc.returncode,
            "status": "VERIFIED" if proc.returncode == 0 else "NOT_VERIFIED",
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        },
    )
    print(proc.stdout)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)
    print(f"Wrote wave artifacts under {rel(WAVE)}")


if __name__ == "__main__":
    main()
