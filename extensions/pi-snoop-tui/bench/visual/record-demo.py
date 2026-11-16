#!/usr/bin/env python3
"""Record a scripted Pi session with pi-snoop-tui as timestamped screen frames.

usage: uv run --with pyte record-demo.py [out.json.gz]
Starts Pi in a 100x32 pseudo-terminal with demo-provider.ts, types a prompt, waits for the agent to finish,
then expands and collapses tool rows with Ctrl+O. Writes every distinct screen to out/demo-frames.json.gz."""
import fcntl
import gzip
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

import pyte

COLS, ROWS = 100, 32
PROMPT = "Make the cache refresh cancelable."
REQUIRED = ["Make the cache refr", "● working", "•  bash", "exit 1", "Tests  1 failed", "exit 0", "Tests pass", "Tool output: expanded", "Tool output: collapsed"]
FORBIDDEN = ["npm warn", "npm error", "/workspace (main)"]
HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGE = os.path.dirname(os.path.dirname(HERE))
SETTINGS = {
    "quietStartup": True,
    "collapseChangelog": True,
    "lastChangelogVersion": "1.5.2",
    "outputPad": 1,
    "hideThinkingBlock": True,
}


def color(value: str) -> str | None:
    return None if value == "default" else value


def runs(screen: pyte.Screen) -> list[list[list]]:
    rows = []
    for y in range(screen.lines):
        row, line = screen.buffer[y], []
        for x in range(screen.columns):
            char = row[x]
            fg, bg = (char.bg, char.fg) if char.reverse else (char.fg, char.bg)
            style = [color(fg), color(bg), char.bold, char.reverse]
            if line and line[-1][1:] == style:
                line[-1][0] += char.data or "\0"
            else:
                line.append([char.data or "\0", *style])
        rows.append(line)
    return rows


def text(screen: pyte.Screen) -> str:
    return "\n".join(screen.display)


class Session:
    def __init__(self, fd: int) -> None:
        self.fd = fd
        self.screen = pyte.Screen(COLS, ROWS)
        self.stream = pyte.ByteStream(self.screen)
        self.start = time.monotonic()
        self.frames: list[dict] = []
        self.alive = True

    def pump(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while self.alive and time.monotonic() < deadline:
            ready, _, _ = select.select([self.fd], [], [], max(0.0, min(0.08, deadline - time.monotonic())))
            if not ready:
                continue
            self.drain()
            self.snapshot()

    def drain(self) -> None:
        """Read until Pi is quiet for 12 ms, so a frame written in several chunks is captured whole."""
        while True:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                self.alive = False
                return
            if not data:
                self.alive = False
                return
            self.stream.feed(data)
            ready, _, _ = select.select([self.fd], [], [], 0.012)
            if not ready:
                return

    def snapshot(self) -> None:
        rows = runs(self.screen)
        if self.frames and self.frames[-1]["rows"] == rows:
            return
        self.frames.append({"t": round(time.monotonic() - self.start, 3), "rows": rows})

    def restart(self) -> None:
        """Drop frames Pi drew before the extensions loaded, and start the clock at the first snoop frame."""
        self.frames.clear()
        self.start = time.monotonic()
        self.snapshot()

    def until(self, predicate, cap: float, label: str) -> None:
        deadline = time.monotonic() + cap
        while not predicate(text(self.screen)):
            if not self.alive or time.monotonic() > deadline:
                sys.exit(f"timed out waiting for {label}:\n{text(self.screen)}")
            self.pump(0.08)

    def send(self, data: bytes) -> None:
        os.write(self.fd, data)


def workspace() -> tuple[str, str]:
    root = tempfile.mkdtemp(prefix="snoop-demo-", dir=os.environ.get("TMPDIR"))
    work, agent = os.path.join(root, "workspace"), os.path.join(root, "agent")
    os.makedirs(work)
    os.makedirs(agent)
    with open(os.path.join(agent, "settings.json"), "w") as handle:
        json.dump(SETTINGS, handle)
    git = ["git", "-C", work, "-c", "user.name=demo", "-c", "user.email=demo@example.com"]
    subprocess.run([*git, "init", "-q", "-b", "main"], check=True)
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "init"], check=True)
    return work, agent


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out", "demo-frames.json.gz")
    work, agent = workspace()
    inherited = {key: value for key, value in os.environ.items() if not key.lower().startswith("npm_config_")}
    env = dict(
        inherited,
        TERM="xterm-256color",
        COLORTERM="truecolor",
        COLUMNS=str(COLS),
        LINES=str(ROWS),
        PI_CODING_AGENT_DIR=agent,
        npm_config_update_notifier="false",
        npm_config_fund="false",
    )
    args = [
        "pi", "--no-extensions", "-e", PACKAGE, "-e", os.path.join(HERE, "demo-provider.ts"),
        "--provider", "demo", "--model", "demo-model", "--thinking", "medium",
        "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--tools", "read,bash,edit,grep", "--use-theme", "snoop-dark",
    ]
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(work)
        os.execvpe("pi", args, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    session = Session(fd)
    try:
        session.until(lambda screen: "ready" in screen and "main" in screen, 60, "startup")
        session.restart()
        session.pump(1.2)
        for key in PROMPT:
            session.send(key.encode())
            session.pump(0.04)
        session.pump(0.5)
        session.send(b"\r")
        session.until(lambda screen: "● working" in screen, 10, "working")
        session.until(lambda screen: "ready" in screen and "Tests pass" in screen, 60, "agent end")
        session.pump(1.8)
        session.send(b"\x0f")
        session.pump(2.4)
        session.send(b"\x0f")
        session.pump(2.0)
    finally:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(fd)
    session.frames.append({"t": round(time.monotonic() - session.start, 3), "rows": session.frames[-1]["rows"]})
    seen = ["\n".join("".join(run[0] for run in line) for line in frame["rows"]) for frame in session.frames]
    missing = [needle for needle in REQUIRED if not any(needle in screen for screen in seen)]
    leaked = [needle for needle in FORBIDDEN if any(needle in screen for screen in seen)]
    if missing or leaked:
        sys.exit(f"missing states {missing}, unexpected text {leaked}")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with gzip.open(out, "wt") as handle:
        json.dump({"cols": COLS, "rows": ROWS, "frames": session.frames}, handle)
    print(f"{out}: {len(session.frames)} frames over {session.frames[-1]['t']:.1f} s")


main()
