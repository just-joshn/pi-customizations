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
import subprocess
import sys
import tempfile
import termios
import time
from dataclasses import dataclass, field
from pathlib import Path

BENCH = Path(__file__).resolve().parent
PACKAGE = BENCH.parent
PROVIDER = BENCH / "bench-provider.ts"
FIXTURE = BENCH / "visual/mockup-fixture.py"
MEDIUM_FIXTURE = BENCH / "medium-fixture.py"
MIXED_FIXTURE = BENCH / "mixed-fixture.py"
ROWS, COLS = 40, 120
PROMPT = "Run the replay benchmark workload."
KEY = b"q"
KEYSTROKES = 10
KEY_INTERVAL_S = 0.25
ECHO_BOUND_S = 1.0
EXPECTED_TOOL_RESULTS = 4
IDLE_SETTLE_S = 1.0
LONG_REPEATS = 150
NARROW_COLS = 90
QUIET_S = 0.5
STEP_FIRST_BYTE_S = 5.0
STEP_CAP_S = 60.0
COLLAPSED_KEYSTROKES = 20
COLLAPSED_KEY_INTERVAL_S = 0.1
BURST_KEYSTROKES = 50
BURST_BOUND_S = 5.0
STORM_COLS = [NARROW_COLS, COLS, NARROW_COLS, COLS, NARROW_COLS]
MEDIUM_TURNS = 30
MIXED_TURNS = 50
# snoop insets its editor rules by one gutter column on each side.
RULE_INSET = 2
TIMING_GROUP = re.compile(r"^--- Startup Timings: (\w+) ---$", re.M)
TIMING_LINE = re.compile(r"^  (.+): (\d+)ms$", re.M)

SHARED_FLAGS = ["--offline", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files"]
SHARED_ARGS = [*SHARED_FLAGS, "--tools", "read,bash,edit,grep"]
COMMON_ARGS = ["--no-extensions", "-e", str(PROVIDER), "--provider", "bench", "--model", "replay", "--no-session", *SHARED_ARGS]
LONG_ARGS = ["--no-extensions", *SHARED_ARGS]
MEDIUM_ARGS = ["--no-extensions", "-e", str(PROVIDER), "--provider", "bench", "--model", "replay", *SHARED_ARGS]
MIXED_ARGS = ["--no-extensions", "-e", str(PROVIDER), *SHARED_FLAGS, "--tools", "read,bash,edit,grep,codemode,pi_spawn,tmux_run"]
RESTORED = {
    "long": (FIXTURE, LONG_REPEATS, LONG_ARGS),
    "mixed": (MIXED_FIXTURE, MIXED_TURNS, MIXED_ARGS),
}
CONFIGS = {
    "stock": ["--use-theme", "dark"],
    "theme": ["--theme", str(PACKAGE / "themes"), "--use-theme", "snoop-dark"],
    "full": ["-e", str(PACKAGE), "--use-theme", "snoop-dark"],
    "spinner": ["-e", str(PACKAGE / "src/tool-rows.ts"), "-e", str(PACKAGE / "src/footer.ts"), "--theme", str(PACKAGE / "themes"), "--use-theme", "snoop-dark"],
}
SETTINGS = {"quietStartup": True, "collapseChangelog": True, "lastChangelogVersion": "1.5.2", "packages": []}
RULE = re.compile("─+")
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


def set_winsize(fd: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, cols, 0, 0))


def now_us() -> int:
    return time.monotonic_ns() // 1000


def spawn(config: str, workspace: Path, agent_dir: Path, log: Path, args: list[str] = COMMON_ARGS, extra_env: dict | None = None) -> Session:
    env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent_dir), TERM="xterm-256color", COLORTERM="truecolor", COLUMNS=str(COLS), LINES=str(ROWS), **(extra_env or {}))
    env["SNOOP_BENCH_OUT"] = str(agent_dir / "record.jsonl")
    pid, fd = pty.fork()
    if pid == 0:
        set_winsize(0, COLS)
        os.chdir(workspace)
        os.execvpe("pi", ["pi", *args, *CONFIGS[config]], env)
    set_winsize(fd, COLS)
    return Session(pid=pid, fd=fd, log=log)


def measure_echo(session: Session, start: float, keystrokes: int = KEYSTROKES, interval: float = KEY_INTERVAL_S) -> tuple[list[float], int]:
    latencies: list[float] = []
    misses = 0
    for count in range(1, keystrokes + 1):
        slot = start + count * interval
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


def measure_burst(session: Session) -> dict:
    started = time.monotonic()
    for _ in range(BURST_KEYSTROKES):
        session.write(KEY)
    seen = b""
    while time.monotonic() < started + BURST_BOUND_S:
        seen += session.read(started + BURST_BOUND_S - time.monotonic())
        if KEY * BURST_KEYSTROKES in ANSI.sub(b"", seen):
            return {"ms": (time.monotonic() - started) * 1000, "echoed": True, "bytes": len(seen)}
    return {"ms": BURST_BOUND_S * 1000, "echoed": False, "bytes": len(seen)}


def clear_editor(session: Session) -> None:
    session.write(b"\x15")
    session.settle(quiet=QUIET_S, cap=STEP_CAP_S)


def wait_for_record(session: Session, record: Path, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        session.read(0.2)
        if record.exists() and record.read_text().strip():
            return json.loads(record.read_text().strip().splitlines()[-1])
    raise RuntimeError(f"no record within {timeout}s")


def reap(session: Session) -> tuple[int, dict]:
    for action in (None, b"\x03", b"\x03", signal.SIGTERM, signal.SIGKILL):
        if isinstance(action, bytes):
            session.write(action)
        elif action is not None:
            os.kill(session.pid, action)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            session.read(0.1)
            done, status, usage = os.wait4(session.pid, os.WNOHANG)
            if done:
                os.close(session.fd)
                return os.waitstatus_to_exitcode(status), {"user": usage.ru_utime * 1000, "sys": usage.ru_stime * 1000}
    raise RuntimeError("pi did not exit")


def run_once(config: str, round_index: int, keep: bool, medium: bool = False) -> dict:
    root = Path(tempfile.mkdtemp(prefix=f"snoop-bench-{'medium-' if medium else ''}{config}-", dir=os.environ.get("TMPDIR")))
    workspace, agent_dir = root / "workspace", root / "agent"
    workspace.mkdir()
    agent_dir.mkdir()
    (agent_dir / "settings.json").write_text(json.dumps(SETTINGS))
    result: dict = {"config": config, "round": round_index}
    if medium:
        session_file = root / "session.jsonl"
        subprocess.run([sys.executable, str(MEDIUM_FIXTURE), str(session_file), str(workspace), str(MEDIUM_TURNS)], check=True)
        result.update(workloadName="medium", turns=MEDIUM_TURNS)
        session = spawn(config, workspace, agent_dir, root / "pty.log", [*MEDIUM_ARGS, "--session", str(session_file)])
    else:
        session = spawn(config, workspace, agent_dir, root / "pty.log")
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
            "cleanIdleBytes": session.bytes_between(record["idleEndEpochMs"] / 1000, record["cleanIdleEndEpochMs"] / 1000),
        }
    except RuntimeError as error:
        result["error"] = str(error)
    result["exitCode"], _ = reap(session)
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


def measure_step(session: Session, started: float, first_byte_s: float) -> dict:
    deadline = started + STEP_CAP_S
    last, output = None, b""
    while True:
        now = time.monotonic()
        quiet_until = last + QUIET_S if last else started + first_byte_s
        if now >= quiet_until:
            rules = [len(run) for run in RULE.findall(output.decode("utf-8", "replace"))]
            end = last or started
            return {"ms": (end - started) * 1000, "bytes": len(output), "output": bool(output), "ruleCols": max(rules, default=0), "lastRuleCols": rules[-1] if rules else 0,
                    "windowUs": [int(started * 1e6), int(end * 1e6)]}
        if now >= deadline:
            raise RuntimeError(f"output did not settle within {STEP_CAP_S}s")
        data = session.read(min(quiet_until, deadline) - now)
        if data:
            last = time.monotonic()
            output += data


def rule_fits(rule: int, cols: int) -> bool:
    return rule in (cols, cols - RULE_INSET)


def run_long(config: str, round_index: int, keep: bool, workload: str = "long") -> dict:
    fixture, repeats, args = RESTORED[workload]
    root = Path(tempfile.mkdtemp(prefix=f"snoop-bench-{workload}-{config}-", dir=os.environ.get("TMPDIR")))
    workspace, agent_dir = root / "workspace", root / "agent"
    workspace.mkdir()
    agent_dir.mkdir()
    (agent_dir / "settings.json").write_text(json.dumps(SETTINGS))
    session_file = root / "session.jsonl"
    subprocess.run([sys.executable, str(fixture), str(session_file), str(workspace), str(repeats)], check=True)
    steps: dict = {}
    result: dict = {"workloadName": workload, "config": config, "round": round_index, "repeats": repeats, "steps": steps}
    started = time.monotonic()
    session = spawn(config, workspace, agent_dir, root / "pty.log", [*args, "--session", str(session_file)])
    actions = [
        ("narrow", lambda: set_winsize(session.fd, NARROW_COLS)),
        ("wide", lambda: set_winsize(session.fd, COLS)),
        ("expand", lambda: session.write(b"\x0f")),
        ("collapse", lambda: session.write(b"\x0f")),
        ("storm", lambda: [set_winsize(session.fd, cols) for cols in STORM_COLS]),
    ]
    name = "startup"
    try:
        steps[name] = measure_step(session, started, STEP_CAP_S)
        name = "typing"
        typing_start = now_us()
        latencies, misses = measure_echo(session, time.monotonic(), COLLAPSED_KEYSTROKES, COLLAPSED_KEY_INTERVAL_S)
        result["collapsedEcho"] = {"latenciesMs": latencies, "misses": misses, "windowUs": [typing_start, now_us()]}
        clear_editor(session)
        name = "burst"
        burst_start = now_us()
        result["burst"] = {**measure_burst(session), "windowUs": [burst_start, now_us()]}
        clear_editor(session)
        for name, action in actions:
            at = time.monotonic()
            action()
            steps[name] = measure_step(session, at, STEP_FIRST_BYTE_S)
            if name == "expand":
                latencies, misses = measure_echo(session, time.monotonic())
                result["echo"] = {"latenciesMs": latencies, "misses": misses}
                clear_editor(session)
        set_winsize(session.fd, COLS)
        session.settle(quiet=QUIET_S, cap=STEP_CAP_S)
    except RuntimeError as error:
        result["error"] = f"{name}: {error}"
    exit_at = time.time()
    session.write(b"\x04")
    result["exitCode"], result["cpuMs"] = reap(session)
    result["exitBytes"] = session.bytes_between(exit_at, time.time())
    problems = [result["error"]] if "error" in result else [f"{name}: no output" for name, step in steps.items() if not step["output"]]
    problems += [f"{name}: widest rule {steps[name]['ruleCols']} != {cols}" for name, cols in (("narrow", NARROW_COLS), ("wide", COLS)) if name in steps and not rule_fits(steps[name]["ruleCols"], cols)]
    if "storm" in steps and not rule_fits(steps["storm"]["lastRuleCols"], STORM_COLS[-1]):
        problems.append(f"storm: last rule {steps['storm']['lastRuleCols']} != {STORM_COLS[-1]}")
    for key in ("echo", "collapsedEcho"):
        if result.get(key, {}).get("misses"):
            problems.append(f"{key} misses {result[key]['misses']}")
    if "burst" in result and not result["burst"]["echoed"]:
        problems.append("burst not echoed")
    if problems:
        result["problems"] = problems
    if problems or keep:
        result["artifacts"] = str(root)
        (root / "chunks.json").write_text(json.dumps(session.chunks))
    else:
        shutil.rmtree(root)
    return result


def parse_timings(text: str) -> dict:
    parts = TIMING_GROUP.split(ANSI.sub(b"", text.encode()).decode())
    groups = {}
    for name, body in zip(parts[1::2], parts[2::2]):
        body = body.split("\n---", 1)[0]
        groups[name] = {label.replace(str(PACKAGE) + "/", ""): int(ms) for label, ms in TIMING_LINE.findall(body)}
    return groups


def run_startup(config: str, round_index: int, keep: bool) -> dict:
    root = Path(tempfile.mkdtemp(prefix=f"snoop-bench-startup-{config}-", dir=os.environ.get("TMPDIR")))
    workspace, agent_dir = root / "workspace", root / "agent"
    workspace.mkdir()
    agent_dir.mkdir()
    (agent_dir / "settings.json").write_text(json.dumps(SETTINGS))
    result: dict = {"workloadName": "startup", "config": config, "round": round_index}
    started = time.monotonic()
    session = spawn(config, workspace, agent_dir, root / "pty.log")
    try:
        result["startup"] = measure_step(session, started, STEP_CAP_S)
    except RuntimeError as error:
        result["error"] = f"startup: {error}"
    exit_at = time.time()
    session.write(b"\x04")
    result["exitCode"], result["cpuMs"] = reap(session)
    result["exitBytes"] = session.bytes_between(exit_at, time.time())
    timing_log = root / "timings.log"
    timed = spawn(config, workspace, agent_dir, timing_log, extra_env={"PI_STARTUP_BENCHMARK": "1", "PI_TIMING": "1"})
    result["timingExitCode"], result["timingCpuMs"] = reap(timed)
    result["timingsMs"] = parse_timings(timing_log.read_bytes().decode("utf-8", "replace").replace("\r", ""))
    problems = [result["error"]] if "error" in result else []
    if not problems and not result["startup"]["output"]:
        problems.append("startup: no output")
    if result["exitCode"] != 0:
        problems.append(f"exit code {result['exitCode']}")
    if "interactiveMode.init" not in result["timingsMs"].get("main", {}) or "TOTAL" not in result["timingsMs"].get("extensions", {}):
        problems.append(f"startup timings incomplete: {sorted(result['timingsMs'])}")
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
    if result["cleanIdle"]["wallMs"] < 9000:
        problems.append(f"clean idle wall {result['cleanIdle']['wallMs']:.0f} ms")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay benchmark for pi-snoop-tui in a real Pi TUI.")
    parser.add_argument("--workload", choices=list(WORKLOADS), default="stream", help="stream: replay a streamed turn; medium: the same turn on a restored 150-tool-row session; long: restore a 1050-row session, type, resize, toggle expansion; mixed: the long steps on a 300-row session where half the tools have no renderer; startup: empty session to first settled frame and clean exit")
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
            result = WORKLOADS[args.workload](config, round_index, args.keep_artifacts)
            with open(args.out, "a") as handle:
                handle.write(json.dumps(result) + "\n")
            if args.workload in RESTORED:
                summary = result.get("problems") or f"cpu {result['cpuMs']['user'] + result['cpuMs']['sys']:.0f} ms, " + ", ".join(f"{name} {step['ms']:.0f} ms" for name, step in result["steps"].items()) + f", burst {result['burst']['ms']:.0f} ms"
            elif args.workload == "startup":
                summary = result.get("problems") or f"settle {result['startup']['ms']:.0f} ms, cpu {result['cpuMs']['user'] + result['cpuMs']['sys']:.0f} ms, pi main {result['timingsMs']['main']['TOTAL']} ms, extensions {result['timingsMs']['extensions']['TOTAL']} ms"
            else:
                summary = result.get("problems") or f"cpu {result['workload']['cpuUserMs'] + result['workload']['cpuSystemMs']:.0f} ms"
            print(f"round {round_index} {config}: {summary}", flush=True)


WORKLOADS = {
    "stream": run_once,
    "medium": lambda config, round_index, keep: run_once(config, round_index, keep, medium=True),
    "long": run_long,
    "mixed": lambda config, round_index, keep: run_long(config, round_index, keep, workload="mixed"),
    "startup": run_startup,
}

if __name__ == "__main__":
    main()
