#!/usr/bin/env python3
"""Run one CLI invocation under controlled conditions and append a JSONL evidence record.

Usage: probe.py [options] -- <cli> [args...]
Unix only (uses pty). Standard library only.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import os
import platform
import pty
import re
import shutil
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

PREVIEW_BYTES = 2000


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot(root: Path) -> dict[str, dict]:
    entries: dict[str, dict] = {}
    if not root.exists():
        return entries
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            p = Path(dirpath, name)
            st = p.lstat()
            entry: dict = {"mode": oct(st.st_mode)}
            if p.is_symlink():
                entry["type"], entry["link"] = "symlink", os.readlink(p)
            elif p.is_dir():
                entry["type"] = "dir"
            elif p.is_file():
                entry.update(type="file", size=st.st_size, sha256=sha256_file(p))
            else:
                entry["type"] = "other"
            entries[str(p.relative_to(root))] = entry
    return entries


def diff(before: dict, after: dict) -> dict:
    return {
        "created": {k: after[k] for k in sorted(after.keys() - before.keys())},
        "deleted": {k: before[k] for k in sorted(before.keys() - after.keys())},
        "modified": {
            k: {"before": before[k], "after": after[k]}
            for k in sorted(before.keys() & after.keys())
            if before[k] != after[k]
        },
    }


def output_summary(data: bytes, path: Path) -> dict:
    with path.open("xb") as stream:
        stream.write(data)
    return {
        "path": str(path),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "has_ansi": b"\x1b[" in data,
        "has_crlf": b"\r\n" in data,
        "ends_with_newline": data.endswith(b"\n"),
        "preview": data[:PREVIEW_BYTES].decode("utf-8", errors="backslashreplace"),
        "truncated": len(data) > PREVIEW_BYTES,
    }


def open_pty(cols: int, rows: int) -> tuple[int, int]:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    return master, slave


def drain(fd: int, buf: bytearray) -> None:
    while True:
        try:
            chunk = os.read(fd, 65536)
        except OSError:  # EIO from a pty master once every slave is closed
            break
        if not chunk:
            break
        buf.extend(chunk)
    os.close(fd)


def feed(fd: int, data: bytes) -> None:
    view = memoryview(data)
    try:
        while view:
            view = view[os.write(fd, view):]
    except OSError:  # child exited first: EPIPE on a pipe, EIO on a pty
        pass
    finally:
        os.close(fd)


def build_sandbox(root: Path, seeds: list[str]) -> dict[str, str]:
    layout = {
        "HOME": "home",
        "XDG_CONFIG_HOME": "home/.config",
        "XDG_CACHE_HOME": "home/.cache",
        "XDG_DATA_HOME": "home/.local/share",
        "XDG_STATE_HOME": "home/.local/state",
        "TMPDIR": "tmp",
    }
    env = {}
    for var, rel in layout.items():
        (root / rel).mkdir(parents=True, exist_ok=True)
        env[var] = str(root / rel)
    (root / "work").mkdir(exist_ok=True)
    for seed in seeds:
        src, _, dest = seed.partition(":")
        target = root / (dest or Path(src).name)
        if not target.resolve().is_relative_to(root.resolve()):
            raise ValueError("seed destination escapes sandbox")
        target.parent.mkdir(parents=True, exist_ok=True)
        if Path(src).is_dir():
            shutil.copytree(src, target, symlinks=True, dirs_exist_ok=True)
        else:
            shutil.copy2(src, target, follow_symlinks=False)
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=".re/probes/manual", help="probe output directory")
    ap.add_argument("--id", help="probe id (default generated)")
    ap.add_argument("--label", default="", help="free-text description of what this probe discriminates")
    ap.add_argument("--cwd", help="working directory (default: sandbox work/ with --isolate, else current)")
    ap.add_argument("--isolate", action="store_true",
                    help="fresh HOME/XDG_*/TMPDIR/work under <out>/sandboxes/<id>, snapshotted automatically")
    ap.add_argument("--seed", action="append", default=[], metavar="SRC[:DEST]",
                    help="copy SRC into the sandbox at DEST (relative to sandbox root) before running")
    ap.add_argument("--clean-env", action="store_true", help="start from PATH only instead of the inherited env")
    ap.add_argument("--env", action="append", default=[], metavar="K=V")
    ap.add_argument("--unset", action="append", default=[], metavar="K")
    stdin = ap.add_mutually_exclusive_group()
    stdin.add_argument("--stdin-text")
    stdin.add_argument("--stdin-file")
    ap.add_argument("--stdin-mode", choices=["pipe", "null", "closed", "tty", "inherit"], default=None,
                    help="default: pipe if stdin data given, else null")
    ap.add_argument("--tty", choices=["none", "stdout", "stderr", "both"], default="none",
                    help="attach stdout/stderr to separate ptys")
    ap.add_argument("--cols", type=int, default=120)
    ap.add_argument("--rows", type=int, default=40)
    ap.add_argument("--snapshot", action="append", default=[], metavar="DIR", help="extra directory to diff")
    ap.add_argument("--timeout", type=float, default=60.0)
    ap.add_argument("--send-signal", metavar="SIG", help="signal the process group, e.g. INT or TERM")
    ap.add_argument("--after", type=float, default=1.0, help="seconds before --send-signal")
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()

    cmd = a.cmd[1:] if a.cmd[:1] == ["--"] else a.cmd
    if not cmd:
        ap.error("missing command after --")
    if not math.isfinite(a.timeout) or not math.isfinite(a.after) or a.timeout <= 0 or a.after < 0 or (a.send_signal and a.after >= a.timeout):
        ap.error("require timeout > after >= 0")
    if a.seed and not a.isolate:
        ap.error("--seed requires --isolate")
    if any("=" not in kv or not kv.split("=", 1)[0] for kv in a.env):
        ap.error("--env requires NAME=VALUE")
    if a.send_signal and not hasattr(signal, "SIG" + a.send_signal.upper().removeprefix("SIG")):
        ap.error("unknown signal")

    out = Path(a.out).resolve()
    (out / "raw").mkdir(parents=True, exist_ok=True)
    probe_id = a.id or f"P-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:6]}"
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", probe_id):
        ap.error("id must contain only letters, digits, dots, underscores, and hyphens")
    # Repeated case IDs retain older bytes and receive fresh sandbox directories.
    run_id = f"{probe_id}-{uuid.uuid4().hex}"

    env = {"PATH": os.environ.get("PATH", "")} if a.clean_env else dict(os.environ)
    overrides: dict[str, str | None] = {}
    snap_dirs = [Path(d).resolve() for d in a.snapshot]
    sandbox = None
    if a.isolate:
        sandbox = out / "sandboxes" / run_id
        overrides.update(build_sandbox(sandbox, a.seed))
        snap_dirs.append(sandbox)
    for kv in a.env:
        k, _, v = kv.partition("=")
        overrides[k] = v
    for k in a.unset:
        overrides[k] = None
    for k, v in overrides.items():
        if v is None:
            env.pop(k, None)
        else:
            env[k] = v

    cwd = Path(a.cwd).resolve() if a.cwd else (sandbox / "work" if sandbox else Path.cwd())

    stdin_data = (a.stdin_text.encode() if a.stdin_text is not None
                  else Path(a.stdin_file).read_bytes() if a.stdin_file else b"")
    stdin_mode = a.stdin_mode or ("pipe" if a.stdin_text is not None or a.stdin_file else "null")

    search_path = os.pathsep.join(str((cwd / p).resolve()) for p in env.get("PATH", os.defpath).split(os.pathsep))
    executable = str((cwd / cmd[0]).resolve()) if os.sep in cmd[0] else cmd[0]
    resolved = shutil.which(executable, path=search_path)
    target = {"argv0": cmd[0], "resolved": resolved,
              "realpath": os.path.realpath(resolved) if resolved else None,
              "sha256": sha256_file(Path(resolved)) if resolved else None}

    before = {str(d): snapshot(d) for d in snap_dirs}

    parent_close: list[int] = []
    threads: list[threading.Thread] = []
    bufs = {"stdout": bytearray(), "stderr": bytearray(), "tty_echo": bytearray()}

    def reader(fd: int, name: str) -> None:
        t = threading.Thread(target=drain, args=(fd, bufs[name]), daemon=True)
        threads.append(t)

    stdin_arg: int | None
    writer = None
    if stdin_mode == "pipe":
        r, w = os.pipe()
        stdin_arg, writer = r, (w, stdin_data)
        parent_close.append(r)
    elif stdin_mode == "tty":
        m, s = open_pty(a.cols, a.rows)
        stdin_arg, writer = s, (os.dup(m), stdin_data + b"\x04")
        parent_close.append(s)
        reader(m, "tty_echo")
    elif stdin_mode == "null":
        stdin_arg = subprocess.DEVNULL
    else:
        stdin_arg = None

    fds = {}
    for name in ("stdout", "stderr"):
        if a.tty in (name, "both"):
            m, s = open_pty(a.cols, a.rows)
        else:
            m, s = os.pipe()
        fds[name] = s
        parent_close.append(s)
        reader(m, name)

    def preexec() -> None:
        os.setsid()
        if stdin_mode == "tty":
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        if stdin_mode == "closed":
            os.close(0)

    start_wall = datetime.now(timezone.utc)
    start = time.monotonic()
    launch_error = None
    try:
        proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=stdin_arg, stdout=fds["stdout"],
                                stderr=fds["stderr"], preexec_fn=preexec, close_fds=True)
    except OSError as exc:
        launch_error = {"type": type(exc).__name__, "errno": exc.errno, "message": str(exc)}
        proc = None
    for fd in parent_close:
        os.close(fd)
    for t in threads:
        t.start()
    if writer and proc is not None:
        threading.Thread(target=feed, args=writer, daemon=True).start()
    elif writer:
        os.close(writer[0])

    signal_sent = None
    timed_out = False
    try:
        if proc is not None and a.send_signal:
            try:
                proc.wait(timeout=a.after)
            except subprocess.TimeoutExpired:
                sig = getattr(signal, "SIG" + a.send_signal.upper().removeprefix("SIG"))
                try:
                    os.killpg(proc.pid, sig)
                    signal_sent = {"signal": sig.name, "after_s": a.after}
                except ProcessLookupError:
                    pass
        if proc is not None:
            proc.wait(timeout=max(a.timeout - (time.monotonic() - start), 0.1))
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
    duration = time.monotonic() - start

    for t in threads:
        t.join(timeout=2)
    descendants_hold_output = any(t.is_alive() for t in threads)
    if descendants_hold_output and proc is not None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        for t in threads:
            t.join(timeout=2)

    rc = proc.returncode if proc is not None else None
    after = {str(d): snapshot(d) for d in snap_dirs}
    before_file = out / "raw" / f"{run_id}.before.json"
    after_file = out / "raw" / f"{run_id}.after.json"
    before_file.write_text(json.dumps(before, indent=2))
    after_file.write_text(json.dumps(after, indent=2))
    stdin_file = out / "raw" / f"{run_id}.stdin"
    stdin_file.write_bytes(stdin_data)
    record = {
        "id": probe_id,
        "run_id": run_id,
        "launch_error": launch_error,
        "label": a.label,
        "started_at": start_wall.isoformat(),
        "duration_s": round(duration, 4),
        "duration_ms": round(duration * 1000, 3),
        "argv": cmd,
        "cwd": str(cwd),
        "target": target,
        "env_base": "clean" if a.clean_env else "inherited",
        "env_overrides": overrides,
        "env_delta": overrides,
        "base_path": env.get("PATH"),
        "stdin_fixture": str(stdin_file) if stdin_mode in ("pipe", "tty") else None,
        "stdin_is_tty": stdin_mode == "tty" or (stdin_mode == "inherit" and os.isatty(0)),
        "stdout_is_tty": a.tty in ("stdout", "both"),
        "stderr_is_tty": a.tty in ("stderr", "both"),
        "stdin": {"mode": stdin_mode, "bytes": len(stdin_data),
                  "sha256": hashlib.sha256(stdin_data).hexdigest(),
                  "tty_eof_sent": stdin_mode == "tty"},
        "tty": {"stdin": stdin_mode == "tty" or (stdin_mode == "inherit" and os.isatty(0)),
                "stdout": a.tty in ("stdout", "both"),
                "stderr": a.tty in ("stderr", "both"),
                "size": [a.cols, a.rows]},
        "exit_code": rc if rc is not None and rc >= 0 else None,
        "signal": signal.Signals(-rc).name if rc is not None and rc < 0 else None,
        "signal_sent": signal_sent,
        "timed_out": timed_out,
        "descendants_hold_output": descendants_hold_output,
        "descendants_killed": descendants_hold_output,
        "capture_complete": not any(t.is_alive() for t in threads),
        "stdout_file": str(out / "raw" / f"{run_id}.stdout"),
        "stderr_file": str(out / "raw" / f"{run_id}.stderr"),
        "stdout": output_summary(bytes(bufs["stdout"]), out / "raw" / f"{run_id}.stdout"),
        "stderr": output_summary(bytes(bufs["stderr"]), out / "raw" / f"{run_id}.stderr"),
        "tty_echo": output_summary(bytes(bufs["tty_echo"]), out / "raw" / f"{run_id}.tty-echo"),
        "filesystem_before": str(before_file),
        "filesystem_after": str(after_file),
        "fs_diff": {d: diff(before[d], after[d]) for d in before},
        "network_observed": None,
        "sandbox": str(sandbox) if sandbox else None,
        "host": {"platform": platform.platform(), "python": platform.python_version()},
    }
    with open(out / "probes.jsonl", "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    json.dump({k: record[k] for k in ("id", "exit_code", "signal", "timed_out", "duration_s")}, sys.stdout)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
