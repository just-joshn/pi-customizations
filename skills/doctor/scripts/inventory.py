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
from urllib.parse import unquote, urlsplit

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


def validate_settings(data: object) -> str | None:
    if not isinstance(data, dict):
        return "settings must be an object"
    for field in ("skills", "packages"):
        values = data.get(field, [])
        if not isinstance(values, list):
            return f"{field} must be an array"
        for value in values:
            source = value.get("source") if field == "packages" and isinstance(value, dict) else value
            if not isinstance(source, str) or not source.strip() or "\0" in source:
                return f"{field} entries must have nonempty string paths or sources"
    directory = data.get("sessionDir")
    if "sessionDir" in data and (not isinstance(directory, str) or not directory.strip() or "\0" in directory):
        return "sessionDir must be a nonempty string"
    return None


def read_settings(agent_dir: Path, cwd: Path) -> tuple[list[dict], dict[str, str]]:
    settings, statuses = [], {}
    for path, base in ((agent_dir / "settings.json", agent_dir), (cwd / ".pi/settings.json", cwd / ".pi")):
        data, error = load_json(path)
        invalid = validate_settings(data) if error is None else None
        statuses[str(path)] = error or (f"invalid: {invalid}" if invalid else "ok")
        if error is None and invalid is None:
            settings.append({"base": base, "data": data})
    return settings, statuses


def nonnegative_days(value: str) -> int:
    days = int(value)
    if days < 0:
        raise argparse.ArgumentTypeError("days must be nonnegative")
    return days


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
                directory = package_info(src, agent_dir, base)["dir"]
                if directory is not None:
                    roots.append(Path(directory) / "skills")
    seen, out = set(), []
    for r in roots:
        if r.exists() and r.resolve() not in seen:
            seen.add(r.resolve())
            out.append(r)
    return out


def package_dir(src: str, agent_dir: Path, base: Path) -> Path:
    src = src.strip()
    if src.startswith("npm:"):
        spec = src[4:]
        name = spec if not spec[1:].count("@") else spec[: spec.rfind("@")]
        return base / "npm" / "node_modules" / name
    if src.startswith(("git:", "https://", "http://", "ssh://")):
        url = src[4:].strip() if src.startswith("git:") and not src.startswith("git://") else src
        scp = re.fullmatch(r"git@([^:]+):(.+)", url)
        if scp:
            host, path = scp.groups()
        else:
            parsed = urlsplit(url if "://" in url else "https://" + url)
            host, path = parsed.hostname or "", parsed.path.lstrip("/")
        path = path.split("@", 1)[0].split("#", 1)[0].removesuffix(".git")
        if not host or "/" in unquote(host) or len(path.split("/")) < 2 or any(unsafe_git_part(part) for part in (host, path)):
            raise ValueError("invalid managed Git package path")
        return base / "git" / host / path
    return (base / os.path.expanduser(src)).resolve()


def unsafe_git_part(value: str) -> bool:
    if re.search(r"%(?![0-9a-fA-F]{2})", value):
        return True
    decoded = unquote(value, errors="strict")
    return any("\0" in item or "\\" in item or item.startswith("/") or ".." in item.split("/")
               for item in (value, decoded))


def package_info(src: str, agent_dir: Path, base: Path) -> dict:
    try:
        directory = package_dir(src, agent_dir, base)
        return {"source": src, "settings": str(base), "dir": str(directory), "exists": directory.exists()}
    except (OSError, ValueError) as error:
        return {"source": src, "settings": str(base), "dir": None, "exists": False, "error": str(error)}


def scan_skills(roots: list[Path]) -> list[dict]:
    found, seen = [], set()
    visited = set()
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
            directory = Path(dirpath).resolve()
            if directory in visited:
                dirnames[:] = []
                continue
            visited.add(directory)
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and (directory / d).resolve() not in visited]
            if "SKILL.md" not in filenames:
                continue
            path = Path(dirpath) / "SKILL.md"
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            try:
                text = path.read_text(errors="replace")
            except OSError:
                continue
            found.append(skill_info(path, root, text))
    return found


def skill_info(path: Path, root: Path, text: str) -> dict:
    parsed, err = frontmatter(text)
    fields = parsed or {}
    name = fields.get("name", "")
    desc = fields.get("description", "")
    extra = sorted(set(fields) - SPEC_FIELDS)
    name_problem = ("missing name" if not name else "invalid name" if not NAME_RE.match(name) or len(name) > 64
                    else "name differs from directory" if name != path.parent.name else None)
    desc_problem = "missing description (not loaded)" if not desc else "description over 1024 chars" if len(desc) > 1024 else None
    problems = [problem for problem in (err, name_problem, desc_problem,
                "non-spec fields: " + ", ".join(extra) if extra else None) if problem]
    return {"name": name or path.parent.name, "path": str(path), "root": str(root),
            "description_chars": len(desc), "body_chars": len(text),
            "explicit_only": fields.get("disable-model-invocation", "").lower() == "true", "problems": problems}


def session_files(session_dir: Path, days: int) -> list[Path]:
    cutoff = datetime.now().timestamp() - days * 86400
    files = [p for p in session_dir.rglob("*.jsonl") if p.is_file() and p.stat().st_mtime >= cutoff]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b["text"] for b in content if isinstance(b, dict) and isinstance(b.get("text"), str))
    return ""


def session_entries(path: Path):
    try:
        with path.open(errors="replace") as lines:
            for line in lines:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict):
                    yield entry
    except OSError:
        return


def objects(value) -> list[dict]:
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def message_usage(entry: dict):
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return
    timestamp = entry.get("timestamp", "")
    timestamp = timestamp if isinstance(timestamp, str) else ""
    if msg.get("role") == "user":
        for name in EXPLICIT_RE.findall(text_of(msg.get("content"))):
            yield "explicit", name, timestamp
    elif msg.get("role") == "assistant":
        for block in objects(msg.get("content")):
            if block.get("type") != "toolCall" or not isinstance(block.get("name"), str):
                continue
            tool = block["name"]
            yield "tools", tool, timestamp
            arguments = block.get("arguments")
            path = arguments.get("path", "") if isinstance(arguments, dict) else ""
            if tool.lower() == "read" and isinstance(path, str) and path.endswith("/SKILL.md"):
                yield "model", Path(path).parent.name, timestamp


def scan_usage(files: list[Path]) -> dict:
    explicit, model, tools = Counter(), Counter(), Counter()
    counts = {"explicit": explicit, "model": model, "tools": tools}
    last: dict[str, str] = {}
    for path in files:
        for entry in session_entries(path):
            for kind, name, timestamp in message_usage(entry):
                counts[kind][name] += 1
                if kind != "tools":
                    last[name] = max(last.get(name, ""), timestamp)
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
        entries = session_entries(f)
        header = next(entries, {})
        header_cwd = header.get("cwd")
        if header.get("type") != "session" or not isinstance(header_cwd, str) or not header_cwd:
            continue
        if Path(header_cwd).resolve() != cwd.resolve():
            continue
        sections, tools = prompt_state(active_branch(tuple(entries)))
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


def ancestors(entries: tuple[dict, ...]):
    indexed = {entry["id"]: entry for entry in entries if isinstance(entry.get("id"), str)}
    current = entries[-1]
    for _ in range(len(entries)):
        yield current
        parent = current.get("parentId")
        if not isinstance(parent, str) or parent not in indexed:
            return
        current = indexed[parent]


def active_branch(entries: tuple[dict, ...]):
    if not entries or not isinstance(entries[-1].get("id"), str):
        return entries
    return reversed(tuple(ancestors(entries)))


def prompt_state(entries) -> tuple[dict[str, str], dict[str, int]]:
    sections: dict[str, str] = {}
    tools: dict[str, int] = {}
    for entry in entries:
        msg = entry.get("message")
        if not isinstance(msg, dict) or msg.get("role") != "system":
            continue
        updates = msg.get("sections")
        if isinstance(updates, dict):
            sections = {**sections, **{k: v if isinstance(v, str) else json.dumps(v)
                                     for k, v in updates.items() if v is not None}}
            sections = {k: v for k, v in sections.items() if k not in updates or updates[k] is not None}
        removed = {t["name"] for t in objects(msg.get("toolsRemoved")) if isinstance(t.get("name"), str)}
        tools = {**{name: size for name, size in tools.items() if name not in removed},
                 **{t["name"]: len(json.dumps(t)) for t in objects(msg.get("toolsAdded"))
                    if isinstance(t.get("name"), str)}}
    return sections, tools


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
    ap.add_argument("--days", type=nonnegative_days, default=30, help="scan session files modified in the last N days")
    a = ap.parse_args()
    agent_dir, cwd = a.agent_dir.expanduser().resolve(), a.cwd.resolve()

    settings, settings_status = read_settings(agent_dir, cwd)
    effective_settings = {key: value for item in settings for key, value in item["data"].items()}
    session_dir = (a.session_dir or Path(os.environ.get("PI_CODING_AGENT_SESSION_DIR") or effective_settings.get("sessionDir") or agent_dir / "sessions")).expanduser()
    session_dir = (cwd / session_dir).resolve()

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
            package_info(src, agent_dir, s["base"])
            for s in settings
            for pkg in s["data"].get("packages", [])
            if isinstance(src := pkg.get("source") if isinstance(pkg, dict) else pkg, str)
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
