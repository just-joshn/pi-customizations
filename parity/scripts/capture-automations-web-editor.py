#!/usr/bin/env python3
"""Drive https://cursor.com/automations via Agent Helper on Chrome (witness only).

Opens the web Automations host, captures screens/AX, tries New Automation entry
via element_index / xy / keyboard. Does not save, enable Benny, Slack, or mint.

Usage:
  python3 parity/scripts/capture-automations-web-editor.py
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

HELPER = Path.home() / ".cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper"
ROOT = Path(__file__).resolve().parents[1]
URL = "https://cursor.com/automations"
APP = "Google Chrome"

EDITOR_CHROME_MARKERS = (
    "Untitled Automation",
    "Automation name",
    "Save Automation",
    "When this happens",
    "Then do this",
)


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
                "clientInfo": {"name": "capture-automations-web", "version": "1"},
            },
            init=True,
        )
        assert self.proc.stdin is not None
        self.proc.stdin.write(
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"
        )
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

    def get_state(self) -> dict:
        return self.tool("get_app_state", app=APP)

    def shot(self, dest: Path) -> dict:
        result = self.get_state()
        ax_text = None
        for part in result.get("result", {}).get("content", []):
            if part.get("type") == "text" and ax_text is None:
                ax_text = part.get("text")
            if part.get("type") == "image":
                dest.write_bytes(base64.b64decode(part["data"]))
                if ax_text:
                    dest.with_suffix(dest.suffix + ".ax.txt").write_text(ax_text)
                return result
        raise RuntimeError(f"no screenshot for {dest}")

    def key(self, keys: str) -> None:
        self.tool("key", app=APP, keys=keys)

    def type(self, text: str) -> None:
        self.tool("type_text", app=APP, text=text)

    def click_xy(self, x: int, y: int) -> None:
        self.get_state()
        self.tool("click", app=APP, x=x, y=y)

    def click_index(self, element_index: str) -> dict:
        self.get_state()
        return self.tool("click", app=APP, element_index=str(element_index))

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        finally:
            self.proc.terminate()


def ax_json_from_state(result: dict) -> dict | None:
    for part in result.get("result", {}).get("content", []):
        if part.get("type") == "text":
            text = part.get("text") or ""
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return None
    return None


def walk_nodes(tree: dict | None):
    if not tree:
        return
    stack: list[object] = [tree]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        yield node
        for key, value in node.items():
            if key == "frame":
                continue
            if isinstance(value, (dict, list)):
                stack.append(value)


def find_buttons(tree: dict | None, title: str) -> list[dict]:
    hits: list[dict] = []
    for node in walk_nodes(tree):
        if str(node.get("title") or "").strip() != title:
            continue
        if node.get("role") not in {"AXButton", "AXLink", "AXGroup", "AXStaticText"}:
            # Prefer buttons; still record other exact title matches.
            if node.get("role") != "AXButton" and title != "New Automation":
                continue
        hits.append(
            {
                "index": str(node.get("index")),
                "role": node.get("role"),
                "title": node.get("title"),
                "actions": node.get("actions"),
                "frame": node.get("frame"),
                "enabled": node.get("enabled"),
            }
        )
    # Prefer AXButton first
    hits.sort(key=lambda h: 0 if h.get("role") == "AXButton" else 1)
    return hits


def find_new_automation_buttons(tree: dict | None) -> list[dict]:
    return [h for h in find_buttons(tree, "New Automation") if h.get("role") == "AXButton"]


def ax_looks_like_editor(ax_text: str) -> bool:
    if not ax_text:
        return False
    if "No Automations Yet" in ax_text:
        return False
    return any(m in ax_text for m in EDITOR_CHROME_MARKERS)


def still_on_list(ax_text: str) -> bool:
    return "New Automation" in ax_text or "Automations" in ax_text


def page_markers(ax_text: str) -> dict:
    return {
        "hasAutomations": "Automations" in ax_text,
        "hasNewAutomation": "New Automation" in ax_text,
        "hasNoAutomationsYet": "No Automations Yet" in ax_text,
        "hasSignIn": any(
            s in ax_text for s in ("Sign in", "Log in", "Continue with", "Sign up")
        ),
        "hasEditorMarkers": ax_looks_like_editor(ax_text),
        "urlHint": "cursor.com/automations" in ax_text.lower()
        or "automations" in ax_text.lower(),
    }


def frame_center(frame: object) -> tuple[int, int] | None:
    if not isinstance(frame, dict):
        return None
    try:
        x = float(frame.get("x", 0))
        y = float(frame.get("y", 0))
        w = float(frame.get("width", 0))
        h = float(frame.get("height", 0))
    except (TypeError, ValueError):
        return None
    return int(x + w / 2), int(y + h / 2)


def click_ok_from(result: dict) -> tuple[bool, str | None]:
    err = ""
    for part in (result or {}).get("result", {}).get("content", []) or []:
        if part.get("type") == "text":
            err += part.get("text") or ""
    if "Error:" in err:
        return False, err
    return True, None


def ensure_url(h: Helper) -> None:
    # Focus address bar and navigate. Prefer keyboard over Escape.
    h.key("cmd+l")
    time.sleep(0.3)
    h.key("cmd+a")
    time.sleep(0.1)
    h.type(URL)
    time.sleep(0.2)
    h.key("Return")
    time.sleep(3.0)


def probe(h: Helper, adir: Path) -> dict:
    h.shot(adir / "screen-00-baseline.png")
    ensure_url(h)
    state = h.shot(adir / "screen-01-after-nav.png")
    ax_path = adir / "screen-01-after-nav.png.ax.txt"
    ax_text = ax_path.read_text() if ax_path.is_file() else ""
    markers = page_markers(ax_text)
    (adir / "01-page-markers.json").write_text(json.dumps(markers, indent=2) + "\n")

    tree = ax_json_from_state(state)
    buttons = find_new_automation_buttons(tree)
    if not buttons and ax_path.is_file():
        try:
            tree = json.loads(ax_text)
            buttons = find_new_automation_buttons(tree)
        except json.JSONDecodeError:
            buttons = []
    (adir / "new-automation-buttons.json").write_text(json.dumps(buttons, indent=2) + "\n")

    click_log: list[dict] = []
    editor_witnessed = bool(markers.get("hasEditorMarkers"))
    paths: list[str] = ["open Chrome URL", "cmd+l navigate to cursor.com/automations"]

    # element_index clicks
    for i, btn in enumerate(buttons[:4]):
        idx = btn["index"]
        label = f"screen-02-idx-{i}-{idx}"
        try:
            res = h.click_index(idx)
            ok, err = click_ok_from(res)
        except Exception as exc:  # noqa: BLE001
            ok, err = False, str(exc)
        time.sleep(1.5)
        h.shot(adir / f"{label}.png")
        axp = adir / f"{label}.png.ax.txt"
        axt = axp.read_text() if axp.is_file() else ""
        looks = ax_looks_like_editor(axt)
        click_log.append(
            {
                "method": "element_index",
                "index": idx,
                "frame": btn.get("frame"),
                "clickOk": ok,
                "clickError": err,
                "editorChromeByAx": looks,
                "stillOnList": still_on_list(axt),
                "markers": page_markers(axt),
            }
        )
        paths.append(f"click element_index {idx}")
        if looks:
            editor_witnessed = True
            break

    # xy clicks on button frames
    if not editor_witnessed:
        for i, btn in enumerate(buttons[:4]):
            center = frame_center(btn.get("frame"))
            if not center:
                continue
            x, y = center
            label = f"screen-03-xy-{i}-{x}-{y}"
            try:
                h.click_xy(x, y)
                ok, err = True, None
            except Exception as exc:  # noqa: BLE001
                ok, err = False, str(exc)
            time.sleep(1.5)
            h.shot(adir / f"{label}.png")
            axp = adir / f"{label}.png.ax.txt"
            axt = axp.read_text() if axp.is_file() else ""
            looks = ax_looks_like_editor(axt)
            click_log.append(
                {
                    "method": "xy",
                    "index": btn.get("index"),
                    "xy": [x, y],
                    "clickOk": ok,
                    "clickError": err,
                    "editorChromeByAx": looks,
                    "stillOnList": still_on_list(axt),
                    "markers": page_markers(axt),
                }
            )
            paths.append(f"click xy {x},{y}")
            if looks:
                editor_witnessed = True
                break

    # keyboard: Tab cycle + Return/Space. Do not Escape (dismisses host).
    if not editor_witnessed:
        ensure_url(h)
        h.shot(adir / "screen-04-pre-keyboard.png")
        for _ in range(16):
            h.key("Tab")
            time.sleep(0.12)
        h.shot(adir / "screen-05-after-tabs.png")
        h.key("Return")
        time.sleep(1.5)
        h.shot(adir / "screen-06-after-return.png")
        axp = adir / "screen-06-after-return.png.ax.txt"
        axt = axp.read_text() if axp.is_file() else ""
        if ax_looks_like_editor(axt):
            editor_witnessed = True
        else:
            h.key("Space")
            time.sleep(1.2)
            h.shot(adir / "screen-07-after-space.png")
            axp = adir / "screen-07-after-space.png.ax.txt"
            axt = axp.read_text() if axp.is_file() else ""
            if ax_looks_like_editor(axt):
                editor_witnessed = True
        paths.append("Tab cycle + Return/Space (no Escape)")

    h.shot(adir / "screen-09-final.png")
    final_ax = adir / "screen-09-final.png.ax.txt"
    final_text = final_ax.read_text() if final_ax.is_file() else ""
    final_markers = page_markers(final_text)
    if ax_looks_like_editor(final_text):
        editor_witnessed = True

    return {
        "probe": "automations-web-editor",
        "url": URL,
        "app": APP,
        "editorChromeWitnessed": editor_witnessed,
        "newAutomationButtons": buttons,
        "clickLog": click_log,
        "initialMarkers": markers,
        "finalMarkers": final_markers,
        "finalStillOnList": still_on_list(final_text),
        "pathsTried": paths,
        "didNot": [
            "save automation",
            "enable Benny",
            "post to Slack",
            "mint Cloud Agent",
            "edit ledgers",
            "Escape that dismisses host",
        ],
    }


def main() -> int:
    if not HELPER.is_file():
        raise SystemExit(f"missing helper: {HELPER}")
    attempt = str(uuid.uuid4())
    evid_root = ROOT / "evidence" / "setup-benny" / "creation-boundary" / "web"
    adir = evid_root / attempt
    adir.mkdir(parents=True, exist_ok=True)
    research = ROOT / "research" / "automations-web-editor-001"
    research.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        ["open", "-a", "Google Chrome", URL],
        check=False,
    )
    time.sleep(2.5)

    h = Helper()
    try:
        subprocess.run(
            ["osascript", "-e", 'tell application "Google Chrome" to activate'],
            check=False,
        )
        time.sleep(0.5)
        notes = probe(h, adir)
        meta = {
            "attemptId": attempt,
            "mode": "web",
            "method": "agent-helper MCP on Google Chrome at cursor.com/automations",
            "evidenceDir": str(adir),
            **notes,
        }
        (adir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        (research / "attempt-meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(json.dumps(meta, indent=2))
        return 0
    finally:
        h.close()


if __name__ == "__main__":
    raise SystemExit(main())
