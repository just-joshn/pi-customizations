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
  diagnostics operation, path, and error records for incomplete inspection
  partial   true when diagnostics exist; partial reports still exit zero
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import stat
import warnings
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

SECONDS_PER_DAY = 86400
MAX_DAYS = 3652059  # A datetime's full calendar range is enough to request all retained history.
VERSION_TIMEOUT_SECONDS = 30  # Bound a broken executable without penalizing cold startup.
FILESYSTEM_ERRORS = (OSError, ValueError, RuntimeError)

NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SPEC_FIELDS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools", "disable-model-invocation"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__"}
EXPLICIT_RE = re.compile(r'<skill name="([a-z0-9-]+)"')
SKILL_BLOCK_RE = re.compile(r"<skill>\s*<name>(.*?)</name>.*?<location>(.*?)</location>\s*</skill>", re.S)
CONTEXT_RE = re.compile(r'<project_instructions path="([^"]+)">(.*?)</project_instructions>', re.S)


def diagnose(operation, path, error):
    warnings.warn(f"{operation} {path}: {error}", stacklevel=2)


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
    if not 0 <= days <= MAX_DAYS:
        raise argparse.ArgumentTypeError(f"days must be between 0 and {MAX_DAYS}")
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


def skill_roots(agent_dir: Path, cwd: Path, settings: list[dict], on_error=diagnose) -> list[Path]:
    roots = [agent_dir / "skills", Path.home() / ".agents" / "skills", cwd / ".pi" / "skills"]
    d = cwd
    while True:
        roots.append(d / ".agents" / "skills")
        try:
            (d / ".git").stat()
            break
        except FileNotFoundError:
            if d.parent == d:
                break
            d = d.parent
        except FILESYSTEM_ERRORS as error:
            on_error("inspect repository boundary", d / ".git", error)
            break
    for s in settings:
        base = s["base"]
        for entry in s["data"].get("skills", []) if isinstance(s["data"], dict) else []:
            if isinstance(entry, str) and not entry.startswith(("!", "-")):
                roots.append(base / os.path.expanduser(entry.lstrip("+")))
        for pkg in s["data"].get("packages", []) if isinstance(s["data"], dict) else []:
            src = pkg.get("source") if isinstance(pkg, dict) else pkg
            if isinstance(src, str):
                directory = package_info(src, agent_dir, base)["dir"]
                if directory is not None:
                    roots.append(Path(directory) / "skills")
    seen, out = set(), []
    for r in roots:
        try:
            if optional_directory(r, on_error) and (real := r.resolve()) not in seen:
                seen.add(real)
                out.append(real)
        except FILESYSTEM_ERRORS as error:
            on_error("resolve skill root", r, error)
    return out


def package_dir(src: str, agent_dir: Path, base: Path) -> Path:
    src = src.strip()
    if src.startswith("npm:"):
        spec = src[4:]
        name = spec if not spec[1:].count("@") else spec[: spec.rfind("@")]
        component = r"[a-zA-Z0-9~][a-zA-Z0-9._~-]*"
        if not re.fullmatch(rf"(?:@{component}/)?{component}", name):
            raise ValueError("invalid managed npm package name")
        managed = base.resolve() / "npm" / "node_modules"
        directory = managed / name
        if not directory.resolve().is_relative_to(managed):
            raise ValueError("managed npm package escapes node_modules")
        return directory
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
        try:
            directory.stat()
            exists = True
        except FileNotFoundError:
            exists = False
        return {"source": src, "settings": str(base), "dir": str(directory), "exists": exists}
    except FILESYSTEM_ERRORS as error:
        return {"source": src, "settings": str(base), "dir": None, "exists": False, "error": str(error)}


def scan_skills(roots: list[Path], on_error=diagnose) -> list[dict]:
    found, seen = [], set()
    visited = set()
    for root in roots:
        if not optional_directory(root, on_error):
            continue
        for dirpath, dirnames, filenames in os.walk(
                root, followlinks=True, onerror=lambda e: on_error("walk skills", e.filename or root, e)):
            try:
                directory = Path(dirpath).resolve()
            except FILESYSTEM_ERRORS as error:
                on_error("resolve skill directory", dirpath, error)
                dirnames[:] = []
                continue
            if directory in visited:
                dirnames[:] = []
                continue
            visited.add(directory)
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            if "SKILL.md" not in filenames:
                continue
            path = Path(dirpath) / "SKILL.md"
            try:
                real = path.resolve()
                if real in seen:
                    continue
                seen.add(real)
                text = path.read_text()
            except FILESYSTEM_ERRORS as error:
                on_error("read skill", path, error)
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


def session_files(session_dir: Path, days: int | None, on_error=diagnose, depth=None):
    cutoff = datetime.now().timestamp() - days * SECONDS_PER_DAY if days is not None else float('-inf')
    files = []
    try:
        if not stat.S_ISDIR(session_dir.stat().st_mode):
            on_error("inspect directory", session_dir, "not a directory")
            return files
    except FileNotFoundError:
        return files
    except FILESYSTEM_ERRORS as error:
        on_error("inspect directory", session_dir, error)
        return files
    for directory, dirs, names in os.walk(
            session_dir, followlinks=depth is not None,
            onerror=lambda e: on_error("walk sessions", e.filename or session_dir, e)):
        if depth is not None and len(Path(directory).relative_to(session_dir).parts) >= depth:
            dirs[:] = []
        for name in names:
            if not name.endswith('.jsonl'):
                continue
            path = Path(directory) / name
            try:
                info = path.stat()
                if stat.S_ISREG(info.st_mode) and info.st_mtime >= cutoff:
                    datetime.fromtimestamp(info.st_mtime, timezone.utc)
                    files.append((path, info.st_mtime))
            except (*FILESYSTEM_ERRORS, OverflowError) as error:
                on_error("stat session", path, error)
    return sorted(files, key=lambda item: item[1], reverse=True)


def optional_directory(path, on_error=diagnose):
    try:
        return stat.S_ISDIR(path.stat().st_mode)
    except FileNotFoundError:
        return False
    except FILESYSTEM_ERRORS as error:
        on_error("inspect directory", path, error)
        return False


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b["text"] for b in content if isinstance(b, dict) and isinstance(b.get("text"), str))
    return ""


def session_entries(path: Path, on_error=diagnose):
    try:
        with path.open() as lines:
            for line in lines:
                try:
                    entry = json.loads(line)
                except ValueError as error:
                    on_error("read session", path, error)
                    continue
                if isinstance(entry, dict):
                    yield entry
                else:
                    on_error("read session", path, "record must be an object")
    except FILESYSTEM_ERRORS as error:
        on_error("read session", path, error)


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


def scan_usage(files: list[Path], on_error=diagnose) -> dict:
    explicit, model, tools = Counter(), Counter(), Counter()
    counts = {"explicit": explicit, "model": model, "tools": tools}
    last: dict[str, str] = {}
    for path in files:
        for entry in session_entries(path, on_error):
            for kind, name, timestamp in message_usage(entry):
                counts[kind][name] += 1
                if kind != "tools":
                    last[name] = max(last.get(name, ""), timestamp)
    names = set(explicit) | set(model)
    return {
        "skills": {n: {"explicit": explicit[n], "model_reads": model[n], "last": last.get(n)} for n in sorted(names)},
        "tools": dict(tools.most_common()),
    }


def newest_prompt(session_dir: Path, cwd: Path, on_error=diagnose) -> dict | None:
    key = "--" + str(cwd).lstrip("/").replace("/", "-").replace(":", "-") + "--"
    candidates = session_files(session_dir / key, None, on_error, depth=0)
    if not candidates:
        candidates = session_files(session_dir, None, on_error, depth=1)
    for f, _ in candidates:
        entries = session_entries(f, on_error)
        header = next(entries, {})
        header_cwd = header.get("cwd")
        if header.get("type") != "session" or not isinstance(header_cwd, str) or not header_cwd:
            on_error("read session header", f, "expected session header with nonempty cwd")
            continue
        try:
            if Path(header_cwd).resolve() != cwd.resolve():
                continue
        except FILESYSTEM_ERRORS as error:
            on_error("resolve session header", f, error)
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


def version_info(on_error=diagnose):
    try:
        if not shutil.which("pi"):
            return {"status": "not_found", "version": None}
        result = subprocess.run(["pi", "--version"], capture_output=True, text=True,
                                timeout=VERSION_TIMEOUT_SECONDS)
        if result.returncode == 0:
            return {"status": "ok", "returncode": 0, "version": result.stdout.strip()}
        on_error("pi version", "pi", f"exit {result.returncode}")
        return {"status": "failed", "returncode": result.returncode, "version": None}
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        on_error("pi version", "pi", error)
        status = "timeout" if isinstance(error, subprocess.TimeoutExpired) else "error"
        return {"status": status, "version": None, "error": str(error)}


def installed_releases(path, on_error=diagnose):
    releases = []
    if not optional_directory(path, on_error):
        return releases
    try:
        for entry in path.iterdir():
            try:
                if stat.S_ISDIR(entry.stat().st_mode):
                    releases.append(entry.name)
            except FILESYSTEM_ERRORS as error:
                on_error("stat release", entry, error)
    except FILESYSTEM_ERRORS as error:
        on_error("list releases", path, error)
    return sorted(releases)


def install_info(agent_dir: Path, on_error=diagnose) -> dict:
    on_path = []
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = Path(d) / "pi"
        try:
            if stat.S_ISREG(p.stat().st_mode) and os.access(p, os.X_OK):
                on_path.append({"path": str(p), "resolves_to": str(p.resolve())})
        except FileNotFoundError:
            continue
        except FILESYSTEM_ERRORS as error:
            on_error("inspect executable", p, error)
    command = version_info(on_error)
    return {"pi_on_path": on_path, "version": command["version"], "version_command": command,
            "releases": installed_releases(agent_dir / "install" / "releases", on_error)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--agent-dir", type=Path, default=os.environ.get("PI_CODING_AGENT_DIR"))
    ap.add_argument("--cwd", type=Path, default=None)
    ap.add_argument("--session-dir", type=Path, default=None)
    ap.add_argument("--days", type=nonnegative_days, default=30, help="scan session files modified in the last N days")
    a = ap.parse_args()
    diagnostics = []
    def record_error(operation, path, error):
        diagnostics.append({"operation": operation, "path": str(path), "error": str(error)})
    try:
        report = inventory_report(a, record_error)
    except FILESYSTEM_ERRORS as error:
        record_error("inventory paths", a.cwd, error)
        report = {}
    print(json.dumps({**report, "partial": bool(diagnostics), "diagnostics": diagnostics}, indent=2))
    return 0


def trust_info(path, on_error=diagnose):
    trust, error = load_json(path)
    if error == "missing":
        return None
    if error or not isinstance(trust, dict):
        on_error("read trust", path, error or "trust must be an object")
        return None
    stale = []
    for directory in trust:
        try:
            Path(directory).stat()
        except FileNotFoundError:
            stale.append(directory)
        except FILESYSTEM_ERRORS as error:
            on_error("inspect trust path", directory, error)
    return {"stale": sorted(stale)}


def inventory_report(a, on_error):
    agent_dir = (a.agent_dir or Path.home() / ".pi" / "agent").expanduser().resolve()
    cwd = (a.cwd or Path.cwd()).resolve()
    settings, settings_status = read_settings(agent_dir, cwd)
    for path, status in settings_status.items():
        if status not in ("ok", "missing"):
            on_error("read settings", path, status)
    effective_settings = {key: value for item in settings for key, value in item["data"].items()}
    session_dir = (a.session_dir or Path(os.environ.get("PI_CODING_AGENT_SESSION_DIR") or effective_settings.get("sessionDir") or agent_dir / "sessions")).expanduser()
    session_dir = cwd / session_dir
    try:
        session_dir = session_dir.resolve()
    except FILESYSTEM_ERRORS as error:
        on_error("resolve sessions", session_dir, error)

    sessions = session_files(session_dir, a.days, on_error)
    files = [path for path, _ in sessions]
    mtimes = [datetime.fromtimestamp(mtime, timezone.utc).isoformat(timespec="seconds") for _, mtime in sessions]
    skills = scan_skills(skill_roots(agent_dir, cwd, settings, on_error), on_error)
    by_name = defaultdict(list)
    for s in skills:
        by_name[s["name"]].append(s["path"])
    trust = trust_info(agent_dir / "trust.json", on_error)
    packages = [package_info(pkg.get("source") if isinstance(pkg, dict) else pkg, agent_dir, s["base"])
                for s in settings for pkg in s["data"].get("packages", [])]
    for package in packages:
        if "error" in package:
            on_error("inspect package", package["source"], package["error"])
    return {
        "agent_dir": str(agent_dir),
        "cwd": str(cwd),
        "install": install_info(agent_dir, on_error),
        "settings": settings_status,
        "packages": packages,
        "prompt": newest_prompt(session_dir, cwd, on_error),
        "usage": {"window": {"files": len(files), "oldest": min(mtimes, default=None), "newest": max(mtimes, default=None)}, **scan_usage(files, on_error)},
        "skills": skills,
        "collisions": {n: p for n, p in sorted(by_name.items()) if len(p) > 1},
        "trust": trust,
    }


if __name__ == "__main__":
    raise SystemExit(main())
