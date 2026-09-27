/**
 * Approval gate parity for Reference's tool decisions. Research:
 * source-composer.md §6.1 (titles, options, keys), §6.2 (context previews),
 * source-screens.md §1 (/run-everything, /auto-review semantics).
 *
 * Pi adaptation (documented in docs/parity.md): decisions gate bash, edit and
 * write in TUI mode only; non-interactive modes proceed without approval
 * because pi loads extensions in JSON and print modes where no dialog exists.
 */

import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { basename } from "../format.ts";
import type { ReferenceSessionState } from "../state.ts";
import { DecisionSurface, decisionTitle, shellOptions, writeOptions, type DecisionOutcome } from "./surface.ts";

export interface AllowlistState {
	readonly shells: Set<string>;
	readonly paths: Set<string>;
}

export function createAllowlist(): AllowlistState {
	return { shells: new Set(), paths: new Set() };
}

export function isAllowlisted(allowlist: AllowlistState, toolName: string, input: unknown): boolean {
	if (toolName === "bash") {
		const command = (input as { command?: string }).command;
		return command !== undefined && allowlist.shells.has(command);
	}
	const path = (input as { path?: string }).path;
	return path !== undefined && allowlist.paths.has(path);
}

function previewFor(toolName: "bash" | "edit" | "write", input: unknown, cwd: string): string[] {
	if (toolName === "bash") {
		const command = String((input as { command?: string }).command ?? "");
		return [`$ ${command}`, `in ${cwd}`];
	}
	const path = String((input as { path?: string }).path ?? "");
	if (toolName === "edit") {
		const edits = (input as { edits?: { oldText?: string; newText?: string }[] }).edits ?? [];
		const removed = edits.reduce((n, e) => n + (e.oldText ?? "").split("\n").length, 0);
		const added = edits.reduce((n, e) => n + (e.newText ?? "").split("\n").length, 0);
		return [`${basename(path)} +${added} -${removed}`, path];
	}
	const content = String((input as { content?: string }).content ?? "");
	return [`${basename(path)} +${content.length === 0 ? 0 : content.split("\n").length}`, path];
}

async function showDecision(request: {
	ctx: ExtensionContext;
	toolName: "bash" | "edit" | "write";
	input: unknown;
	cwd: string;
}): Promise<DecisionOutcome> {
	const { ctx, toolName, input, cwd } = request;
	const options = toolName === "bash" ? shellOptions(String((input as { command?: string }).command ?? "")) : writeOptions(`${toolName}(${basename(String((input as { path?: string }).path ?? ""))})`);
	return ctx.ui.custom<DecisionOutcome>((tui, theme, _keybindings, done) => {
		const surface = new DecisionSurface(tui, theme, {
			operation: toolName,
			title: decisionTitle(toolName),
			preview: previewFor(toolName, input, cwd),
			allowlistLabel: "",
		}, options, done);
		return surface;
	});
}

export function installDecisionGate(pi: ExtensionAPI, state: ReferenceSessionState, allowlist: AllowlistState): void {
	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
		if (state.runEverything) return undefined;
		const gated = event.toolName === "bash" || event.toolName === "edit" || event.toolName === "write";
		if (!gated) return undefined;
		const toolName = event.toolName as "bash" | "edit" | "write";
		if (isAllowlisted(allowlist, toolName, event.input)) return undefined;
		if (ctx.mode !== "tui" || !ctx.hasUI) return undefined;
		const outcome = await showDecision({ ctx, toolName, input: event.input, cwd: ctx.cwd });
		if (outcome.action === "approve") return undefined;
		if (outcome.action === "allow") {
			if (toolName === "bash") {
				allowlist.shells.add(String((event.input as { command?: string }).command ?? ""));
			} else {
				allowlist.paths.add(String((event.input as { path?: string }).path ?? ""));
			}
			return undefined;
		}
		return { block: true, reason: outcome.reason ?? "The user rejected this action." };
	});
}
