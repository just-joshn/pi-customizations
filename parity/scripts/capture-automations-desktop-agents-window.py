#!/usr/bin/env python3
"""Drive Cursor Agents Window Automations / slash probes via Agent Helper MCP.

Probe modes:
  benny     — New Chat → /automate slash probe → Automations sidebar
  makebot   — New Chat → /make-bot-ui slash probe → Cmd+Shift+I Routines path
  neweditor — Open Automations list → fresh get_app_state → element_index click
              New Automation → Tab/Return keyboard fallback. Witness only.
  automate-handoff — New Chat → select built-in /automate skill → watch for
              Automations editor chrome. Never Save / Activate / Benny enable.
              Optional profile arg: witness (default) | benny-triage | benny-reproduce.
  open-draft — Open Automations list → discard stuck Untitled (no Save) →
              element_index / System Events click existing draft row → OCR/AX
              editor title chrome. Arg: draft name (default benny-triage).

Screens are the oracle. Does not edit ledgers. Does not enable Benny or mint cloud agents.

Usage:
  python3 parity/scripts/capture-automations-desktop-agents-window.py benny
  python3 parity/scripts/capture-automations-desktop-agents-window.py makebot
  python3 parity/scripts/capture-automations-desktop-agents-window.py neweditor
  python3 parity/scripts/capture-automations-desktop-agents-window.py automate-handoff
  python3 parity/scripts/capture-automations-desktop-agents-window.py automate-handoff benny-triage
  python3 parity/scripts/capture-automations-desktop-agents-window.py automate-handoff benny-reproduce
  python3 parity/scripts/capture-automations-desktop-agents-window.py open-draft benny-triage
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
                "clientInfo": {"name": "capture-automations-desktop", "version": "1"},
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
        return self.tool("get_app_state", app="Cursor")

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
        self.tool("key", app="Cursor", keys=keys)

    def type(self, text: str) -> None:
        self.tool("type_text", app="Cursor", text=text)

    def click_xy(self, x: int, y: int) -> None:
        # Helper requires a fresh get_app_state before coordinate clicks.
        self.get_state()
        self.tool("click", app="Cursor", x=x, y=y)

    def click_index(self, element_index: str) -> dict:
        # Prefer element_index after a fresh get_app_state (indices are snapshot-tied).
        self.get_state()
        return self.tool("click", app="Cursor", element_index=str(element_index))

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


def find_new_automation_buttons(tree: dict | None) -> list[dict]:
    hits: list[dict] = []
    if not tree:
        return hits

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        title = str(node.get("title") or "")
        if title.strip() == "New Automation" and node.get("role") == "AXButton":
            hits.append(
                {
                    "index": str(node.get("index")),
                    "role": node.get("role"),
                    "title": title,
                    "actions": node.get("actions"),
                    "frame": node.get("frame"),
                    "enabled": node.get("enabled"),
                }
            )
        # get_app_state roots are {app, window, ...}; walk every nested dict/list.
        for key, value in node.items():
            if key == "frame":
                continue
            if isinstance(value, (dict, list)):
                walk(value)

    walk(tree)
    return hits


# Chat chrome also says Discard/Draft. Require Automations-editor-specific strings.
EDITOR_CHROME_MARKERS = (
    "Untitled Automation",
    "Automation name",
    "Save Automation",
    "When this happens",
    "Then do this",
    # Web editor chrome (cursor.com/automations/<id>) witnessed f6e29fb7.
    "Add Trigger",
    "Agent Instructions",
    "Add Tool or MCP",
    "Toggle automation enabled state",
    "Edit automation name: Untitled",
)


def ax_looks_like_editor(ax_text: str, *, strong_only: bool = False) -> bool:
    if not ax_text:
        return False
    if "No Automations Yet" in ax_text and "Add Trigger" not in ax_text:
        return False
    # Strong pair: Inactive + Add Trigger (web editor Settings form).
    if "Inactive" in ax_text and "Add Trigger" in ax_text and "Agent Instructions" in ax_text:
        return True
    if strong_only:
        return False
    return any(m in ax_text for m in EDITOR_CHROME_MARKERS)


def still_on_automations_list(ax_text: str) -> bool:
    return "New Automation" in ax_text


def clear_overlays(h: Helper) -> None:
    for _ in range(3):
        h.key("Escape")
        time.sleep(0.15)


def open_agents_chat(h: Helper, adir: Path) -> None:
    """Reach Agents Window New Chat. Prefer cmd+n (sticky path). Avoid Cloud Agent mint."""
    clear_overlays(h)
    h.key("cmd+n")
    time.sleep(1.0)
    h.shot(adir / "screen-01-new-chat.png")
    clear_overlays(h)


def open_automations_list(h: Helper, adir: Path, prefix: str) -> None:
    """Command palette → Open Automations (list host). Does not save or enable."""
    h.key("cmd+shift+p")
    time.sleep(0.5)
    h.type("Open Automations")
    time.sleep(0.8)
    h.shot(adir / f"{prefix}-palette-open-automations.png")
    h.key("Return")
    time.sleep(1.2)
    h.shot(adir / f"{prefix}-automations-list.png")


def probe_benny(h: Helper, adir: Path) -> dict:
    open_agents_chat(h, adir)
    h.type("/automate")
    time.sleep(1.0)
    h.shot(adir / "screen-02-slash-automate.png")
    clear_overlays(h)
    open_automations_list(h, adir, "screen-03")
    clear_overlays(h)
    h.shot(adir / "screen-04-final.png")
    return {
        "probe": "benny-creation-boundary",
        "pathsTried": [
            "cmd+n New Chat",
            "/automate slash menu",
            "cmd+shift+p Open Automations",
        ],
        "didNot": [
            "enable Benny automations",
            "fabricate Automations editor save",
            "open Cloud Agent mint path intentionally",
            "post to Slack",
        ],
    }


def read_ax_text(adir: Path, shot_name: str) -> str:
    ax_path = adir / f"{shot_name}.ax.txt"
    if ax_path.is_file():
        return ax_path.read_text()
    return ""


def ocr_png(path: Path) -> str:
    """macOS Vision OCR. Automations editor often lives in AXWebArea without AX text."""
    if not path.is_file():
        return ""
    script_file = path.with_suffix(path.suffix + ".ocr.swift")
    script_file.write_text(
        "import Foundation\nimport Vision\nimport AppKit\n"
        f'let path = "{path}"\n'
        "guard let img = NSImage(contentsOfFile: path),\n"
        "      let tiff = img.tiffRepresentation,\n"
        "      let rep = NSBitmapImageRep(data: tiff),\n"
        "      let cg = rep.cgImage else { exit(0) }\n"
        "let req = VNRecognizeTextRequest()\n"
        "req.recognitionLevel = .accurate\n"
        "let handler = VNImageRequestHandler(cgImage: cg, options: [:])\n"
        "try? handler.perform([req])\n"
        "let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }"
        '.joined(separator: "\\n")\n'
        "print(text)\n"
    )
    try:
        proc = subprocess.run(
            ["swift", str(script_file)],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        return proc.stdout or ""
    except (OSError, subprocess.TimeoutExpired):
        return ""
    finally:
        try:
            script_file.unlink(missing_ok=True)
        except OSError:
            pass


def editor_markers_from_text(text: str) -> dict:
    return {
        "hasInactive": "Inactive" in text,
        "hasAddTrigger": "Add Trigger" in text,
        "hasAgentInstructions": "Agent Instructions" in text,
        "hasUntitled": "Untitled" in text,
        "hasSave": ("Save" in text) and ("Do not Save" not in text),
    }


def activate_cursor() -> None:
    subprocess.run(
        ["osascript", "-e", 'tell application "Cursor" to activate'],
        check=False,
    )
    time.sleep(0.3)
    # Helper screenshots the focused Cursor window. Prefer Agents over the IDE.
    subprocess.run(
        [
            "osascript",
            "-e",
            'tell application "System Events" to tell process "Cursor" to '
            'try\nclick menu item "Cursor Agents" of menu "Window" of menu bar 1\nend try',
        ],
        check=False,
        capture_output=True,
    )
    time.sleep(0.4)


def dismiss_front_permission_sheet() -> None:
    """Dismiss macOS permission sheets that steal focus from Agents Window."""
    script = (
        'tell application "System Events"\n'
        "  if exists (window 1 of process \"UserNotificationCenter\") then\n"
        '    key code 53\n'
        "  end if\n"
        "  if exists (process \"Cursor\") then\n"
        '    tell process "Cursor"\n'
        "      if exists (sheet 1 of window 1) then\n"
        "        try\n"
        '          click button "Don\'t Allow" of sheet 1 of window 1\n'
        "        on error\n"
        "          key code 53\n"
        "        end try\n"
        "      end if\n"
        "    end tell\n"
        "  end if\n"
        "end tell"
    )
    subprocess.run(["osascript", "-e", script], check=False, capture_output=True)
    time.sleep(0.3)


def find_composer_click_target(tree: dict | None) -> dict | None:
    """Prefer a focused/settable text area in Cursor Agents for typing."""
    hits: list[dict] = []
    if not tree:
        return None

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        role = str(node.get("role") or "")
        if role in {"AXTextArea", "AXTextField", "AXComboBox"} and node.get("frame"):
            hits.append(node)
        for key, value in node.items():
            if key == "frame":
                continue
            if isinstance(value, (dict, list)):
                walk(value)

    walk(tree)
    if not hits:
        return None
    focused = [n for n in hits if n.get("focused")]
    settable = [n for n in hits if n.get("settable")]
    pool = focused or settable or hits
    # Prefer larger composer-like fields.
    def area(n: dict) -> float:
        fr = n.get("frame") or {}
        return float(fr.get("width") or 0) * float(fr.get("height") or 0)

    return max(pool, key=area)


def focus_agents_composer(h: Helper, adir: Path, label: str) -> dict:
    activate_cursor()
    dismiss_front_permission_sheet()
    state = h.get_state()
    tree = ax_json_from_state(state)
    target = find_composer_click_target(tree)
    note: dict = {"label": label, "clicked": False}
    if target and target.get("index") is not None:
        try:
            h.click_index(str(target["index"]))
            note["clicked"] = True
            note["elementIndex"] = str(target["index"])
            note["role"] = target.get("role")
        except Exception as exc:  # noqa: BLE001 — capture path must continue
            note["clickError"] = str(exc)
    elif target and target.get("frame"):
        fr = target["frame"]
        x = int(fr["x"] + fr["width"] / 2)
        y = int(fr["y"] + fr["height"] / 2)
        h.click_xy(x, y)
        note["clicked"] = True
        note["xy"] = [x, y]
    h.shot(adir / f"{label}.png")
    return note


def open_agents_window_via_palette(h: Helper, adir: Path) -> None:
    """Open Agents Window via palette. Avoid Cloud Agent mint commands."""
    activate_cursor()
    clear_overlays(h)
    h.key("cmd+shift+p")
    time.sleep(0.5)
    h.type("Open Agents Window")
    time.sleep(0.8)
    h.shot(adir / "screen-01-palette-open-agents.png")
    h.key("Return")
    time.sleep(1.5)
    activate_cursor()
    h.shot(adir / "screen-02-agents-window.png")


HANDOFF_PROFILES = {
    "witness": {
        "draftName": "parity-witness-draft",
        "nameMarkers": ("parity-witness", "parity-witness-draft"),
        "prompt": (
            " Create a Cursor Automation: cron every day at 9:00, no tools, instructions "
            '"reply with ok". Name it "parity-witness-draft". Do not enable it. Do not Save. '
            "After the draft table, open the Automations editor only. Stop before Save or Activate."
        ),
    },
    "benny-triage": {
        "draftName": "benny-triage",
        "nameMarkers": ("benny-triage",),
        "sessionToken": "PARITY_TOKEN=benny-triage-handoff-001",
        "prompt": (
            " PARITY_TOKEN=benny-triage-handoff-001. Create exactly one Cursor Automation. "
            "The Name field must be exactly benny-triage (refuse Untitled, parity-*, or "
            "webhook names). Cron every day at 9:05 as a harness stand-in trigger (do not "
            "attach Slack; do not post to Slack). No tools. Instructions must say: read and "
            "follow .cursor/automations/benny/skills/triage-issue-reports/SKILL.md; classify "
            "reports; reply only inside the triggering thread; end with one of [benny:bug], "
            "[benny:performance], or [benny:other]; never post a source-channel root message. "
            "Do not enable it. Do not Save. After the draft table shows Name benny-triage, "
            "open the Automations editor only. Stop before Save or Activate."
        ),
    },
    "benny-reproduce": {
        "draftName": "benny-reproduce",
        "nameMarkers": ("benny-reproduce",),
        "sessionToken": "PARITY_TOKEN=benny-reproduce-handoff-001",
        "prompt": (
            " PARITY_TOKEN=benny-reproduce-handoff-001. Create exactly one Cursor Automation. "
            "The Name field must be exactly benny-reproduce (refuse Untitled, parity-*, or "
            "webhook names). Cron every day at 9:10 as a harness stand-in trigger (do not "
            "attach Slack; do not post to Slack). No tools. Instructions must say: read and "
            "follow .cursor/automations/benny/skills/reproduce-and-fix-issues/SKILL.md; "
            "wait for a trusted triage marker before acting; reproduce the symptom twice; "
            "never post a source-channel root message. Do not enable it. Do not Save. After "
            "the draft table shows Name benny-reproduce, open the Automations editor only. "
            "Stop before Save or Activate."
        ),
    },
    "webhook-witness": {
        "draftName": "parity-webhook-witness",
        "nameMarkers": ("parity-webhook-witness", "webhook-witness", "webhook"),
        "sessionToken": "PARITY_TOKEN=webhook-witness-handoff-001",
        "prompt": (
            " PARITY_TOKEN=webhook-witness-handoff-001. Create a Cursor Automation named "
            "parity-webhook-witness. Trigger must be an incoming HTTP webhook (not cron, not "
            "Slack, not git). No tools. Instructions: treat the POST body as untrusted JSON "
            "and reply with ok. Do not enable it. Do not Save. After the draft table, open "
            "the Automations editor only. Stop before Save or Activate. Do not request or "
            "paste any sender key."
        ),
    },
}


def probe_automate_handoff(h: Helper, adir: Path, profile: str = "witness") -> dict:
    """Run built-in /automate in Agents Window until editor chrome. No Save."""
    if profile not in HANDOFF_PROFILES:
        raise SystemExit(
            f"unknown automate-handoff profile {profile!r}; "
            f"expected one of {sorted(HANDOFF_PROFILES)}"
        )
    profile_cfg = HANDOFF_PROFILES[profile]
    draft_name = profile_cfg["draftName"]
    name_markers = profile_cfg["nameMarkers"]
    session_token = str(profile_cfg.get("sessionToken") or "")
    open_agents_window_via_palette(h, adir)
    activate_cursor()
    h.key("cmd+n")
    time.sleep(1.0)
    h.shot(adir / "screen-03-new-chat.png")
    clear_overlays(h)
    focus_note = focus_agents_composer(h, adir, "screen-03b-composer-focus")
    h.type("/automate")
    time.sleep(1.2)
    h.shot(adir / "screen-04-slash-automate.png")
    slash_ax = read_ax_text(adir, "screen-04-slash-automate.png")
    slash_shows_automate = "automate" in slash_ax.lower() and (
        "Trigger an agent" in slash_ax or "trigger or schedule" in slash_ax.lower()
    )
    # Tab inserts skill chip when slash menu is up. Avoid cmd+Return (Use as Mode).
    h.key("Tab")
    time.sleep(0.3)
    h.shot(adir / "screen-05-after-tab.png")
    h.type(profile_cfg["prompt"])
    time.sleep(0.4)
    h.shot(adir / "screen-06-prompt-ready.png")
    h.key("Return")
    time.sleep(3.0)

    # Benny profiles require strong editor chrome so chat prompt text cannot
    # false-pass via draft-name + weak marker matches in the IDE AX tree.
    # Automations editor often renders in an AXWebArea without page text in AX,
    # so OCR of PNGs is the primary oracle for webview editor chrome.
    strong_only = profile != "witness"
    poll_log: list[dict] = []
    editor_witnessed = False
    draft_name_in_editor = False
    yes_sent_count = 0
    for i in range(30):
        time.sleep(4.0)
        activate_cursor()
        if i in (2, 6, 10, 14, 18, 22, 26):
            dismiss_front_permission_sheet()
        name = f"screen-07-poll-{i}"
        shot_path = adir / f"{name}.png"
        h.shot(shot_path)
        ax_text = read_ax_text(adir, f"{name}.png")
        ocr_text = ""
        # OCR every other poll (Vision is ~1-3s).
        if i % 2 == 0:
            ocr_text = ocr_png(shot_path)
            (adir / f"{name}.ocr.txt").write_text(ocr_text)
        combined = f"{ax_text}\n{ocr_text}"
        looks_ax = ax_looks_like_editor(ax_text, strong_only=strong_only)
        ocr_marks = editor_markers_from_text(ocr_text) if ocr_text else {}
        looks_ocr = bool(
            ocr_marks.get("hasInactive")
            and ocr_marks.get("hasAddTrigger")
            and ocr_marks.get("hasAgentInstructions")
        )
        looks = looks_ax or looks_ocr
        name_in_combined = any(m in combined for m in name_markers)
        # For Benny, name in the chat prompt alone is not enough. Prefer OCR editor
        # frame that also shows the draft name, or AX strong chrome + name.
        name_hit = False
        if looks_ocr and name_in_combined and any(m in ocr_text for m in name_markers):
            name_hit = True
        elif looks_ax and any(m in ax_text for m in name_markers):
            name_hit = True
        if name_hit:
            draft_name_in_editor = True
        poll_log.append(
            {
                "poll": i,
                "editorChromeByAx": looks_ax,
                "editorChromeByOcr": looks_ocr,
                "hasInactive": ("Inactive" in ax_text)
                or bool(ocr_marks.get("hasInactive")),
                "hasAddTrigger": ("Add Trigger" in ax_text)
                or bool(ocr_marks.get("hasAddTrigger")),
                "hasAgentInstructions": ("Agent Instructions" in ax_text)
                or bool(ocr_marks.get("hasAgentInstructions")),
                "draftNameInEditor": name_hit,
                "draftNameSeenAnywhere": name_in_combined,
                "yesSentCount": yes_sent_count,
            }
        )
        if looks and (profile == "witness" or name_hit):
            editor_witnessed = True
            break
        lower = combined.lower()
        readiness = (
            "ready for me to open" in lower
            or "does this look correct" in lower
            or "look correct?" in lower
            or "shall i open" in lower
            or "open the automations editor" in lower
        )
        # Draft approval then editor-open are often two separate questions.
        # Allow up to three yes replies while editor chrome is still absent.
        token_ok = (not session_token) or (session_token in combined)
        if (
            yes_sent_count < 3
            and i in (3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24)
            and readiness
            and (profile == "witness" or (name_in_combined and token_ok))
        ):
            focus_agents_composer(h, adir, f"screen-07-yes-focus-{i}")
            h.type("yes")
            time.sleep(0.3)
            h.key("Return")
            time.sleep(2.0)
            yes_sent_count += 1

    for _ in range(3):
        h.key("Escape")
        time.sleep(0.12)
    activate_cursor()
    final_path = adir / "screen-08-final.png"
    h.shot(final_path)
    final_ax = read_ax_text(adir, "screen-08-final.png")
    final_ocr = ocr_png(final_path)
    (adir / "screen-08-final.png.ocr.txt").write_text(final_ocr)
    final_combined = f"{final_ax}\n{final_ocr}"
    final_looks_ax = ax_looks_like_editor(final_ax, strong_only=strong_only)
    final_ocr_marks = editor_markers_from_text(final_ocr)
    final_looks_ocr = bool(
        final_ocr_marks.get("hasInactive")
        and final_ocr_marks.get("hasAddTrigger")
        and final_ocr_marks.get("hasAgentInstructions")
    )
    final_looks = final_looks_ax or final_looks_ocr
    final_name = False
    if final_looks_ocr and any(m in final_ocr for m in name_markers):
        final_name = True
    elif final_looks_ax and any(m in final_ax for m in name_markers):
        final_name = True
    if final_name:
        draft_name_in_editor = True
    if final_looks and (profile == "witness" or final_name):
        editor_witnessed = True
    agent_said_name = any(m in final_combined for m in name_markers)

    return {
        "probe": "automate-handoff",
        "profile": profile,
        "draftName": draft_name,
        "slashMenuShowedAutomate": slash_shows_automate,
        "automateHandoffWitnessed": editor_witnessed,
        "editorChromeWitnessed": editor_witnessed,
        "draftNameWitnessed": draft_name_in_editor,
        "draftNameSeenInSession": agent_said_name,
        "composerFocus": focus_note,
        "saved": False,
        "activated": False,
        "slack": False,
        "axNote": (
            "Strong AX markers often missing when editor is AXWebArea; "
            "OCR of PNGs used for Inactive/Add Trigger/Agent Instructions/draft name."
        ),
        "pollLog": poll_log,
        "pathsTried": [
            "cmd+shift+p Open Agents Window",
            "cmd+n New Chat",
            "focus chat composer",
            "/automate + Tab skill chip",
            f"send {profile} no-Save prompt",
            "poll AX for Automations editor chrome + draft name",
            "yes replies if draft/readiness asked",
            "dismiss permission sheets that steal focus",
        ],
        "didNot": [
            "press Save",
            "toggle Inactive/Activate",
            "enable Benny",
            "post to Slack",
            "edit ledgers",
            "mint Cloud Agent",
        ],
    }


def probe_neweditor(h: Helper, adir: Path) -> dict:
    """Reach Automations list, then try element_index + keyboard to enter editor. No save."""
    open_agents_chat(h, adir)
    # Do not Escape after Open Automations; Escape dismisses the Automations host.
    open_automations_list(h, adir, "screen-02")
    state = h.shot(adir / "screen-03-automations-list.png")
    tree = ax_json_from_state(state)
    buttons = find_new_automation_buttons(tree)
    if not buttons:
        list_ax = adir / "screen-02-automations-list.png.ax.txt"
        if list_ax.is_file():
            try:
                tree = json.loads(list_ax.read_text())
                buttons = find_new_automation_buttons(tree)
            except json.JSONDecodeError:
                buttons = []
            if buttons:
                open_automations_list(h, adir, "screen-03b")
                state = h.shot(adir / "screen-03c-automations-list.png")
                tree = ax_json_from_state(state)
                buttons = find_new_automation_buttons(tree)
    (adir / "new-automation-buttons.json").write_text(json.dumps(buttons, indent=2) + "\n")

    click_log: list[dict] = []
    editor_witnessed = False
    pending = list(buttons)
    seen_indices: set[str] = set()
    click_i = 0
    while pending:
        btn = pending.pop(0)
        idx = btn["index"]
        if idx in seen_indices:
            continue
        seen_indices.add(idx)
        label = f"screen-04-click-{click_i}-idx-{idx}"
        click_i += 1
        try:
            click_res = h.click_index(idx)
            err_content = ""
            for part in (click_res or {}).get("result", {}).get("content", []) or []:
                if part.get("type") == "text":
                    err_content += part.get("text") or ""
            click_ok = "Error:" not in err_content
            click_err = err_content if not click_ok else None
        except Exception as exc:  # noqa: BLE001 — record helper errors as evidence
            click_ok = False
            click_err = str(exc)
        time.sleep(1.5)
        h.shot(adir / f"{label}.png")
        ax_path = adir / f"{label}.png.ax.txt"
        ax_text = ax_path.read_text() if ax_path.is_file() else ""
        looks = ax_looks_like_editor(ax_text)
        on_list = still_on_automations_list(ax_text)
        click_log.append(
            {
                "index": idx,
                "frame": btn.get("frame"),
                "clickOk": click_ok,
                "clickError": click_err,
                "editorChromeByAx": looks,
                "stillOnList": on_list,
            }
        )
        if looks:
            editor_witnessed = True
            break
        if not on_list and pending:
            open_automations_list(h, adir, f"screen-04b-reopen-{click_i}")
            state = h.shot(adir / f"screen-04c-relist-{click_i}.png")
            tree = ax_json_from_state(state)
            for extra in find_new_automation_buttons(tree):
                if extra["index"] not in seen_indices:
                    pending.append(extra)

    if not editor_witnessed:
        open_automations_list(h, adir, "screen-05")
        h.shot(adir / "screen-05-pre-keyboard.png")
        for _ in range(12):
            h.key("Tab")
            time.sleep(0.15)
        h.shot(adir / "screen-06-after-tabs.png")
        h.key("Return")
        time.sleep(1.5)
        h.shot(adir / "screen-07-after-return.png")
        ax_path = adir / "screen-07-after-return.png.ax.txt"
        ax_text = ax_path.read_text() if ax_path.is_file() else ""
        if ax_looks_like_editor(ax_text):
            editor_witnessed = True
        else:
            h.key("Space")
            time.sleep(1.2)
            h.shot(adir / "screen-08-after-space.png")
            ax_path = adir / "screen-08-after-space.png.ax.txt"
            ax_text = ax_path.read_text() if ax_path.is_file() else ""
            if ax_looks_like_editor(ax_text):
                editor_witnessed = True
            elif not editor_witnessed:
                for _ in range(12):
                    h.key("shift+Tab")
                    time.sleep(0.12)
                h.shot(adir / "screen-08b-after-shift-tabs.png")
                h.key("Return")
                time.sleep(1.5)
                h.shot(adir / "screen-08c-after-shift-return.png")
                ax_path = adir / "screen-08c-after-shift-return.png.ax.txt"
                ax_text = ax_path.read_text() if ax_path.is_file() else ""
                if ax_looks_like_editor(ax_text):
                    editor_witnessed = True

    h.shot(adir / "screen-09-final.png")
    final_ax = adir / "screen-09-final.png.ax.txt"
    final_text = final_ax.read_text() if final_ax.is_file() else ""
    if ax_looks_like_editor(final_text):
        editor_witnessed = True

    return {
        "probe": "automations-new-editor",
        "editorChromeWitnessed": editor_witnessed,
        "newAutomationButtons": buttons,
        "clickLog": click_log,
        "finalStillOnList": still_on_automations_list(final_text),
        "pathsTried": [
            "cmd+n New Chat",
            "cmd+shift+p Open Automations",
            "fresh get_app_state + click element_index New Automation",
            "Tab/Shift+Tab focus cycle + Return/Space",
        ],
        "didNot": [
            "save automation",
            "enable Benny",
            "post to Slack",
            "mint Cloud Agent",
            "edit ledgers",
        ],
    }


def probe_makebot(h: Helper, adir: Path) -> dict:
    open_agents_chat(h, adir)
    h.type("/make-bot-ui")
    time.sleep(1.0)
    h.shot(adir / "screen-02-slash-make-bot-ui.png")
    clear_overlays(h)
    open_automations_list(h, adir, "screen-03")
    clear_overlays(h)
    h.key("cmd+shift+i")
    time.sleep(1.0)
    h.shot(adir / "screen-04-cmd-shift-i.png")
    h.key("cmd+shift+p")
    time.sleep(0.5)
    h.type("Routines")
    time.sleep(0.8)
    h.shot(adir / "screen-05-palette-routines.png")
    clear_overlays(h)
    h.key("cmd+shift+p")
    time.sleep(0.5)
    h.type("update_state")
    time.sleep(0.8)
    h.shot(adir / "screen-06-palette-update-state.png")
    clear_overlays(h)
    h.shot(adir / "screen-07-final.png")
    return {
        "probe": "make-bot-ui-key-server",
        "pathsTried": [
            "cmd+n New Chat",
            "/make-bot-ui slash menu",
            "cmd+shift+p Open Automations",
            "cmd+shift+i",
            "cmd+shift+p Routines",
            "cmd+shift+p update_state",
        ],
        "didNot": [
            "fabricate webhook sender key",
            "claim update_state success without UI proof",
            "mint Cloud Agent",
            "post to Slack",
        ],
    }


def walk_ax_nodes(tree: dict | None):
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


def find_draft_row_targets(tree: dict | None, draft_name: str) -> list[dict]:
    hits: list[dict] = []
    for node in walk_ax_nodes(tree):
        blob = f"{node.get('title') or ''}|{node.get('value') or ''}"
        if draft_name not in blob:
            continue
        hits.append(
            {
                "index": str(node.get("index")) if node.get("index") is not None else None,
                "role": node.get("role"),
                "title": node.get("title"),
                "value": node.get("value"),
                "frame": node.get("frame"),
                "actions": node.get("actions"),
            }
        )
    return hits


def system_events_axpress_button_containing(substr: str) -> dict:
    """Prefer System Events AXPress over helper xy (xy can fail frontmost checks)."""
    script = (
        'tell application "System Events"\n'
        '  tell process "Cursor"\n'
        "    set frontmost to true\n"
        "    set hit to false\n"
        "    repeat with w in windows\n"
        "      try\n"
        "        set btns to entire contents of w\n"
        "        repeat with el in btns\n"
        "          try\n"
        "            set t to (name of el as text)\n"
        f'            if t contains "{substr}" then\n'
        "              try\n"
        "                perform action \"AXPress\" of el\n"
        "                set hit to true\n"
        "                exit repeat\n"
        "              end try\n"
        "            end if\n"
        "          end try\n"
        "        end repeat\n"
        "      end try\n"
        "      if hit then exit repeat\n"
        "    end repeat\n"
        "    return hit\n"
        "  end tell\n"
        "end tell"
    )
    proc = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        check=False,
        timeout=45,
    )
    return {
        "via": "system-events-axpress",
        "ok": (proc.stdout or "").strip().lower() == "true",
        "stdout": (proc.stdout or "").strip()[:200],
        "stderr": (proc.stderr or "").strip()[:200],
        "returncode": proc.returncode,
    }


def discard_stuck_untitled(h: Helper, adir: Path) -> dict:
    """Close stuck Untitled editor chrome without Save/Activate."""
    note: dict = {"attempted": False, "dismissed": False, "actions": []}
    ax = read_ax_text(adir, "screen-03-automations-list.png")
    ocr = ocr_png(adir / "screen-03-automations-list.png")
    stuck = (
        ("Untitled" in ax or "Untitled" in ocr)
        and ax_looks_like_editor(ax + "\n" + ocr, strong_only=False)
        and "Add Trigger" in (ax + ocr)
    )
    if not stuck:
        note["stuckUntitledEditor"] = False
        return note
    note["stuckUntitledEditor"] = True
    note["attempted"] = True
    # Escape first (no Save). Then System Events Discard if a modal appears.
    h.key("Escape")
    time.sleep(0.6)
    note["actions"].append("escape")
    h.shot(adir / "screen-03b-after-escape.png")
    se = system_events_axpress_button_containing("Discard")
    note["actions"].append(se)
    if se.get("ok"):
        note["dismissed"] = True
        time.sleep(0.8)
        h.shot(adir / "screen-03c-after-discard.png")
        return note
    # Narrow Discard via element_index if present.
    state = h.get_state()
    tree = ax_json_from_state(state)
    for node in walk_ax_nodes(tree):
        title = str(node.get("title") or "")
        if title.strip() != "Discard" or node.get("role") != "AXButton":
            continue
        fr = node.get("frame") or {}
        if float(fr.get("width") or 0) > 400:
            continue
        if node.get("index") is None:
            continue
        try:
            h.click_index(str(node["index"]))
            note["dismissed"] = True
            note["actions"].append({"via": "element_index", "index": str(node["index"])})
            time.sleep(0.8)
            h.shot(adir / "screen-03d-after-index-discard.png")
            return note
        except Exception as exc:  # noqa: BLE001
            note["actions"].append({"via": "element_index", "error": str(exc)})
    return note


def editor_title_oracle(ax_text: str, ocr_text: str, draft_name: str) -> dict:
    blob = f"{ax_text}\n{ocr_text}"
    marks = editor_markers_from_text(blob)
    title_ok = (
        draft_name in blob
        and (
            f"Automations > {draft_name}" in ocr_text
            or f"Edit automation name: {draft_name}" in blob
            or (f'value": "{draft_name}"' in ax_text)
            or (f'"{draft_name}"' in ax_text and "Inactive" in blob)
        )
    )
    chrome_ok = bool(
        marks["hasInactive"]
        and marks["hasAgentInstructions"]
        and (marks["hasAddTrigger"] or "Add Tool or MCP" in blob)
    )
    return {
        "draftName": draft_name,
        "titleOk": title_ok,
        "chromeOk": chrome_ok,
        "editorTitleWitnessed": title_ok and chrome_ok,
        "markers": marks,
        "ocrHasBreadcrumb": f"Automations > {draft_name}" in ocr_text,
        "axHasAddTrigger": "Add Trigger" in ax_text,
    }


def probe_open_draft(h: Helper, adir: Path, draft_name: str = "benny-triage") -> dict:
    """Open existing Inactive draft editor chrome by list row. No Save/Activate."""
    activate_cursor()
    open_agents_window_via_palette(h, adir)
    activate_cursor()
    open_automations_list(h, adir, "screen-03")
    discard_note = discard_stuck_untitled(h, adir)
    if discard_note.get("dismissed") or discard_note.get("attempted"):
        open_automations_list(h, adir, "screen-04-relist")
    state = h.shot(adir / "screen-05-list-for-row.png")
    tree = ax_json_from_state(state)
    hits = find_draft_row_targets(tree, draft_name)
    (adir / "draft-row-hits.json").write_text(json.dumps(hits, indent=2) + "\n")
    click_log: list[dict] = []
    clicked = False
    # Prefer AXButton row containing the draft name (list row), avoid wide feed.
    candidates = [
        c
        for c in hits
        if c.get("role") == "AXButton" and c.get("index") and draft_name in f"{c.get('title') or ''}|{c.get('value') or ''}"
    ]
    if not candidates:
        candidates = [c for c in hits if c.get("index")]
    narrow = [
        c
        for c in candidates
        if c.get("frame") and float((c.get("frame") or {}).get("width") or 9999) < 900
    ]
    ordered = narrow or candidates
    for cand in ordered[:4]:
        idx = cand["index"]
        try:
            res = h.click_index(idx)
            err = ""
            for part in (res or {}).get("result", {}).get("content", []) or []:
                if part.get("type") == "text":
                    err += part.get("text") or ""
            ok = "Error:" not in err
            click_log.append({"via": "element_index", "index": idx, "ok": ok, "error": err[:300] or None})
            if ok:
                clicked = True
                break
        except Exception as exc:  # noqa: BLE001
            click_log.append({"via": "element_index", "index": idx, "ok": False, "error": str(exc)})
    if not clicked:
        se = system_events_axpress_button_containing(draft_name)
        click_log.append(se)
        clicked = bool(se.get("ok"))
    time.sleep(2.0)
    h.shot(adir / "screen-06-after-row-click.png")
    # Dismiss command palette if it steals the frame.
    clear_overlays(h)
    h.shot(adir / "screen-07-final.png")
    final_ax = read_ax_text(adir, "screen-07-final.png")
    final_ocr = ocr_png(adir / "screen-07-final.png")
    (adir / "screen-07-final.png.ocr.txt").write_text(final_ocr)
    oracle = editor_title_oracle(final_ax, final_ocr, draft_name)
    return {
        "probe": "open-draft-editor-title",
        "draftName": draft_name,
        "discardUntitled": discard_note,
        "draftRowHits": len(hits),
        "clickLog": click_log,
        "clicked": clicked,
        "saved": False,
        "activated": False,
        "slack": False,
        **oracle,
        "pathsTried": [
            "cmd+shift+p Open Agents Window",
            "cmd+shift+p Open Automations",
            "discard stuck Untitled via Escape/Discard (no Save)",
            "element_index click draft row",
            "System Events AXPress fallback on draft name",
            "OCR+AX editor title oracle",
        ],
        "didNot": [
            "press Save",
            "toggle Inactive/Activate",
            "enable Benny",
            "post to Slack",
            "edit ledgers",
            "helper xy click (prefer element_index / System Events)",
        ],
    }


def main() -> int:
    modes = {"benny", "makebot", "neweditor", "automate-handoff", "open-draft"}
    if len(sys.argv) < 2 or sys.argv[1] not in modes:
        raise SystemExit(
            "usage: capture-automations-desktop-agents-window.py "
            "benny|makebot|neweditor|automate-handoff|open-draft "
            "[witness|benny-triage|benny-reproduce|draft-name]"
        )
    mode = sys.argv[1]
    handoff_profile = "witness"
    open_draft_name = "benny-triage"
    if mode == "automate-handoff":
        if len(sys.argv) > 3:
            raise SystemExit(
                "usage: capture-automations-desktop-agents-window.py "
                "automate-handoff [witness|benny-triage|benny-reproduce|webhook-witness]"
            )
        if len(sys.argv) == 3:
            handoff_profile = sys.argv[2]
            if handoff_profile not in HANDOFF_PROFILES:
                raise SystemExit(
                    f"unknown profile {handoff_profile!r}; "
                    f"expected one of {sorted(HANDOFF_PROFILES)}"
                )
    elif mode == "open-draft":
        if len(sys.argv) > 3:
            raise SystemExit(
                "usage: capture-automations-desktop-agents-window.py "
                "open-draft [benny-triage|benny-reproduce|<draft-name>]"
            )
        if len(sys.argv) == 3:
            open_draft_name = sys.argv[2]
    elif len(sys.argv) != 2:
        raise SystemExit(
            "usage: capture-automations-desktop-agents-window.py "
            "benny|makebot|neweditor|automate-handoff|open-draft "
            "[witness|benny-triage|benny-reproduce]"
        )
    if not HELPER.is_file():
        raise SystemExit(f"missing helper: {HELPER}")
    attempt = str(uuid.uuid4())
    if mode in {"benny", "neweditor", "automate-handoff", "open-draft"}:
        evid_root = ROOT / "evidence" / "setup-benny" / "creation-boundary" / "agents-window"
    else:
        evid_root = ROOT / "evidence" / "make-bot-ui" / "agents-window"
    adir = evid_root / attempt
    adir.mkdir(parents=True, exist_ok=True)
    # Record desktop readiness before drive (screen lock blocks frontmost).
    ready = subprocess.run(
        [
            str(HELPER),
            "desktop-share-status",
            "--mode",
            "view_and_control",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    (adir / "00-desktop-share-status.json").write_text((ready.stdout or ready.stderr or "") + "\n")
    h = Helper()
    try:
        subprocess.run(["osascript", "-e", 'tell application "Cursor" to activate'], check=False)
        time.sleep(0.5)
        h.shot(adir / "screen-00-baseline.png")
        if mode == "benny":
            notes = probe_benny(h, adir)
        elif mode == "neweditor":
            notes = probe_neweditor(h, adir)
        elif mode == "automate-handoff":
            notes = probe_automate_handoff(h, adir, profile=handoff_profile)
        elif mode == "open-draft":
            notes = probe_open_draft(h, adir, draft_name=open_draft_name)
        else:
            notes = probe_makebot(h, adir)
        meta = {
            "attemptId": attempt,
            "mode": mode,
            "method": "agent-helper MCP keyboard/click drive of Cursor Agents Window",
            "evidenceDir": str(adir),
            **notes,
        }
        (adir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(json.dumps(meta, indent=2))
        return 0
    finally:
        h.close()


if __name__ == "__main__":
    raise SystemExit(main())
