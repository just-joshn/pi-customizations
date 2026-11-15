#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
import pty
import re
import select
import shutil
import signal
import struct
import tempfile
import termios
import time
from dataclasses import dataclass, field
from pathlib import Path

BENCH = Path(__file__).resolve().parent
PACKAGE = BENCH.parent
PROVIDER = BENCH / "bench-provider.ts"
ROWS, COLS = 40, 120
PROMPT = "Run the replay benchmark workload."
KEY = b"q"
KEYSTROKES = 10
KEY_INTERVAL_S = 0.25
ECHO_BOUND_S = 1.0
EXPECTED_TOOL_RESULTS = 4
IDLE_SETTLE_S = 1.0

COMMON_ARGS = [
    "--no-extensions", "-e", str(PROVIDER),
    "--provider", "bench", "--model", "replay",
    "--no-session", "--offline", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--tools", "read,bash,edit,grep",
]
CONFIGS = {
    "stock": ["--use-theme", "dark"],
    "theme": ["--theme", str(PACKAGE / "themes"), "--use-theme", "snoop-dark"],
    "full": ["-e", str(PACKAGE), "--use-theme", "snoop-dark"],
}
SETTINGS = {"quietStartup": True, "collapseChangelog": True, "lastChangelogVersion": "1.5.2", "packages": []}
ANSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]")


@dataclass
class Session:
    pid: int
    fd: int
    log: Path
    chunks: list = field(default_factory=list)

    def read(self, timeout: float) -> bytes:
        ready, _, _ = select.select([self.fd], [], [], max(timeout, 0))
        if not ready:
            return b""
        try:
            data = os.read(self.fd, 65536)
        except OSError:
            return b""
        self.chunks.append((time.time(), len(data)))
        with self.log.open("ab") as handle:
            handle.write(data)
        return data

    def pump(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.read(deadline - time.monotonic())

    def settle(self, quiet: float, cap: float) -> None:
        deadline = time.monotonic() + cap
        seen = False
        while time.monotonic() < deadline:
            data = self.read(quiet)
            if data:
                seen = True
            elif seen:
                return
        raise RuntimeError(f"no settled first frame within {cap}s")

    def write(self, data: bytes) -> float:
        os.write(self.fd, data)
        return time.monotonic()

    def bytes_between(self, start_s: float, end_s: float) -> int:
        return sum(size for at, size in self.chunks if start_s <= at < end_s)


def spawn(config: str, workspace: Path, agent_dir: Path, log: Path) -> Session:
    env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent_dir), TERM="xterm-256color", COLORTERM="truecolor", COLUMNS=str(COLS), LINES=str(ROWS))
    env["SNOOP_BENCH_OUT"] = str(agent_dir / "record.jsonl")
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        os.chdir(workspace)
        os.execvpe("pi", ["pi", *COMMON_ARGS, *CONFIGS[config]], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    return Session(pid=pid, fd=fd, log=log)


def measure_echo(session: Session, start: float) -> tuple[list[float], int]:
    latencies: list[float] = []
    misses = 0
    for count in range(1, KEYSTROKES + 1):
        slot = start + count * KEY_INTERVAL_S
        session.pump(slot - time.monotonic())
        sent = session.write(KEY)
        seen = b""
        while True:
            remaining = sent + ECHO_BOUND_S - time.monotonic()
            if remaining <= 0:
                misses += 1
                break
            seen += session.read(remaining)
            if KEY * count in ANSI.sub(b"", seen):
                latencies.append((time.monotonic() - sent) * 1000)
                break
    return latencies, misses


def wait_for_record(session: Session, record: Path, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        session.read(0.2)
        if record.exists() and record.read_text().strip():
            return json.loads(record.read_text().strip().splitlines()[-1])
    raise RuntimeError(f"no record within {timeout}s")


def reap(session: Session) -> int:
    for action in (None, b"\x03", b"\x03", signal.SIGTERM, signal.SIGKILL):
        if isinstance(action, bytes):
            session.write(action)
        elif action is not None:
            os.kill(session.pid, action)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            session.read(0.1)
            done, status = os.waitpid(session.pid, os.WNOHANG)
            if done:
                os.close(session.fd)
                return os.waitstatus_to_exitcode(status)
    raise RuntimeError("pi did not exit")


def run_once(config: str, round_index: int, keep: bool) -> dict:
    root = Path(tempfile.mkdtemp(prefix=f"snoop-bench-{config}-", dir=os.environ.get("TMPDIR")))
    workspace, agent_dir = root / "workspace", root / "agent"
    workspace.mkdir()
    agent_dir.mkdir()
    (agent_dir / "settings.json").write_text(json.dumps(SETTINGS))
    session = spawn(config, workspace, agent_dir, root / "pty.log")
    result: dict = {"config": config, "round": round_index}
    try:
        session.settle(quiet=0.7, cap=20)
        session.write(PROMPT.encode())
        session.pump(0.3)
        start = session.write(b"\r")
        latencies, misses = measure_echo(session, start)
        record = wait_for_record(session, agent_dir / "record.jsonl", timeout=90)
        result.update(record)
        result["echo"] = {"latenciesMs": latencies, "misses": misses}
        result["pty"] = {
            "workloadBytes": session.bytes_between(record["agentStartEpochMs"] / 1000, record["agentEndEpochMs"] / 1000),
            "idleBytes": session.bytes_between(record["agentEndEpochMs"] / 1000, record["idleEndEpochMs"] / 1000),
            "idleLateBytes": session.bytes_between(record["agentEndEpochMs"] / 1000 + IDLE_SETTLE_S, record["idleEndEpochMs"] / 1000),
        }
    except RuntimeError as error:
        result["error"] = str(error)
    result["exitCode"] = reap(session)
    result["editApplied"] = (workspace / "edit-target.txt").exists() and "status: final" in (workspace / "edit-target.txt").read_text()
    problems = check(result)
    if problems:
        result["problems"] = problems
    if problems or keep:
        result["artifacts"] = str(root)
        (root / "chunks.json").write_text(json.dumps(session.chunks))
    else:
        shutil.rmtree(root)
    return result


def check(result: dict) -> list[str]:
    if "error" in result:
        return [result["error"]]
    problems = []
    if result["toolResults"] != EXPECTED_TOOL_RESULTS:
        problems.append(f"toolResults {result['toolResults']} != {EXPECTED_TOOL_RESULTS}")
    if result["toolErrors"]:
        problems.append(f"toolErrors {result['toolErrors']}")
    if not result["editApplied"]:
        problems.append("edit not applied")
    if result["pty"]["workloadBytes"] == 0:
        problems.append("no PTY bytes during workload")
    if result["echo"]["misses"]:
        problems.append(f"echo misses {result['echo']['misses']}")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay benchmark for pi-snoop-tui in a real Pi TUI.")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--configs", default="stock,theme,full")
    parser.add_argument("--out", default="results.jsonl")
    parser.add_argument("--keep-artifacts", action="store_true", help="keep each run's workspace, pty.log, and chunk timings")
    args = parser.parse_args()
    configs = args.configs.split(",")
    unknown = set(configs) - CONFIGS.keys()
    if unknown:
        parser.error(f"unknown configs: {sorted(unknown)}")
    for round_index in range(args.runs):
        order = configs[round_index % len(configs):] + configs[:round_index % len(configs)]
        for config in order:
            result = run_once(config, round_index, args.keep_artifacts)
            with open(args.out, "a") as handle:
                handle.write(json.dumps(result) + "\n")
            summary = result.get("problems") or f"cpu {result['workload']['cpuUserMs'] + result['workload']['cpuSystemMs']:.0f} ms"
            print(f"round {round_index} {config}: {summary}", flush=True)


if __name__ == "__main__":
    main()
