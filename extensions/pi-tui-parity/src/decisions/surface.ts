/**
 * Reference DecisionSurface. Research: source-composer.md §6.1/§6.2.
 * Frame: pager shell with primary #A78BFA, variant condensed (margin 0),
 * top rule only, paddingX 1. Title bold purple. Dropdown rows paddingLeft 1,
 * "→ " prefix, selected bold in highlight color with hint, unselected in
 * foreground. Keys: y approve, n/Esc reject, p propose, Tab allowlist,
 * Enter the selected row, arrows move.
 */

import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { paletteFg } from "../palette.ts";

export type DecisionAction = "approve" | "allow" | "reject" | "propose";

export interface DecisionOption {
	readonly label: string;
	readonly hint: string;
	readonly action: DecisionAction;
	readonly key?: string;
}

export interface DecisionRequest {
	readonly operation: "shell" | "write" | "edit" | "bash";
	readonly title: string;
	readonly preview: readonly string[];
	readonly allowlistLabel: string;
}

export interface DecisionOutcome {
	readonly action: DecisionAction;
	readonly reason?: string;
}

export function decisionTitle(operation: "shell" | "write" | "edit" | "bash"): string {
	if (operation === "bash") return "Run this command?";
	return "Write to this file?";
}

export function shellOptions(command: string): DecisionOption[] {
	return [
		{ label: "Run (once)", hint: "(y)", action: "approve", key: "y" },
		{ label: `Add Shell(${command.length > 30 ? `${command.slice(0, 30)}...` : command}) to allowlist?`, hint: "(tab)", action: "allow", key: "tab" },
		{ label: "Skip & tell the agent what to do instead", hint: "(esc or n)", action: "reject", key: "n" },
	];
}

export function writeOptions(label: string): DecisionOption[] {
	return [
		{ label: "Proceed", hint: "(y)", action: "approve", key: "y" },
		{ label: `Add ${label} to allowlist`, hint: "(tab)", action: "allow", key: "tab" },
		{ label: "Reject & propose changes", hint: "(esc or n or p)", action: "reject", key: "n" },
	];
}


export class DecisionSurface implements Component {
	private selected = 0;
	private preview: readonly string[];
	private readonly title: string;

	constructor(
		private readonly tui: { requestRender: () => void },
		private readonly theme: Theme,
		request: DecisionRequest,
		private readonly options: DecisionOption[],
		private readonly done: (outcome: DecisionOutcome) => void,
	) {
		this.preview = request.preview;
		this.title = request.title;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up")) {
			this.selected = (this.selected + this.options.length - 1) % this.options.length;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			this.selected = (this.selected + 1) % this.options.length;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "escape")) {
			this.done({ action: "reject", reason: "The user skipped this action." });
			return;
		}
		if (matchesKey(data, "return")) {
			this.commit(this.options[this.selected]!);
			return;
		}
		const key = data.length === 1 ? data.toLowerCase() : undefined;
		if (key === "y") {
			this.commit(this.options.find((o) => o.action === "approve")!);
			return;
		}
		if (key === "n") {
			this.done({ action: "reject", reason: "The user declined this action." });
			return;
		}
		if (key === "p") {
			this.done({ action: "propose", reason: "The user asked the agent to propose changes instead." });
			return;
		}
		if (data === "\t") {
			const allow = this.options.find((o) => o.action === "allow");
			if (allow) this.commit(allow);
			return;
		}
	}

	private commit(option: DecisionOption): void {
		if (option.action === "approve" || option.action === "allow") {
			this.done({ action: option.action });
		} else {
			this.done({ action: option.action, reason: "The user rejected this action." });
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const mode = this.theme.getColorMode();
		const purple = (text: string) => paletteFg("#A78BFA", mode, text);
		const rows: string[] = [purple("─".repeat(Math.max(1, width)))];
		rows.push(...this.preview.map((p) => ` ${this.theme.fg("dim", p)}`));
		rows.push(` ${purple(this.theme.bold(this.title))}`);
		this.options.forEach((option, i) => {
			const selectedRow = i === this.selected;
			const prefix = selectedRow ? purple("→ ") : "  ";
			const label = selectedRow ? purple(this.theme.bold(option.label)) : option.label;
			const hint = this.theme.fg("dim", ` ${option.hint}`);
			rows.push(truncateToWidth(` ${prefix}${label}${hint}`, width));
		});
		rows.push(` ${this.theme.fg("dim", "↑/↓ to navigate • Enter to select • y approve • tab allowlist • esc reject")}`);
		return rows;
	}

}

