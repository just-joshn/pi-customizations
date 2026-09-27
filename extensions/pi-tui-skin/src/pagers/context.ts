/**
 * Reference context pager (research: source-screens.md §2 Pagers (context),
 * .audit parts/07-screens.txt rows pager.context-*). Accent/green tokens are
 * Reference-only roles carried in REFERENCE_TOKENS, so they go through paletteFg.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../format.ts";
import { getTokens, paletteBg, paletteFg, type ColorMode, type HexColor } from "../palette.ts";

export interface ContextCategory {
	readonly label: string;
	readonly tokens: number;
}

export interface ContextScreenData {
	readonly modelName?: string;
	readonly contextWindow: number;
	readonly tokens: number | null;
	readonly percent: number | null;
	readonly categories: readonly ContextCategory[];
}

const CATEGORY_COLORS: readonly HexColor[] = ["#58B7D6", "#A78BFA", "#58D68D", "#E3B341", "#E34671"];
const FREE_COLOR: HexColor = "#3E3E42";
const TWO_COLUMN_WIDTH = 88;

function formatWindow(tokens: number): string {
	return `${Math.round(tokens / 1000)}k`;
}

function percentOf(tokens: number, window: number): string {
	if (window <= 0) return "0.0%";
	return `${((tokens / window) * 100).toFixed(1)}%`;
}

function joinRow(left: string, right: string, width: number): string {
	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	if (lw + rw + 1 >= width) return truncateToWidth(`${left} ${right}`, width);
	return `${left}${" ".repeat(width - lw - rw)}${right}`;
}

function segmentWidths(segments: readonly { tokens: number }[], total: number, width: number): number[] {
	const widths = segments.map((s) => Math.floor((width * s.tokens) / total));
	let remainder = width - widths.reduce((sum, w) => sum + w, 0);
	for (let i = 0; remainder > 0; i = (i + 1) % widths.length) {
		widths[i]! += 1;
		remainder -= 1;
	}
	return widths;
}

function buildBar(categories: readonly ContextCategory[], free: number, window: number, width: number, mode: ColorMode): string {
	const segments = [
		...categories.map((c, i) => ({ color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!, tokens: c.tokens })),
		{ color: FREE_COLOR, tokens: free },
	];
	const total = Math.max(window, 1);
	const widths = segmentWidths(segments, total, width);
	return segments.map((s, i) => paletteBg(s.color, mode, " ".repeat(widths[i]!))).join("");
}

function buildScale(width: number): string {
	const marks: [string, number][] = [
		["0", 0],
		["25", Math.floor(width * 0.25)],
		["50", Math.floor(width * 0.5)],
		["75", Math.floor(width * 0.75)],
		["100%", width - 4],
	];
	const chars: string[] = Array.from({ length: width }, () => " ");
	let end = 0;
	for (const [label, at] of marks) {
		const off = Math.max(at, end);
		for (let i = 0; i < label.length && off + i < width; i++) chars[off + i] = label[i]!;
		end = off + label.length + 1;
	}
	return chars.join("");
}

function categoryCell(category: ContextCategory, color: HexColor, window: number, mode: ColorMode): string {
	return `${paletteBg(color, mode, "  ")} ${category.label} ${formatTokens(category.tokens)} • ${percentOf(category.tokens, window)}`;
}

function categoryRows(categories: readonly ContextCategory[], window: number, width: number, mode: ColorMode): string[] {
	const cells = categories.map((c, i) => categoryCell(c, CATEGORY_COLORS[i % CATEGORY_COLORS.length]!, window, mode));
	if (width < TWO_COLUMN_WIDTH) return cells;
	const colWidth = Math.floor(width / 2);
	const rows: string[] = [];
	for (let i = 0; i < cells.length; i += 2) {
		const left = cells[i]!;
		const right = cells[i + 1];
		rows.push(right ? `${left}${" ".repeat(Math.max(1, colWidth - visibleWidth(left)))}${right}` : left);
	}
	return rows;
}

export function renderContextScreen(opts: ContextScreenData & { width: number; theme: Theme }): string[] {
	const { theme, width } = opts;
	const tokens = getTokens(theme.name);
	const mode = theme.getColorMode();
	const accent = (s: string) => paletteFg(tokens.pagerAccent, mode, theme.bold(s));
	const green = (s: string) => paletteFg(tokens.green, mode, s);
	const dim = (s: string) => theme.fg("dim", s);

	const title = accent("Context") + (opts.modelName ? dim(` • ${opts.modelName}`) : "");
	const stats = opts.tokens !== null && opts.percent !== null
		? dim(`${formatTokens(opts.tokens)} / ${formatWindow(opts.contextWindow)}  `) + green(`${Math.round(opts.percent)}%`)
		: "";
	const lines: string[] = [joinRow(title, stats, width), dim("Current context usage by category.")];

	if (opts.tokens === null || opts.categories.length === 0) {
		lines.push("", dim("No context usage breakdown to show yet."));
		return lines;
	}

	const free = Math.max(0, opts.contextWindow - opts.tokens);
	lines.push("");
	lines.push(truncateToWidth(buildBar(opts.categories, free, opts.contextWindow, width, mode), width));
	lines.push(dim(buildScale(width)));
	lines.push("");
	lines.push(...categoryRows(opts.categories, opts.contextWindow, width, mode));
	lines.push(`${paletteBg(FREE_COLOR, mode, "  ")} ${dim(`Free space ${formatTokens(free)} • ${percentOf(free, opts.contextWindow)}`)}`);
	return lines.map((l) => truncateToWidth(l, width));
}
