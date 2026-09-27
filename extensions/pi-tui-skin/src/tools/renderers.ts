/**
 * Reference-style tool UIs for pi's built-in tools, delegating execution to the
 * originals (official pattern from examples/extensions/built-in-tool-renderer.ts).
 *
 * Research mapping (source-conversation.md §3):
 * - bash   -> shellToolCall UI: "$ " gutter, command, cwd note, duration/exit suffix,
 *            collapsed 2 output lines + hidden hint, expanded 256 lines.
 * - read   -> readToolCall UI: Reading/Read, truncate-start path, line N / lines N-M.
 * - edit   -> editToolCall UI: Editing/Edited, +N -M note, ▎-bordered diff, max 12 lines.
 * - write  -> write adapted to the edit UI with additions only (Reference's write
 *            decision exists; its transcript row is edit-shaped).
 * - grep   -> grepToolCall UI: "pattern" 40-char rule, Found N matches (truncated).
 * - find   -> globToolCall UI: Globbing/Globbed, Found N file(s).
 * - ls     -> lsToolCall UI: Listing/Listed, files/directories note.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { createBashTool, createEditTool, createFindTool, createGrepTool, createLsTool, createReadTool, createWriteTool, type BashToolDetails, type EditToolDetails, type FindToolDetails, type GrepToolDetails, type LsToolDetails, type ReadToolDetails } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import {
	SHELL_INPUT_LINES,
	SHELL_EXPANDED_OUTPUT_LINES,
	SHELL_TOOL_OUTPUT_LINES,
	EXPANDED_MAX_LINES,
	MAX_CHARS_PER_LINE,
	MAX_TOTAL_CHARS,
	PATH_TRUNCATE_WIDTH,
	CWD_TRUNCATE_WIDTH,
	EDIT_DIFF_MAX_LINES,
} from "../constants.ts";
import { basename, cwdRelative, displayPath, lineRange, truncatePatternHead } from "../format.ts";
import { getTokens, paletteFg } from "../palette.ts";
import { countNewLines, diffCounts, editDiffBlock, ensureState, invalidateOnce, measureDuration, renderTextBlock, seedState, statefulCallRow, truncateStart, type ToolRenderContextLike, type ToolRowState } from "./ui.ts";

type AnyToolRenderContext = ToolRenderContextLike;

function outputText(result: { content: { type: string; text?: string }[] }): string {
	const first = result.content[0];
	return first && first.type === "text" && typeof first.text === "string" ? first.text : "";
}

function exitCodeOf(output: string): number | undefined {
	const m = output.match(/exit code: (\d+)/);
	return m ? Number.parseInt(m[1], 10) : undefined;
}

function collapsedWithHint(lines: string[], visible: number, theme: Theme): string[] {
	if (lines.length <= visible) return lines.map((l) => theme.fg("dim", l));
	const shown = lines.slice(0, visible).map((l) => theme.fg("dim", l));
	const hidden = lines.length - visible;
	shown.push(theme.fg("dim", `… ${hidden} output line${hidden === 1 ? "" : "s"} hidden · ctrl+o to expand`));
	return shown;
}

export function registerReferenceTools(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const starts = new Map<string, number>();

	// --- bash -> Reference shell UI ---
	const originalBash = createBashTool(cwd);
	pi.registerTool({
		name: "bash",
		label: originalBash.label,
		description: originalBash.description,
		parameters: originalBash.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			starts.set(toolCallId, Date.now());
			return originalBash.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, { verb: "Ran", primary: "", suffix: undefined });
			return {
				invalidate() {},
				render(width: number): string[] {
					const suffix = (c.state as { suffix?: string } | undefined)?.suffix ?? "";
					return [truncateToWidth(`$ ${args.command}${suffix}${theme.fg("dim", ` in ${displayPath(cwd, c.cwd, CWD_TRUNCATE_WIDTH)}`)}`, width)];
				},
			};
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const raw = outputText(result);
			const exit = exitCodeOf(raw);
			const output = raw.replace(/\n?exit code: \d+$/, "");
			const outputLines = output.length > 0 ? output.split("\n") : [];
			const start = starts.get(c.toolCallId);
			const dur = start === undefined ? "" : measureDuration(start);
			const suffix = exit !== undefined && exit !== 0 ? `exit ${exit}${dur ? ` • ${dur}` : ""}` : dur;
			const command = String((c.args as { command?: string })?.command ?? "");
			const state0 = ensureState(c);
			state0.suffix = suffix ? theme.fg("dim", ` ${suffix}`) : undefined;
			invalidateOnce(c);
			const rows: string[] = [];
			let body: string[];
			if (expanded) {
				body = outputLines.slice(0, SHELL_EXPANDED_OUTPUT_LINES).map((l) => theme.fg("dim", l));
				const details = result.details as BashToolDetails | undefined;
				if (details?.truncation?.truncated) {
					body.push(theme.fg("dim", `Output truncated for display (max ${MAX_CHARS_PER_LINE} chars/line, ${MAX_TOTAL_CHARS} chars total)`));
				}
				body.push(theme.fg("dim", "ctrl+o to collapse"));
			} else {
				body = collapsedWithHint(outputLines, SHELL_TOOL_OUTPUT_LINES, theme);
			}
			const commandLines = command.split("\n");
			if (commandLines.length > SHELL_INPUT_LINES && !expanded) {
				rows.push(theme.fg("dim", `… ${commandLines.length - SHELL_INPUT_LINES} input lines hidden`));
			}
			return renderTextBlock(c, [...rows, ...body].join("\n"));
		},
	});

	// --- read -> Reference read UI ---
	const originalRead = createReadTool(cwd);
	pi.registerTool({
		name: "read",
		label: originalRead.label,
		description: originalRead.description,
		parameters: originalRead.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return originalRead.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, {
				verb: "Reading",
				primary: truncateStart(String(args.path), 96),
				note: lineRange((Number(args.offset) || 0) + 1, args.limit === undefined ? undefined : Number(args.limit)),
			});
			return statefulCallRow(c, theme);
		},
		renderResult(result, { isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const state0 = ensureState(c);
			const details = result.details as ReadToolDetails | undefined;
			state0.note = [lineRange((Number((c.args as { offset?: number }).offset) || 0) + 1, (c.args as { limit?: number }).limit), details?.truncation?.truncated ? "(truncated)" : undefined].filter(Boolean).join(" ") || undefined;
			if (!isPartial) {
				state0.verb = "Read";
				const output = outputText(result);
				if (output.startsWith("Error") || output.startsWith("<error>")) state0.error = output.slice(0, 200);
			}
			invalidateOnce(c);
			return renderTextBlock(c, "");
		},
	});

	// --- edit -> Reference edit UI ---
	const originalEdit = createEditTool(cwd);
	pi.registerTool({
		name: "edit",
		label: originalEdit.label,
		description: originalEdit.description,
		parameters: originalEdit.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return originalEdit.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, {
				verb: "Editing",
				primary: truncateStart(basename(String(args.path)), 64),
				note: "",
			});
			return statefulCallRow(c, theme, (state) => (state.added === undefined ? [] : [theme.fg("dim", ` ${state.added} changed line(s) · ctrl+r to review`)]));
		},
		renderResult(result, { isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const state0 = ensureState(c);
			if (isPartial) return renderTextBlock(c, theme.fg("dim", "Editing..."));
			const details = result.details as EditToolDetails | undefined;
			if (details?.patch) {
				const { added, removed } = diffCounts(details.patch);
				state0.added = added;
				state0.removed = removed;
				state0.note = `${theme.fg("success", `+${added}`)} ${theme.fg("error", `-${removed}`)}`;
			}
			state0.verb = "Edited";
			invalidateOnce(c);
			const rows: string[] = [];
			if (details?.diff) {
				const tokens = getTokens(theme.name);
				const border = (text: string) => paletteFg(tokens.editDiffBorder, theme.getColorMode(), text);
				rows.push(...editDiffBlock(theme, border, details.diff, EDIT_DIFF_MAX_LINES));
			} else {
				const output = outputText(result);
				if (output) rows.push(theme.fg("dim", truncateStart(output.split("\n")[0]!, 96)));
			}
			return new Text(rows.join("\n"), 2, 0);
		},
	});

	// --- write -> Reference edit UI, additions only ---
	const originalWrite = createWriteTool(cwd);
	pi.registerTool({
		name: "write",
		label: originalWrite.label,
		description: originalWrite.description,
		parameters: originalWrite.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return originalWrite.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, {
				verb: "Writing",
				primary: truncateStart(basename(String(args.path)), 64),
				note: `+${countNewLines(String(args.content ?? ""))}`,
			});
			return statefulCallRow(c, theme);
		},
		renderResult(result, { isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const state0 = ensureState(c);
			if (isPartial) return renderTextBlock(c, theme.fg("dim", "Writing..."));
			state0.verb = "Wrote";
			invalidateOnce(c);
			return renderTextBlock(c, theme.fg("dim", truncateStart(cwdRelative(cwd, String((c.args as { path?: string }).path ?? "")), PATH_TRUNCATE_WIDTH)));
		},
	});

	// --- grep -> Reference grep UI ---
	const originalGrep = createGrepTool(cwd);
	pi.registerTool({
		name: "grep",
		label: originalGrep.label,
		description: originalGrep.description,
		parameters: originalGrep.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return originalGrep.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, {
				verb: "Grepping",
				primary: `"${truncatePatternHead(String(args.pattern))}"`,
				note: `in ${displayPath(cwd, String(args.path ?? cwd), PATH_TRUNCATE_WIDTH)}`,
			});
			return statefulCallRow(c, theme);
		},
		renderResult(result, { isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const state0 = ensureState(c);
			if (isPartial) return renderTextBlock(c, theme.fg("dim", "Searching..."));
			state0.verb = "Grepped";
			invalidateOnce(c);
			const output = outputText(result);
			const details = result.details as GrepToolDetails | undefined;
			const matches = output.length > 0 ? output.split("\n").filter((l) => l.length > 0).length : 0;
			const truncated = details?.truncation?.truncated ? " (truncated)" : "";
			return renderTextBlock(c, theme.fg("dim", `Found ${matches} match${matches === 1 ? "" : "es"}${truncated}`));
		},
	});

	// --- find -> Reference glob UI ---
	const originalFind = createFindTool(cwd);
	pi.registerTool({
		name: "find",
		label: originalFind.label,
		description: originalFind.description,
		parameters: originalFind.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return originalFind.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, {
				verb: "Globbing",
				primary: `"${truncatePatternHead(String(args.pattern))}"`,
				note: `in ${displayPath(cwd, String(args.path ?? cwd), PATH_TRUNCATE_WIDTH)}`,
			});
			return statefulCallRow(c, theme);
		},
		renderResult(result, { isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const state0 = ensureState(c);
			if (isPartial) return renderTextBlock(c, theme.fg("dim", "Searching..."));
			state0.verb = "Globbed";
			invalidateOnce(c);
			const output = outputText(result);
			const details = result.details as FindToolDetails | undefined;
			const files = output.length > 0 ? output.split("\n").filter((l) => l.length > 0).length : 0;
			const truncated = details?.resultLimitReached || details?.truncation?.truncated ? " (truncated)" : "";
			return renderTextBlock(c, theme.fg("dim", `Found ${files} file${files === 1 ? "" : "s"}${truncated}`));
		},
	});

	// --- ls -> Reference ls UI ---
	const originalLs = createLsTool(cwd);
	pi.registerTool({
		name: "ls",
		label: originalLs.label,
		description: originalLs.description,
		parameters: originalLs.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return originalLs.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const c = context as AnyToolRenderContext;
			seedState(c, {
				verb: "Listing",
				primary: displayPath(cwd, String(args.path ?? cwd), PATH_TRUNCATE_WIDTH),
			});
			return statefulCallRow(c, theme);
		},
		renderResult(result, { isPartial }, theme, context) {
			const c = context as AnyToolRenderContext;
			const state0 = ensureState(c);
			if (isPartial) return renderTextBlock(c, theme.fg("dim", "Listing..."));
			state0.verb = "Listed";
			invalidateOnce(c);
			const output = outputText(result);
			const details = result.details as LsToolDetails | undefined;
			if (output === "(empty directory)") return renderTextBlock(c, theme.fg("dim", "0 files, 0 directories"));
			const lines = output.split("\n").filter((l) => l.length > 0 && !l.startsWith("["));
			const dirs = lines.filter((l) => l.endsWith("/")).length;
			const files = lines.length - dirs;
			const truncated = details?.entryLimitReached || details?.truncation?.truncated ? " (truncated)" : "";
			return renderTextBlock(c, theme.fg("dim", `${files} files, ${dirs} directories${truncated}`));
		},
	});
}

export type { Theme };
