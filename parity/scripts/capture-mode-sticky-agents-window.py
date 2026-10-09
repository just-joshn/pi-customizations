#!/usr/bin/env python3
"""Drive Cursor Agents Window sticky Custom Mode via Agent Helper MCP.

Journey: New Chat → /poteto-mode → alt+Return (Use as Mode) → first task → follow-up.
Screens are the oracle. Does not edit ledgers.

Usage:
  python3 parity/scripts/capture-mode-sticky-agents-window.py
"""
from __future__ import annotations

import base64
import json
import subprocess
import time
import uuid
from pathlib import Path

HELPER = Path.home() / ".cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper"
ROOT = Path(__file__).resolve().parents[1]
EVID_ROOT = ROOT / "evidence" / "mode-sticky" / "agents-window"
FIRST = "Reply with exactly the three words: sticky mode on. Do no other work."
FOLLOW = "Reply with exactly the digit 7. Do no other work."


class Helper:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [str(HELPER), "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        self._id = 0
        self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "capture-mode-sticky-agents-window", "version": "1"},
            },
            init=True,
        )
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.proc.stdin.flush()

    def _rpc(self, name: str, params: dict, init: bool = False) -> dict:
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self._id += 1
        mid = self._id
        msg = {
            "jsonrpc": "2.0",
            "id": mid,
            "method": "initialize" if init else "tools/call",
            "params": params if init else {"name": name, "arguments": params},
        }
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("helper MCP eof")
            obj = json.loads(line)
            if obj.get("id") == mid:
                if obj.get("result", {}).get("isError"):
                    raise RuntimeError(json.dumps(obj))
                return obj

    def tool(self, name: str, **args):
        return self._rpc(name, args)

    def shot(self, dest: Path) -> None:
        result = self.tool("get_app_state", app="Cursor")
        for part in result.get("result", {}).get("content", []):
            if part.get("type") == "image":
                dest.write_bytes(base64.b64decode(part["data"]))
                return
        raise RuntimeError(f"no screenshot for {dest}")

    def key(self, keys: str) -> None:
        self.tool("key", app="Cursor", keys=keys)

    def type(self, text: str) -> None:
        self.tool("type_text", app="Cursor", text=text)

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        finally:
            self.proc.terminate()


def wait_shots(h: Helper, adir: Path, prefix: str, seconds: int, step: int = 5) -> None:
    for i in range(max(1, seconds // step)):
        time.sleep(step)
        h.shot(adir / f"{prefix}-{i:02d}.png")


def main() -> int:
    if not HELPER.is_file():
        raise SystemExit(f"missing helper: {HELPER}")
    attempt = str(uuid.uuid4())
    adir = EVID_ROOT / attempt
    adir.mkdir(parents=True, exist_ok=True)
    h = Helper()
    try:
        subprocess.run(["osascript", "-e", 'tell application "Cursor" to activate'], check=False)
        time.sleep(0.5)
        h.shot(adir / "screen-00-baseline.png")
        h.key("cmd+n")
        time.sleep(0.8)
        h.shot(adir / "screen-00b-new-chat.png")
        h.type("/poteto-mode")
        time.sleep(1.0)
        h.shot(adir / "screen-01-slash-use-as-mode.png")
        h.key("alt+Return")
        time.sleep(0.8)
        h.shot(adir / "screen-02-custom-mode-badge.png")
        h.type(FIRST)
        time.sleep(0.3)
        h.shot(adir / "screen-03-first-task-typed.png")
        h.key("Return")
        wait_shots(h, adir, "screen-03b-wait", 60)
        h.shot(adir / "screen-04-after-first-turn-sticky.png")
        h.type(FOLLOW)
        time.sleep(0.3)
        h.shot(adir / "screen-05-followup-typed-sticky.png")
        h.key("Return")
        wait_shots(h, adir, "screen-05b-wait", 45)
        h.shot(adir / "screen-06-after-second-turn-sticky.png")
        meta = {
            "attemptId": attempt,
            "method": "agent-helper MCP keyboard drive of Cursor Agents Window",
            "firstTask": FIRST,
            "followup": FOLLOW,
            "evidenceDir": str(adir),
            "keySequence": ["cmd+n", "/poteto-mode", "alt+Return", "Return", "Return"],
        }
        (adir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(json.dumps(meta, indent=2))
        return 0
    finally:
        h.close()


if __name__ == "__main__":
    raise SystemExit(main())
