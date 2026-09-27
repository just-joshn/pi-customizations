/**
 * Session-scoped Reference mode state shared by the editor, footer, decision gate,
 * and commands. Reference sources: source-composer.md §3 (headline), §8 (modes),
 * §9 (vim indicators); source-screens.md §1 (/run-everything, /auto-review).
 */

import type { HexColor } from "./palette.ts";

export type ReferenceMode = "default" | "plan" | "ask" | "debug" | (string & {});

export interface CustomMode {
	readonly id: string;
	readonly label: string;
	readonly color: HexColor;
}

export type VimState = "insert" | "normal" | "visual";

export interface ReferenceSessionState {
	mode: ReferenceMode;
	customMode: CustomMode | undefined;
	runEverything: boolean;
	autoReview: boolean;
	vim: VimState;
	compact: boolean;
}

export interface FooterHeadline {
	readonly text: string;
	readonly color: HexColor;
	readonly inverseFocus: boolean;
}

export function modeHeadline(state: ReferenceSessionState, width: number): FooterHeadline | undefined {
	if (state.customMode) {
		return { text: `${state.customMode.label} (shift+tab to exit)`, color: state.customMode.color, inverseFocus: false };
	}
	if (width > 0 && state.runEverything) {
		return undefined;
	}
	switch (state.mode) {
		case "plan":
			return { text: "Plan (shift+tab to cycle)", color: "#F4E7A1", inverseFocus: false };
		case "ask":
			return { text: "Ask (shift+tab to cycle)", color: "#58D68D", inverseFocus: false };
		case "debug":
			return { text: "Debug (shift+tab to cycle)", color: "#E34671", inverseFocus: false };
		default:
			return undefined;
	}
}

export function autorunLabel(state: ReferenceSessionState): string | undefined {
	if (state.runEverything) return "Run Everything";
	if (state.autoReview) return "Auto-review";
	return undefined;
}

export function vimFooterLabel(state: ReferenceSessionState): string | undefined {
	if (state.vim === "normal") return undefined;
	return state.vim === "visual" ? "-- VISUAL --" : "-- INSERT --";
}

export const MODE_CYCLE: readonly ReferenceMode[] = ["default", "plan", "debug", "ask"];

export function createSessionState(): ReferenceSessionState {
	return {
		mode: "default",
		customMode: undefined,
		runEverything: false,
		autoReview: false,
		vim: "insert",
		compact: true,
	};
}

export function nextMode(current: ReferenceMode): ReferenceMode {
	const idx = MODE_CYCLE.indexOf(current);
	return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
}
