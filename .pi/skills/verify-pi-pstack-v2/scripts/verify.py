#!/usr/bin/env python3
"""Isolated real-Pi terminal driver. See ../SKILL.md for proof and cleanup rules."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

REPO = Path(__file__).resolve().parents[4]
PACKAGE = REPO / "extensions/pi-pstack-v2"
SCRATCH = REPO / ".audit/verify-pi-pstack-v2/scratch"


def fingerprint(root):
    paths = [root / "package.json", root / "README.md"]
    for directory in ("src", "skills", "agents", "rules", "docs"):
        paths.extend(p for p in (root / directory).rglob("*") if p.is_file())
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "doctor", "serve", "send", "cleanup"))
    parser.add_argument("evidence", type=Path)
    parser.add_argument("text", nargs="?")
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    if args.action == "init":
        evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
        SCRATCH.mkdir(parents=True, exist_ok=True)
        scratch = Path(tempfile.mkdtemp(prefix="run-", dir=SCRATCH)).resolve()
        (scratch / "agent").mkdir(mode=0o700)
        (scratch / "work").mkdir()
        (scratch / "outside.txt").write_text("PSTACK_OUTSIDE_UNCHANGED\n")
        (scratch / "agent/settings.json").write_text(json.dumps({
            "retry": {"enabled": False}, "compaction": {"enabled": False},
            "quietStartup": False,
            "extensions": [str(PACKAGE / "src/index.ts")], "skills": [str(PACKAGE / "skills")],
        }))
        subprocess.run(["git", "init", "-q", str(scratch / "work")], check=True)
        (evidence / "state.json").write_text(json.dumps({
            "repo": str(REPO), "scratch": str(scratch), "source": fingerprint(PACKAGE),
            "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        }, indent=2) + "\n")
        print(scratch)
        return

    state = json.loads((evidence / "state.json").read_text())
    scratch = Path(state["scratch"])
    if state["repo"] != str(REPO) or scratch.parent != SCRATCH.resolve() or not scratch.name.startswith("run-"):
        raise RuntimeError("Manifest does not belong to this checkout")
    pid_file = scratch / "launcher.pid"
    if args.action == "cleanup":
        for recorded in (pid_file, scratch / "child.pid"):
            if recorded.exists():
                try:
                    os.kill(int(recorded.read_text()), 0)
                except ProcessLookupError:
                    pass
                else:
                    raise RuntimeError("Stop the owned process before cleanup: " + str(recorded))
        for spec in (scratch / "agent/pstack-v2/jobs").glob("**/job.json"):
            job = json.loads(spec.read_text())
            socket = job.get("socket")
            if socket and subprocess.run(["tmux", "-S", socket, "has-session", "-t", "=" + job["id"]],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                raise RuntimeError("A pstack job is still running: " + job["id"])
        report = {"scratch": str(scratch), "scratchRemoved": False,
                  "outsideUnchanged": (scratch / "outside.txt").read_text() == "PSTACK_OUTSIDE_UNCHANGED\n"}
        shutil.rmtree(scratch)
        report["scratchRemoved"] = not scratch.exists()
        (evidence / "cleanup.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))
        return

    if not scratch.is_dir() or state["source"] != fingerprint(PACKAGE):
        raise RuntimeError("Missing scratch or changed package: clean up, then initialize a fresh run")
    if args.action == "doctor":
        version = subprocess.check_output(["pi", "--version"], text=True).strip()
        report = {"piVersion": version, "packageVersion": json.loads((PACKAGE / "package.json").read_text())["version"],
                  "packageUnchanged": True, "tmux": shutil.which("tmux"),
                  "sandbox": shutil.which("sandbox-exec" if sys.platform == "darwin" else "bwrap"),
                  "agent": str(scratch / "agent"), "work": str(scratch / "work"),
                  "authPresent": (scratch / "agent/auth.json").exists(), "launcherRecorded": pid_file.exists(),
                  "sandboxedLauncher": os.environ.get("PSTACK_V2_SANDBOXED") == "1"}
        print(json.dumps(report, indent=2))
        if version != "1.5.2" or not report["tmux"] or not report["sandbox"]:
            raise RuntimeError("Need Pi 1.5.2, tmux and a supported sandbox")
        return

    if args.action == "send":
        if args.text is None:
            parser.error("send requires text; use a literal carriage return to submit")
        fd = os.open(scratch / "input", os.O_WRONLY | os.O_NONBLOCK)
        try:
            os.write(fd, args.text.encode())
        finally:
            os.close(fd)
        with (evidence / "actions.jsonl").open("a") as log:
            log.write(json.dumps({"time": time.time(), "keys": args.text}) + "\n")
        return

    env = {key: value for key, value in os.environ.items()
           if not key.startswith("PI_") and key != "NODE_OPTIONS" and not key.endswith(("_API_KEY", "_TOKEN"))}
    env.update(PI_CODING_AGENT_DIR=str(scratch / "agent"), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1",
               PI_TELEMETRY="0", TERM="xterm-256color")
    command = ["pi", "--offline", "--no-approve", "--no-mcp", "-ne", "-e", str(PACKAGE / "src/index.ts"),
               "-ns", "--skill", str(PACKAGE / "skills"), "-nc", "-np", "--no-themes",
               "--session-dir", str(scratch / "sessions")]
    (evidence / "command.json").write_text(json.dumps(command, indent=2) + "\n")
    fifo = scratch / "input"
    os.mkfifo(fifo, mode=0o600)
    control = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))
    child = subprocess.Popen(command, cwd=scratch / "work", env=env, stdin=slave, stdout=slave,
                             stderr=slave, start_new_session=True)
    os.close(slave)
    pid_file.write_text(str(os.getpid()))
    (scratch / "child.pid").write_text(str(child.pid))

    def stop(_signal, _frame):
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, stop)
    try:
        with (evidence / "terminal.ansi").open("ab") as transcript:
            while child.poll() is None:
                for fd in select.select([master, control], [], [], 0.2)[0]:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        break
                    if fd == control:
                        os.write(master, data)
                    else:
                        if b"\x1b[6n" in data:
                            os.write(master, b"\x1b[1;1R")
                        transcript.write(data)
                        transcript.flush()
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        (evidence / "exit.txt").write_text(str(child.returncode) + "\n")
        os.close(master)
        os.close(control)
        fifo.unlink(missing_ok=True)
        pid_file.unlink(missing_ok=True)
        (scratch / "child.pid").unlink(missing_ok=True)
    raise SystemExit(child.returncode)


if __name__ == "__main__":
    main()
