import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composerGlyph, composerPlaceholder, ComposerEditor } from "../src/editor/composer-editor.ts";
import { createSessionState, nextMode } from "../src/state.ts";

process.env.FORCE_COLOR = "3";

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
		assert.equal(composerPlaceholder(false), "Plan, search, build anything");
		assert.equal(composerPlaceholder(true), "Add a follow-up");
	});

	it("glyph is dim by default and active in a mode", () => {
		const state = createSessionState();
		assert.deepEqual(composerGlyph(state), { glyph: "→", dim: true });
		state.mode = "plan";
		assert.deepEqual(composerGlyph(state), { glyph: "→", dim: false });
	});

	it("shift+tab cycles modes and is not passed to pi", () => {
		const { editor, state, requests } = editorHarness();
		editor.handleInput("\x1b[Z");
		assert.equal(state.mode, "plan");
		editor.handleInput("\x1b[Z");
		assert.equal(state.mode, "debug");
		editor.handleInput("\x1b[Z");
		assert.equal(state.mode, "ask");
		editor.handleInput("\x1b[Z");
		assert.equal(state.mode, "default");
		assert.ok(requests.length === 0, "mode cycle itself does not force a render");
	});

	it("escape on empty input enters vim normal mode; i returns to insert", () => {
		const { editor, state } = editorHarness();
		editor.handleInput("\x1b");
		assert.equal(state.vim, "normal");
		editor.handleInput("i");
		assert.equal(state.vim, "insert");
	});

	it("normal mode swallows printable keys and maps hjkl", () => {
		const { editor, state } = editorHarness();
		editor.handleInput("\x1b");
		state.vim = "normal";
		editor.setText("hello");
		editor.handleInput("x");
		assert.equal(editor.getText(), "hello", "printable keys do nothing in normal mode");
		editor.handleInput("h");
		assert.equal(state.vim, "normal");
		editor.handleInput("i");
		assert.equal(state.vim, "insert");
	});

	it("empty-state render draws the half-block frame and inverse placeholder", () => {
		const { editor } = editorHarness();
		const rows = editor.render(60);
		assert.equal(rows.length, 3);
		assert.match(rows[0]!, /▄{60}/);
		assert.match(rows[2]!, /▀{60}/);
		const mid = strip(rows[1]!).split(CURSOR_MARKER).join("");
		assert.ok(mid.includes("→ Plan, search, build anything"), `mid: ${mid}`);
		assert.ok(rows[1]!.includes("\x1b[7mP\x1b[0m"), "first placeholder character is inverse");
	});

	it("mode cycle order matches the the reference CLI ring", () => {
		const state = createSessionState();
		assert.equal(nextMode("default"), "plan");
		assert.equal(nextMode("plan"), "debug");
		assert.equal(nextMode("debug"), "ask");
		assert.equal(nextMode("ask"), "default");
	});
});
