#!/usr/bin/env python3
"""Probe Automations editor Add Trigger / Tools for webhook + secret-request.

Witness only. Does not Save, Activate, or invent update_state.
Never prints or stores sender keys.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time
import uuid
from pathlib import Path

HELPER = Path.home() / ".cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper"
ROOT = Path(__file__).resolve().parents[2]
URL = "https://cursor.com/automations/new"
APP = "Google Chrome"

WEBHOOK_MARKERS = (
    "webhook",
    "Webhook",
    "HTTP",
    "http trigger",
    "sender key",
    "secret-request",
    "secret request",
    "update_state",
)
TRIGGER_LABEL_RE = re.compile(
    r"(schedule|cron|slack|github|linear|webhook|http|email|timer|manual|pull request|pr |issue)",
    re.I,
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
                "clientInfo": {"name": "probe-trigger-picker", "version": "1"},
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


def node_label(node: dict) -> str:
    parts = [
        str(node.get("title") or "").strip(),
        str(node.get("description") or "").strip(),
        str(node.get("value") or "").strip(),
    ]
    return " | ".join(p for p in parts if p)


def find_by_title(tree: dict | None, title: str, roles: set[str] | None = None) -> list[dict]:
    hits: list[dict] = []
    for node in walk_nodes(tree):
        if str(node.get("title") or "").strip() != title:
            continue
        if roles and node.get("role") not in roles:
            continue
        hits.append(
            {
                "index": str(node.get("index")),
                "role": node.get("role"),
                "title": node.get("title"),
                "description": node.get("description"),
                "value": node.get("value"),
                "actions": node.get("actions"),
                "frame": node.get("frame"),
                "enabled": node.get("enabled"),
            }
        )
    return hits


def collect_visible_labels(tree: dict | None) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for node in walk_nodes(tree):
        role = node.get("role")
        if role not in {
            "AXStaticText",
            "AXButton",
            "AXMenuItem",
            "AXComboBox",
            "AXPopUpButton",
            "AXRadioButton",
            "AXCheckBox",
            "AXLink",
            "AXHeading",
        }:
            continue
        label = node_label(node)
        if not label or label in seen:
            continue
        seen.add(label)
        labels.append(label)
    return labels


def extract_trigger_candidates(labels: list[str]) -> list[str]:
    out: list[str] = []
    for label in labels:
        if TRIGGER_LABEL_RE.search(label) or any(m.lower() in label.lower() for m in WEBHOOK_MARKERS):
            out.append(label)
    return out


def marker_hits(text: str) -> dict[str, bool]:
    lower = text.lower()
    return {
        "webhook": "webhook" in lower,
        "http": bool(re.search(r"\bhttp\b", lower)),
        "senderKey": "sender key" in lower,
        "secretRequest": "secret-request" in lower or "secret request" in lower,
        "updateState": "update_state" in lower,
        "addTrigger": "add trigger" in lower,
        "inactive": "inactive" in lower,
        "agentInstructions": "agent instructions" in lower,
        "tools": "tools" in lower,
        "memories": "memories" in lower,
        "save": '"Save"' in text or "title\":\"Save\"" in text or "\nSave\n" in text,
    }


def ensure_editor(h: Helper) -> None:
    h.key("cmd+l")
    time.sleep(0.3)
    h.key("cmd+a")
    time.sleep(0.1)
    h.type(URL)
    time.sleep(0.2)
    h.key("Return")
    time.sleep(3.5)


def click_first(h: Helper, hits: list[dict], log: list[dict], label: str) -> bool:
    for hit in hits[:3]:
        idx = hit.get("index")
        center = frame_center(hit.get("frame"))
        entry: dict = {"target": label, "hit": hit}
        ok = False
        err = None
        method = None
        if idx and idx != "None":
            method = "element_index"
            try:
                h.click_index(idx)
                ok = True
            except Exception as exc:  # noqa: BLE001
                err = str(exc)
        if not ok and center:
            method = "xy"
            try:
                h.click_xy(center[0], center[1])
                ok = True
                err = None
            except Exception as exc:  # noqa: BLE001
                err = str(exc)
        entry.update({"method": method, "clickOk": ok, "clickError": err})
        log.append(entry)
        if ok:
            time.sleep(1.2)
            return True
    return False


def main() -> int:
    attempt_id = str(uuid.uuid4())
    research = ROOT / "research" / "make-bot-automations-editor-001"
    evidence = ROOT / "evidence" / "make-bot-ui" / "automations-editor" / attempt_id
    research.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)

    click_log: list[dict] = []
    h = Helper()
    try:
        ensure_editor(h)
        state0 = h.shot(evidence / "01-editor-open.png")
        tree0 = ax_json_from_state(state0)
        ax0 = (evidence / "01-editor-open.png.ax.txt").read_text()
        markers0 = marker_hits(ax0)
        labels0 = collect_visible_labels(tree0)
        add_trigger = find_by_title(
            tree0, "Add Trigger", {"AXComboBox", "AXButton", "AXPopUpButton", "AXGroup"}
        )
        add_tool = find_by_title(
            tree0, "Add Tool or MCP", {"AXPopUpButton", "AXButton", "AXComboBox", "AXGroup"}
        )
        (evidence / "01-labels.json").write_text(json.dumps(labels0, indent=2) + "\n")
        (evidence / "01-add-trigger-hits.json").write_text(json.dumps(add_trigger, indent=2) + "\n")
        (evidence / "01-add-tool-hits.json").write_text(json.dumps(add_tool, indent=2) + "\n")

        opened_trigger = click_first(h, add_trigger, click_log, "Add Trigger")
        state1 = h.shot(evidence / "02-trigger-picker.png")
        tree1 = ax_json_from_state(state1)
        ax1 = (evidence / "02-trigger-picker.png.ax.txt").read_text()
        labels1 = collect_visible_labels(tree1)
        trigger_cands = extract_trigger_candidates(labels1)
        (evidence / "02-labels.json").write_text(json.dumps(labels1, indent=2) + "\n")
        (evidence / "02-trigger-candidates.json").write_text(
            json.dumps(trigger_cands, indent=2) + "\n"
        )

        # Type webhook into open picker if it looks like a searchable combo.
        typed_webhook = False
        if opened_trigger:
            try:
                h.type("webhook")
                typed_webhook = True
                time.sleep(1.0)
            except Exception as exc:  # noqa: BLE001
                click_log.append({"target": "type webhook", "clickOk": False, "clickError": str(exc)})
        state2 = h.shot(evidence / "03-trigger-search-webhook.png")
        tree2 = ax_json_from_state(state2)
        ax2 = (evidence / "03-trigger-search-webhook.png.ax.txt").read_text()
        labels2 = collect_visible_labels(tree2)
        search_cands = extract_trigger_candidates(labels2)
        (evidence / "03-labels.json").write_text(json.dumps(labels2, indent=2) + "\n")
        (evidence / "03-search-candidates.json").write_text(
            json.dumps(search_cands, indent=2) + "\n"
        )

        # Dismiss picker, then open Tools.
        try:
            h.key("Escape")
            time.sleep(0.5)
        except Exception as exc:  # noqa: BLE001
            click_log.append({"target": "Escape dismiss", "clickOk": False, "clickError": str(exc)})

        state3 = h.shot(evidence / "04-after-escape.png")
        tree3 = ax_json_from_state(state3)
        add_tool2 = find_by_title(
            tree3, "Add Tool or MCP", {"AXPopUpButton", "AXButton", "AXComboBox", "AXGroup"}
        )
        if not add_tool2:
            add_tool2 = add_tool
        opened_tools = click_first(h, add_tool2, click_log, "Add Tool or MCP")
        state4 = h.shot(evidence / "05-tools-picker.png")
        tree4 = ax_json_from_state(state4)
        ax4 = (evidence / "05-tools-picker.png.ax.txt").read_text()
        labels4 = collect_visible_labels(tree4)
        (evidence / "05-labels.json").write_text(json.dumps(labels4, indent=2) + "\n")

        typed_secret = False
        if opened_tools:
            try:
                h.type("secret")
                typed_secret = True
                time.sleep(1.0)
            except Exception as exc:  # noqa: BLE001
                click_log.append({"target": "type secret", "clickOk": False, "clickError": str(exc)})
        state5 = h.shot(evidence / "06-tools-search-secret.png")
        tree5 = ax_json_from_state(state5)
        ax5 = (evidence / "06-tools-search-secret.png.ax.txt").read_text()
        labels5 = collect_visible_labels(tree5)
        (evidence / "06-labels.json").write_text(json.dumps(labels5, indent=2) + "\n")

        try:
            h.key("Escape")
            time.sleep(0.4)
        except Exception:
            pass
        h.shot(evidence / "07-final.png")

        all_text = "\n".join([ax0, ax1, ax2, ax4, ax5])
        all_labels = sorted(set(labels0 + labels1 + labels2 + labels4 + labels5))
        webhook_in_picker = any("webhook" in (c or "").lower() for c in trigger_cands + search_cands)
        secret_in_tools = any(
            ("secret" in (c or "").lower() or "credential" in (c or "").lower())
            for c in labels4 + labels5
        )

        disposition = {
            "attemptId": attempt_id,
            "url": URL,
            "editorChromeWitnessed": bool(
                markers0.get("addTrigger") and markers0.get("agentInstructions")
            ),
            "savePressed": False,
            "activatePressed": False,
            "updateStateInvented": False,
            "openedTriggerPicker": opened_trigger,
            "typedWebhookInPicker": typed_webhook,
            "openedToolsPicker": opened_tools,
            "typedSecretInTools": typed_secret,
            "webhookTriggerSeen": webhook_in_picker or marker_hits(all_text).get("webhook", False),
            "secretRequestPathSeen": secret_in_tools
            or marker_hits(all_text).get("secretRequest", False),
            "senderKeySeenInArtifacts": False,
            "markersEditorOpen": markers0,
            "markersTriggerPicker": marker_hits(ax1),
            "markersTriggerSearch": marker_hits(ax2),
            "markersTools": marker_hits(ax4),
            "markersToolsSearch": marker_hits(ax5),
            "triggerCandidates": trigger_cands,
            "triggerSearchCandidates": search_cands,
            "clickLog": click_log,
            "allLabelsSample": all_labels[:200],
            "evidenceDir": str(evidence.relative_to(ROOT.parent)),
        }
        (evidence / "disposition.json").write_text(json.dumps(disposition, indent=2) + "\n")
        (research / "disposition.json").write_text(json.dumps(disposition, indent=2) + "\n")
        (research / "latest-attempt-id.txt").write_text(attempt_id + "\n")
        print(json.dumps({"attemptId": attempt_id, "disposition": disposition}, indent=2))
        return 0
    finally:
        h.close()


if __name__ == "__main__":
    raise SystemExit(main())
