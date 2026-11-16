#!/usr/bin/env python3
"""Isolated native Pi launcher; see ../SKILL.md for the driving contract."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import fcntl
import pty
import select
import signal
import struct
import termios
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[4]
EXTENSION = REPO / "extensions/pi-google-oauth-v2/src/index.ts"
SOURCE = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi/agent")).resolve()
SCRATCH_PARENT = REPO / ".audit/verify-pi-google-oauth-v2/scratch"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def snapshot(source=SOURCE):
    return {name: digest(source / name) for name in ("auth.json", "settings.json", "models.json", "models-store.json")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "copy-auth", "doctor", "run", "serve-tui", "tui", "live", "cleanup"))
    parser.add_argument("evidence", type=Path)
    parser.add_argument("args", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    evidence = options.evidence.resolve()
    state_file = evidence / "state.json"
    if options.action == "init":
        evidence.mkdir(parents=True, exist_ok=False, mode=0o700)
        SCRATCH_PARENT.mkdir(parents=True, exist_ok=True)
        scratch = Path(tempfile.mkdtemp(prefix="pi-google-verification-", dir=SCRATCH_PARENT))
        (scratch / "agent").mkdir(mode=0o700)
        (scratch / "work").mkdir()
        (scratch / "agent/settings.json").write_text(json.dumps({
            "retry": {"enabled": False}, "compaction": {"enabled": False},
            "defaultProvider": "google-oauth-v2", "defaultModel": "gemini-3.8-flash",
        }))
        state = {"repo": str(REPO), "scratch": str(scratch), "source": str(SOURCE),
                 "sourceBefore": snapshot(), "extensionHash": digest(EXTENSION)}
        state_file.write_text(json.dumps(state, indent=2) + "\n")
        print(json.dumps(state, indent=2))
        return

    state = json.loads(state_file.read_text())
    scratch = Path(state["scratch"])
    agent = scratch / "agent"
    assert state["repo"] == str(REPO) and scratch.name.startswith("pi-google-verification-")
    assert scratch.parent.resolve() == SCRATCH_PARENT.resolve()
    source = Path(state["source"])
    if options.action == "cleanup":
        if (scratch / "tui.pid").exists():
            pid = int((scratch / "tui.pid").read_text())
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                pass
            else:
                raise RuntimeError("Stop the owned TUI before cleanup")
        report = {"sourceProfileUnchanged": snapshot(source) == state["sourceBefore"],
                  "scratch": str(scratch)}
        shutil.rmtree(scratch, ignore_errors=False)
        report["scratchRemoved"] = not scratch.exists()
        (evidence / "cleanup.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))
        assert report["sourceProfileUnchanged"], "Source profile changed; investigate concurrent use"
        return

    assert agent.is_dir() and digest(EXTENSION) == state["extensionHash"], "Reinitialize after source changes"
    if options.action == "copy-auth":
        credential = json.loads((source / "auth.json").read_text()).get("google-oauth-v2")
        assert credential and credential.get("type") == "oauth", "No source Google OAuth login; use /login"
        target = agent / "auth.json"
        target.touch(mode=0o600, exist_ok=True)
        target.chmod(0o600)
        target.write_text(json.dumps({"google-oauth-v2": credential}))
        print("Copied only Google OAuth credentials into the disposable profile; login is NOT verified")
        return

    env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent))
    env.pop("PI_CODING_AGENT_SESSION_DIR", None)
    for key in list(env):
        if key == "NODE_OPTIONS" or key.endswith("_API_KEY") or key == "PI_OFFLINE":
            env.pop(key)
    common = ["pi", "-ne", "-e", str(EXTENSION), "--no-mcp", "--no-skills",
              "--no-context-files", "--no-prompt-templates", "--no-themes",
              "--no-approve", "--no-session"]
    if options.action == "doctor":
        credential = {}
        if (agent / "auth.json").exists():
            credential = json.loads((agent / "auth.json").read_text()).get("google-oauth-v2", {})
        version = subprocess.check_output(["pi", "--version"], text=True).strip()
        report = {"piVersion": version, "extensionVersion": json.loads((EXTENSION.parents[1] / "package.json").read_text())["version"],
                  "extensionUnchanged": True, "agentDir": str(agent), "cwd": str(scratch / "work"),
                  "oauthPresent": credential.get("type") == "oauth",
                  "oauthUnexpired": credential.get("expires", 0) > time.time() * 1000,
                  "projectPresent": bool(credential.get("projectId")),
                  "sourceProfileUnchanged": snapshot(source) == state["sourceBefore"]}
        (evidence / "doctor.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        assert version == "1.5.2", "Revalidate CLI compatibility before driving another Pi version"
        assert report["sourceProfileUnchanged"]
        return

    args = options.args[1:] if options.args[:1] == ["--"] else options.args
    if options.action == "serve-tui":
        fifo = scratch / "tui.input"
        os.mkfifo(fifo, mode=0o600)
        control = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
        child_command = [sys.executable, str(Path(__file__).resolve()), "tui", str(evidence), "--", *args]
        child = subprocess.Popen(child_command, stdin=slave, stdout=slave, stderr=slave,
                                 env=dict(os.environ, TERM="xterm-256color"), start_new_session=True)
        os.close(slave)
        def stop(_signal, _frame):
            raise SystemExit(143)
        signal.signal(signal.SIGTERM, stop)
        try:
            while child.poll() is None:
                for fd in select.select([master, control], [], [], 0.2)[0]:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        break
                    if fd == control:
                        os.write(master, data)
                    else:
                        # Answer cursor-position queries; managed commands have no stdin.
                        if b"\x1b[6n" in data:
                            os.write(master, b"\x1b[1;1R")
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            os.close(master)
            os.close(control)
            fifo.unlink(missing_ok=True)
        raise SystemExit(child.wait())

    if options.action == "live":
        command = ["bun", str(REPO / "extensions/pi-google-oauth-v2/scripts/verify-live.ts")]
    else:
        command = common + args
    if options.action == "tui":
        command += ["--provider", "google-oauth-v2", "--model", "gemini-3.8-flash", "--no-tools"]
        (evidence / "tui.command.json").write_text(json.dumps(command) + "\n")
        pid_file = scratch / "tui.pid"
        pid_file.write_text(str(os.getpid()))
        try:
            result = subprocess.run(command, cwd=scratch / "work", env=env)
        finally:
            pid_file.unlink(missing_ok=True)
        raise SystemExit(result.returncode)

    label = "live" if options.action == "live" else f"cli-{time.time_ns()}"
    (evidence / f"{label}.command.json").write_text(json.dumps(command) + "\n")
    with (evidence / f"{label}.stdout.txt").open("w") as stdout, (evidence / f"{label}.stderr.txt").open("w") as stderr:
        try:
            result = subprocess.run(command, cwd=scratch / "work", env=env, stdout=stdout,
                                    stderr=stderr, timeout=1800 if options.action == "live" else 180)
            code = result.returncode
        except subprocess.TimeoutExpired:
            code = 124
    (evidence / f"{label}.exit.txt").write_text(f"{code}\n")
    print(f"{label}: exit {code}; evidence {evidence}")
    raise SystemExit(code)


if __name__ == "__main__":
    main()
