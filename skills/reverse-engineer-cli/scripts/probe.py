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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

PREVIEW_BYTES = 2000


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot_entry(path: Path) -> dict:
    metadata = path.lstat()
    mode = {"mode": oct(metadata.st_mode)}
    if path.is_symlink():
        return {**mode, "type": "symlink", "link": os.readlink(path)}
    if path.is_dir():
        return {**mode, "type": "dir"}
    if path.is_file():
        return {**mode, "type": "file", "size": metadata.st_size, "sha256": sha256_file(path)}
    return {**mode, "type": "other"}


def snapshot(root: Path) -> dict[str, dict]:
    return {str(path.relative_to(root)): snapshot_entry(path)
            for directory, directories, files in os.walk(root)
            for name in directories + files for path in (Path(directory, name),)}


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
    for rel in layout.values():
        (root / rel).mkdir(parents=True, exist_ok=True)
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
    return {var: str(root / rel) for var, rel in layout.items()}


@dataclass(frozen=True)
class Invocation:
    command: tuple[str, ...]
    cwd: Path
    env: dict[str, str]
    overrides: dict[str, str | None]
    snapshot_roots: tuple[Path, ...]
    sandbox: Path | None
    stdin_data: bytes
    stdin_mode: str
    target: dict


@dataclass(frozen=True)
class Capture:
    stdin: int | None
    stdout: int
    stderr: int
    parent_close: tuple[int, ...]
    threads: tuple[threading.Thread, ...]
    buffers: dict[str, bytearray]
    writer: tuple[int, bytes] | None


@dataclass(frozen=True)
class Execution:
    process: subprocess.Popen | None
    started_at: datetime
    duration: float
    returncode: int | None
    launch_error: dict | None
    signal_sent: dict | None
    timed_out: bool


def argument_parser() -> argparse.ArgumentParser:
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
    return ap


def validate_arguments(a: argparse.Namespace, ap: argparse.ArgumentParser) -> tuple[str, ...]:
    cmd = a.cmd[1:] if a.cmd[:1] == ["--"] else a.cmd
    if not cmd:
        ap.error("missing command after --")
    if not 1 <= a.cols <= 65535 or not 1 <= a.rows <= 65535:
        ap.error("--cols and --rows must be between 1 and 65535")
    if not math.isfinite(a.timeout) or not math.isfinite(a.after) or a.timeout <= 0 or a.after < 0 or (a.send_signal and a.after >= a.timeout):
        ap.error("require timeout > after >= 0")
    if a.seed and not a.isolate:
        ap.error("--seed requires --isolate")
    if any("=" not in kv or not kv.split("=", 1)[0] for kv in a.env):
        ap.error("--env requires NAME=VALUE")
    if a.send_signal and not hasattr(signal, "SIG" + a.send_signal.upper().removeprefix("SIG")):
        ap.error("unknown signal")

    if a.id and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", a.id):
        ap.error("id must contain only letters, digits, dots, underscores, and hyphens")
    return tuple(cmd)


def prepare_invocation(a: argparse.Namespace, out: Path, run_id: str, command: tuple[str, ...]) -> Invocation:
    sandbox = out / "sandboxes" / run_id if a.isolate else None
    sandbox_env = build_sandbox(sandbox, a.seed) if sandbox else {}
    overrides = {**sandbox_env, **dict(item.split("=", 1) for item in a.env), **dict.fromkeys(a.unset)}
    base = {"PATH": os.environ.get("PATH", "")} if a.clean_env else dict(os.environ)
    env = {key: value for key, value in {**base, **overrides}.items() if value is not None}
    roots = tuple(Path(directory).resolve() for directory in a.snapshot) + ((sandbox,) if sandbox else ())
    cwd = Path(a.cwd).resolve() if a.cwd else (sandbox / "work" if sandbox else Path.cwd())
    data = (a.stdin_text.encode() if a.stdin_text is not None
            else Path(a.stdin_file).read_bytes() if a.stdin_file else b"")
    mode = a.stdin_mode or ("pipe" if a.stdin_text is not None or a.stdin_file else "null")
    search_path = os.pathsep.join(str((cwd / part).resolve()) for part in env.get("PATH", os.defpath).split(os.pathsep))
    executable = str((cwd / command[0]).resolve()) if os.sep in command[0] else command[0]
    resolved = shutil.which(executable, path=search_path)
    target = {"argv0": command[0], "resolved": resolved,
              "realpath": os.path.realpath(resolved) if resolved else None,
              "sha256": sha256_file(Path(resolved)) if resolved else None}
    return Invocation(command, cwd, env, overrides, roots, sandbox, data, mode, target)


def input_capture(a: argparse.Namespace, invocation: Invocation, echo: bytearray):
    if invocation.stdin_mode == "pipe":
        reader, writer = os.pipe()
        return reader, (writer, invocation.stdin_data), (reader,), ()
    if invocation.stdin_mode == "tty":
        master, slave = open_pty(a.cols, a.rows)
        thread = threading.Thread(target=drain, args=(master, echo), daemon=True)
        return slave, (os.dup(master), invocation.stdin_data + b"\x04"), (slave,), (thread,)
    descriptor = subprocess.DEVNULL if invocation.stdin_mode == "null" else None
    return descriptor, None, (), ()


def output_capture(a: argparse.Namespace, name: str, buffer: bytearray):
    reader, writer = open_pty(a.cols, a.rows) if a.tty in (name, "both") else os.pipe()
    return writer, threading.Thread(target=drain, args=(reader, buffer), daemon=True)


def prepare_capture(a: argparse.Namespace, invocation: Invocation) -> Capture:
    buffers = {name: bytearray() for name in ("stdout", "stderr", "tty_echo")}
    stdin, writer, parent_close, threads = input_capture(a, invocation, buffers["tty_echo"])
    stdout, stdout_reader = output_capture(a, "stdout", buffers["stdout"])
    stderr, stderr_reader = output_capture(a, "stderr", buffers["stderr"])
    return Capture(stdin, stdout, stderr, parent_close + (stdout, stderr),
                   threads + (stdout_reader, stderr_reader), buffers, writer)


def launch(invocation: Invocation, capture: Capture):
    def preexec() -> None:
        os.setsid()
        if invocation.stdin_mode == "tty":
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        if invocation.stdin_mode == "closed":
            os.close(0)

    try:
        process = subprocess.Popen(invocation.command, cwd=invocation.cwd, env=invocation.env,
                                   stdin=capture.stdin, stdout=capture.stdout, stderr=capture.stderr,
                                   preexec_fn=preexec, close_fds=True)
        return process, None
    except OSError as error:
        return None, {"type": type(error).__name__, "errno": error.errno, "message": str(error)}


def start_capture(capture: Capture, process: subprocess.Popen | None) -> None:
    for descriptor in capture.parent_close:
        os.close(descriptor)
    for thread in capture.threads:
        thread.start()
    if capture.writer and process is not None:
        threading.Thread(target=feed, args=capture.writer, daemon=True).start()
    elif capture.writer:
        os.close(capture.writer[0])


def signal_group(process: subprocess.Popen, number: int) -> bool:
    try:
        os.killpg(process.pid, number)
        return True
    except ProcessLookupError:
        return False


def wait_for_process(a: argparse.Namespace, process: subprocess.Popen | None, start: float):
    sent = None
    if process is None:
        return sent, False
    try:
        if a.send_signal:
            try:
                process.wait(timeout=a.after)
            except subprocess.TimeoutExpired:
                number = getattr(signal, "SIG" + a.send_signal.upper().removeprefix("SIG"))
                if signal_group(process, number):
                    sent = {"signal": number.name, "after_s": a.after}
        process.wait(timeout=max(a.timeout - (time.monotonic() - start), 0.1))
        return sent, False
    except subprocess.TimeoutExpired:
        signal_group(process, signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            signal_group(process, signal.SIGKILL)
            process.wait()
        return sent, True


def execute(a: argparse.Namespace, invocation: Invocation, capture: Capture) -> Execution:
    started_at, start = datetime.now(timezone.utc), time.monotonic()
    process, error = launch(invocation, capture)
    start_capture(capture, process)
    sent, timed_out = wait_for_process(a, process, start)
    return Execution(process, started_at, time.monotonic() - start,
                     process.returncode if process is not None else None, error, sent, timed_out)


def finish_capture(capture: Capture, execution: Execution) -> bool:
    for thread in capture.threads:
        thread.join(timeout=2)
    descendants_hold_output = any(thread.is_alive() for thread in capture.threads)
    if descendants_hold_output and execution.process is not None:
        signal_group(execution.process, signal.SIGKILL)
        for thread in capture.threads:
            thread.join(timeout=2)
    return descendants_hold_output


def terminal_metadata(a: argparse.Namespace, invocation: Invocation, stdin_file: Path) -> dict:
    return {
        "stdin_fixture": str(stdin_file) if invocation.stdin_mode in ("pipe", "tty") else None,
        "stdin_is_tty": invocation.stdin_mode == "tty" or (invocation.stdin_mode == "inherit" and os.isatty(0)),
        "stdout_is_tty": a.tty in ("stdout", "both"),
        "stderr_is_tty": a.tty in ("stderr", "both"),
        "stdin": {"mode": invocation.stdin_mode, "bytes": len(invocation.stdin_data),
                  "sha256": hashlib.sha256(invocation.stdin_data).hexdigest(),
                  "tty_eof_sent": invocation.stdin_mode == "tty"},
        "tty": {"stdin": invocation.stdin_mode == "tty" or (invocation.stdin_mode == "inherit" and os.isatty(0)),
                "stdout": a.tty in ("stdout", "both"),
                "stderr": a.tty in ("stderr", "both"),
                "size": [a.cols, a.rows]},
    }


def evidence_record(a: argparse.Namespace, invocation: Invocation, execution: Execution, capture: Capture,
                    out: Path, probe_id: str, run_id: str, before: dict, descendants_hold_output: bool) -> dict:
    after = {str(directory): snapshot(directory) for directory in invocation.snapshot_roots}
    before_file = out / "raw" / f"{run_id}.before.json"
    after_file = out / "raw" / f"{run_id}.after.json"
    before_file.write_text(json.dumps(before, indent=2))
    after_file.write_text(json.dumps(after, indent=2))
    stdin_file = out / "raw" / f"{run_id}.stdin"
    stdin_file.write_bytes(invocation.stdin_data)
    return {
        "id": probe_id,
        "run_id": run_id,
        "launch_error": execution.launch_error,
        "label": a.label,
        "started_at": execution.started_at.isoformat(),
        "duration_s": round(execution.duration, 4),
        "duration_ms": round(execution.duration * 1000, 3),
        "argv": list(invocation.command),
        "cwd": str(invocation.cwd),
        "target": invocation.target,
        "env_base": "clean" if a.clean_env else "inherited",
        "env_overrides": invocation.overrides,
        "env_delta": invocation.overrides,
        "base_path": invocation.env.get("PATH"),
        **terminal_metadata(a, invocation, stdin_file),
        "exit_code": execution.returncode if execution.returncode is not None and execution.returncode >= 0 else None,
        "signal": signal.Signals(-execution.returncode).name if execution.returncode is not None and execution.returncode < 0 else None,
        "signal_sent": execution.signal_sent,
        "timed_out": execution.timed_out,
        "descendants_hold_output": descendants_hold_output,
        "descendants_killed": descendants_hold_output,
        "capture_complete": not any(t.is_alive() for t in capture.threads),
        "stdout_file": str(out / "raw" / f"{run_id}.stdout"),
        "stderr_file": str(out / "raw" / f"{run_id}.stderr"),
        "stdout": output_summary(bytes(capture.buffers["stdout"]), out / "raw" / f"{run_id}.stdout"),
        "stderr": output_summary(bytes(capture.buffers["stderr"]), out / "raw" / f"{run_id}.stderr"),
        "tty_echo": output_summary(bytes(capture.buffers["tty_echo"]), out / "raw" / f"{run_id}.tty-echo"),
        "filesystem_before": str(before_file),
        "filesystem_after": str(after_file),
        "fs_diff": {d: diff(before[d], after[d]) for d in before},
        "network_observed": None,
        "sandbox": str(invocation.sandbox) if invocation.sandbox else None,
        "host": {"platform": platform.platform(), "python": platform.python_version()},
    }


def main() -> int:
    parser = argument_parser()
    args = parser.parse_args()
    command = validate_arguments(args, parser)
    out = Path(args.out).resolve()
    (out / "raw").mkdir(parents=True, exist_ok=True)
    probe_id = args.id or f"P-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:6]}"
    run_id = f"{probe_id}-{uuid.uuid4().hex}"
    invocation = prepare_invocation(args, out, run_id, command)
    before = {str(directory): snapshot(directory) for directory in invocation.snapshot_roots}
    capture = prepare_capture(args, invocation)
    execution = execute(args, invocation, capture)
    descendants_hold_output = finish_capture(capture, execution)
    record = evidence_record(args, invocation, execution, capture, out, probe_id, run_id, before, descendants_hold_output)
    with open(out / "probes.jsonl", "a") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    json.dump({key: record[key] for key in ("id", "exit_code", "signal", "timed_out", "duration_s")}, sys.stdout)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
