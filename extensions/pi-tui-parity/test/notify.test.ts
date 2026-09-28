import { describe, it, expect } from "vitest";
import { detectTerminal, FocusGate, FOCUS_IN, FOCUS_OUT, notificationSequence } from "../src/notify/osc.ts";

describe("notifications", () => {
	it("detects the terminal from the environment", () => {
		expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm2");
		expect(detectTerminal({ TERM_PROGRAM: "Ghostty" })).toBe("ghostty");
		expect(detectTerminal({ TERM_PROGRAM: "WarpTerminal" })).toBe("warp");
		expect(detectTerminal({ TERM_PROGRAM: "vscode" })).toBe("vscode");
		expect(detectTerminal({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
		expect(detectTerminal({ TERM_PROGRAM: "Apple_Terminal" })).toBe("apple");
		expect(detectTerminal({})).toBe("other");
	});

	it("emits the per-terminal escape sequences", () => {
		expect(notificationSequence("iterm2", "the reference CLI", "hello", false)).toBe("\x1b]9;hello\x07");
		expect(notificationSequence("ghostty", "the reference CLI", "hello", false)).toBe("\x1b]777;notify;the reference CLI;hello\x07");
		const kitty = notificationSequence("kitty", "the reference CLI", "hello", false);
		expect(kitty).toBe("\x1b]99;i=1:d=0;dGhlIHJlZmVyZW5jZSBDTEk=,aGVsbG8=\x07");
		expect(notificationSequence("apple", "the reference CLI", "hello", false)).toBe("\x07");
		expect(notificationSequence("other", "the reference CLI", "hello", false)).toBe("");
	});

	it("wraps escapes in DCS passthrough under tmux", () => {
		const wrapped = notificationSequence("iterm2", "the reference CLI", "hi", true);
		expect(wrapped.startsWith("\x1bPtmux;")).toBe(true);
		expect(wrapped.includes("\x1b\x1b]9;")).toBe(true);
		expect(wrapped.endsWith("\x1b\\")).toBe(true);
	});

	it("notifies while unfocused and stays quiet after a focus report", () => {
		const gate = new FocusGate(false);
		expect(gate.shouldNotify()).toBe(true);
		gate.handleInput(FOCUS_IN);
		expect(gate.shouldNotify()).toBe(false);
		gate.handleInput(FOCUS_OUT);
		expect(gate.shouldNotify()).toBe(true);
	});
});
