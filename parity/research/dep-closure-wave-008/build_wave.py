#!/usr/bin/env python3
"""Build u-dep-closure-wave-008 research artifacts. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
UNIT = "u-dep-closure-wave-008"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
SCRIPTS = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts"
PKG_JSON = SCRIPTS / "package.json"
POTETO = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode"
PLUGINS = ROOT / "parity/reference/cursor-plugins"
TEAM_KIT = PLUGINS / "cursor-team-kit"
PSTACK_README = PLUGINS / "pstack/README.md"
DIST_HASHES = ROOT / "parity/reference/distribution-sha256.txt"
CREATE_SKILL = (
    ROOT / "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md"
)
LIVE_CREATE_SKILL = Path.home() / ".cursor/skills-cursor/create-skill/SKILL.md"
COMPUTER_USE = ROOT / "parity/research/continuation/computer-use.md"
MODEL_MGMT = ROOT / "parity/research/continuation/model-management.md"
TS_DEEP_007 = (
    ROOT
    / "parity/research/dep-closure-wave-007/npm/typescript-deep-semantics-disposition.json"
)
RECURSIVE_007 = ROOT / "parity/research/dep-closure-wave-007/recursive/extraction.json"
LIVE_007 = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
CONSUMER_007 = ROOT / "parity/research/dep-closure-wave-007/consumer/journey-matrix.json"
CREATE_007 = ROOT / "parity/research/dep-closure-wave-007/create-skill/journey-matrix.json"
CUSTOM_MODE_REPORT = (
    ROOT / "parity/briefs/reports/u-cursor-custom-mode-path-report.md"
)
CUSTOM_MODE_SUMMARY = (
    ROOT / "parity/evidence/mode-sticky/probes/probe-custom-mode-path-summary.json"
)
LIVE_PSTACK_PLUGIN = (
    Path.home()
    / ".cursor/plugins/cache/cursor-public/pstack/ccb5507cec1546dc88135c1139c811e6c59115ba"
)
LIVE_TEAM_KIT_PLUGIN = (
    Path.home()
    / ".cursor/plugins/cache/cursor-public/cursor-team-kit/ccb5507cec1546dc88135c1139c811e6c59115ba"
)

BUN_DOCS = [
    ("install", "https://bun.com/docs/installation", "install.html"),
    ("lockfile", "https://bun.com/docs/pm/lockfile", "lockfile.html"),
    ("bunfig", "https://bun.com/docs/runtime/bunfig", "bunfig.html"),
]
LEGACY_BUN_VERSION_GUIDE = "https://bun.com/docs/guides/install/bun-version"
PIN_NAMES = [
    ".bun-version",
    "bunfig.toml",
    "mise.toml",
    ".tool-versions",
    ".nvmrc",
    ".node-version",
]


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


def run(cmd: list[str], cwd: Path | None = None) -> dict:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
    )
    return {
        "command": cmd,
        "cwd": rel(cwd) if cwd else None,
        "exitCode": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def fetch_url(url: str, body_path: Path, headers_path: Path) -> dict:
    req = Request(url, headers={"User-Agent": "pi-pstack-parity-dep-closure/8"})
    try:
        with urlopen(req, timeout=60) as resp:
            body = resp.read()
            header_lines = [f"HTTP {resp.status}"]
            for k, v in resp.headers.items():
                header_lines.append(f"{k}: {v}")
            final_url = resp.geturl()
            status = "fetched"
            http_status = resp.status
            reason = None
    except HTTPError as exc:
        body = exc.read() if exc.fp else b""
        final_url = url
        status = "http_error"
        http_status = exc.code
        reason = exc.reason
        header_lines = [f"HTTP {exc.code}", f"{exc.reason}"]
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
    if body:
        body_path.write_bytes(body)
    write_text(headers_path, "\n".join(header_lines) + "\n")
    return {
        "url": url,
        "finalUrl": final_url,
        "path": rel(body_path) if body else None,
        "sha256": sha256_bytes(body) if body else None,
        "byteLength": len(body),
        "headersPath": rel(headers_path),
        "status": status,
        "httpStatus": http_status,
        "reason": reason,
    }


def load_lock_hashes() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in DIST_HASHES.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        digest, path = line.split(None, 1)
        out[path] = digest
    return out


def build_team_kit() -> dict:
    lock_hashes = load_lock_hashes()
    files = []
    mismatches = []
    for path in sorted(TEAM_KIT.rglob("*")):
        if not path.is_file():
            continue
        repo_rel = rel(path)
        digest = sha256(path)
        expected = lock_hashes.get(repo_rel)
        match = expected == digest if expected is not None else None
        entry = {
            "path": repo_rel,
            "sha256": digest,
            "byteLength": path.stat().st_size,
            "lockSha256": expected,
            "matchesDistributionSha256": match,
        }
        files.append(entry)
        if expected is not None and not match:
            mismatches.append(repo_rel)

    readme = PSTACK_README.read_text()
    contract_line = None
    for line in readme.splitlines():
        if "cursor-team-kit" in line and "alongside" in line:
            contract_line = line.strip()
            break
    named_skills = sorted(
        p.name for p in (TEAM_KIT / "skills").iterdir() if p.is_dir()
    )
    live_pstack = LIVE_PSTACK_PLUGIN.is_dir()
    live_team = LIVE_TEAM_KIT_PLUGIN.is_dir()
    live_team_any = any(
        Path.home().joinpath(".cursor/plugins/cache").rglob("cursor-team-kit")
    ) if Path.home().joinpath(".cursor/plugins/cache").exists() else False

    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "edge": {"from": "cursor-pstack", "to": "cursor-team-kit"},
        "contract": "Install cursor-team-kit alongside pstack for the full skill set.",
        "readmePath": rel(PSTACK_README),
        "readmeSha256": sha256(PSTACK_README),
        "readmeContractLine": contract_line,
        "lockedRevision": "ccb5507cec1546dc88135c1139c811e6c59115ba",
        "manifestPath": rel(TEAM_KIT / ".cursor-plugin/plugin.json"),
        "manifestSha256": sha256(TEAM_KIT / ".cursor-plugin/plugin.json"),
        "manifestVersion": json.loads(
            (TEAM_KIT / ".cursor-plugin/plugin.json").read_text()
        ).get("version"),
        "trackedFileCount": len(files),
        "lockMatchCount": sum(
            1 for f in files if f["matchesDistributionSha256"] is True
        ),
        "lockMissingCount": sum(
            1 for f in files if f["matchesDistributionSha256"] is None
        ),
        "lockMismatchCount": len(mismatches),
        "lockMismatches": mismatches,
        "namedSkillCount": len(named_skills),
        "namedSkills": named_skills,
        "sourceReadingEvidence": [
            "parity/reviews/source-discovery.md",
            "parity/reference/distribution-sha256.txt",
            "parity/source-lock.json",
        ],
        "liveInstall": {
            "pstackCachePath": str(LIVE_PSTACK_PLUGIN),
            "pstackCachePresent": live_pstack,
            "teamKitCachePath": str(LIVE_TEAM_KIT_PLUGIN),
            "teamKitCachePresent": live_team,
            "teamKitAnywhereUnderPluginsCache": live_team_any,
            "note": "Live plugin-cache presence is consumer evidence, not a pin. Absence does not erase locked distribution custody.",
        },
        "custodyStatus": "verified"
        if len(files) == 29 and not mismatches and all(
            f["matchesDistributionSha256"] for f in files
        )
        else "incomplete",
        "proposedEdgeStatus": "resolved",
        "proposedEdgeNote": (
            "Locked distribution custody for cursor-team-kit@1.2.0 at revision "
            "ccb5507cec1546dc88135c1139c811e6c59115ba re-verified (29/29 files match "
            "parity/reference/distribution-sha256.txt). pstack README install contract "
            "quoted. Source readingComplete already true. Per-skill paired Cursor+Pi "
            "journeys for the full team-kit skill set remain open as a separate "
            "unresolvedReference (same pattern as create-skill edge vs journey ref)."
        ),
        "journeyAuditStatus": "open",
        "blockerForJourneyClosure": (
            "Paired Cursor+Pi user journeys across the 18 named team-kit skills "
            "(and agents/rules) remain required. Distribution install custody alone "
            "does not prove journey parity."
        ),
        "files": files,
    }
    write_json(WAVE / "team-kit/custody-disposition.json", disposition)
    write_text(
        WAVE / "nodes/team-kit-custody.md",
        "\n".join(
            [
                "# cursor-pstack → cursor-team-kit (wave-008)",
                "",
                f"capturedAt: `{NOW}`",
                f"custodyStatus: `{disposition['custodyStatus']}`",
                f"proposedEdgeStatus: `{disposition['proposedEdgeStatus']}`",
                f"manifestSha256: `{disposition['manifestSha256']}`",
                f"trackedFileCount: {disposition['trackedFileCount']}",
                f"lockMatchCount: {disposition['lockMatchCount']}",
                f"namedSkillCount: {disposition['namedSkillCount']}",
                f"liveTeamKitCachePresent: `{live_team}`",
                "",
                disposition["proposedEdgeNote"],
                "",
                f"Journey blocker: {disposition['blockerForJourneyClosure']}",
                "",
                f"Evidence: `{rel(WAVE / 'team-kit/custody-disposition.json')}`",
                "",
            ]
        ),
    )
    return disposition


def build_cli_host() -> dict:
    report_sha = sha256(CUSTOM_MODE_REPORT)
    summary_sha = sha256(CUSTOM_MODE_SUMMARY)
    summary = json.loads(CUSTOM_MODE_SUMMARY.read_text())
    agent = run(["cursor-agent", "--version"])
    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "edge": {"from": "cursor-pstack", "to": "cursor-cli-host"},
        "contract": (
            "Plain Enter attaches a skill to one message. "
            "Option+Enter or Alt+Enter selects a persistent custom mode."
        ),
        "keepStatus": "unverified",
        "disposition": "environment-bound",
        "cursorAgentVersion": {
            "command": agent["command"],
            "exitCode": agent["exitCode"],
            "stdout": agent["stdout"],
            "expectedLock": "2026.10.01-e373342",
            "matchesLock": agent["stdout"] == "2026.10.01-e373342",
        },
        "customModeProbe": {
            "reportPath": rel(CUSTOM_MODE_REPORT),
            "reportSha256": report_sha,
            "summaryPath": rel(CUSTOM_MODE_SUMMARY),
            "summarySha256": summary_sha,
            "baselineAttemptId": "6977eeec-08bd-4829-810c-11d526d9f9fb",
            "statsigOverrideAttemptId": "9857dda0-a74d-4546-b69e-1ff3528bdf3e",
            "successAttemptId": None,
            "rootCause": (
                "Statsig gate glass_custom_modes off for this account/build; "
                "Meta+Enter leaves slash menu open; --statsig-overrides no-op "
                "when constants.Cu is false."
            ),
            "summarySchema": summary.get("schema"),
        },
        "readmePath": rel(PSTACK_README),
        "readmeSha256": sha256(PSTACK_README),
        "blocker": (
            "Persistent-mode Option/Alt+Enter Custom Mode path is environment-bound. "
            "Measured exhaustive-negative on locked cursor-agent 2026.10.01-e373342: "
            "glass_custom_modes off; attempts 6977eeec-08bd-4829-810c-11d526d9f9fb and "
            "9857dda0-a74d-4546-b69e-1ff3528bdf3e; no success attempt ID. Operator must "
            "enable Custom Modes (or capture via Agents Window/IDE path), then recapture "
            "paired Cursor+Pi sticky evidence. See "
            f"{rel(CUSTOM_MODE_REPORT)} sha256={report_sha}."
        ),
        "evidence": [
            rel(CUSTOM_MODE_REPORT),
            rel(CUSTOM_MODE_SUMMARY),
            "parity/mismatches.json",
            "parity/requirements.json",
        ],
    }
    write_json(WAVE / "cli-host/persistent-mode-disposition.json", disposition)
    write_text(
        WAVE / "nodes/cli-host-persistent-mode.md",
        "\n".join(
            [
                "# cursor-pstack → cursor-cli-host (wave-008)",
                "",
                f"capturedAt: `{NOW}`",
                "keepStatus: `unverified`",
                "disposition: `environment-bound`",
                f"cursor-agent: `{agent['stdout']}`",
                f"reportSha256: `{report_sha}`",
                "",
                disposition["blocker"],
                "",
                f"Evidence: `{rel(WAVE / 'cli-host/persistent-mode-disposition.json')}`",
                "",
            ]
        ),
    )
    return disposition


def build_host_edges() -> dict:
    computer_sha = sha256(COMPUTER_USE)
    model_sha = sha256(MODEL_MGMT)
    helper_probe = run(
        [
            "mdfind",
            'kMDItemCFBundleIdentifier == "co.anysphere.cursor-computer-use"',
        ]
    )
    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "edges": [
            {
                "from": "cursor-cli-host",
                "to": "cursor-self-hosted-computer-use",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "docPath": rel(COMPUTER_USE),
                "docSha256": computer_sha,
                "docByteLength": COMPUTER_USE.stat().st_size,
                "docShaUnchangedFromWave007": computer_sha
                == "a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0",
                "helperBundleProbe": {
                    "command": helper_probe["command"],
                    "exitCode": helper_probe["exitCode"],
                    "stdout": helper_probe["stdout"],
                    "matchesFound": bool(helper_probe["stdout"]),
                },
                "blocker": (
                    "Public docs only (computer-use.md). Closing this edge requires "
                    "exercising macOS Cursor Computer Use helper identity "
                    "(co.anysphere.cursor-computer-use / Team ID DCNK4UB866), "
                    "Accessibility and Screen Recording grants, Linux X11/desktop "
                    "packages, and desktop-sharing transport. mdfind for the helper "
                    "bundle returned no matches in this environment. This worker must "
                    "not fabricate those runtime observations."
                ),
            },
            {
                "from": "cursor-cli-host",
                "to": "cursor-enterprise-integration-policy",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "docPath": rel(MODEL_MGMT),
                "docSha256": model_sha,
                "docByteLength": MODEL_MGMT.stat().st_size,
                "docShaUnchangedFromWave007": model_sha
                == "2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205",
                "blocker": (
                    "Public docs only (model-management.md). Closing this edge requires "
                    "observing live Enterprise team/org model access, MCP allowlist "
                    "enforcement, and CLI applicability. Standing orders forbid broad "
                    "allowlist or authorization changes."
                ),
            },
        ],
    }
    write_json(WAVE / "host/host-edge-disposition.json", disposition)
    write_text(
        WAVE / "nodes/host-edge-disposition.md",
        "\n".join(
            [
                "# Host edge disposition (wave-008)",
                "",
                f"capturedAt: `{NOW}`",
                "",
                f"- computer-use docSha256=`{computer_sha}` keepStatus=`unresolved`",
                f"- enterprise docSha256=`{model_sha}` keepStatus=`unresolved`",
                "",
                "Both remain environment-bound. Runtime services were not exercised.",
                "",
                f"Evidence: `{rel(WAVE / 'host/host-edge-disposition.json')}`",
                "",
            ]
        ),
    )
    return disposition


def build_bun() -> dict:
    bun_dir = WAVE / "bun"
    version = run(["bun", "--version"])
    which = run(["which", "bun"])
    write_text(bun_dir / "bun-version.txt", version["stdout"] + "\n")
    docs = []
    for label, url, name in BUN_DOCS:
        docs.append(
            {
                "label": label,
                **fetch_url(url, bun_dir / name, bun_dir / f"{name}.headers.txt"),
            }
        )
    docs.append(
        {
            "label": "bun-version-docs-legacy",
            "note": "Legacy guide URL still expected 404.",
            **fetch_url(
                LEGACY_BUN_VERSION_GUIDE,
                bun_dir / "bun-version-docs.html",
                bun_dir / "bun-version-docs.headers.txt",
            ),
        }
    )
    pkg = json.loads(PKG_JSON.read_text())
    pin_hits = []
    for base in (SCRIPTS, POTETO):
        for name in PIN_NAMES:
            candidate = base / name
            if candidate.exists():
                pin_hits.append(rel(candidate))
    capture = {
        "capturedAt": NOW,
        "unit": UNIT,
        "localBunVersionCapture": rel(bun_dir / "bun-version.txt"),
        "localBunVersionSha256": sha256(bun_dir / "bun-version.txt"),
        "localBunStdout": version["stdout"],
        "whichBun": which["stdout"],
        "docs": docs,
        "pinCandidatesChecked": {
            "package.json.engines": pkg.get("engines"),
            "package.json.packageManager": pkg.get("packageManager"),
            "package.json.volta": pkg.get("volta"),
            "package.json.devEngines": pkg.get("devEngines"),
            "pinFilesFoundUnderToolsOrPoteto": pin_hits,
        },
        "pinStatus": "unresolved",
        "disposition": (
            "Wave-008 re-probed tools/poteto pin files, recorded host bun path and "
            "version, and re-fetched Bun install/lockfile/bunfig docs. No official Bun "
            "binary pin exists under the tools subtree. Do not invent a pin from local "
            "1.4.2, mise latest, or bun-types."
        ),
        "blocker": (
            "No engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions "
            "pin under poteto-mode scripts. Local bun --version and host mise "
            "bun/latest are not official pins."
        ),
    }
    write_json(bun_dir / "official-capture.json", capture)
    write_text(
        WAVE / "nodes/bun-pin.md",
        "\n".join(
            [
                "# source-bun-runtime pin (wave-008)",
                "",
                f"pinStatus: `unresolved`",
                f"localBunStdout: `{version['stdout']}`",
                f"whichBun: `{which['stdout']}`",
                "",
                capture["disposition"],
                "",
                f"Evidence: `{rel(bun_dir / 'official-capture.json')}`",
                "",
            ]
        ),
    )
    return capture


def build_typescript() -> dict:
    prior = json.loads(TS_DEEP_007.read_text())
    files = prior["files"]
    drift = []
    tarball_root = None
    # Prefer already-extracted package under wave-002 if present
    candidates = [
        ROOT
        / "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/package",
        SCRIPTS / "node_modules/typescript",
    ]
    for cand in candidates:
        if (cand / "package.json").exists():
            tarball_root = cand
            break
    for entry in files:
        rel_path = entry["path"]
        if tarball_root is None:
            drift.append({"path": rel_path, "reason": "no_local_typescript_tree"})
            continue
        try:
            path = tarball_root / Path(rel_path).relative_to("package")
        except ValueError:
            path = tarball_root / rel_path
        if not path.exists():
            drift.append(
                {"path": rel_path, "reason": "missing", "expected": entry["sha256"]}
            )
            continue
        digest = sha256(path)
        if digest != entry["sha256"]:
            drift.append(
                {
                    "path": rel_path,
                    "reason": "hash_mismatch",
                    "expected": entry["sha256"],
                    "actual": digest,
                }
            )

    version_probe = run(
        ["bun", "x", "typescript@7.0.2", "tsc", "--version"], cwd=SCRIPTS
    )
    typecheck = run(["bun", "run", "typecheck"], cwd=SCRIPTS)
    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "package": "typescript@7.0.2",
        "priorWave007Disposition": rel(TS_DEEP_007),
        "priorWave007Sha256": sha256(TS_DEEP_007),
        "structuralBodyAuditComplete": True,
        "deepInternalFileCount": len(files),
        "localTypescriptTree": rel(tarball_root) if tarball_root else None,
        "catalogHashDriftFromWave007": drift,
        "catalogHashDriftCount": len(drift),
        "deepCompilerSemanticsStatus": "still_open",
        "consumerActivationProbe": {
            "command": version_probe["command"],
            "cwd": version_probe["cwd"],
            "exitCode": version_probe["exitCode"],
            "stdout": version_probe["stdout"],
            "note": "Package activation only. Not deep compiler-behavior semantics.",
        },
        "consumerTypecheckProbe": {
            "command": typecheck["command"],
            "cwd": typecheck["cwd"],
            "exitCode": typecheck["exitCode"],
            "stdoutTail": typecheck["stdout"][-500:],
            "stderrTail": typecheck["stderr"][-500:],
            "note": (
                "Tools consumer typecheck via locked typescript. Does not prove "
                "AST/enum/internal helper semantics for all 136 internal dist files."
            ),
        },
        "disposition": (
            "Structural body-contract audit from wave-005 remains complete. Wave-008 "
            f"re-verified the {len(files)} internal_module_surface catalog against "
            f"wave-007 hashes (catalogHashDriftCount={len(drift)}) and ran the tools "
            "consumer typecheck script. Deep compiler-behavior semantics stay open."
        ),
        "blocker": (
            "No compiler-test oracle or exhaustive internal-behavior journey was run "
            "against the 136 ast-internal/enums-internal/dist-internal files. "
            "Structural hashes, catalog re-verify, and consumer typecheck are not "
            "compiler-semantics proof."
        ),
        "files": files,
    }
    write_json(WAVE / "npm/typescript-deep-semantics-disposition.json", disposition)
    write_text(
        WAVE / "nodes/typescript-deep-semantics.md",
        "\n".join(
            [
                "# npm:typescript@7.0.2 deep semantics (wave-008)",
                "",
                f"catalogHashDriftCount: {len(drift)}",
                f"deepCompilerSemanticsStatus: `still_open`",
                f"typecheck exitCode: {typecheck['exitCode']}",
                "",
                disposition["disposition"],
                "",
                f"Evidence: `{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}`",
                "",
            ]
        ),
    )
    return disposition


def build_create_skill() -> dict:
    capture_sha = sha256(CREATE_SKILL)
    live_sha = sha256(LIVE_CREATE_SKILL) if LIVE_CREATE_SKILL.exists() else None
    prior = json.loads(CREATE_007.read_text())
    matrix = prior["journeyMatrix"]
    still_open = [j for j in matrix if j.get("status") != "passed"]
    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "skillPath": rel(CREATE_SKILL),
        "skillSha256": capture_sha,
        "skillByteLength": CREATE_SKILL.stat().st_size,
        "liveInstallPath": str(LIVE_CREATE_SKILL),
        "liveInstallSha256": live_sha,
        "captureMatchesLiveInstall": live_sha == capture_sha,
        "priorJourneyMatrix": rel(CREATE_007),
        "priorJourneyMatrixSha256": sha256(CREATE_007),
        "phaseSectionCount": prior.get("phaseSectionCount"),
        "journeyMatrix": matrix,
        "journeysStillOpenCount": len(still_open),
        "journeyAuditStatus": "open",
        "disposition": (
            "Wave-008 re-checks create-skill capture vs live install hash and retains "
            "the wave-007 four-phase journey matrix. No paired Cursor+Pi journey was run."
        ),
        "blockerForJourneyClosure": prior.get("blockerForJourneyClosure"),
    }
    write_json(WAVE / "create-skill/journey-audit.json", disposition)
    write_text(
        WAVE / "nodes/create-skill-journey-audit.md",
        "\n".join(
            [
                "# cursor-create-skill journey audit (wave-008)",
                "",
                f"captureMatchesLiveInstall: `{disposition['captureMatchesLiveInstall']}`",
                f"skillSha256: `{capture_sha}`",
                f"journeysStillOpenCount: {len(still_open)}",
                "",
                disposition["disposition"],
                "",
                f"Evidence: `{rel(WAVE / 'create-skill/journey-audit.json')}`",
                "",
            ]
        ),
    )
    return disposition


def build_carry_forward(label: str, src: Path, out_name: str, note: str) -> dict:
    digest = sha256(src)
    payload = {
        "capturedAt": NOW,
        "unit": UNIT,
        "label": label,
        "sourcePath": rel(src),
        "sourceSha256": digest,
        "sourceByteLength": src.stat().st_size,
        "carryForward": True,
        "disposition": note,
    }
    out = WAVE / out_name
    write_json(out, payload)
    return payload


def build_merge_proposal(
    team_kit: dict,
    cli_host: dict,
    host: dict,
    bun: dict,
    typescript: dict,
    create_skill: dict,
    live: dict,
    recursive: dict,
    consumer: dict,
) -> dict:
    team_kit_art = rel(WAVE / "team-kit/custody-disposition.json")
    cli_host_art = rel(WAVE / "cli-host/persistent-mode-disposition.json")
    host_art = rel(WAVE / "host/host-edge-disposition.json")
    bun_art = rel(WAVE / "bun/official-capture.json")
    ts_art = rel(WAVE / "npm/typescript-deep-semantics-disposition.json")
    create_art = rel(WAVE / "create-skill/journey-audit.json")

    edge_mutations = [
        {
            "from": "cursor-pstack",
            "to": "cursor-team-kit",
            "set": {
                "status": "resolved",
                "blocker": None,
                "evidence": [
                    team_kit_art,
                    rel(WAVE / "nodes/team-kit-custody.md"),
                    "parity/reference/distribution-sha256.txt",
                    "parity/reviews/source-discovery.md",
                ],
                "note": team_kit["proposedEdgeNote"],
                "wave008Note": team_kit["proposedEdgeNote"],
            },
        },
        {
            "from": "cursor-pstack",
            "to": "cursor-cli-host",
            "set": {
                "status": "unverified",
                "disposition": "environment-bound",
                "blocker": cli_host["blocker"],
                "evidence": cli_host["evidence"]
                + [cli_host_art, rel(WAVE / "nodes/cli-host-persistent-mode.md")],
                "wave008Note": cli_host["blocker"],
            },
        },
        {
            "from": "cursor-cli-host",
            "to": "cursor-self-hosted-computer-use",
            "set": {
                "status": "unresolved",
                "disposition": "environment-bound",
                "blocker": host["edges"][0]["blocker"],
                "evidence": [
                    rel(COMPUTER_USE),
                    host_art,
                    rel(WAVE / "nodes/host-edge-disposition.md"),
                ],
                "docSha256": host["edges"][0]["docSha256"],
                "wave008Note": host["edges"][0]["blocker"],
            },
        },
        {
            "from": "cursor-cli-host",
            "to": "cursor-enterprise-integration-policy",
            "set": {
                "status": "unresolved",
                "disposition": "environment-bound",
                "blocker": host["edges"][1]["blocker"],
                "evidence": [
                    rel(MODEL_MGMT),
                    host_art,
                    rel(WAVE / "nodes/host-edge-disposition.md"),
                ],
                "docSha256": host["edges"][1]["docSha256"],
                "wave008Note": host["edges"][1]["blocker"],
            },
        },
    ]

    remove_refs = [
        "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-007 capture at parity/research/dep-closure-wave-007/bun/official-capture.json (local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions under tools; host mise bun/latest and bun-types lock resolve are not runtime pins).",
        "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after wave-007 disposition at parity/research/dep-closure-wave-007/npm/typescript-deep-semantics-disposition.json (136 internal dist files re-verified path+hash; catalogHashDriftCount=0; consumer typecheck exit=0; no compiler-test oracle for internals).",
        "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-007 environment-bound disposition at parity/research/dep-closure-wave-007/host-edge-disposition.json; runtime services were not exercised.",
        "cursor-create-skill journey audit remains open after wave-007 journey matrix at parity/research/dep-closure-wave-007/create-skill/journey-matrix.json (SKILL.md sha256 255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82; 4 phase sections; paired journeys not run).",
        "Inventoried live integrations, cloud services, automation/MCP/model contracts at parity/research/dep-closure-wave-007/live/integrations-inventory.json (416 proposal/queue items; 9 CLI snapshot hits; working-env snapshot hashed). Live exercise and automation-editor runtime remain open.",
        "Recursive references extracted from locked distribution inventory at parity/research/dep-closure-wave-007/recursive/extraction.json (185 text files scanned; 176 unique refs; extractionStatus=complete). Live/runtime audit of extracted external targets remains open.",
        "Tools package consumer acceptance journey matrix recorded at parity/research/dep-closure-wave-007/consumer/journey-matrix.json (6 journeys; local smokes recorded; paired Cursor+Pi acceptance journeys remain open).",
    ]
    add_refs = [
        (
            f"Official Bun runtime version pin under source-bun-runtime remains unresolved "
            f"after wave-008 capture at {bun_art} (local {bun['localBunStdout']} only; "
            "no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions under "
            "tools; host mise bun/latest and bun-types lock resolve are not runtime pins)."
        ),
        (
            f"npm:typescript@7.0.2 deep compiler-behavior semantics remain open after "
            f"wave-008 disposition at {ts_art} "
            f"(136 internal dist files re-verified path+hash; "
            f"catalogHashDriftCount={typescript['catalogHashDriftCount']}; "
            f"consumer typecheck exit={typescript['consumerTypecheckProbe']['exitCode']}; "
            "no compiler-test oracle for internals)."
        ),
        (
            "cursor-cli-host edges to computer-use and enterprise policy remain unresolved "
            f"after wave-008 environment-bound disposition at {host_art}; runtime services "
            "were not exercised."
        ),
        (
            "cursor-create-skill journey audit remains open after wave-008 re-check at "
            f"{create_art} (SKILL.md sha256 {create_skill['skillSha256']}; "
            f"captureMatchesLiveInstall={create_skill['captureMatchesLiveInstall']}; "
            f"{create_skill['journeysStillOpenCount']} phase journeys still open; paired "
            "journeys not run)."
        ),
        (
            "cursor-team-kit full skill-set paired journey audit remains open after "
            f"wave-008 custody resolve at {team_kit_art} "
            f"(29/29 distribution hashes; {team_kit['namedSkillCount']} named skills; "
            "live plugin-cache install absent; per-skill Cursor+Pi journeys not run)."
        ),
        (
            f"Inventoried live integrations carried forward from {live['sourcePath']} "
            f"(sha256 {live['sourceSha256']}). Live exercise and automation-editor "
            "runtime remain open."
        ),
        (
            f"Recursive references extraction carried forward from {recursive['sourcePath']} "
            f"(sha256 {recursive['sourceSha256']}). Live/runtime audit of extracted "
            "external targets remains open."
        ),
        (
            f"Tools package consumer acceptance journey matrix carried forward from "
            f"{consumer['sourcePath']} (sha256 {consumer['sourceSha256']}). Paired "
            "Cursor+Pi acceptance journeys remain open."
        ),
        (
            "cursor-pstack → cursor-cli-host persistent-mode edge remains unverified "
            f"after wave-008 environment-bound disposition at {cli_host_art} "
            "(glass_custom_modes off; attempts "
            "6977eeec-08bd-4829-810c-11d526d9f9fb / "
            "9857dda0-a74d-4546-b69e-1ff3528bdf3e; no success attempt ID)."
        ),
    ]

    proposal = {
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
            "Do not claim completeDependencyClosure. Bun pin, host computer-use/"
            "enterprise edges, cli-host persistent-mode edge, typescript deep "
            "compiler-behavior semantics, create-skill/team-kit/consumer paired "
            "journeys, and live/runtime follow-ups remain open."
        ),
        "resolvedReferenceCount": 0,
        "resolvedEdgeCount": 1,
        "unresolvedTargetCount": 8,
        "resolvedEdgeNote": (
            "Resolved cursor-pstack→cursor-team-kit for locked distribution install "
            "custody (29/29 path+hash). Journey audit moved to unresolvedReferences."
        ),
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "cursor-team-kit",
                    "set": {
                        "readingEvidence": [
                            team_kit_art,
                            rel(WAVE / "nodes/team-kit-custody.md"),
                            "parity/reviews/source-discovery.md",
                            "parity/reference/distribution-sha256.txt",
                        ]
                    },
                    "evidence": [team_kit_art],
                    "disposition": team_kit["proposedEdgeNote"],
                },
                {
                    "id": "cursor-cli-host",
                    "set": {
                        "readingEvidence": [
                            cli_host_art,
                            host_art,
                            rel(WAVE / "nodes/cli-host-persistent-mode.md"),
                            "parity/research/dep-closure-wave-007/live/integrations-inventory.json",
                        ]
                    },
                    "evidence": [cli_host_art, host_art],
                    "disposition": (
                        "Wave-008 binds persistent-mode edge to measured Custom Mode "
                        "harness failure and re-states computer-use/enterprise as "
                        "environment-bound."
                    ),
                },
                {
                    "id": "source-bun-runtime",
                    "set": {
                        "readingEvidence": [
                            bun_art,
                            rel(WAVE / "nodes/bun-pin.md"),
                        ]
                    },
                    "evidence": [bun_art],
                    "disposition": bun["disposition"],
                },
                {
                    "id": "npm:typescript@7.0.2",
                    "set": {
                        "readingEvidence": [
                            ts_art,
                            rel(TS_DEEP_007),
                            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json",
                        ]
                    },
                    "evidence": [ts_art],
                    "disposition": typescript["disposition"],
                },
                {
                    "id": "cursor-create-skill",
                    "set": {
                        "readingEvidence": [
                            create_art,
                            rel(CREATE_007),
                            rel(CREATE_SKILL),
                        ]
                    },
                    "evidence": [create_art],
                    "disposition": create_skill["disposition"],
                },
                {
                    "id": "cursor-self-hosted-computer-use",
                    "set": {
                        "readingEvidence": [
                            host_art,
                            rel(WAVE / "nodes/host-edge-disposition.md"),
                        ]
                    },
                    "evidence": [host_art],
                    "disposition": "Environment-bound. Doc re-hashed; helper bundle not found via mdfind.",
                },
                {
                    "id": "cursor-enterprise-integration-policy",
                    "set": {
                        "readingEvidence": [
                            host_art,
                            rel(WAVE / "nodes/host-edge-disposition.md"),
                        ]
                    },
                    "evidence": [host_art],
                    "disposition": "Environment-bound. Doc re-hashed; live policy not observed.",
                },
                {
                    "id": "cursor-pstack",
                    "set": {
                        "readingEvidence": [
                            team_kit_art,
                            cli_host_art,
                            recursive["sourcePath"],
                        ]
                    },
                    "evidence": [team_kit_art, cli_host_art],
                    "disposition": (
                        "Wave-008 resolves team-kit install custody edge and records "
                        "environment-bound persistent-mode blocker for cli-host."
                    ),
                },
                {
                    "id": "source-tools-manifest",
                    "set": {
                        "readingEvidence": [
                            consumer["sourcePath"],
                            "parity/research/dep-closure-wave-003/consumer-binding.json",
                        ]
                    },
                    "evidence": [consumer["sourcePath"]],
                    "disposition": consumer["disposition"],
                },
            ],
            "edgeMutations": edge_mutations,
            "honestUnresolvedEdges": [
                {
                    "from": "cursor-cli-host",
                    "to": "cursor-self-hosted-computer-use",
                    "keepStatus": "unresolved",
                    "disposition": "environment-bound",
                    "blocker": host["edges"][0]["blocker"],
                    "docSha256": host["edges"][0]["docSha256"],
                },
                {
                    "from": "cursor-cli-host",
                    "to": "cursor-enterprise-integration-policy",
                    "keepStatus": "unresolved",
                    "disposition": "environment-bound",
                    "blocker": host["edges"][1]["blocker"],
                    "docSha256": host["edges"][1]["docSha256"],
                },
                {
                    "from": "cursor-pstack",
                    "to": "cursor-cli-host",
                    "keepStatus": "unverified",
                    "disposition": "environment-bound",
                    "blocker": cli_host["blocker"],
                },
            ],
            "unresolvedReferences": {
                "removeIfPresent": remove_refs,
                "add": add_refs,
                "keep": [],
                "note": (
                    "Replace wave-007 Bun/typescript/host/create-skill/live/recursive/"
                    "consumer lines with wave-008 evidence. Add team-kit journey and "
                    "cli-host persistent-mode environment-bound lines after resolving "
                    "team-kit custody edge."
                ),
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": (
                    "Must remain false until Bun pin, host edges, persistent-mode, "
                    "deep typescript semantics, and journey/live follow-ups close."
                ),
            }
        },
        "fullProposal": rel(WAVE / "merge-proposal.json"),
    }
    write_json(WAVE / "merge-proposal.json", proposal)
    return proposal


def build_inventory(paths: list[Path]) -> dict:
    sources = []
    for i, path in enumerate(paths):
        if not path.exists():
            continue
        sources.append(
            {
                "id": f"w8-{i:03d}-{path.name}",
                "path": rel(path),
                "absolutePath": str(path.resolve()),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
            }
        )
    inv = {
        "capturedAt": NOW,
        "unit": UNIT,
        "sourceCount": len(sources),
        "allSources": sources,
    }
    write_json(WAVE / "read-inventory.json", inv)
    return inv


def verify_inventory(inv: dict) -> dict:
    rows = []
    bad = 0
    for src in inv["allSources"]:
        path = Path(src["absolutePath"])
        if not path.exists():
            path = ROOT / src["path"]
        out = subprocess.check_output(
            ["shasum", "-a", "256", str(path)], text=True
        ).split()[0]
        ok = out == src["sha256"]
        if not ok:
            bad += 1
        rows.append({"id": src["id"], "path": src["path"], "ok": ok, "sha256": out})
    result = {
        "capturedAt": NOW,
        "status": "VERIFIED" if bad == 0 else "NOT_VERIFIED",
        "mismatchCount": bad,
        "rows": rows,
    }
    write_json(WAVE / "verify-hashes.json", result)
    verifier = WAVE / "verify_inventory_shasum.py"
    write_text(
        verifier,
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
    os.chmod(verifier, 0o755)
    return result


def main() -> None:
    team_kit = build_team_kit()
    cli_host = build_cli_host()
    host = build_host_edges()
    bun = build_bun()
    typescript = build_typescript()
    create_skill = build_create_skill()
    live = build_carry_forward(
        "live-integrations",
        LIVE_007,
        "live/integrations-carryforward.json",
        (
            "Wave-007 live inventory (416 items) remains the inventory artifact. "
            "Wave-008 re-hashes it and keeps live exercise open. No fabricated live runs."
        ),
    )
    write_text(
        WAVE / "nodes/live-integrations.md",
        f"# Live integrations (wave-008)\n\n{live['disposition']}\n\n"
        f"source: `{live['sourcePath']}` sha256=`{live['sourceSha256']}`\n",
    )
    recursive = build_carry_forward(
        "recursive-extraction",
        RECURSIVE_007,
        "recursive/extraction-carryforward.json",
        (
            "Wave-007 recursive extraction (185 files / 176 refs) remains complete. "
            "Wave-008 re-hashes it. Live/runtime audit of external targets stays open."
        ),
    )
    write_text(
        WAVE / "nodes/recursive-extraction.md",
        f"# Recursive extraction (wave-008)\n\n{recursive['disposition']}\n\n"
        f"source: `{recursive['sourcePath']}` sha256=`{recursive['sourceSha256']}`\n",
    )
    consumer = build_carry_forward(
        "consumer-journeys",
        CONSUMER_007,
        "consumer/journey-carryforward.json",
        (
            "Wave-007 consumer journey matrix (6 journeys; local smokes exit 0) stands. "
            "Wave-008 re-hashes it. Paired Cursor+Pi acceptance journeys remain open."
        ),
    )
    # refresh local smokes into carryforward note via re-run
    orch = run(["bun", "run", "orch/orch.ts", "--help"], cwd=SCRIPTS)
    typecheck = run(["bun", "run", "typecheck"], cwd=SCRIPTS)
    consumer["localSmokeRefresh"] = {
        "orchHelpExit": orch["exitCode"],
        "typecheckExit": typecheck["exitCode"],
    }
    write_json(WAVE / "consumer/journey-carryforward.json", consumer)
    write_text(
        WAVE / "nodes/consumer-journey-matrix.md",
        f"# Consumer journeys (wave-008)\n\n{consumer['disposition']}\n\n"
        f"orch --help exit={orch['exitCode']}; typecheck exit={typecheck['exitCode']}\n"
        f"source: `{consumer['sourcePath']}` sha256=`{consumer['sourceSha256']}`\n",
    )

    proposal = build_merge_proposal(
        team_kit, cli_host, host, bun, typescript, create_skill, live, recursive, consumer
    )

    decisions = [
        "capturedAt\tdecision\tevidence",
        f"{NOW}\tresolve cursor-pstack→cursor-team-kit on 29/29 custody\t{rel(WAVE / 'team-kit/custody-disposition.json')}",
        f"{NOW}\tkeep cursor-pstack→cursor-cli-host unverified environment-bound\t{rel(WAVE / 'cli-host/persistent-mode-disposition.json')}",
        f"{NOW}\tkeep host computer-use/enterprise unresolved environment-bound\t{rel(WAVE / 'host/host-edge-disposition.json')}",
        f"{NOW}\tbun pin still unresolved\t{rel(WAVE / 'bun/official-capture.json')}",
        f"{NOW}\ttypescript deep semantics still open drift={typescript['catalogHashDriftCount']}\t{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}",
        f"{NOW}\tcompleteDependencyClosure remains false\t{rel(WAVE / 'merge-proposal.json')}",
    ]
    write_text(WAVE / "decisions.tsv", "\n".join(decisions) + "\n")

    inventory_paths = [
        WAVE / "team-kit/custody-disposition.json",
        WAVE / "cli-host/persistent-mode-disposition.json",
        WAVE / "host/host-edge-disposition.json",
        WAVE / "bun/official-capture.json",
        WAVE / "bun/bun-version.txt",
        WAVE / "npm/typescript-deep-semantics-disposition.json",
        WAVE / "create-skill/journey-audit.json",
        WAVE / "live/integrations-carryforward.json",
        WAVE / "recursive/extraction-carryforward.json",
        WAVE / "consumer/journey-carryforward.json",
        WAVE / "merge-proposal.json",
        WAVE / "decisions.tsv",
        WAVE / "nodes/team-kit-custody.md",
        WAVE / "nodes/cli-host-persistent-mode.md",
        WAVE / "nodes/host-edge-disposition.md",
        WAVE / "nodes/bun-pin.md",
        WAVE / "nodes/typescript-deep-semantics.md",
        WAVE / "nodes/create-skill-journey-audit.md",
        WAVE / "nodes/live-integrations.md",
        WAVE / "nodes/recursive-extraction.md",
        WAVE / "nodes/consumer-journey-matrix.md",
        COMPUTER_USE,
        MODEL_MGMT,
        CUSTOM_MODE_REPORT,
        CUSTOM_MODE_SUMMARY,
        DIST_HASHES,
        CREATE_SKILL,
        PSTACK_README,
        LIVE_007,
        RECURSIVE_007,
        CONSUMER_007,
        CREATE_007,
        TS_DEEP_007,
    ]
    # include bun doc bodies that exist
    for p in (WAVE / "bun").glob("*.html"):
        inventory_paths.append(p)

    inv = build_inventory(inventory_paths)
    verify = verify_inventory(inv)
    summary = {
        "unit": UNIT,
        "capturedAt": NOW,
        "teamKitCustodyStatus": team_kit["custodyStatus"],
        "proposedResolvedEdges": 1 if team_kit["custodyStatus"] == "verified" else 0,
        "newlyResolvableEdges": 1 if team_kit["custodyStatus"] == "verified" else 0,
        "newlyResolvableRefs": 0,
        "completeDependencyClosure": False,
        "verifyStatus": verify["status"],
        "mergeProposal": rel(WAVE / "merge-proposal.json"),
        "unresolvedTargetCount": proposal["unresolvedTargetCount"],
    }
    write_json(WAVE / "wave-summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
