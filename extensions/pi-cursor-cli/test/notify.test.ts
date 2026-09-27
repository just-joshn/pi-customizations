import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectTerminal, FocusGate, FOCUS_IN, FOCUS_OUT, notificationSequence } from "../src/notify/osc.ts";

describe("notifications", () => {
	it("detects the terminal from the environment", () => {
		assert.equal(detectTerminal({ TERM_PROGRAM: "iTerm.app" }), "iterm2");
		assert.equal(detectTerminal({ TERM_PROGRAM: "Ghostty" }), "ghostty");
		assert.equal(detectTerminal({ TERM_PROGRAM: "WarpTerminal" }), "warp");
		assert.equal(detectTerminal({ TERM_PROGRAM: "vscode" }), "vscode");
		assert.equal(detectTerminal({ KITTY_WINDOW_ID: "1" }), "kitty");
		assert.equal(detectTerminal({ TERM_PROGRAM: "Apple_Terminal" }), "apple");
		assert.equal(detectTerminal({}), "other");
	});

	it("emits the per-terminal escape sequences", () => {
		assert.equal(notificationSequence("iterm2", "Cursor", "hello", false), "\x1b]9;hello\x07");
		assert.equal(notificationSequence("ghostty", "Cursor", "hello", false), "\x1b]777;notify;Cursor;hello\x07");
		const kitty = notificationSequence("kitty", "Cursor", "hello", false);
		assert.ok(kitty.startsWith("\x1b]99;i=1:d=0;"), kitty);
		assert.ok(kitty.includes(Buffer.from("hello").toString("base64")));
		assert.equal(notificationSequence("apple", "Cursor", "hello", false), "\x07");
		assert.equal(notificationSequence("other", "Cursor", "hello", false), "");
	});

	it("wraps escapes in DCS passthrough under tmux", () => {
		const wrapped = notificationSequence("iterm2", "Cursor", "hi", true);
		assert.ok(wrapped.startsWith("\x1bPtmux;"));
		assert.ok(wrapped.includes("\x1b\x1b]9;"));
		assert.ok(wrapped.endsWith("\x1b\\"));
	});

	it("focus gating: notify when unfocused, suppress when focused after a report; tmux only gates after a report", () => {
		const gate = new FocusGate(false);
		assert.equal(gate.shouldNotify(), true, "no report yet: assume unfocused");
		gate.handleInput(FOCUS_IN);
		assert.equal(gate.shouldNotify(), false, "focused after report");
		gate.handleInput(FOCUS_OUT);
		assert.equal(gate.shouldNotify(), true, "unfocused after report");

		const tmuxGate = new FocusGate(true);
		assert.equal(tmuxGate.shouldNotify(), true, "tmux ignores focus before any report");
		tmuxGate.handleInput(FOCUS_IN);
		assert.equal(tmuxGate.shouldNotify(), false, "tmux gates after a report");
	});
});
