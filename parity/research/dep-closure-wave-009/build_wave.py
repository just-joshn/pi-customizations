#!/usr/bin/env python3
"""Build u-dep-closure-wave-009 research artifacts. Does not edit ledgers."""

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
UNIT = "u-dep-closure-wave-009"
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
TS_DEEP_008 = (
    ROOT
    / "parity/research/dep-closure-wave-008/npm/typescript-deep-semantics-disposition.json"
)
RECURSIVE_007 = ROOT / "parity/research/dep-closure-wave-007/recursive/extraction.json"
LIVE_007 = ROOT / "parity/research/dep-closure-wave-007/live/integrations-inventory.json"
CONSUMER_007 = ROOT / "parity/research/dep-closure-wave-007/consumer/journey-matrix.json"
CREATE_007 = ROOT / "parity/research/dep-closure-wave-007/create-skill/journey-matrix.json"
CREATE_008 = ROOT / "parity/research/dep-closure-wave-008/create-skill/journey-audit.json"
TEAM_KIT_008 = ROOT / "parity/research/dep-closure-wave-008/team-kit/custody-disposition.json"
CUSTOM_MODE_REPORT = (
    ROOT / "parity/briefs/reports/u-cursor-custom-mode-path-report.md"
)
CUSTOM_MODE_SUMMARY = (
    ROOT / "parity/evidence/mode-sticky/probes/probe-custom-mode-path-summary.json"
)
EVIDENCE = ROOT / "parity/evidence"
LIVE_PSTACK_PLUGIN = (
    Path.home()
    / ".cursor/plugins/cache/cursor-public/pstack/ccb5507cec1546dc88135c1139c811e6c59115ba"
)
LIVE_TEAM_KIT_PLUGIN = (
    Path.home()
    / ".cursor/plugins/cache/cursor-public/cursor-team-kit/ccb5507cec1546dc88135c1139c811e6c59115ba"
)

# Sample five named skills spanning review/CI/verify/control surfaces.
TEAM_KIT_SAMPLE_SKILLS = [
    "verify-this",
    "deslop",
    "fix-ci",
    "review-and-ship",
    "control-cli",
]

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
    req = Request(url, headers={"User-Agent": "pi-pstack-parity-dep-closure/9"})
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


def find_pair_artifacts(needle: str) -> list[dict]:
    """Search parity/evidence for pair-*.json whose path or body mentions needle."""
    hits = []
    if not EVIDENCE.exists():
        return hits
    for path in sorted(EVIDENCE.rglob("pair-*.json")):
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        if needle not in text and needle not in str(path):
            continue
        attempt_ids = []
        try:
            data = json.loads(text)
            for side in ("cursor", "pi"):
                node = data.get(side) or {}
                aid = node.get("attemptId")
                if aid:
                    attempt_ids.append(aid)
        except json.JSONDecodeError:
            data = None
        hits.append(
            {
                "path": rel(path),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
                "attemptIds": attempt_ids,
            }
        )
    return hits


def build_team_kit_journey_sampling() -> dict:
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

    named_skills = sorted(
        p.name for p in (TEAM_KIT / "skills").iterdir() if p.is_dir()
    )
    skill_inventory = []
    for name in named_skills:
        skill_md = TEAM_KIT / "skills" / name / "SKILL.md"
        skill_inventory.append(
            {
                "skillId": name,
                "skillMdPath": rel(skill_md) if skill_md.exists() else None,
                "skillMdSha256": sha256(skill_md) if skill_md.exists() else None,
                "skillMdByteLength": skill_md.stat().st_size if skill_md.exists() else None,
                "pairedJourneyStatus": "not_run",
            }
        )

    sample = []
    for name in TEAM_KIT_SAMPLE_SKILLS:
        skill_md = TEAM_KIT / "skills" / name / "SKILL.md"
        sample.append(
            {
                "skillId": name,
                "skillMdPath": rel(skill_md) if skill_md.exists() else None,
                "skillMdSha256": sha256(skill_md) if skill_md.exists() else None,
                "skillMdByteLength": skill_md.stat().st_size if skill_md.exists() else None,
                "sampleRole": "wave-009 journey-sample seed",
                "requiredEvidence": (
                    f"Paired Cursor+Pi user journey exercising team-kit skill `{name}` "
                    "against the locked distribution digest"
                ),
                "pairedJourneyStatus": "not_run",
                "pairedAttemptIds": [],
                "evidenceHits": find_pair_artifacts(name),
            }
        )

    live_pstack = LIVE_PSTACK_PLUGIN.is_dir()
    live_team = LIVE_TEAM_KIT_PLUGIN.is_dir()
    live_team_any = (
        any(Path.home().joinpath(".cursor/plugins/cache").rglob("cursor-team-kit"))
        if Path.home().joinpath(".cursor/plugins/cache").exists()
        else False
    )
    prior_008 = json.loads(TEAM_KIT_008.read_text()) if TEAM_KIT_008.exists() else None

    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "priorWave008Custody": rel(TEAM_KIT_008) if TEAM_KIT_008.exists() else None,
        "priorWave008CustodySha256": sha256(TEAM_KIT_008) if TEAM_KIT_008.exists() else None,
        "edge": {"from": "cursor-pstack", "to": "cursor-team-kit"},
        "edgeAlreadyResolvedByWave008": True,
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
        "lockMismatchCount": len(mismatches),
        "lockMismatches": mismatches,
        "custodyStatus": "verified"
        if len(files) == 29 and not mismatches
        else "incomplete",
        "namedSkillCount": len(named_skills),
        "namedSkills": named_skills,
        "skillInventory": skill_inventory,
        "journeySampleSize": len(sample),
        "journeySample": sample,
        "journeysStillOpenCount": sum(
            1 for s in skill_inventory if s["pairedJourneyStatus"] != "passed"
        ),
        "liveInstall": {
            "pstackCachePresent": live_pstack,
            "teamKitCachePresent": live_team,
            "teamKitAnywhereUnderPluginsCache": live_team_any,
        },
        "journeyAuditStatus": "open",
        "disposition": (
            "Wave-009 re-verifies team-kit custody (already resolved in wave-008) and "
            f"samples {len(sample)} of {len(named_skills)} named skills with SKILL.md "
            "path+hash. No paired Cursor+Pi journeys were run. Sample evidence search "
            "found no closing attempt IDs for the sampled skills."
        ),
        "blockerForJourneyClosure": (
            "Paired Cursor+Pi user journeys across the full team-kit skill set remain "
            "required. Sampling inventories acceptance seeds. It does not close the ref."
        ),
        "priorCustodyNote": prior_008.get("proposedEdgeNote") if prior_008 else None,
        "files": files,
    }
    write_json(WAVE / "team-kit/journey-sampling.json", disposition)
    write_text(
        WAVE / "nodes/team-kit-journey-sampling.md",
        "\n".join(
            [
                "# cursor-team-kit skill-set journey sampling (wave-009)",
                "",
                f"capturedAt: `{NOW}`",
                f"custodyStatus: `{disposition['custodyStatus']}`",
                f"namedSkillCount: {disposition['namedSkillCount']}",
                f"journeySampleSize: {disposition['journeySampleSize']}",
                f"journeysStillOpenCount: {disposition['journeysStillOpenCount']}",
                "",
                disposition["disposition"],
                "",
                f"Evidence: `{rel(WAVE / 'team-kit/journey-sampling.json')}`",
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
        "keepStatus": "unverified",
        "disposition": "environment-bound",
        "newEvidenceFound": False,
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
            "summarySchema": summary.get("schema"),
        },
        "blocker": (
            "Persistent-mode Option/Alt+Enter Custom Mode path is environment-bound. "
            "Measured exhaustive-negative on locked cursor-agent 2026.10.01-e373342: "
            "glass_custom_modes off; attempts 6977eeec-08bd-4829-810c-11d526d9f9fb and "
            "9857dda0-a74d-4546-b69e-1ff3528bdf3e; no success attempt ID. No new success "
            "evidence in wave-009. Operator must enable Custom Modes (or capture via "
            "Agents Window/IDE path), then recapture paired Cursor+Pi sticky evidence."
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
                "# cursor-pstack → cursor-cli-host (wave-009)",
                "",
                f"capturedAt: `{NOW}`",
                "keepStatus: `unverified`",
                "disposition: `environment-bound`",
                f"cursor-agent: `{agent['stdout']}`",
                f"newEvidenceFound: `{False}`",
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
        "newEvidenceFound": False,
        "edges": [
            {
                "from": "cursor-cli-host",
                "to": "cursor-self-hosted-computer-use",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "docPath": rel(COMPUTER_USE),
                "docSha256": computer_sha,
                "docByteLength": COMPUTER_USE.stat().st_size,
                "docShaUnchangedFromPrior": computer_sha
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
                    "bundle returned no matches. Wave-009 found no new runtime evidence."
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
                "docShaUnchangedFromPrior": model_sha
                == "2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205",
                "blocker": (
                    "Public docs only (model-management.md). Closing this edge requires "
                    "observing live Enterprise team/org model access, MCP allowlist "
                    "enforcement, and CLI applicability. Wave-009 found no new runtime "
                    "evidence. Standing orders forbid broad allowlist changes."
                ),
            },
        ],
    }
    write_json(WAVE / "host/host-edge-disposition.json", disposition)
    write_text(
        WAVE / "nodes/host-edge-disposition.md",
        "\n".join(
            [
                "# Host edge disposition (wave-009)",
                "",
                f"capturedAt: `{NOW}`",
                "newEvidenceFound: `false`",
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
            "Wave-009 re-probed tools/poteto pin files, recorded host bun path and "
            "version, and re-fetched Bun install/lockfile/bunfig docs. No official Bun "
            "binary pin exists under the tools subtree. Do not invent a pin from local "
            f"{version['stdout']}, mise latest, or bun-types."
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
                "# source-bun-runtime pin (wave-009)",
                "",
                "pinStatus: `unresolved`",
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
    """Honest disposition. Structural audit != deep compiler-behavior semantics."""
    prior = json.loads(TS_DEEP_007.read_text())
    files = prior["files"]
    drift = []
    tarball_root = None
    candidates = [
        ROOT / "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/package",
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

    honesty = {
        "structuralBodyAuditComplete": True,
        "structuralBodyAuditEvidence": (
            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json"
        ),
        "catalogReverifyIsNotDeepSemantics": True,
        "consumerTypecheckIsNotDeepSemantics": True,
        "tscVersionProbeIsNotDeepSemantics": True,
        "whatWouldCloseDeepSemantics": (
            "A compiler-test oracle or exhaustive internal-behavior journey that "
            "exercises AST/enum/helper contracts for the 136 internal_module_surface "
            "files under typescript@7.0.2. Absent that oracle, the unresolvedReference "
            "must stay open."
        ),
        "honestStatus": "deep_compiler_semantics_still_open",
        "doNotClaim": [
            "catalogHashDriftCount=0 closes deep semantics",
            "bun run typecheck closes deep semantics",
            "tsc --version closes deep semantics",
        ],
    }

    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "package": "typescript@7.0.2",
        "priorWave007Disposition": rel(TS_DEEP_007),
        "priorWave007Sha256": sha256(TS_DEEP_007),
        "priorWave008Disposition": rel(TS_DEEP_008) if TS_DEEP_008.exists() else None,
        "priorWave008Sha256": sha256(TS_DEEP_008) if TS_DEEP_008.exists() else None,
        "structuralBodyAuditComplete": True,
        "deepInternalFileCount": len(files),
        "localTypescriptTree": rel(tarball_root) if tarball_root else None,
        "catalogHashDriftFromWave007": drift,
        "catalogHashDriftCount": len(drift),
        "deepCompilerSemanticsStatus": "still_open",
        "honesty": honesty,
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
            "Wave-009 honesty pass. Structural body-contract audit from wave-005 stays "
            f"complete. Catalog re-verify of {len(files)} internal files shows "
            f"catalogHashDriftCount={len(drift)}. Consumer typecheck exit="
            f"{typecheck['exitCode']}. None of those close deep compiler-behavior "
            "semantics. deepCompilerSemanticsStatus remains still_open."
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
                "# npm:typescript@7.0.2 deep semantics honesty (wave-009)",
                "",
                f"catalogHashDriftCount: {len(drift)}",
                "deepCompilerSemanticsStatus: `still_open`",
                f"typecheck exitCode: {typecheck['exitCode']}",
                "honestStatus: `deep_compiler_semantics_still_open`",
                "",
                disposition["disposition"],
                "",
                "Do not claim typecheck or catalog re-verify as deep-semantics closure.",
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
    text = CREATE_SKILL.read_text()
    phase_headers = re.findall(r"^### (Phase \d+: .+)$", text, flags=re.M)
    checklist_items = re.findall(r"^\s*[-*] \[[ xX]\] ", text, flags=re.M)
    evidence_hits = find_pair_artifacts("create-skill")
    # Also scan for /create-skill slash mentions in pair files.
    evidence_hits_slash = find_pair_artifacts("/create-skill")
    seen = {h["path"] for h in evidence_hits}
    for h in evidence_hits_slash:
        if h["path"] not in seen:
            evidence_hits.append(h)

    matrix = []
    for j in prior["journeyMatrix"]:
        matrix.append(
            {
                **j,
                "status": "not_run",
                "pairedAttemptIds": [],
                "wave009EvidenceSearchHits": 0,
            }
        )

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
        "priorWave008Audit": rel(CREATE_008) if CREATE_008.exists() else None,
        "priorWave008AuditSha256": sha256(CREATE_008) if CREATE_008.exists() else None,
        "phaseHeadersParsed": phase_headers,
        "phaseSectionCount": len(phase_headers),
        "checklistItemCount": len(checklist_items),
        "journeyMatrix": matrix,
        "journeysStillOpenCount": len(still_open),
        "pairedEvidenceSearch": {
            "needles": ["create-skill", "/create-skill"],
            "hitCount": len(evidence_hits),
            "hits": evidence_hits,
            "note": (
                "Hits that mention create-skill or /create-skill in path/body. "
                "None are accepted as closing the four-phase create-skill journey "
                "matrix unless they carry paired attempt IDs for Discovery/Design/"
                "Implementation/Verification."
            ),
        },
        "journeyAuditStatus": "open",
        "disposition": (
            "Wave-009 paired journey audit re-checks create-skill capture vs live "
            f"install hash (match={live_sha == capture_sha}), re-parses "
            f"{len(phase_headers)} phase headers and {len(checklist_items)} checklist "
            f"items, and searches parity/evidence for create-skill pairs "
            f"(hitCount={len(evidence_hits)}). No closing paired Cursor+Pi journeys "
            "were found or run."
        ),
        "blockerForJourneyClosure": (
            "Paired Cursor+Pi user journeys across Discovery, Design, Implementation, "
            "and Verification remain required."
        ),
    }
    write_json(WAVE / "create-skill/journey-audit.json", disposition)
    write_text(
        WAVE / "nodes/create-skill-journey-audit.md",
        "\n".join(
            [
                "# cursor-create-skill journey audit (wave-009)",
                "",
                f"captureMatchesLiveInstall: `{disposition['captureMatchesLiveInstall']}`",
                f"skillSha256: `{capture_sha}`",
                f"phaseSectionCount: {disposition['phaseSectionCount']}",
                f"checklistItemCount: {disposition['checklistItemCount']}",
                f"evidenceHitCount: {len(evidence_hits)}",
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


def build_consumer_journeys() -> dict:
    prior = json.loads(CONSUMER_007.read_text())
    journeys = []
    for j in prior["journeys"]:
        entry = dict(j)
        consumer_path = j.get("consumerPath")
        if consumer_path:
            path = ROOT / consumer_path
            if path.exists():
                entry["consumerSha256Refresh"] = sha256(path)
                entry["consumerByteLength"] = path.stat().st_size
                entry["consumerHashMatchesPrior"] = (
                    entry["consumerSha256Refresh"] == j.get("consumerSha256")
                )
            else:
                entry["consumerSha256Refresh"] = None
                entry["consumerHashMatchesPrior"] = False
        entry["pairedJourneyStatus"] = "not_run"
        package_id = j.get("packageId", "")
        entry["evidenceHits"] = find_pair_artifacts(package_id.split("@")[0] if package_id else "")
        journeys.append(entry)

    orch = run(["bun", "run", "orch/orch.ts", "--help"], cwd=SCRIPTS)
    typecheck = run(["bun", "run", "typecheck"], cwd=SCRIPTS)
    test_probe = run(["bun", "test", "orch", "watch-pr"], cwd=SCRIPTS)

    disposition = {
        "capturedAt": NOW,
        "unit": UNIT,
        "priorMatrix": rel(CONSUMER_007),
        "priorMatrixSha256": sha256(CONSUMER_007),
        "journeyCount": len(journeys),
        "journeys": journeys,
        "journeysStillOpenCount": sum(
            1 for j in journeys if j.get("pairedJourneyStatus") != "passed"
        ),
        "localSmokes": [
            {
                "id": "orch-help",
                "command": orch["command"],
                "exitCode": orch["exitCode"],
                "stdoutTail": orch["stdout"][-400:],
            },
            {
                "id": "tools-typecheck",
                "command": typecheck["command"],
                "exitCode": typecheck["exitCode"],
                "stderrTail": typecheck["stderr"][-400:],
            },
            {
                "id": "bun-test-orch-watch-pr",
                "command": test_probe["command"],
                "exitCode": test_probe["exitCode"],
                "stdoutTail": test_probe["stdout"][-400:],
                "stderrTail": test_probe["stderr"][-400:],
                "note": (
                    "Local bun test under locked bun-types. Not a paired Cursor+Pi "
                    "acceptance journey."
                ),
            },
        ],
        "pairedAcceptanceStatus": "open",
        "disposition": (
            "Wave-009 refreshes the six-row consumer journey matrix with consumer "
            f"path+hash re-checks and local smokes (orch --help exit={orch['exitCode']}, "
            f"typecheck exit={typecheck['exitCode']}, bun test exit={test_probe['exitCode']}). "
            "Local smokes are not paired Cursor+Pi acceptance journeys. All six paired "
            "journeys remain not_run."
        ),
        "blockerForPairedAcceptance": (
            "Local smokes are not paired Cursor+Pi user journeys against the shipped "
            "package digest."
        ),
    }
    write_json(WAVE / "consumer/journey-refresh.json", disposition)
    write_text(
        WAVE / "nodes/consumer-journey-matrix.md",
        "\n".join(
            [
                "# Tools consumer paired journeys (wave-009)",
                "",
                f"journeyCount: {disposition['journeyCount']}",
                f"journeysStillOpenCount: {disposition['journeysStillOpenCount']}",
                f"orch --help exit: {orch['exitCode']}",
                f"typecheck exit: {typecheck['exitCode']}",
                f"bun test exit: {test_probe['exitCode']}",
                "",
                disposition["disposition"],
                "",
                f"Evidence: `{rel(WAVE / 'consumer/journey-refresh.json')}`",
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
    write_json(WAVE / out_name, payload)
    return payload


def build_merge_proposal(
    team_kit: dict,
    cli_host: dict,
    host: dict,
    bun: dict,
    typescript: dict,
    create_skill: dict,
    consumer: dict,
    live: dict,
    recursive: dict,
) -> dict:
    team_kit_art = rel(WAVE / "team-kit/journey-sampling.json")
    cli_host_art = rel(WAVE / "cli-host/persistent-mode-disposition.json")
    host_art = rel(WAVE / "host/host-edge-disposition.json")
    bun_art = rel(WAVE / "bun/official-capture.json")
    ts_art = rel(WAVE / "npm/typescript-deep-semantics-disposition.json")
    create_art = rel(WAVE / "create-skill/journey-audit.json")
    consumer_art = rel(WAVE / "consumer/journey-refresh.json")

    edge_mutations = [
        {
            "from": "cursor-pstack",
            "to": "cursor-cli-host",
            "set": {
                "status": "unverified",
                "disposition": "environment-bound",
                "blocker": cli_host["blocker"],
                "evidence": cli_host["evidence"]
                + [cli_host_art, rel(WAVE / "nodes/cli-host-persistent-mode.md")],
                "wave009Note": cli_host["blocker"],
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
                "wave009Note": host["edges"][0]["blocker"],
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
                "wave009Note": host["edges"][1]["blocker"],
            },
        },
    ]

    # Exact strings currently in dependencies.json unresolvedReferences (wave-008).
    remove_refs = [
        "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-008 capture at parity/research/dep-closure-wave-008/bun/official-capture.json (local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions under tools; host mise bun/latest and bun-types lock resolve are not runtime pins).",
        "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after wave-008 disposition at parity/research/dep-closure-wave-008/npm/typescript-deep-semantics-disposition.json (136 internal dist files re-verified path+hash; catalogHashDriftCount=0; consumer typecheck exit=0; no compiler-test oracle for internals).",
        "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-008 environment-bound disposition at parity/research/dep-closure-wave-008/host/host-edge-disposition.json; runtime services were not exercised.",
        "cursor-create-skill journey audit remains open after wave-008 re-check at parity/research/dep-closure-wave-008/create-skill/journey-audit.json (SKILL.md sha256 255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82; captureMatchesLiveInstall=True; 4 phase journeys still open; paired journeys not run).",
        "cursor-team-kit full skill-set paired journey audit remains open after wave-008 custody resolve at parity/research/dep-closure-wave-008/team-kit/custody-disposition.json (29/29 distribution hashes; 18 named skills; live plugin-cache install absent; per-skill Cursor+Pi journeys not run).",
        "Inventoried live integrations carried forward from parity/research/dep-closure-wave-007/live/integrations-inventory.json (sha256 63ef7f8f4c35e3918556e787f22eb308666e5e8d0b444b41584524ce13b867d4). Live exercise and automation-editor runtime remain open.",
        "Recursive references extraction carried forward from parity/research/dep-closure-wave-007/recursive/extraction.json (sha256 eb531640c75896c1443fd0f8c12f5a82b79c3500d6cbbe9425611222621ca323). Live/runtime audit of extracted external targets remains open.",
        "Tools package consumer acceptance journey matrix carried forward from parity/research/dep-closure-wave-007/consumer/journey-matrix.json (sha256 0d007527cd8d70f9888776cdd5135151b8db34167af26f5820cae939fc743ed3). Paired Cursor+Pi acceptance journeys remain open.",
        "cursor-pstack → cursor-cli-host persistent-mode edge remains unverified after wave-008 environment-bound disposition at parity/research/dep-closure-wave-008/cli-host/persistent-mode-disposition.json (glass_custom_modes off; attempts 6977eeec-08bd-4829-810c-11d526d9f9fb / 9857dda0-a74d-4546-b69e-1ff3528bdf3e; no success attempt ID).",
    ]

    add_refs = [
        (
            f"Official Bun runtime version pin under source-bun-runtime remains unresolved "
            f"after wave-009 capture at {bun_art} (local {bun['localBunStdout']} only; "
            "no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions under "
            "tools; host mise bun/latest and bun-types lock resolve are not runtime pins)."
        ),
        (
            f"npm:typescript@7.0.2 deep compiler-behavior semantics remain open after "
            f"wave-009 honesty disposition at {ts_art} "
            f"(structuralBodyAuditComplete=true; catalogHashDriftCount="
            f"{typescript['catalogHashDriftCount']}; consumer typecheck exit="
            f"{typescript['consumerTypecheckProbe']['exitCode']}; honesty records that "
            "catalog re-verify and typecheck are not deep-semantics proof; no "
            "compiler-test oracle)."
        ),
        (
            "cursor-cli-host edges to computer-use and enterprise policy remain unresolved "
            f"after wave-009 environment-bound disposition at {host_art}; no new runtime "
            "evidence; services were not exercised."
        ),
        (
            "cursor-create-skill journey audit remains open after wave-009 paired journey "
            f"audit at {create_art} (SKILL.md sha256 {create_skill['skillSha256']}; "
            f"captureMatchesLiveInstall={create_skill['captureMatchesLiveInstall']}; "
            f"phaseSectionCount={create_skill['phaseSectionCount']}; "
            f"evidenceHitCount={create_skill['pairedEvidenceSearch']['hitCount']}; "
            f"{create_skill['journeysStillOpenCount']} phase journeys still open; paired "
            "journeys not run)."
        ),
        (
            "cursor-team-kit full skill-set paired journey audit remains open after "
            f"wave-009 journey sampling at {team_kit_art} "
            f"(custody re-verified {team_kit['lockMatchCount']}/{team_kit['trackedFileCount']}; "
            f"{team_kit['namedSkillCount']} named skills inventoried; sampleSize="
            f"{team_kit['journeySampleSize']}; per-skill Cursor+Pi journeys not run)."
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
            f"Tools package consumer acceptance journey matrix refreshed at {consumer_art} "
            f"(prior sha256 {consumer['priorMatrixSha256']}; "
            f"{consumer['journeyCount']} journeys; local smokes recorded; paired "
            "Cursor+Pi acceptance journeys remain open)."
        ),
        (
            "cursor-pstack → cursor-cli-host persistent-mode edge remains unverified "
            f"after wave-009 environment-bound disposition at {cli_host_art} "
            "(glass_custom_modes off; attempts "
            "6977eeec-08bd-4829-810c-11d526d9f9fb / "
            "9857dda0-a74d-4546-b69e-1ff3528bdf3e; no success attempt ID; no new evidence)."
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
        "resolvedEdgeCount": 0,
        "unresolvedTargetCount": 9,
        "resolvedEdgeNote": (
            "No new edges resolved. cursor-pstack→cursor-team-kit stays resolved from "
            "wave-008. Wave-009 advances journey sampling/audits without fabricating "
            "paired journeys."
        ),
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "cursor-team-kit",
                    "set": {
                        "readingEvidence": [
                            team_kit_art,
                            rel(WAVE / "nodes/team-kit-journey-sampling.md"),
                            rel(TEAM_KIT_008),
                            "parity/reference/distribution-sha256.txt",
                        ]
                    },
                    "evidence": [team_kit_art],
                    "disposition": team_kit["disposition"],
                },
                {
                    "id": "cursor-cli-host",
                    "set": {
                        "readingEvidence": [
                            cli_host_art,
                            host_art,
                            rel(WAVE / "nodes/cli-host-persistent-mode.md"),
                        ]
                    },
                    "evidence": [cli_host_art, host_art],
                    "disposition": (
                        "Wave-009 re-states persistent-mode and host edges as "
                        "environment-bound. No new success evidence."
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
                    "disposition": "Environment-bound. Doc re-hashed; no new helper evidence.",
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
                            consumer_art,
                        ]
                    },
                    "evidence": [team_kit_art, cli_host_art, consumer_art],
                    "disposition": (
                        "Wave-009 samples team-kit journeys, refreshes consumer paired "
                        "journey matrix, and keeps cli-host persistent-mode "
                        "environment-bound."
                    ),
                },
                {
                    "id": "source-tools-manifest",
                    "set": {
                        "readingEvidence": [
                            consumer_art,
                            "parity/research/dep-closure-wave-003/consumer-binding.json",
                        ]
                    },
                    "evidence": [consumer_art],
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
                    "Replace wave-008 Bun/typescript/host/create-skill/team-kit/live/"
                    "recursive/consumer/cli-host lines with wave-009 evidence. No refs "
                    "closed. Team-kit journey sampling and consumer refresh stay open."
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
                "id": f"w9-{i:03d}-{path.name}",
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
    team_kit = build_team_kit_journey_sampling()
    cli_host = build_cli_host()
    host = build_host_edges()
    bun = build_bun()
    typescript = build_typescript()
    create_skill = build_create_skill()
    consumer = build_consumer_journeys()
    live = build_carry_forward(
        "live-integrations",
        LIVE_007,
        "live/integrations-carryforward.json",
        (
            "Wave-007 live inventory remains the inventory artifact. Wave-009 "
            "re-hashes it and keeps live exercise open. No fabricated live runs."
        ),
    )
    write_text(
        WAVE / "nodes/live-integrations.md",
        f"# Live integrations (wave-009)\n\n{live['disposition']}\n\n"
        f"source: `{live['sourcePath']}` sha256=`{live['sourceSha256']}`\n",
    )
    recursive = build_carry_forward(
        "recursive-extraction",
        RECURSIVE_007,
        "recursive/extraction-carryforward.json",
        (
            "Wave-007 recursive extraction remains complete. Wave-009 re-hashes it. "
            "Live/runtime audit of external targets stays open."
        ),
    )
    write_text(
        WAVE / "nodes/recursive-extraction.md",
        f"# Recursive extraction (wave-009)\n\n{recursive['disposition']}\n\n"
        f"source: `{recursive['sourcePath']}` sha256=`{recursive['sourceSha256']}`\n",
    )

    proposal = build_merge_proposal(
        team_kit,
        cli_host,
        host,
        bun,
        typescript,
        create_skill,
        consumer,
        live,
        recursive,
    )

    decisions = [
        "capturedAt\tdecision\tevidence",
        f"{NOW}\tno new edges; keep team-kit resolved from wave-008; sample journeys\t{rel(WAVE / 'team-kit/journey-sampling.json')}",
        f"{NOW}\tkeep cursor-pstack→cursor-cli-host unverified environment-bound\t{rel(WAVE / 'cli-host/persistent-mode-disposition.json')}",
        f"{NOW}\tkeep host computer-use/enterprise unresolved environment-bound\t{rel(WAVE / 'host/host-edge-disposition.json')}",
        f"{NOW}\tbun pin still unresolved\t{rel(WAVE / 'bun/official-capture.json')}",
        f"{NOW}\ttypescript deep semantics honesty still open drift={typescript['catalogHashDriftCount']}\t{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}",
        f"{NOW}\tcreate-skill paired journeys still open\t{rel(WAVE / 'create-skill/journey-audit.json')}",
        f"{NOW}\tconsumer paired journeys still open\t{rel(WAVE / 'consumer/journey-refresh.json')}",
        f"{NOW}\tcompleteDependencyClosure remains false\t{rel(WAVE / 'merge-proposal.json')}",
    ]
    write_text(WAVE / "decisions.tsv", "\n".join(decisions) + "\n")

    inventory_paths = [
        WAVE / "team-kit/journey-sampling.json",
        WAVE / "cli-host/persistent-mode-disposition.json",
        WAVE / "host/host-edge-disposition.json",
        WAVE / "bun/official-capture.json",
        WAVE / "bun/bun-version.txt",
        WAVE / "npm/typescript-deep-semantics-disposition.json",
        WAVE / "create-skill/journey-audit.json",
        WAVE / "consumer/journey-refresh.json",
        WAVE / "live/integrations-carryforward.json",
        WAVE / "recursive/extraction-carryforward.json",
        WAVE / "merge-proposal.json",
        WAVE / "decisions.tsv",
        WAVE / "nodes/team-kit-journey-sampling.md",
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
        TEAM_KIT_008,
    ]
    for p in (WAVE / "bun").glob("*.html"):
        inventory_paths.append(p)

    inv = build_inventory(inventory_paths)
    verify = verify_inventory(inv)
    summary = {
        "unit": UNIT,
        "capturedAt": NOW,
        "teamKitCustodyStatus": team_kit["custodyStatus"],
        "teamKitJourneySampleSize": team_kit["journeySampleSize"],
        "proposedResolvedEdges": 0,
        "newlyResolvableEdges": 0,
        "newlyResolvableRefs": 0,
        "completeDependencyClosure": False,
        "verifyStatus": verify["status"],
        "mergeProposal": rel(WAVE / "merge-proposal.json"),
        "unresolvedTargetCount": proposal["unresolvedTargetCount"],
        "createSkillEvidenceHits": create_skill["pairedEvidenceSearch"]["hitCount"],
        "typescriptHonestStatus": typescript["honesty"]["honestStatus"],
        "bunPinStatus": bun["pinStatus"],
    }
    write_json(WAVE / "wave-summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
