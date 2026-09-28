/**
 * ComposerEditor: pi's CustomEditor dressed in the reference CLI's composer chrome.
 * Research: source-composer.md §2 (half-block rows "▄"/"▀" in the composer
 * background, "→ " glyph dim when empty, placeholder with inverse first
 * character), §8 (shift+tab mode cycle), §9 (vim states).
 *
 * pi adaptations (docs/parity.md): registerShortcut cannot own shift+tab
 * (runner.js reserved list), so the mode cycle lives here where the editor
 * owns its keys. The full composer render (glyph column, inline token
 * styling, 6-line viewport) stays pi's editor when text is present; the
 * empty state is fully the reference CLI-rendered.
 */

import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

type EditorCtorArgs = ConstructorParameters<typeof CustomEditor>;

import { COMPOSER_PLACEHOLDERS } from "../constants.ts";
import { getTokens, paletteBg } from "../palette.ts";
import { nextMode, type TuiSessionState } from "../state.ts";

export interface ComposerEditorHooks {
	readonly theme: { name?: string; getColorMode(): "truecolor" | "256color" };
	readonly state: TuiSessionState;
	/** True when the session already has messages, for the follow-up placeholder. */
	readonly hasConversation: () => boolean;
}

export function composerPlaceholder(hasConversation: boolean): string {
	return hasConversation ? COMPOSER_PLACEHOLDERS.followUp : COMPOSER_PLACEHOLDERS.emptyChat;
}

export function composerGlyph(state: TuiSessionState): { glyph: string; dim: boolean } {
	const active = state.mode !== "default";
	return { glyph: "→", dim: !active };
}

export class ComposerEditor extends CustomEditor {
	constructor(
		tui: EditorCtorArgs[0],
		theme: EditorCtorArgs[1],
		keybindings: EditorCtorArgs[2],
		private readonly hooks: ComposerEditorHooks,
	) {
		super(tui, theme, keybindings);
	}

	/** Shift+Tab cycles the the reference CLI mode; the runner reserves it for shortcuts. */
	handleInput(data: string): void {
		if (data === "\x1b[Z") {
			this.hooks.state.mode = nextMode(this.hooks.state.mode);
			return;
		}
		if (this.hooks.state.vim === "normal") {
			if (data === "i" || data === "a") {
				this.hooks.state.vim = "insert";
				return;
			}
			const map: Record<string, string> = { h: "\x1b[D", j: "\x1b[B", k: "\x1b[A", l: "\x1b[C" };
			const seq = map[data];
			if (seq) {
				super.handleInput(seq);
				return;
			}
			if (data.length === 1 && data.charCodeAt(0) >= 32) return;
			super.handleInput(data);
			return;
		}
		if (data === "\x1b" && this.getText().length === 0) {
			this.hooks.state.vim = "normal";
			return;
		}
		super.handleInput(data);
	}

	renderTopBorder(width: number, hiddenLineCount: number): string {
		if (hiddenLineCount > 0) return super.renderTopBorder(width, hiddenLineCount);
		const fallback = getTokens(this.hooks.theme.name).composerBg.fallback;
		return paletteBg(fallback, this.hooks.theme.getColorMode(), "▄".repeat(Math.max(1, width)));
	}

	renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (hiddenLineCount > 0) return super.renderBottomBorder(width, hiddenLineCount);
		const fallback = getTokens(this.hooks.theme.name).composerBg.fallback;
		return paletteBg(fallback, this.hooks.theme.getColorMode(), "▀".repeat(Math.max(1, width)));
	}

	render(width: number): string[] {
		if (this.getText().length > 0) return super.render(width);
		const rows = super.render(width);
		if (rows.length < 3) return rows;
		const placeholder = composerPlaceholder(this.hooks.hasConversation());
		const first = placeholder.slice(0, 1);
		const rest = placeholder.slice(1);
		const glyph = composerGlyph(this.hooks.state);
		const content = ` ${glyph.glyph} ${CURSOR_MARKER}\x1b[7m${first}\x1b[0m\x1b[2m${rest}\x1b[0m `;
		const pad = width - 1 - placeholder.length - 4;
		const padded = pad > 0 ? content + " ".repeat(pad) : content;
		return [rows[0]!, padded, rows[rows.length - 1]!];
	}
}
