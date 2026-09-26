#!/usr/bin/env python3
"""Read-only inventory of a Pi setup for /skill:doctor. Prints one JSON document.

Sections:
  install   pi on PATH, running version, installed releases
  settings  parse status of user and project settings files
  prompt    what the newest session for --cwd actually sent: system prompt
            section sizes, tool declaration sizes, loaded skills, context files
  packages  declared packages and whether their checkout exists
  usage     skill and tool usage across session files from the last --days days
  skills    every SKILL.md on disk under known roots, with frontmatter problems
  collisions skill names defined in more than one place
  trust     trust.json entries whose directory no longer exists
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SPEC_FIELDS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools", "disable-model-invocation"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__"}
EXPLICIT_RE = re.compile(r'<skill name="([a-z0-9-]+)"')
SKILL_BLOCK_RE = re.compile(r"<skill>\s*<name>(.*?)</name>.*?<location>(.*?)</location>\s*</skill>", re.S)
CONTEXT_RE = re.compile(r'<project_instructions path="([^"]+)">(.*?)</project_instructions>', re.S)


def load_json(path: Path) -> tuple[object | None, str | None]:
    try:
        return json.loads(path.read_text()), None
    except FileNotFoundError:
        return None, "missing"
    except (OSError, ValueError) as e:
        return None, f"unparseable: {e}"


def frontmatter(text: str) -> tuple[dict[str, str] | None, str | None]:
    if not text.startswith("---\n"):
        return None, "no frontmatter"
    end = text.find("\n---", 4)
    if end < 0:
        return None, "unterminated frontmatter"
    fields: dict[str, str] = {}
    key = None
    for line in text[4:end].splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            if value in (">", ">-", "|", "|-"):
                value = ""
            fields[key] = value.strip("\"'")
        elif key and line.startswith((" ", "\t")):
            fields[key] = (fields[key] + " " + line.strip()).strip()
    return fields, None


def skill_roots(agent_dir: Path, cwd: Path, settings: list[dict]) -> list[Path]:
    roots = [agent_dir / "skills", Path.home() / ".agents" / "skills", cwd / ".pi" / "skills"]
    d = cwd
    while True:
        roots.append(d / ".agents" / "skills")
        if (d / ".git").exists() or d.parent == d:
            break
        d = d.parent
    for s in settings:
        base = s["base"]
        for entry in s["data"].get("skills", []) if isinstance(s["data"], dict) else []:
            if isinstance(entry, str) and not entry.startswith(("!", "-")):
                roots.append((base / os.path.expanduser(entry.lstrip("+"))).resolve())
        for pkg in s["data"].get("packages", []) if isinstance(s["data"], dict) else []:
            src = pkg.get("source") if isinstance(pkg, dict) else pkg
            if isinstance(src, str):
                roots.append(package_dir(src, agent_dir, base) / "skills")
    seen, out = set(), []
    for r in roots:
        if r.exists() and r.resolve() not in seen:
            seen.add(r.resolve())
            out.append(r)
    return out


def package_dir(src: str, agent_dir: Path, base: Path) -> Path:
    if src.startswith("npm:"):
        spec = src[4:]
        name = spec if not spec[1:].count("@") else spec[: spec.rfind("@")]
        return agent_dir / "npm" / "node_modules" / name
    if src.startswith(("git:", "https://", "http://")):
        path = re.sub(r"^(git:|https?://)", "", src).split("@")[0].removesuffix(".git")
        return agent_dir / "git" / path
    return (base / os.path.expanduser(src)).resolve()


def scan_skills(roots: list[Path]) -> list[dict]:
    found, seen = [], set()
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            if "SKILL.md" not in filenames:
                continue
            path = Path(dirpath) / "SKILL.md"
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            text = path.read_text(errors="replace")
            fields, err = frontmatter(text)
            problems = [err] if err else []
            fields = fields or {}
            name = fields.get("name", "")
            desc = fields.get("description", "")
            if not name:
                problems.append("missing name")
            elif not NAME_RE.match(name) or len(name) > 64:
                problems.append("invalid name")
            elif name != Path(dirpath).name:
                problems.append("name differs from directory")
            if not desc:
                problems.append("missing description (not loaded)")
            elif len(desc) > 1024:
                problems.append("description over 1024 chars")
            extra = sorted(set(fields) - SPEC_FIELDS)
            if extra:
                problems.append("non-spec fields: " + ", ".join(extra))
            found.append({
                "name": name or Path(dirpath).name,
                "path": str(path),
                "root": str(root),
                "description_chars": len(desc),
                "body_chars": len(text),
                "explicit_only": fields.get("disable-model-invocation", "").lower() == "true",
                "problems": problems,
            })
    return found


def session_files(session_dir: Path, days: int) -> list[Path]:
    cutoff = datetime.now().timestamp() - days * 86400
    files = [p for p in session_dir.rglob("*.jsonl") if p.is_file() and p.stat().st_mtime >= cutoff]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""


def scan_usage(files: list[Path]) -> dict:
    explicit, model, tools = Counter(), Counter(), Counter()
    last: dict[str, str] = {}
    for f in files:
        try:
            lines = f.open(errors="replace")
        except OSError:
            continue
        with lines:
            for line in lines:
                if '"role":"user"' not in line and '"toolCall"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                msg = entry.get("message") or {}
                ts = entry.get("timestamp", "")
                if msg.get("role") == "user":
                    for name in EXPLICIT_RE.findall(text_of(msg.get("content"))):
                        explicit[name] += 1
                        last[name] = max(last.get(name, ""), ts)
                elif msg.get("role") == "assistant":
                    for block in msg.get("content") or []:
                        if not isinstance(block, dict) or block.get("type") != "toolCall":
                            continue
                        tool = block.get("name", "")
                        tools[tool] += 1
                        path = str((block.get("arguments") or {}).get("path", ""))
                        if tool.lower() == "read" and path.endswith("/SKILL.md"):
                            name = Path(path).parent.name
                            model[name] += 1
                            last[name] = max(last.get(name, ""), ts)
    names = set(explicit) | set(model)
    return {
        "skills": {n: {"explicit": explicit[n], "model_reads": model[n], "last": last.get(n)} for n in sorted(names)},
        "tools": dict(tools.most_common()),
    }


def newest_prompt(session_dir: Path, cwd: Path) -> dict | None:
    key = "--" + str(cwd).lstrip("/").replace("/", "-").replace(":", "-") + "--"
    candidates = sorted((session_dir / key).glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        flat = [*session_dir.glob("*.jsonl"), *session_dir.glob("*/*.jsonl")]
        candidates = sorted(flat, key=lambda p: p.stat().st_mtime, reverse=True)
    for f in candidates:
        sections: dict[str, str] = {}
        tools: dict[str, int] = {}
        with f.open(errors="replace") as lines:
            for line in lines:
                if '"role":"system"' not in line:
                    continue
                msg = json.loads(line).get("message") or {}
                for k, v in (msg.get("sections") or {}).items():
                    if v is None:
                        sections.pop(k, None)
                    else:
                        sections[k] = v if isinstance(v, str) else json.dumps(v)
                for t in msg.get("toolsAdded") or []:
                    tools[t.get("name", "?")] = len(json.dumps(t))
                for t in msg.get("toolsRemoved") or []:
                    tools.pop(t.get("name", "?"), None)
        if not sections:
            continue
        skills_text = sections.get("skills", "")
        return {
            "session": str(f),
            "section_chars": {k: len(v) for k, v in sections.items()},
            "tool_chars": tools,
            "loaded_skills": [
                {"name": m.group(1), "location": m.group(2), "chars": len(m.group(0))}
                for m in SKILL_BLOCK_RE.finditer(skills_text)
            ],
            "context_files": [
                {"path": m.group(1), "chars": len(m.group(2))} for m in CONTEXT_RE.finditer("".join(sections.values()))
            ],
        }
    return None


def install_info(agent_dir: Path) -> dict:
    on_path = []
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = Path(d) / "pi"
        if p.is_file() and os.access(p, os.X_OK):
            on_path.append({"path": str(p), "resolves_to": str(p.resolve())})
    version = None
    if shutil.which("pi"):
        try:
            version = subprocess.run(["pi", "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    releases = agent_dir / "install" / "releases"
    return {
        "pi_on_path": on_path,
        "version": version,
        "releases": sorted(p.name for p in releases.iterdir() if p.is_dir()) if releases.is_dir() else [],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--agent-dir", type=Path, default=Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent")))
    ap.add_argument("--cwd", type=Path, default=Path.cwd())
    ap.add_argument("--session-dir", type=Path, default=None)
    ap.add_argument("--days", type=int, default=30, help="scan session files modified in the last N days")
    a = ap.parse_args()
    agent_dir, cwd = a.agent_dir.expanduser().resolve(), a.cwd.resolve()

    settings, settings_status = [], {}
    for path, base in [(agent_dir / "settings.json", agent_dir), (cwd / ".pi" / "settings.json", cwd / ".pi")]:
        data, err = load_json(path)
        settings_status[str(path)] = err or "ok"
        if isinstance(data, dict):
            settings.append({"base": base, "data": data})
    user_settings = settings[0]["data"] if settings and settings[0]["base"] == agent_dir else {}
    session_dir = (a.session_dir or Path(os.environ.get("PI_CODING_AGENT_SESSION_DIR") or user_settings.get("sessionDir") or agent_dir / "sessions")).expanduser()

    files = session_files(session_dir, a.days) if session_dir.is_dir() else []
    mtimes = [datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(timespec="seconds") for f in files]
    skills = scan_skills(skill_roots(agent_dir, cwd, settings))
    by_name = defaultdict(list)
    for s in skills:
        by_name[s["name"]].append(s["path"])
    trust, _ = load_json(agent_dir / "trust.json")

    print(json.dumps({
        "agent_dir": str(agent_dir),
        "cwd": str(cwd),
        "install": install_info(agent_dir),
        "settings": settings_status,
        "packages": [
            {"source": src, "settings": str(s["base"]), "dir": str(d), "exists": d.exists()}
            for s in settings
            for pkg in s["data"].get("packages", [])
            if isinstance(src := pkg.get("source") if isinstance(pkg, dict) else pkg, str)
            for d in [package_dir(src, agent_dir, s["base"])]
        ],
        "prompt": newest_prompt(session_dir, cwd) if session_dir.is_dir() else None,
        "usage": {"window": {"files": len(files), "oldest": min(mtimes, default=None), "newest": max(mtimes, default=None)}, **scan_usage(files)},
        "skills": skills,
        "collisions": {n: p for n, p in sorted(by_name.items()) if len(p) > 1},
        "trust": {"stale": sorted(k for k in trust if not Path(k).exists())} if isinstance(trust, dict) else None,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
