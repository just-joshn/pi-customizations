/**
 * Reference ToolCallHeader and shared tool-row primitives.
 * Research: source-conversation.md §0 (header layout: [1-col gutter] gap1 name bold
 * gap1 primary dim gap1 note dim; status colors only the gutter space, so the
 * visible cues are the verb, the notes, and the dimmed name), §3 (per-tool rules).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text as TextCtor, truncateToWidth } from "@earendil-works/pi-tui";

/** Structural subset of pi's renderer context (the full type is not public API). */
export interface ToolRenderContextLike {
	toolCallId: string;
	invalidate: () => void;
	state: ToolRowState | undefined;
	args: unknown;
	cwd: string;
	/** Previously returned component for this render slot (pi provides it). */
	lastComponent?: unknown;
}

export interface ToolRowState {
	verb: string;
	primary: string;
	note?: string;
	error?: string;
	added?: number;
	removed?: number;
	suffix?: string;
}

export function ensureState(context: ToolRenderContextLike): ToolRowState {
	if (!context.state || Object.keys(context.state).length === 0) context.state = { verb: "", primary: "" };
	return context.state;
}

/** Seeds the shared row state; pi initializes it as an empty object, so a nullish check is not enough. */
const invalidated = new Set<string>();

/**
 * Requests exactly one redraw per tool call. renderResult runs on every TUI
 * frame (the spinner re-renders the row), so an unconditional invalidate
 * makes an infinite render loop.
 */
export function invalidateOnce(context: ToolRenderContextLike): void {
	if (invalidated.has(context.toolCallId)) return;
	invalidated.add(context.toolCallId);
	context.invalidate();
}

export function seedState(context: ToolRenderContextLike, seed: ToolRowState): void {
	if (!context.state || Object.keys(context.state).length === 0) context.state = seed;
}

type TextLike = { setText: (text: string) => void };

/**
 * Updates the previous result component in place when possible. pi re-renders
 * the result on every partial update; returning a fresh component each time
 * makes pi append rows instead of replacing them (tui.md: "reuse the previous
 * component when it can be updated safely").
 */
export function renderTextBlock(context: ToolRenderContextLike, text: string, paddingX = 2): Component {
	const prev = context.lastComponent as TextLike | undefined;
	if (prev && typeof prev.setText === "function") {
		prev.setText(text);
		return prev as unknown as Component;
	}
	return new TextCtor(text, paddingX, 0);
}

export function truncateStart(text: string, max: number): string {
	if (text.length <= max) return text;
	return `...${text.slice(text.length - max + 3)}`;
}

function headerLine(theme: Theme, state: ToolRowState): string {
	const name = theme.fg("toolTitle", theme.bold(state.verb));
	const parts = [name];
	if (state.primary) parts.push(theme.fg("dim", state.primary));
	if (state.note) parts.push(theme.fg("dim", state.note));
	return ` ${parts.join(" ")}`;
}

/**
 * A call-row component whose rendered text is recomputed from the shared row
 * state, so a result render can flip the verb (Reading -> Read) and add
 * counts, then invalidate the row. Mirrors pi's EditRenderState pattern.
 */
export function statefulCallRow(context: ToolRenderContextLike, theme: Theme, extraRows?: (state: ToolRowState) => string[]): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			const state = context.state ?? { verb: "", primary: "" };
			const rows = [headerLine(theme, state), ...(extraRows?.(state) ?? [])];
			return rows.map((r) => truncateToWidth(r, width));
		},
	};
}

export function diffCounts(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

export function countNewLines(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length;
}

export function editDiffBlock(theme: Theme, borderHexFg: (text: string) => string, diff: string, maxLines: number): string[] {
	const rows: string[] = [];
	const lines = diff.split("\n").filter((l, i, arr) => l.length > 0 || i < arr.length - 1);
	for (const line of lines.slice(0, maxLines)) {
		const cut = line.length > 120 ? `${line.slice(0, 116)} ...` : line;
		rows.push(`${borderHexFg("▎")} ${cut}`);
	}
	return rows;
}

export function measureDuration(startedAt: number): string {
	const ms = Math.max(0, Date.now() - startedAt);
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}
