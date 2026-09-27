#!/usr/bin/env python3
"""Run one CLI invocation under controlled conditions and append a JSONL evidence record.

Usage: probe.py [options] -- <cli> [args...]
Unix only (uses pty). Standard library only.
"""

from __future__ import annotations

import argparse
import errno
from concurrent.futures import Future
from contextlib import ExitStack
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
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import MappingProxyType

PREVIEW_BYTES = 2000
PROCESS_GRACE_SECONDS = 2
CAPTURE_GRACE_SECONDS = 2
POST_LAUNCH_MINIMUM_WAIT_SECONDS = 0.1
IO_POLL_SECONDS = 0.01


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


def snapshot_error(error: OSError) -> None:
    raise error


def snapshot(root: Path) -> dict[str, dict]:
    root.stat()
    return {str(path.relative_to(root)): snapshot_entry(path)
            for directory, directories, files in os.walk(root, onerror=snapshot_error)
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
    with ExitStack() as resources:
        resources.callback(os.close, slave)
        resources.callback(os.close, master)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        resources.pop_all()
        return master, slave


@dataclass(frozen=True)
class IOErrorDetail:
    type: str
    errno: int | None
    message: str


@dataclass(frozen=True)
class StreamOutcome:
    data: bytes = b""
    transferred: int = 0
    status: str = "complete"
    error: IOErrorDetail | None = None


def next_io(fd: int, data: bytes | None, transferred: int, stop: threading.Event):
    try:
        if data is None:
            return os.read(fd, 65536)
        count = os.write(fd, memoryview(data)[transferred:])
        if not count:
            raise RuntimeError("write made no progress")
        return count
    except BlockingIOError:
        stop.wait(IO_POLL_SECONDS)
        return None


def stream_io(fd: int, tty: bool, data: bytes | None, stop: threading.Event) -> StreamOutcome:
    buffer, transferred = bytearray(), 0
    try:
        while not stop.is_set():
            if data is not None and transferred == len(data):
                return StreamOutcome(transferred=transferred)
            chunk = next_io(fd, data, transferred, stop)
            if chunk is None:
                continue
            if data is None:
                if not chunk:
                    return StreamOutcome(bytes(buffer), len(buffer))
                buffer.extend(chunk)
            else:
                transferred += chunk
        return StreamOutcome(bytes(buffer), transferred if data is not None else len(buffer), "cancelled")
    except Exception as error:
        number = error.errno if isinstance(error, OSError) else None
        expected = (tty and number == errno.EIO) or (data is not None and not tty and number == errno.EPIPE)
        status = ("complete" if data is None else "closed") if expected else "error"
        detail = None if expected else IOErrorDetail(type(error).__name__, number, str(error))
        return StreamOutcome(bytes(buffer), transferred if data is not None else len(buffer), status, detail)


def stream_task(fd: int, tty: bool, data: bytes | None, stop: threading.Event, result: Future) -> None:
    try:
        os.set_blocking(fd, False)
        outcome = stream_io(fd, tty, data, stop)
    except Exception as error:
        outcome = StreamOutcome(status="error",
                                error=IOErrorDetail(type(error).__name__, getattr(error, 'errno', None), str(error)))
    try:
        os.close(fd)
    except OSError as error:
        outcome = StreamOutcome(outcome.data, outcome.transferred, "error",
                                IOErrorDetail(type(error).__name__, error.errno, str(error)))
    result.set_result(outcome)


def stream_metadata(outcome: StreamOutcome) -> dict:
    return {"bytes": outcome.transferred, "status": outcome.status,
            "error": asdict(outcome.error) if outcome.error else None}


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
    targets = tuple(root / (seed.partition(":")[2] or Path(seed.partition(":")[0]).name) for seed in seeds)
    resolved = tuple(target.resolve() for target in targets)
    if any(not target.is_relative_to(root.resolve()) for target in resolved):
        raise ValueError("seed destination escapes sandbox")
    ordered = sorted(resolved, key=lambda path: path.parts)
    if any(target.is_relative_to(previous) for previous, target in zip(ordered, ordered[1:])):
        raise ValueError("seed destinations must not overlap")
    for seed, target in zip(seeds, resolved):
        src = seed.partition(":")[0]
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
    env: MappingProxyType
    overrides: MappingProxyType
    snapshot_roots: tuple[Path, ...]
    sandbox: Path | None
    stdin_data: bytes
    stdin_mode: str
    target: MappingProxyType


@dataclass(frozen=True)
class Capture:
    stdin: int | None
    stdout: int
    stderr: int
    parent_close: tuple[int, ...]
    threads: tuple[threading.Thread, ...]
    results: tuple[tuple[str, Future], ...]
    stop: threading.Event
    owned: tuple[int, ...]
    parent_resources: ExitStack


@dataclass(frozen=True)
class Execution:
    process: subprocess.Popen | None
    started_at: datetime
    duration: float
    returncode: int | None
    launch_error: MappingProxyType | None
    signal_sent: MappingProxyType | None
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
    if a.send_signal is not None and "SIG" + a.send_signal.upper().removeprefix("SIG") not in signal.Signals.__members__:
        ap.error("unknown signal")
    strings = (*cmd, *a.env, *a.unset, *a.seed, *a.snapshot, a.out, a.cwd, a.label, a.stdin_file)
    if any(value is not None and "\0" in value for value in strings):
        ap.error("arguments must not contain NUL bytes")
    if any(not key or "=" in key for key in a.unset):
        ap.error("--unset requires an environment name")

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
    return Invocation(command, cwd, MappingProxyType(env), MappingProxyType(overrides), roots,
                      sandbox, data, mode, MappingProxyType(target))


def capture_pair(a: argparse.Namespace, tty: bool, resources: ExitStack):
    pair = open_pty(a.cols, a.rows) if tty else os.pipe()
    for fd in pair:
        resources.callback(os.close, fd)
    return pair


def input_capture(a: argparse.Namespace, invocation: Invocation, resources: ExitStack):
    mode = invocation.stdin_mode
    if mode == "pipe":
        reader, writer = capture_pair(a, False, resources)
        return reader, (("stdin", writer, False, invocation.stdin_data),), (reader,)
    if mode == "tty":
        master, slave = capture_pair(a, True, resources)
        writer = os.dup(master)
        resources.callback(os.close, writer)
        return slave, (("tty_echo", master, True, None),
                       ("stdin", writer, True, invocation.stdin_data + b"\x04")), (slave,)
    return subprocess.DEVNULL if mode == "null" else None, (), ()


def prepare_capture(a: argparse.Namespace, invocation: Invocation) -> Capture:
    with ExitStack() as resources:
        stdin, workers, parent_close = input_capture(a, invocation, resources)
        for name in ("stdout", "stderr"):
            tty = a.tty in (name, "both")
            reader, writer = capture_pair(a, tty, resources)
            workers += ((name, reader, tty, None),)
            parent_close += (writer,)
        stop = threading.Event()
        results = tuple((name, Future()) for name, _, _, _ in workers)
        threads = tuple(threading.Thread(target=stream_task, args=(fd, tty, data, stop, result), daemon=True)
                        for (_, fd, tty, data), (_, result) in zip(workers, results))
        parent_resources = ExitStack()
        for fd in parent_close:
            parent_resources.callback(os.close, fd)
        capture = Capture(stdin, parent_close[-2], parent_close[-1], parent_close, threads,
                          results, stop, parent_close + tuple(fd for _, fd, _, _ in workers), parent_resources)
        resources.pop_all()
        return capture


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
        return None, MappingProxyType({"type": type(error).__name__, "errno": error.errno, "message": str(error)})


def start_capture(capture: Capture) -> None:
    capture.parent_resources.close()
    try:
        for thread in capture.threads:
            thread.start()
    except RuntimeError as error:
        raise OSError(f"capture worker startup failed: {error}") from error


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
                    sent = MappingProxyType({"signal": number.name, "after_s": a.after})
        process.wait(timeout=max(a.timeout - (time.monotonic() - start), POST_LAUNCH_MINIMUM_WAIT_SECONDS))
        return sent, False
    except subprocess.TimeoutExpired:
        signal_group(process, signal.SIGTERM)
        try:
            process.wait(timeout=PROCESS_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            signal_group(process, signal.SIGKILL)
            process.wait(timeout=PROCESS_GRACE_SECONDS)
        return sent, True


def execute(a: argparse.Namespace, invocation: Invocation, capture: Capture) -> Execution:
    started_at, start = datetime.now(timezone.utc), time.monotonic()
    process = None
    try:
        process, error = launch(invocation, capture)
        start_capture(capture)
        sent, timed_out = wait_for_process(a, process, start)
    except BaseException:
        cleanup_execution(capture, process)
        raise
    return Execution(process, started_at, time.monotonic() - start,
                     process.returncode if process is not None else None, error, sent, timed_out)


def join_capture(capture: Capture) -> None:
    deadline = time.monotonic() + CAPTURE_GRACE_SECONDS
    for thread in capture.threads:
        if thread.ident is not None:
            thread.join(timeout=max(0, deadline - time.monotonic()))


def cleanup_execution(capture: Capture, process: subprocess.Popen | None) -> None:
    errors = []
    actions = (() if process is None else (lambda: signal_group(process, signal.SIGKILL),
                                           lambda: process.wait(timeout=PROCESS_GRACE_SECONDS)))
    unstarted = tuple(fd for fd, thread in zip(capture.owned[len(capture.parent_close):], capture.threads)
                      if thread.ident is None)
    actions += (capture.stop.set, lambda: join_capture(capture), capture.parent_resources.close)
    actions += tuple(lambda fd=fd: os.close(fd) for fd in unstarted)
    for action in actions:
        try:
            action()
        except (OSError, subprocess.SubprocessError) as error:
            errors.append(str(error))
    if errors:
        raise OSError('capture cleanup failed: ' + '; '.join(errors))


def finish_capture(capture: Capture, execution: Execution) -> bool:
    join_capture(capture)
    descendants_hold_output = any(not result.done() for name, result in capture.results if name != "stdin")
    if any(thread.is_alive() for thread in capture.threads) and execution.process is not None:
        signal_group(execution.process, signal.SIGKILL)
        join_capture(capture)
    capture.stop.set()
    join_capture(capture)
    return descendants_hold_output


def completed_outcomes(capture: Capture) -> dict[str, StreamOutcome]:
    defaults = {name: StreamOutcome(status="not_applicable") for name in ("stdout", "stderr", "tty_echo", "stdin")}
    return {**defaults, **{name: result.result() if result.done() else StreamOutcome(status="cancelled")
                          for name, result in capture.results}}


def terminal_metadata(a: argparse.Namespace, invocation: Invocation, stdin_file: Path,
                      delivery: StreamOutcome) -> dict:
    return {
        "stdin_fixture": str(stdin_file) if invocation.stdin_mode in ("pipe", "tty") else None,
        "stdin_is_tty": invocation.stdin_mode == "tty" or (invocation.stdin_mode == "inherit" and os.isatty(0)),
        "stdout_is_tty": a.tty in ("stdout", "both"),
        "stderr_is_tty": a.tty in ("stderr", "both"),
        "stdin": {"mode": invocation.stdin_mode, "bytes": len(invocation.stdin_data),
                  "sha256": hashlib.sha256(invocation.stdin_data).hexdigest(),
                  "tty_eof_sent": invocation.stdin_mode == "tty" and delivery.status == "complete"},
        "tty": {"stdin": invocation.stdin_mode == "tty" or (invocation.stdin_mode == "inherit" and os.isatty(0)),
                "stdout": a.tty in ("stdout", "both"),
                "stderr": a.tty in ("stderr", "both"),
                "size": [a.cols, a.rows]},
    }


def evidence_record(a: argparse.Namespace, invocation: Invocation, execution: Execution, capture: Capture,
                    out: Path, probe_id: str, run_id: str, before: dict, descendants_hold_output: bool) -> dict:
    outcomes = completed_outcomes(capture)
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
        "launch_error": dict(execution.launch_error) if execution.launch_error is not None else None,
        "label": a.label,
        "started_at": execution.started_at.isoformat(),
        "duration_s": round(execution.duration, 4),
        "duration_ms": round(execution.duration * 1000, 3),
        "argv": list(invocation.command),
        "cwd": str(invocation.cwd),
        "target": dict(invocation.target),
        "env_base": "clean" if a.clean_env else "inherited",
        "env_overrides": dict(invocation.overrides),
        "env_delta": dict(invocation.overrides),
        "base_path": invocation.env.get("PATH"),
        **terminal_metadata(a, invocation, stdin_file, outcomes["stdin"]),
        "exit_code": execution.returncode if execution.returncode is not None and execution.returncode >= 0 else None,
        "signal": signal.Signals(-execution.returncode).name if execution.returncode is not None and execution.returncode < 0 else None,
        "signal_sent": dict(execution.signal_sent) if execution.signal_sent is not None else None,
        "timed_out": execution.timed_out,
        "descendants_hold_output": descendants_hold_output,
        "capture_complete": all(outcomes[name].status in ("complete", "not_applicable")
                                for name in ("stdout", "stderr", "tty_echo")),
        "capture_outcomes": {name: stream_metadata(outcomes[name]) for name in ("stdout", "stderr", "tty_echo")},
        "input_delivery": stream_metadata(outcomes["stdin"]),
        "stdout_file": str(out / "raw" / f"{run_id}.stdout"),
        "stderr_file": str(out / "raw" / f"{run_id}.stderr"),
        "stdout": output_summary(outcomes["stdout"].data, out / "raw" / f"{run_id}.stdout"),
        "stderr": output_summary(outcomes["stderr"].data, out / "raw" / f"{run_id}.stderr"),
        "tty_echo": output_summary(outcomes["tty_echo"].data, out / "raw" / f"{run_id}.tty-echo"),
        "filesystem_before": str(before_file),
        "filesystem_after": str(after_file),
        "fs_diff": {d: diff(before[d], after[d]) for d in before},
        "network_observed": None,
        "sandbox": str(invocation.sandbox) if invocation.sandbox else None,
        "host": {"platform": platform.platform(), "python": platform.python_version()},
    }


def run(args: argparse.Namespace, command: tuple[str, ...]) -> int:
    out = Path(args.out).resolve()
    (out / "raw").mkdir(parents=True, exist_ok=True)
    probe_id = args.id or f"P-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:6]}"
    run_id = f"{probe_id}-{uuid.uuid4().hex}"
    invocation = prepare_invocation(args, out, run_id, command)
    before = {str(directory): snapshot(directory) for directory in invocation.snapshot_roots}
    capture = prepare_capture(args, invocation)
    execution = execute(args, invocation, capture)
    try:
        descendants_hold_output = finish_capture(capture, execution)
        record = evidence_record(args, invocation, execution, capture, out, probe_id, run_id, before, descendants_hold_output)
    except BaseException:
        cleanup_execution(capture, execution.process)
        raise
    with open(out / "probes.jsonl", "a") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    json.dump({key: record[key] for key in ("id", "exit_code", "signal", "timed_out", "duration_s")}, sys.stdout)
    print()
    return 0


def main() -> int:
    parser = argument_parser()
    args = parser.parse_args()
    command = validate_arguments(args, parser)
    try:
        return run(args, command)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"probe: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
