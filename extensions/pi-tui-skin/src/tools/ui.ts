/**
 * Reference ToolCallHeader and shared tool-row primitives.
 * Research: source-conversation.md §0 (header layout: [1-col gutter] gap1 name bold
 * gap1 primary dim gap1 note dim; status colors only the gutter space, so the
 * visible cues are the verb, the notes, and the dimmed name), §3 (per-tool rules).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { GREP_PATTERN_KEEP, GREP_PATTERN_MAX } from "../constants.ts";

/** Structural subset of pi's renderer context (the full type is not public API). */
export interface ToolRenderContextLike {
	toolCallId: string;
	invalidate: () => void;
	state: ToolRowState | undefined;
	args: unknown;
	cwd: string;
}

export interface ToolRowState {
	verb: string;
	primary: string;
	note?: string;
	error?: string;
	added?: number;
	removed?: number;
}

export function ensureState(context: ToolRenderContextLike): ToolRowState {
	if (!context.state) context.state = { verb: "", primary: "" };
	return context.state;
}

export function truncateStart(text: string, max: number): string {
	if (text.length <= max) return text;
	return `...${text.slice(text.length - max + 3)}`;
}

export function truncatePattern(pattern: string): string {
	if (pattern.length <= GREP_PATTERN_MAX) return pattern;
	return `...${pattern.slice(pattern.length - GREP_PATTERN_KEEP)}`;
}

export function headerLine(theme: Theme, state: ToolRowState): string {
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
