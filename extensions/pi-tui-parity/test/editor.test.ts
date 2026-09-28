import { describe, it, expect } from "vitest";
import { composerGlyph, composerPlaceholder, ComposerEditor } from "../src/editor/composer-editor.ts";
import { createSessionState, nextMode } from "../src/state.ts";


const { KeybindingsManager, TUI_KEYBINDINGS, CURSOR_MARKER } = await import("@earendil-works/pi-tui");

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

function editorHarness() {
	const state = createSessionState();
	const requests: string[] = [];
	const editor = new ComposerEditor(
		{ requestRender: () => requests.push("r"), terminal: { rows: 40, columns: 120 } } as never,
		{ borderColor: (s: string) => s } as never,
		new KeybindingsManager(TUI_KEYBINDINGS as never) as never,
		{
			theme: { name: "tui-dark", getColorMode: () => "truecolor" as const },
			state,
			hasConversation: () => false,
		},
	);
	return { editor, state, requests };
}

describe("composer editor", () => {
	it("placeholders follow the conversation state", () => {
		expect(composerPlaceholder(false)).toBe("Plan, search, build anything");
		expect(composerPlaceholder(true)).toBe("Add a follow-up");
	});

	it("glyph is dim by default and active in a mode", () => {
		const state = createSessionState();
		expect(composerGlyph(state)).toEqual({ glyph: "→", dim: true });
		state.mode = "plan";
		expect(composerGlyph(state)).toEqual({ glyph: "→", dim: false });
	});

	it("shift+tab cycles modes and is not passed to pi", () => {
		const { editor, state, requests } = editorHarness();
		editor.handleInput("\x1b[Z");
		expect(state.mode).toBe("plan");
		editor.handleInput("\x1b[Z");
		expect(state.mode).toBe("debug");
		editor.handleInput("\x1b[Z");
		expect(state.mode).toBe("ask");
		editor.handleInput("\x1b[Z");
		expect(state.mode).toBe("default");
		expect(requests.length).toBe(0);
	});

	it("escape enters vim normal mode only for empty input", () => {
		const { editor, state } = editorHarness();
		editor.handleInput("\x1b");
		expect(state.vim).toBe("normal");
		editor.handleInput("i");
		expect(state.vim).toBe("insert");

		const typed = editorHarness();
		typed.editor.setText("hello");
		typed.editor.handleInput("\x1b");
		expect(typed.state.vim).toBe("insert");
	});

	it("normal mode swallows printable keys and maps hjkl", () => {
		const { editor, state } = editorHarness();
		editor.handleInput("\x1b");
		editor.setText("hello");
		editor.handleInput("x");
		expect(editor.getText()).toBe("hello");
		editor.handleInput("h");
		editor.handleInput("i");
		editor.handleInput("I");
		expect(editor.getText()).toBe("hellIo");
		expect(state.vim).toBe("insert");
	});

	it("empty-state render draws the half-block frame and inverse placeholder", () => {
		const { editor } = editorHarness();
		const rows = editor.render(60);
		expect(rows.length).toBe(3);
		expect(rows[0]!).toMatch(/▄{60}/);
		expect(rows[2]!).toMatch(/▀{60}/);
		const mid = strip(rows[1]!).split(CURSOR_MARKER).join("");
		expect(mid.includes("→ Plan, search, build anything")).toBe(true);
		expect(rows[1]!.includes("\x1b[7mP\x1b[0m")).toBe(true);
	});

	it("mode cycle order matches the the reference CLI ring", () => {
		const state = createSessionState();
		expect(nextMode("default")).toBe("plan");
		expect(nextMode("plan")).toBe("debug");
		expect(nextMode("debug")).toBe("ask");
		expect(nextMode("ask")).toBe("default");
	});
});
