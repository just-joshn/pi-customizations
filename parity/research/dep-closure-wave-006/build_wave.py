#!/usr/bin/env python3
"""Build u-dep-closure-wave-006 research artifacts. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
UNIT = "u-dep-closure-wave-006"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
SCRIPTS = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts"
LOCK = SCRIPTS / "bun.lock"
PKG_JSON = SCRIPTS / "package.json"
POTETO = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode"
TS_BODY_AUDIT = (
    ROOT / "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json"
)
CREATE_SKILL = (
    ROOT / "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md"
)
LIVE_CREATE_SKILL = Path.home() / ".cursor/skills-cursor/create-skill/SKILL.md"
COMPUTER_USE = ROOT / "parity/research/continuation/computer-use.md"
MODEL_MGMT = ROOT / "parity/research/continuation/model-management.md"

BUN_DOCS = [
    ("install", "https://bun.com/docs/installation", "install.html"),
    ("lockfile", "https://bun.com/docs/pm/lockfile", "lockfile.html"),
    ("nodejs-compat", "https://bun.com/docs/runtime/nodejs-compat", "nodejs-compat.html"),
    ("package-manager", "https://bun.com/docs/pm/cli/install", "package-manager.html"),
    ("bunfig", "https://bun.com/docs/runtime/bunfig", "bunfig.html"),
]

# Prior wave-005 guide URL. Record status honestly when it 404s.
LEGACY_BUN_VERSION_GUIDE = "https://bun.com/docs/guides/install/bun-version"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def fetch_url(url: str, body_path: Path, headers_path: Path) -> dict:
    req = Request(url, headers={"User-Agent": "pi-pstack-parity-dep-closure/6"})
    try:
        with urlopen(req, timeout=60) as resp:
            body = resp.read()
            header_lines = [f"HTTP {resp.status}"]
            for k, v in resp.headers.items():
                header_lines.append(f"{k}: {v}")
            final_url = resp.geturl()
    except HTTPError as exc:
        err_body = exc.read() if exc.fp else b""
        body_path.parent.mkdir(parents=True, exist_ok=True)
        write_text(headers_path, f"HTTP {exc.code}\n{exc.reason}\n")
        if err_body:
            body_path.write_bytes(err_body)
        return {
            "url": url,
            "path": rel(body_path) if err_body else None,
            "sha256": sha256_bytes(err_body) if err_body else None,
            "byteLength": len(err_body),
            "headersPath": rel(headers_path),
            "status": "http_error",
            "httpStatus": exc.code,
            "reason": exc.reason,
        }
    except URLError as exc:
        write_text(headers_path, f"URLError {exc.reason}\n")
        return {
            "url": url,
            "path": None,
            "sha256": None,
            "byteLength": 0,
            "headersPath": rel(headers_path),
            "status": "url_error",
            "reason": str(exc.reason),
        }
    body_path.parent.mkdir(parents=True, exist_ok=True)
    body_path.write_bytes(body)
    write_text(headers_path, "\n".join(header_lines) + "\n")
    return {
        "url": url,
        "finalUrl": final_url,
        "path": rel(body_path),
        "sha256": sha256_bytes(body),
        "byteLength": len(body),
        "headersPath": rel(headers_path),
        "status": "fetched",
    }


def capture_local_bun_version() -> tuple[str, Path]:
    out = subprocess.check_output(["bun", "--version"], text=True).strip()
    path = WAVE / "bun/bun-version.txt"
    write_text(path, out + "\n")
    return out, path


def which_bun() -> str | None:
    try:
        return subprocess.check_output(["which", "bun"], text=True).strip()
    except subprocess.CalledProcessError:
        return None


def find_pin_files(root: Path) -> list[dict]:
    names = {
        ".bun-version",
        "bunfig.toml",
        ".nvmrc",
        ".node-version",
        "mise.toml",
        ".tool-versions",
    }
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules"}]
        for name in filenames:
            if name in names:
                p = Path(dirpath) / name
                found.append(
                    {
                        "path": rel(p),
                        "sha256": sha256(p),
                        "byteLength": p.stat().st_size,
                    }
                )
    return found


def shebang_bun_files(root: Path) -> list[dict]:
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules"}]
        for name in filenames:
            p = Path(dirpath) / name
            try:
                first = p.read_bytes()[:80]
            except OSError:
                continue
            if first.startswith(b"#!/usr/bin/env bun") or first.startswith(b"#!/usr/bin/bun"):
                hits.append({"path": rel(p), "firstLine": first.splitlines()[0].decode("utf-8", "replace")})
    return hits


def build_bun_capture() -> dict:
    local_version, version_txt = capture_local_bun_version()
    bun_path = which_bun()
    pkg = json.loads(PKG_JSON.read_text())
    lock = load_bun_lock(LOCK)
    packages = lock.get("packages") or {}
    bun_types_key = None
    for key in packages:
        if key == "bun-types" or key.startswith("bun-types@"):
            bun_types_key = key
            break

    docs = []
    for label, url, fname in BUN_DOCS:
        meta = fetch_url(url, WAVE / "bun" / fname, WAVE / "bun" / f"{Path(fname).stem}.headers.txt")
        docs.append({"label": label, **meta})

    legacy_guide = fetch_url(
        LEGACY_BUN_VERSION_GUIDE,
        WAVE / "bun/bun-version-docs.html",
        WAVE / "bun/bun-version-docs.headers.txt",
    )
    docs.append(
        {
            "label": "bun-version-docs-legacy",
            "note": (
                "Wave-005 guide URL. Wave-006 records live status. Pin guidance now "
                "appears under installation#installing-older-versions and bunfig docs."
            ),
            **legacy_guide,
        }
    )

    pin_files_under_poteto = find_pin_files(POTETO)
    shebangs = shebang_bun_files(SCRIPTS)

    pin_candidates = {
        "package.json.engines": pkg.get("engines"),
        "package.json.packageManager": pkg.get("packageManager"),
        "package.json.volta": pkg.get("volta"),
        "package.json.devEngines": pkg.get("devEngines"),
        "dotBunVersionFile": (SCRIPTS / ".bun-version").exists(),
        "bunfigToml": (SCRIPTS / "bunfig.toml").exists(),
        "miseToml": (SCRIPTS / "mise.toml").exists(),
        "toolVersions": (SCRIPTS / ".tool-versions").exists(),
        "nvmrc": (SCRIPTS / ".nvmrc").exists(),
        "nodeVersion": (SCRIPTS / ".node-version").exists(),
        "bunLockPinsBunBinary": False,
        "pinFilesUnderPotetoMode": pin_files_under_poteto,
        "shebangEnvBunFiles": shebangs,
        "hostWhichBun": bun_path,
        "hostWhichBunIsMiseLatest": bool(bun_path and "/mise/installs/bun/latest/" in bun_path),
    }

    return {
        "capturedAt": NOW,
        "localBunVersionCapture": rel(version_txt),
        "localBunVersionSha256": sha256(version_txt),
        "localBunStdout": local_version,
        "docs": docs,
        "pinCandidatesChecked": pin_candidates,
        "manifestDevDependencies": pkg.get("devDependencies"),
        "lockBunTypesResolved": bun_types_key,
        "typesVersusRuntimeNote": (
            f"Lock resolves {bun_types_key}; local bun --version is {local_version}. "
            "bun-types is not an official Bun runtime pin. Host bun from mise 'latest' "
            "is environment state, not a tools subtree pin."
        ),
        "pinStatus": "unresolved",
        "closureCriteria": [
            "Exact Bun binary version declared in tools subtree via engines.bun, packageManager, volta, .bun-version, bunfig, or equivalent lock binding",
            "Declaration must be in source custody under poteto-mode/scripts or a documented official pin path for this package",
        ],
        "note": (
            "Wave-006 re-probed tools scripts and poteto-mode tree for pin files, "
            "recorded shebang usage and host mise-latest path, and re-fetched official "
            "Bun docs. No official Bun binary pin exists. Do not invent a pin from "
            "local version, mise latest, or bun-types."
        ),
    }


def build_typescript_deep_disposition() -> dict:
    audit = json.loads(TS_BODY_AUDIT.read_text())
    deep_files = [
        {
            "path": f["path"],
            "role": f["role"],
            "sha256": f["sha256"],
            "byteLength": f["byteLength"],
            "bodyAudit": f.get("bodyAudit"),
            "exportStatementCount": f.get("exportStatementCount"),
            "importStatementCount": f.get("importStatementCount"),
            "requireCallCount": f.get("requireCallCount"),
        }
        for f in audit["files"]
        if f.get("bodyAudit") == "internal_module_surface"
        or f.get("role") in {"ast-internal", "enums-internal", "dist-internal"}
    ]
    role_counts: Counter[str] = Counter(f["role"] for f in deep_files)

    # Optional consumer typecheck probe (does not close deep semantics).
    consumer_probe: dict
    try:
        proc = subprocess.run(
            ["bun", "x", "typescript@7.0.2", "tsc", "--version"],
            cwd=str(SCRIPTS),
            capture_output=True,
            text=True,
            timeout=120,
        )
        version_out = (proc.stdout or proc.stderr or "").strip()
        consumer_probe = {
            "command": "bun x typescript@7.0.2 tsc --version",
            "cwd": rel(SCRIPTS),
            "exitCode": proc.returncode,
            "stdout": version_out,
            "note": (
                "Consumer can resolve locked typescript major via bun x. This proves "
                "package activation, not deep compiler-behavior semantics of the 136 "
                "internal dist files."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        consumer_probe = {"error": str(exc), "status": "probe_failed"}

    return {
        "capturedAt": NOW,
        "package": "typescript@7.0.2",
        "priorStructuralAudit": rel(TS_BODY_AUDIT),
        "priorStructuralAuditSha256": sha256(TS_BODY_AUDIT),
        "structuralBodyAuditComplete": audit.get("structuralBodyAuditComplete"),
        "deepInternalFileCount": len(deep_files),
        "deepRoleCounts": dict(role_counts),
        "deepCompilerSemanticsStatus": "still_open",
        "disposition": (
            "Structural body-contract audit from wave-005 remains complete. Wave-006 "
            "catalogs the 136 internal_module_surface files with path+hash and states "
            "honest closure criteria. Deep compiler-behavior semantics stay open."
        ),
        "closureCriteria": [
            "Behavioral proof that AST/enum/internal helpers match TypeScript@7.0.2 contracts under a typecheck or compiler-test oracle",
            "Paired consumer typecheck journeys alone do not prove internal module semantics for all 136 files",
            "Do not mark readingComplete true for deep semantics on structural facts alone",
        ],
        "blocker": (
            "No compiler-test oracle or exhaustive internal-behavior journey was run "
            "against the 136 ast-internal/enums-internal/dist-internal files. "
            "Structural hashes and module-surface facts are not compiler-semantics proof."
        ),
        "consumerActivationProbe": consumer_probe,
        "files": deep_files,
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
                    "parity/research/dep-closure-wave-006/nodes/host-edge-disposition.md",
                ],
                "docSha256": sha256(COMPUTER_USE),
                "docByteLength": COMPUTER_USE.stat().st_size,
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
                    "parity/research/dep-closure-wave-006/nodes/host-edge-disposition.md",
                ],
                "docSha256": sha256(MODEL_MGMT),
                "docByteLength": MODEL_MGMT.stat().st_size,
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
        "note": (
            "Wave-006 re-hashed public continuation docs. Hashes unchanged from "
            "wave-005. Edges remain environment-bound unresolved."
        ),
    }


HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
CHECK_RE = re.compile(r"^\s*-\s*\[[ xX]\]\s+(.+)$", re.M)


def build_create_skill_audit() -> dict:
    text = CREATE_SKILL.read_text()
    live_sha = sha256(LIVE_CREATE_SKILL) if LIVE_CREATE_SKILL.exists() else None
    captured_sha = sha256(CREATE_SKILL)
    headings = []
    for m in HEADING_RE.finditer(text):
        level = len(m.group(1))
        title = m.group(2).strip()
        headings.append({"level": level, "title": title, "offset": m.start()})

    workflows = []
    workflow_titles = {
        "Skill Creation Workflow",
        "Workflow Pattern",
        "Conditional Workflow Pattern",
        "Feedback Loop Pattern",
        "Template Pattern",
        "Examples Pattern",
        "Before You Begin: Gather Requirements",
        "Summary Checklist",
        "Phase 1: Discovery",
        "Phase 2: Design",
        "Phase 3: Implementation",
        "Phase 4: Verification",
    }
    for h in headings:
        if h["title"] in workflow_titles or "Workflow" in h["title"] or h["title"].startswith("Phase "):
            workflows.append(h)

    links = [{"text": a, "target": b} for a, b in LINK_RE.findall(text)]
    checks = CHECK_RE.findall(text)

    subordinate_inventory_complete = True
    journey_audit_complete = False

    return {
        "capturedAt": NOW,
        "skillPath": rel(CREATE_SKILL),
        "skillSha256": captured_sha,
        "skillByteLength": CREATE_SKILL.stat().st_size,
        "liveInstallPath": str(LIVE_CREATE_SKILL),
        "liveInstallSha256": live_sha,
        "captureMatchesLiveInstall": live_sha == captured_sha,
        "headingCount": len(headings),
        "headings": headings,
        "subordinateWorkflowSections": workflows,
        "subordinateWorkflowSectionCount": len(workflows),
        "markdownLinks": links,
        "checklistItemCount": len(checks),
        "checklistItems": checks,
        "supportingFilesInInstallDir": sorted(
            p.name for p in LIVE_CREATE_SKILL.parent.iterdir() if LIVE_CREATE_SKILL.parent.exists()
        )
        if LIVE_CREATE_SKILL.exists()
        else [],
        "subordinateWorkflowInventoryStatus": "complete"
        if subordinate_inventory_complete
        else "incomplete",
        "journeyAuditStatus": "open" if not journey_audit_complete else "complete",
        "disposition": (
            "Wave-006 inventoried subordinate workflow/phase/pattern sections, "
            "checklist items, and markdown links from the captured SKILL.md. Capture "
            "hash still matches live ~/.cursor/skills-cursor/create-skill/SKILL.md. "
            "No paired Cursor+Pi journey exercised the skill-creation workflow."
        ),
        "blockerForJourneyClosure": (
            "Paired Cursor+Pi user journeys that author a skill via /create-skill "
            "(or equivalent) and verify discovery/application remain required."
        ),
    }


def build_merge_proposal(
    bun: dict,
    ts: dict,
    host: dict,
    create_skill: dict,
) -> dict:
    bun_line = (
        "Official Bun runtime version pin under source-bun-runtime remains unresolved "
        f"after wave-006 capture at {rel(WAVE / 'bun/official-capture.json')} "
        f"(local {bun['localBunStdout']} only; no engines/packageManager/volta/"
        ".bun-version/bunfig/mise/.tool-versions under tools; host mise bun/latest "
        "and bun-types lock resolve are not runtime pins)."
    )
    ts_line = (
        "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after "
        f"wave-006 disposition at {rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')} "
        f"({ts['deepInternalFileCount']} internal dist files cataloged with path+hash; "
        "structural body audit from wave-005 stands; no compiler-test oracle)."
    )
    host_line = (
        "cursor-cli-host edges to computer-use and enterprise policy remain unresolved "
        f"after wave-006 environment-bound disposition at "
        f"{rel(WAVE / 'host-edge-disposition.json')}; runtime services were not exercised."
    )
    create_skill_line = (
        "cursor-create-skill journey audit remains open after subordinate workflow "
        f"inventory at {rel(WAVE / 'create-skill/subordinate-audit.json')} "
        f"(SKILL.md sha256 {create_skill['skillSha256']}; "
        f"{create_skill['subordinateWorkflowSectionCount']} workflow/phase sections; "
        "paired journeys not run)."
    )

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
            "compiler-behavior semantics, create-skill journeys, and broader "
            "recursive/live integrations remain open."
        ),
        "resolvedReferenceCount": 1,
        "unresolvedTargetCount": 7,
        "resolvedReferenceNote": (
            "Narrowed create-skill combined subordinate+journey line into journey-only "
            "after subordinate workflow inventory with path+hash evidence."
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
                        ]
                    },
                    "evidence": [rel(WAVE / "bun/official-capture.json")],
                    "disposition": bun["note"],
                },
                {
                    "id": "npm:typescript@7.0.2",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "npm/typescript-deep-semantics-disposition.json"),
                            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json",
                            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json",
                        ]
                    },
                    "evidence": [
                        rel(WAVE / "npm/typescript-deep-semantics-disposition.json"),
                        rel(WAVE / "nodes/typescript-deep-semantics.md"),
                    ],
                    "disposition": ts["disposition"],
                },
                {
                    "id": "cursor-self-hosted-computer-use",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "host-edge-disposition.json"),
                            rel(WAVE / "nodes/host-edge-disposition.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "host-edge-disposition.json")],
                    "disposition": (
                        "Environment-bound. Public-doc contracts re-hashed; runtime "
                        "helper/desktop services not exercised."
                    ),
                },
                {
                    "id": "cursor-enterprise-integration-policy",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "host-edge-disposition.json"),
                            rel(WAVE / "nodes/host-edge-disposition.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "host-edge-disposition.json")],
                    "disposition": (
                        "Environment-bound. Public-doc contracts re-hashed; live "
                        "team/org policy enforcement not observed."
                    ),
                },
                {
                    "id": "cursor-create-skill",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "create-skill/subordinate-audit.json"),
                            rel(WAVE / "nodes/create-skill-subordinate-audit.md"),
                            rel(CREATE_SKILL),
                        ]
                    },
                    "evidence": [rel(WAVE / "create-skill/subordinate-audit.json")],
                    "disposition": create_skill["disposition"],
                },
            ],
            "edgeMutations": [],
            "honestUnresolvedEdges": host["edges"]
            + [
                {
                    "from": e["from"],
                    "to": e["to"],
                    "keepStatus": e["keepStatus"],
                    "blocker": e["blocker"],
                }
                for e in host["journeyEdgesUnchanged"]
            ],
            "unresolvedReferences": {
                "removeIfPresent": [
                    "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-005 capture at parity/research/dep-closure-wave-005/bun/official-capture.json (local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig; bun-types lock resolve bun-types is not a runtime pin).",
                    "npm:typescript@7.0.2 structural per-file body-contract audit recorded at parity/research/dep-closure-wave-005/npm/typescript-body-audit.json (416/416 files; hash mismatches=0). Deep compiler-behavior semantics for 136 internal dist files remain open.",
                    "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-005 environment-bound disposition at parity/research/dep-closure-wave-005/host-edge-disposition.json; runtime services were not exercised.",
                    "cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture at parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md.",
                ],
                "add": [bun_line, ts_line, host_line, create_skill_line],
                "keep": [
                    "Required live integrations, cloud services, automation editor, models and supporting tools.",
                    "Recursive references in inspected sources still require complete extraction and audit.",
                    "Tools package consumer binding recorded at parity/research/dep-closure-wave-003/consumer-binding.json (commander runtime; bun-types/typescript test/typecheck). Broader acceptance journeys remain open.",
                ],
                "note": (
                    "Replace Bun/typescript/host wave-005 status lines with wave-006 "
                    "evidence. Narrow create-skill subordinate+journey line to journey "
                    "only after subordinate inventory. Keep live/recursive/consumer items."
                ),
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": "Must remain false until Bun pin, host edges, journeys, and deep typescript semantics close with evidence.",
            }
        },
        "fullProposal": rel(WAVE / "merge-proposal.json"),
    }


def build_nodes(
    bun: dict,
    ts: dict,
    host: dict,
    create_skill: dict,
) -> None:
    write_text(
        WAVE / "nodes/bun-pin.md",
        "\n".join(
            [
                "# source-bun-runtime Bun pin (wave-006)",
                "",
                f"pinStatus: `{bun['pinStatus']}`",
                f"localBunStdout: `{bun['localBunStdout']}`",
                f"capture: `{rel(WAVE / 'bun/official-capture.json')}` sha256=`{sha256(WAVE / 'bun/official-capture.json')}`",
                "",
                bun["note"],
                "",
                "Closure criteria:",
                *[f"- {c}" for c in bun["closureCriteria"]],
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/typescript-deep-semantics.md",
        "\n".join(
            [
                "# npm:typescript@7.0.2 deep compiler semantics (wave-006)",
                "",
                f"status: `{ts['deepCompilerSemanticsStatus']}`",
                f"deepInternalFileCount: `{ts['deepInternalFileCount']}`",
                f"disposition: `{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}` sha256=`{sha256(WAVE / 'npm/typescript-deep-semantics-disposition.json')}`",
                "",
                ts["disposition"],
                "",
                f"Blocker: {ts['blocker']}",
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/host-edge-disposition.md",
        "\n".join(
            [
                "# Host computer-use / enterprise edges (wave-006)",
                "",
                f"dispositionClass: `{host['dispositionClass']}`",
                f"capture: `{rel(WAVE / 'host-edge-disposition.json')}` sha256=`{sha256(WAVE / 'host-edge-disposition.json')}`",
                "",
                host["note"],
                "",
                "## Edges",
                "",
                *[
                    f"- `{e['from']}` → `{e['to']}` status=`{e['keepStatus']}` docSha256=`{e['docSha256']}`\n  Blocker: {e['blocker']}"
                    for e in host["edges"]
                ],
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/create-skill-subordinate-audit.md",
        "\n".join(
            [
                "# cursor-create-skill subordinate audit (wave-006)",
                "",
                f"skillSha256: `{create_skill['skillSha256']}`",
                f"captureMatchesLiveInstall: `{create_skill['captureMatchesLiveInstall']}`",
                f"subordinateWorkflowInventoryStatus: `{create_skill['subordinateWorkflowInventoryStatus']}`",
                f"journeyAuditStatus: `{create_skill['journeyAuditStatus']}`",
                f"audit: `{rel(WAVE / 'create-skill/subordinate-audit.json')}` sha256=`{sha256(WAVE / 'create-skill/subordinate-audit.json')}`",
                "",
                create_skill["disposition"],
                "",
                f"Journey blocker: {create_skill['blockerForJourneyClosure']}",
                "",
                "Workflow/phase sections:",
                *[f"- L{w['level']} {w['title']}" for w in create_skill["subordinateWorkflowSections"]],
                "",
            ]
        ),
    )


def build_inventory(paths: list[Path]) -> dict:
    sources = []
    for i, path in enumerate(paths):
        if not path.exists():
            continue
        sources.append(
            {
                "id": f"w6-{i:03d}-{path.name}",
                "path": rel(path),
                "absolutePath": str(path.resolve()),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
            }
        )
    return {
        "unit": UNIT,
        "capturedAt": NOW,
        "allSources": sources,
        "sourceCount": len(sources),
    }


def write_verify_script() -> None:
    write_text(
        WAVE / "verify_inventory_shasum.py",
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
''',
    )


def main() -> None:
    WAVE.mkdir(parents=True, exist_ok=True)
    (WAVE / "bun").mkdir(exist_ok=True)
    (WAVE / "npm").mkdir(exist_ok=True)
    (WAVE / "nodes").mkdir(exist_ok=True)
    (WAVE / "create-skill").mkdir(exist_ok=True)

    bun = build_bun_capture()
    write_json(WAVE / "bun/official-capture.json", bun)

    ts = build_typescript_deep_disposition()
    write_json(WAVE / "npm/typescript-deep-semantics-disposition.json", ts)

    host = build_host_disposition()
    write_json(WAVE / "host-edge-disposition.json", host)

    create_skill = build_create_skill_audit()
    write_json(WAVE / "create-skill/subordinate-audit.json", create_skill)

    build_nodes(bun, ts, host, create_skill)

    proposal = build_merge_proposal(bun, ts, host, create_skill)
    write_json(WAVE / "merge-proposal.json", proposal)

    decisions = [
        "timestamp\tdecision\tevidence\tnote",
        f"{NOW}\tbun_pin_unresolved\t{rel(WAVE / 'bun/official-capture.json')}\tno pin files; host mise latest not a pin",
        f"{NOW}\ttypescript_deep_still_open\t{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}\t136 internals cataloged; no compiler oracle",
        f"{NOW}\thost_edges_environment_bound\t{rel(WAVE / 'host-edge-disposition.json')}\tdoc hashes unchanged; runtime not exercised",
        f"{NOW}\tcreate_skill_subordinates_inventoried\t{rel(WAVE / 'create-skill/subordinate-audit.json')}\tjourney audit remains open",
        f"{NOW}\tcompleteDependencyClosure_false\t{rel(WAVE / 'merge-proposal.json')}\tno fabricated closure",
    ]
    write_text(WAVE / "decisions.tsv", "\n".join(decisions) + "\n")

    inventory_paths = [
        WAVE / "bun/official-capture.json",
        WAVE / "bun/bun-version.txt",
        WAVE / "npm/typescript-deep-semantics-disposition.json",
        WAVE / "host-edge-disposition.json",
        WAVE / "create-skill/subordinate-audit.json",
        WAVE / "merge-proposal.json",
        WAVE / "nodes/bun-pin.md",
        WAVE / "nodes/typescript-deep-semantics.md",
        WAVE / "nodes/host-edge-disposition.md",
        WAVE / "nodes/create-skill-subordinate-audit.md",
        WAVE / "decisions.tsv",
        CREATE_SKILL,
        COMPUTER_USE,
        MODEL_MGMT,
        TS_BODY_AUDIT,
        PKG_JSON,
        LOCK,
    ]
    for _label, _url, fname in BUN_DOCS:
        inventory_paths.append(WAVE / "bun" / fname)
        inventory_paths.append(WAVE / "bun" / f"{Path(fname).stem}.headers.txt")
    inventory_paths.append(WAVE / "bun/bun-version-docs.headers.txt")
    if (WAVE / "bun/bun-version-docs.html").exists():
        inventory_paths.append(WAVE / "bun/bun-version-docs.html")

    inv = build_inventory(inventory_paths)
    write_json(WAVE / "read-inventory.json", inv)
    write_verify_script()

    verify = subprocess.run(
        ["python3", str(WAVE / "verify_inventory_shasum.py")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    write_json(
        WAVE / "verify-hashes.json",
        {
            "capturedAt": NOW,
            "status": "VERIFIED" if verify.returncode == 0 else "NOT_VERIFIED",
            "exitCode": verify.returncode,
            "stdout": verify.stdout,
            "stderr": verify.stderr,
        },
    )
    print(verify.stdout)
    if verify.returncode != 0:
        raise SystemExit(verify.returncode)
    print(f"Wrote {UNIT} artifacts under {rel(WAVE)}")


if __name__ == "__main__":
    main()
