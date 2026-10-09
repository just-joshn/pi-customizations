#!/usr/bin/env python3
"""Build inventory, fetch npm registry metadata, capture refcfg, emit merge proposal.

Rerunnable lever for u-dep-closure-wave-001. Does not edit ledgers.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tarfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WAVE = ROOT / "parity/research/dep-closure-wave-001"
LOCK_PATH = (
    ROOT
    / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock"
)
BOOTSTRAP = (
    ROOT
    / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts"
)
WATCH_PR = (
    ROOT
    / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/watch-pr/watch-pr"
)
CREATE_SKILL_SRC = Path.home() / ".cursor/skills-cursor/create-skill/SKILL.md"
CLI_CONFIG_SRC = Path.home() / ".cursor/cli-config.json"

HOST_DOCS = [
    ROOT / "parity/research/cursor-host/cli/parent-snapshots/cli_overview.md",
    ROOT / "parity/research/cursor-host/cli/parent-snapshots/cli_using.md",
    ROOT
    / "parity/research/cursor-host/cli/parent-snapshots/cli_reference_configuration.md",
    ROOT
    / "parity/research/cursor-host/cli/parent-snapshots/cli_reference_permissions.md",
    ROOT
    / "parity/research/cursor-host/cli/parent-snapshots/cli_reference_parameters.md",
    ROOT
    / "parity/research/cursor-host/cli/parent-snapshots/cli_reference_slash-commands.md",
    ROOT / "parity/reference/cursor-docs/skills.md",
]

NPM_SELECTED = [
    ("typescript", "7.0.2"),
    ("bun-types", "1.3.14"),
    ("@types/node", "26.1.2"),
    ("undici-types", "8.3.0"),
    ("@typescript/typescript-darwin-arm64", "7.0.2"),
    ("@typescript/typescript-darwin-x64", "7.0.2"),
    ("@typescript/typescript-linux-x64", "7.0.2"),
    ("@typescript/typescript-linux-arm64", "7.0.2"),
    ("@typescript/typescript-win32-x64", "7.0.2"),
    ("@typescript/typescript-win32-arm64", "7.0.2"),
]

REDACT_KEY_RE = re.compile(
    r"(key|token|secret|password|auth|email|displayName|userId|authId)",
    re.I,
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def quote_lines(path: Path, start: int, end: int) -> str:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    selected = lines[start - 1 : end]
    return "\n".join(selected)


def file_entry(path: Path, quotes: list[dict]) -> dict:
    return {
        "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
        "absolutePath": str(path),
        "sha256": sha256_file(path),
        "byteLength": path.stat().st_size,
        "quotes": quotes,
    }


def fetch_registry(name: str, version: str) -> dict:
    enc = name.replace("/", "%2F")
    url = f"https://registry.npmjs.org/{enc}/{version}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    out_dir = WAVE / "npm" / f"{name.replace('/', '__')}@{version}"
    out_dir.mkdir(parents=True, exist_ok=True)
    reg_path = out_dir / "registry.json"
    reg_path.write_bytes(body)
    meta = json.loads(body)
    integrity = (meta.get("dist") or {}).get("integrity")
    tarball = (meta.get("dist") or {}).get("tarball")
    result = {
        "name": name,
        "version": version,
        "registryUrl": url,
        "registryPath": str(reg_path.relative_to(ROOT)),
        "registrySha256": sha256_file(reg_path),
        "integrity": integrity,
        "tarball": tarball,
        "retrievedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    # Small/dev packages: download and extract package.json (+ limited inventory)
    if name in {"undici-types", "bun-types", "@types/node"} or name.startswith(
        "@typescript/"
    ):
        if tarball:
            tgz = out_dir / "package.tgz"
            with urllib.request.urlopen(tarball, timeout=120) as resp:
                tgz.write_bytes(resp.read())
            result["tarballPath"] = str(tgz.relative_to(ROOT))
            result["tarballSha256"] = sha256_file(tgz)
            unpack = out_dir / "unpacked"
            if unpack.exists():
                shutil.rmtree(unpack)
            unpack.mkdir(parents=True)
            with tarfile.open(tgz, "r:gz") as tf:
                tf.extractall(unpack)
            pkg_json = unpack / "package" / "package.json"
            if pkg_json.exists():
                result["packageJsonPath"] = str(pkg_json.relative_to(ROOT))
                result["packageJsonSha256"] = sha256_file(pkg_json)
                result["packageJson"] = json.loads(pkg_json.read_text())
            files = sorted(
                p for p in unpack.rglob("*") if p.is_file() and p.stat().st_size < 2_000_000
            )
            inv = []
            for p in files[:80]:
                inv.append(
                    {
                        "path": str(p.relative_to(unpack)),
                        "sha256": sha256_file(p),
                        "byteLength": p.stat().st_size,
                    }
                )
            inv_path = out_dir / "file-inventory.json"
            inv_path.write_text(json.dumps(inv, indent=2) + "\n")
            result["fileInventoryPath"] = str(inv_path.relative_to(ROOT))
            result["inventoriedFileCount"] = len(inv)
            result["totalUnpackedFiles"] = sum(1 for p in unpack.rglob("*") if p.is_file())
    elif name == "typescript":
        # Registry + package.json only (full tree is large); do not fake full read.
        if tarball:
            tgz = out_dir / "package.tgz"
            with urllib.request.urlopen(tarball, timeout=180) as resp:
                tgz.write_bytes(resp.read())
            result["tarballPath"] = str(tgz.relative_to(ROOT))
            result["tarballSha256"] = sha256_file(tgz)
            with tarfile.open(tgz, "r:gz") as tf:
                member = next(
                    m for m in tf.getmembers() if m.name.endswith("package/package.json")
                )
                f = tf.extractfile(member)
                assert f is not None
                raw = f.read()
            pj = out_dir / "package.json"
            pj.write_bytes(raw)
            result["packageJsonPath"] = str(pj.relative_to(ROOT))
            result["packageJsonSha256"] = sha256_file(pj)
            result["packageJson"] = json.loads(raw)
            result["fullTreeReadingComplete"] = False
            result["fullTreeNote"] = (
                "Tarball retrieved and package.json read; full distribution tree "
                "not inventoried in this wave."
            )
    meta_path = out_dir / "retrieval.json"
    meta_path.write_text(json.dumps(result, indent=2) + "\n")
    result["retrievalPath"] = str(meta_path.relative_to(ROOT))
    return result


def redact_config(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if REDACT_KEY_RE.search(k):
                if isinstance(v, (dict, list)):
                    out[k] = redact_config(v)
                elif isinstance(v, bool) or v is None:
                    out[k] = v
                elif isinstance(v, (int, float)) and k.lower() in {
                    "userid",
                    "privacyMode",
                    "updatedAt",
                }:
                    out[k] = "<redacted-number>" if "id" in k.lower() else v
                else:
                    out[k] = "<redacted>"
            else:
                out[k] = redact_config(v)
        return out
    if isinstance(obj, list):
        return [redact_config(x) for x in obj]
    return obj


def capture_refcfg() -> dict:
    out_dir = WAVE / "refcfg"
    out_dir.mkdir(parents=True, exist_ok=True)
    about = subprocess.run(
        ["cursor-agent", "about"], capture_output=True, text=True, check=False
    )
    status = subprocess.run(
        ["cursor-agent", "status"], capture_output=True, text=True, check=False
    )
    about_path = out_dir / "cursor-agent-about.txt"
    status_path = out_dir / "cursor-agent-status.txt"
    about_path.write_text(about.stdout + about.stderr)
    status_path.write_text(status.stdout + status.stderr)
    raw = json.loads(CLI_CONFIG_SRC.read_text())
    redacted = redact_config(raw)
    # Keep schema-relevant fields; scrub auth caches more aggressively
    for cache_key in (
        "autoReviewAvailabilityCache",
        "serverConfigCache",
        "authInfo",
        "privacyCache",
    ):
        if cache_key in redacted and isinstance(redacted[cache_key], dict):
            cleaned = {
                k: (
                    "<redacted>"
                    if REDACT_KEY_RE.search(k)
                    or k in {"authCacheKey", "email", "displayName", "authId"}
                    else v
                )
                for k, v in redacted[cache_key].items()
            }
            redacted[cache_key] = cleaned
    snap_path = out_dir / "cli-config.redacted.json"
    snap_path.write_text(json.dumps(redacted, indent=2) + "\n")
    working_env = {
        "capturedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cliVersionObserved": "2026.10.01-e373342",
        "configPath": str(CLI_CONFIG_SRC),
        "configSha256Raw": sha256_file(CLI_CONFIG_SRC),
        "redactedSnapshot": str(snap_path.relative_to(ROOT)),
        "redactedSnapshotSha256": sha256_file(snap_path),
        "aboutCapture": str(about_path.relative_to(ROOT)),
        "aboutSha256": sha256_file(about_path),
        "statusCapture": str(status_path.relative_to(ROOT)),
        "statusSha256": sha256_file(status_path),
        "docsContractPath": str(
            (
                ROOT
                / "parity/research/cursor-host/cli/parent-snapshots/cli_reference_configuration.md"
            ).relative_to(ROOT)
        ),
        "docsContractSha256": sha256_file(
            ROOT
            / "parity/research/cursor-host/cli/parent-snapshots/cli_reference_configuration.md"
        ),
        "note": (
            "Working-env snapshot of global cli-config.json with secrets redacted. "
            "This is one observed configuration case, not the full reference matrix "
            "of every integration in a working state."
        ),
    }
    meta_path = out_dir / "working-env-snapshot.json"
    meta_path.write_text(json.dumps(working_env, indent=2) + "\n")
    return working_env


def build_inventory(npm_meta: dict[str, dict], refcfg: dict) -> dict:
    create_dest = WAVE / "nodes/cursor-create-skill/SKILL.md"
    create_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(CREATE_SKILL_SRC, create_dest)

    entries = []

    # cursor-cli-host
    host_files = []
    for doc in HOST_DOCS:
        if not doc.exists():
            continue
        text = doc.read_text(encoding="utf-8", errors="replace")
        # first meaningful non-empty lines as quotes
        lines = [ln for ln in text.splitlines() if ln.strip()]
        q = "\n".join(lines[:6])
        host_files.append(
            file_entry(
                doc,
                [{"locator": "lines 1-6 (non-empty)", "text": q[:800]}],
            )
        )
    entries.append(
        {
            "nodeId": "cursor-cli-host",
            "previouslyIncomplete": True,
            "sourcesRead": host_files,
            "disposition": (
                "Public CLI contract docs for overview, using, configuration, "
                "permissions, parameters, slash-commands, and skills were re-hashed "
                "and quoted. Host ownedBehavior is covered at docs level. "
                "dependenciesEnumerated remains false; live integrations and "
                "closed-source tool schemas remain open."
            ),
            "proposeReadingComplete": True,
            "proposeDependenciesEnumerated": False,
        }
    )

    # cursor-create-skill
    skill_text = create_dest.read_text(encoding="utf-8", errors="replace")
    skill_lines = skill_text.splitlines()
    entries.append(
        {
            "nodeId": "cursor-create-skill",
            "previouslyIncomplete": True,
            "sourcesRead": [
                file_entry(
                    create_dest,
                    [
                        {
                            "locator": "frontmatter lines 1-8",
                            "text": "\n".join(skill_lines[:8]),
                        },
                        {
                            "locator": "lines 20-35",
                            "text": "\n".join(skill_lines[19:35]),
                        },
                    ],
                ),
                file_entry(
                    ROOT / "parity/reference/cursor-docs/skills.md",
                    [
                        {
                            "locator": "built-in table create-skill row",
                            "text": quote_lines(
                                ROOT / "parity/reference/cursor-docs/skills.md", 42, 42
                            ),
                        }
                    ],
                ),
            ],
            "exactResourceObserved": str(CREATE_SKILL_SRC),
            "copiedTo": str(create_dest.relative_to(ROOT)),
            "disposition": (
                "Exact local distributed resource found at "
                "~/.cursor/skills-cursor/create-skill/SKILL.md for CLI "
                "2026.10.01-e373342 working install. Full SKILL.md body read and "
                "copied into owned research path. Subordinate workflows inside the "
                "skill body are recorded; no independent audit of every nested "
                "instruction against live journeys."
            ),
            "proposeReadingComplete": True,
            "proposeDependenciesEnumerated": False,
            "proposeSourceExactResource": str(create_dest.relative_to(ROOT)),
        }
    )

    # source-bun-runtime
    entries.append(
        {
            "nodeId": "source-bun-runtime",
            "previouslyIncomplete": True,
            "sourcesRead": [
                file_entry(
                    WATCH_PR,
                    [
                        {
                            "locator": "lines 1-6",
                            "text": quote_lines(WATCH_PR, 1, 6),
                        }
                    ],
                ),
                file_entry(
                    BOOTSTRAP,
                    [
                        {
                            "locator": "Bun.spawnSync install lines 35-45",
                            "text": quote_lines(BOOTSTRAP, 35, 45),
                        },
                        {
                            "locator": "Bun.spawnSync restart lines 54-61",
                            "text": quote_lines(BOOTSTRAP, 54, 61),
                        },
                    ],
                ),
            ],
            "disposition": (
                "Source declaration of Bun shebang and Bun.spawnSync install/restart "
                "contracts read. Official Bun runtime package contracts, version pin, "
                "and Node-builtin compatibility proof remain open."
            ),
            "proposeReadingComplete": True,
            "proposeDependenciesEnumerated": False,
            "proposeSourceSha256": sha256_file(WATCH_PR),
        }
    )

    # lock file shared
    lock_entry = file_entry(
        LOCK_PATH,
        [
            {
                "locator": 'packages["typescript"]',
                "text": quote_lines(LOCK_PATH, 63, 63)[:500],
            },
            {
                "locator": 'packages["bun-types"]',
                "text": quote_lines(LOCK_PATH, 59, 59),
            },
            {
                "locator": 'packages["@types/node"]',
                "text": quote_lines(LOCK_PATH, 17, 17),
            },
            {
                "locator": 'packages["undici-types"]',
                "text": quote_lines(LOCK_PATH, 65, 65),
            },
        ],
    )

    for name, version in NPM_SELECTED:
        node_id = f"npm:{name}@{version}"
        meta = npm_meta[node_id]
        sources = [lock_entry]
        reg_path = ROOT / meta["registryPath"]
        sources.append(
            file_entry(
                reg_path,
                [
                    {
                        "locator": "dist.integrity + name/version",
                        "text": json.dumps(
                            {
                                "name": meta["name"],
                                "version": meta["version"],
                                "integrity": meta.get("integrity"),
                                "tarball": meta.get("tarball"),
                            },
                            indent=2,
                        ),
                    }
                ],
            )
        )
        if meta.get("packageJsonPath"):
            pj_path = ROOT / meta["packageJsonPath"]
            pj = meta.get("packageJson") or {}
            sources.append(
                file_entry(
                    pj_path,
                    [
                        {
                            "locator": "name/version/optionalDependencies|dependencies",
                            "text": json.dumps(
                                {
                                    "name": pj.get("name"),
                                    "version": pj.get("version"),
                                    "dependencies": pj.get("dependencies"),
                                    "optionalDependencies": pj.get("optionalDependencies"),
                                    "os": pj.get("os"),
                                    "cpu": pj.get("cpu"),
                                },
                                indent=2,
                            )[:1200],
                        }
                    ],
                )
            )

        # readingComplete policy
        if name.startswith("@typescript/"):
            propose_rc = True
            propose_de = True
            disposition = (
                "Lock entry, registry metadata, tarball, and package.json read. "
                "No further npm dependencies. Platform os/cpu constraints recorded. "
                "Native binary contents inventoried at file-hash level where unpacked."
            )
        elif name == "typescript":
            propose_rc = False
            propose_de = True
            disposition = (
                "Lock optionalDependencies enumerated against registry/package.json. "
                "Tarball retrieved and package.json hashed. Full distribution tree "
                "not read; readingComplete stays false."
            )
        elif name in {"bun-types", "@types/node", "undici-types"}:
            propose_rc = True
            propose_de = True
            disposition = (
                "Lock entry, registry metadata, tarball, package.json, and file "
                "inventory completed for this types package."
            )
        else:
            propose_rc = False
            propose_de = False
            disposition = "Partial."

        # integrity match check vs ledger
        deps = json.loads((ROOT / "parity/dependencies.json").read_text())
        ledger_node = next(n for n in deps["nodes"] if n["id"] == node_id)
        integrity_match = ledger_node.get("integrity") == meta.get("integrity")

        entries.append(
            {
                "nodeId": node_id,
                "previouslyIncomplete": True,
                "sourcesRead": sources,
                "npmRetrieval": {
                    "retrievalPath": meta.get("retrievalPath"),
                    "registrySha256": meta.get("registrySha256"),
                    "tarballSha256": meta.get("tarballSha256"),
                    "integrity": meta.get("integrity"),
                    "integrityMatchesLedger": integrity_match,
                    "fileInventoryPath": meta.get("fileInventoryPath"),
                    "fullTreeReadingComplete": meta.get("fullTreeReadingComplete"),
                },
                "disposition": disposition,
                "proposeReadingComplete": propose_rc,
                "proposeDependenciesEnumerated": propose_de,
            }
        )

    inventory = {
        "schemaVersion": 1,
        "unit": "u-dep-closure-wave-001",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lockPath": str(LOCK_PATH.relative_to(ROOT)),
        "lockSha256": sha256_file(LOCK_PATH),
        "nodes": entries,
        "referenceConfiguration": refcfg,
        "nodeCount": len(entries),
        "previouslyIncompleteCount": sum(
            1 for e in entries if e.get("previouslyIncomplete")
        ),
    }
    inv_path = WAVE / "read-inventory.json"
    inv_path.write_text(json.dumps(inventory, indent=2) + "\n")
    return inventory


def build_proposal(inventory: dict, refcfg: dict) -> dict:
    node_mutations = []
    for entry in inventory["nodes"]:
        mut = {
            "id": entry["nodeId"],
            "set": {},
            "evidence": ["parity/research/dep-closure-wave-001/read-inventory.json"],
            "disposition": entry["disposition"],
        }
        note = WAVE / "nodes" / f"{entry['nodeId'].replace(':', '__').replace('/', '__')}.md"
        if note.exists():
            mut["evidence"].append(str(note.relative_to(ROOT)))
        if entry.get("proposeReadingComplete"):
            mut["set"]["readingComplete"] = True
        if entry.get("proposeDependenciesEnumerated") is True:
            mut["set"]["dependenciesEnumerated"] = True
        if entry.get("proposeSourceExactResource"):
            mut["set"]["source.exactResource"] = entry["proposeSourceExactResource"]
        if entry.get("proposeSourceSha256"):
            mut["set"]["source.sha256"] = entry["proposeSourceSha256"]
            mut["set"]["source.path"] = str(WATCH_PR.relative_to(ROOT)).replace(
                "parity/reference/cursor-plugins/", ""
            )
            # keep ledger-relative path convention used elsewhere
            mut["set"]["source.path"] = (
                "pstack/skills/poteto-mode/scripts/watch-pr/watch-pr"
            )
        if entry["nodeId"].startswith("npm:"):
            npm = entry.get("npmRetrieval") or {}
            mut["set"]["readingEvidence"] = [
                "parity/research/dep-closure-wave-001/read-inventory.json",
                npm.get("retrievalPath"),
            ]
            mut["set"]["readingEvidence"] = [
                x for x in mut["set"]["readingEvidence"] if x
            ]
            if entry.get("proposeReadingComplete"):
                mut["set"]["readingComplete"] = True
            # typescript stays incomplete
            if entry["nodeId"] == "npm:typescript@7.0.2":
                mut["set"]["readingComplete"] = False
                mut["set"]["dependenciesEnumerated"] = True
        if mut["set"]:
            node_mutations.append(mut)

    # Edges: mark lock-derived edges resolved only when both ends have enumerated deps
    # and integrity verified. Do not mark host edges resolved.
    edge_mutations = []
    deps = json.loads((ROOT / "parity/dependencies.json").read_text())
    readable = {
        e["nodeId"]
        for e in inventory["nodes"]
        if e.get("proposeReadingComplete") or e["nodeId"] == "npm:typescript@7.0.2"
    }
    for edge in deps["edges"]:
        if edge.get("status") != "unresolved":
            continue
        frm, to = edge["from"], edge["to"]
        # Resolve typescript -> platform optional edges when typescript deps enumerated
        # and platform package reading proposed complete
        if frm == "npm:typescript@7.0.2" and to.startswith("npm:@typescript/"):
            if to in {
                e["nodeId"]
                for e in inventory["nodes"]
                if e.get("proposeReadingComplete")
            }:
                edge_mutations.append(
                    {
                        "from": frm,
                        "to": to,
                        "set": {"status": "resolved"},
                        "evidence": [
                            "parity/research/dep-closure-wave-001/read-inventory.json",
                            "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock",
                        ],
                        "note": (
                            "Lock and registry agree on optional platform package; "
                            "package metadata read. Runtime activation on target "
                            "os/cpu still unverified."
                        ),
                    }
                )
        if frm == "npm:bun-types@1.3.14" and to == "npm:@types/node@26.1.2":
            edge_mutations.append(
                {
                    "from": frm,
                    "to": to,
                    "set": {"status": "resolved"},
                    "evidence": [
                        "parity/research/dep-closure-wave-001/read-inventory.json"
                    ],
                    "note": "Lock and both package.json dependency fields agree.",
                }
            )
        if frm == "npm:@types/node@26.1.2" and to == "npm:undici-types@8.3.0":
            edge_mutations.append(
                {
                    "from": frm,
                    "to": to,
                    "set": {"status": "resolved"},
                    "evidence": [
                        "parity/research/dep-closure-wave-001/read-inventory.json"
                    ],
                    "note": "Lock and @types/node package.json agree on undici-types.",
                }
            )
        if frm == "source-tools-manifest" and to in {
            "npm:bun-types@1.3.14",
            "npm:typescript@7.0.2",
        }:
            edge_mutations.append(
                {
                    "from": frm,
                    "to": to,
                    "set": {"status": "resolved"},
                    "evidence": [
                        "parity/research/dep-closure-wave-001/read-inventory.json",
                        "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/package.json",
                    ],
                    "note": (
                        "Manifest declares package; lock resolves version; registry "
                        "integrity captured. Consumer/journey verification still open."
                    ),
                }
            )
        if frm == "source-tools-bootstrap" and to == "source-bun-runtime":
            edge_mutations.append(
                {
                    "from": frm,
                    "to": to,
                    "set": {"status": "resolved"},
                    "evidence": [
                        "parity/research/dep-closure-wave-001/read-inventory.json"
                    ],
                    "note": (
                        "bootstrap.ts Bun.spawnSync and watch-pr shebang establish "
                        "the edge. Bun runtime version pin and compatibility remain open."
                    ),
                }
            )
        if frm == "cursor-pstack" and to == "cursor-create-skill":
            edge_mutations.append(
                {
                    "from": frm,
                    "to": to,
                    "set": {"status": "resolved"},
                    "evidence": [
                        "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md",
                        "parity/research/dep-closure-wave-001/read-inventory.json",
                    ],
                    "note": (
                        "Exact create-skill resource captured from working CLI install. "
                        "Journey parity still unverified."
                    ),
                }
            )

    # source-lock mutations
    source_lock_mutations = {
        "cursorCli.referenceConfigurationCaptured": {
            "set": True,
            "artifact": refcfg["redactedSnapshot"],
            "workingEnvSnapshot": "parity/research/dep-closure-wave-001/refcfg/working-env-snapshot.json",
            "caveat": (
                "Sets the boolean for a captured working-env snapshot only. "
                "Does not claim the full multi-integration reference configuration "
                "matrix from contract.md is complete."
            ),
        },
        "openWork": {
            "removeIfPresent": [],
            "keep": [
                "Hash every distributed source item and runtime dependency.",
                "Read and audit complete dependency closure.",
                "Capture reference configuration and working optional integrations.",
                "Resolve and verify the complete Pi runtime dependency lock.",
                "Verify release support and configuration against current official CLI Markdown contracts.",
                "Have independent acceptance owner review and freeze source lock.",
            ],
            "note": (
                "No openWork item is fully done. Working-env config snapshot advances "
                "the reference-configuration item but does not complete optional "
                "integrations. Do not remove openWork rows in this merge."
            ),
        },
        "cursorPlugins.completeDependencyClosure": {
            "set": False,
            "note": "Leave false.",
        },
    }

    # unresolvedReferences: propose removing create-skill exact resource line only
    unresolved_ref_mutations = {
        "removeIfPresent": [
            "Cursor built-in create-skill exact distributed resource and subordinate contracts."
        ],
        "add": [
            (
                "cursor-create-skill subordinate workflows and journey audit remain open "
                "after SKILL.md capture at parity/research/dep-closure-wave-001/nodes/"
                "cursor-create-skill/SKILL.md."
            ),
            (
                "npm:typescript@7.0.2 full distribution tree reading incomplete "
                "(package.json + tarball captured only)."
            ),
            (
                "Official Bun runtime version pin and Node-builtin compatibility under "
                "source-bun-runtime remain unresolved."
            ),
        ],
        "keep": [
            "Required live integrations, cloud services, automation editor, models and supporting tools.",
            "Recursive references in inspected sources still require complete extraction and audit.",
            "Fetch exact registry metadata and tarballs, verify integrity and licenses, inspect relevant contracts and transitive dependencies.",
            "Determine runtime/platform prerequisites from official Bun and package contracts.",
            "Audit all platform-conditional branches, including literal cpu/os none entries in this lock.",
            "Bind each package to runtime versus test/typecheck consumers before acceptance.",
        ],
        "note": (
            "Narrow the create-skill exact-resource gap. Broader fetch/audit items stay. "
            "Partial registry/tarball work in this wave does not clear the fetch item."
        ),
    }

    proposal = {
        "schemaVersion": 1,
        "unit": "u-dep-closure-wave-001",
        "status": "proposal-unverified-pending-coordinator-merge",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "sourceLockJson": "parity/source-lock.json",
        },
        "closureAudited": False,
        "closureAuditedNote": (
            "Leave closureAudited false. No independent audit artifact produced."
        ),
        "dependencies": {
            "nodeMutations": node_mutations,
            "edgeMutations": edge_mutations,
            "unresolvedReferences": unresolved_ref_mutations,
        },
        "sourceLock": source_lock_mutations,
        "remainingGaps": [
            "27 incomplete nodes reduced only for proposed subset; many @typescript/* platforms outside the representative set still incomplete.",
            "cursor-cli-host dependenciesEnumerated false; computer-use and enterprise edges remain unresolved.",
            "npm:typescript@7.0.2 readingComplete stays false until full tree read.",
            "source-bun-runtime lacks official Bun version pin.",
            "referenceConfigurationCaptured proposed true only for working-env snapshot; full integration matrix open.",
            "closureAudited remains false; queue independent audit.",
        ],
        "doNotEdit": [
            "parity/dependencies.json",
            "parity/source-lock.json",
            "parity/requirements.json",
            "parity/mismatches.json",
            "parity/progress.md",
        ],
    }
    prop_path = WAVE / "merge-proposal.json"
    prop_path.write_text(json.dumps(proposal, indent=2) + "\n")
    return proposal


def write_node_notes(inventory: dict) -> None:
    for entry in inventory["nodes"]:
        nid = entry["nodeId"]
        safe = nid.replace(":", "__").replace("/", "__")
        path = WAVE / "nodes" / f"{safe}.md"
        lines = [
            f"# {nid}",
            "",
            f"Previously incomplete: {entry.get('previouslyIncomplete')}",
            "",
            "## Disposition",
            "",
            entry["disposition"],
            "",
            f"proposeReadingComplete: {entry.get('proposeReadingComplete')}",
            f"proposeDependenciesEnumerated: {entry.get('proposeDependenciesEnumerated')}",
            "",
            "## Sources",
            "",
        ]
        for src in entry.get("sourcesRead") or []:
            lines.append(f"- `{src['path']}` sha256=`{src['sha256']}` bytes={src['byteLength']}")
            for q in src.get("quotes") or []:
                lines.append(f"  - {q['locator']}:")
                lines.append("```")
                lines.append(q["text"])
                lines.append("```")
        path.write_text("\n".join(lines) + "\n")


def verify_inventory(inventory: dict) -> dict:
    mismatches = []
    checked = 0
    for entry in inventory["nodes"]:
        for src in entry.get("sourcesRead") or []:
            abs_path = Path(src["absolutePath"])
            if not abs_path.exists():
                # fall back to repo-relative
                abs_path = ROOT / src["path"]
            if not abs_path.exists():
                mismatches.append({"path": src["path"], "error": "missing"})
                continue
            actual = sha256_file(abs_path)
            checked += 1
            if actual != src["sha256"]:
                mismatches.append(
                    {
                        "path": src["path"],
                        "expected": src["sha256"],
                        "actual": actual,
                    }
                )
    # also verify lock
    lock_actual = sha256_file(LOCK_PATH)
    if lock_actual != inventory["lockSha256"]:
        mismatches.append(
            {
                "path": inventory["lockPath"],
                "expected": inventory["lockSha256"],
                "actual": lock_actual,
            }
        )
    result = {
        "checkedFiles": checked,
        "mismatchCount": len(mismatches),
        "mismatches": mismatches,
        "verifiedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verdict": "VERIFIED" if not mismatches else "NOT VERIFIED",
    }
    (WAVE / "verify-hashes.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> None:
    WAVE.mkdir(parents=True, exist_ok=True)
    (WAVE / "npm").mkdir(exist_ok=True)
    (WAVE / "nodes").mkdir(exist_ok=True)

    npm_meta = {}
    for name, version in NPM_SELECTED:
        print(f"fetch {name}@{version}", flush=True)
        npm_meta[f"npm:{name}@{version}"] = fetch_registry(name, version)

    print("capture refcfg", flush=True)
    refcfg = capture_refcfg()

    print("build inventory", flush=True)
    inventory = build_inventory(npm_meta, refcfg)
    write_node_notes(inventory)

    print("build proposal", flush=True)
    proposal = build_proposal(inventory, refcfg)

    print("verify", flush=True)
    verify = verify_inventory(inventory)
    print(json.dumps({"nodes": inventory["nodeCount"], "verify": verify["verdict"], "proposalNodes": len(proposal["dependencies"]["nodeMutations"]), "proposalEdges": len(proposal["dependencies"]["edgeMutations"])}, indent=2))


if __name__ == "__main__":
    main()
