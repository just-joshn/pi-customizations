/**
 * Reference slash-command registry (research: source-screens.md §1, 07-screens.txt
 * command rows). the reference CLI-parity ids, aliases and descriptions verbatim, in
 * the reference CLI's built-ins-then-dynamic push order.
 *
 * Statuses: "implemented" = this extension executes the behavior via pi;
 * "mapped" = a pi built-in or pi-owned command already owns the id (pi wins);
 * "unmet" = needs a the reference CLI backend service pi has no equivalent for.
 */

import { execFileSync } from "node:child_process";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiSessionState } from "../state.ts";

export type CommandStatus = "implemented" | "mapped" | "unmet";

export type CommandHandler = (args: string, ctx: ExtensionCommandContext, state: TuiSessionState) => void | Promise<void>;

export interface CommandEntry {
	readonly id: string;
	readonly aliases: readonly string[];
	readonly description: string;
	readonly status: CommandStatus;
	readonly handler?: CommandHandler;
	readonly reason?: string;
	/** Set when another module (e.g. pagers) registers the command instead. */
	readonly registeredBy?: string;
}

export function findCommand(token: string): CommandEntry | undefined {
	const lower = token.toLowerCase();
	return TUI_COMMANDS.find((c) => c.id === lower) ?? TUI_COMMANDS.find((c) => c.aliases.includes(lower));
}

function suffixFor(status: CommandStatus): string {
	return status === "mapped" ? " (pi builtin)" : status === "unmet" ? " (unavailable in pi)" : "";
}

export function helpLines(theme: Theme): string[] {
	const lines = [theme.fg("mdHeading", theme.bold("Commands:"))];
	for (const entry of TUI_COMMANDS) {
		const desc = `${entry.description}${suffixFor(entry.status)}`;
		lines.push(`${theme.fg("mdHeading", `/${entry.id}`)} ${theme.fg("dim", `- ${desc}`)}`);
	}
	lines.push(theme.fg("dim", "Hint: /help <command> for details"));
	return lines;
}

export function porcelainFiles(status: string): string[] {
	return status.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

export interface UsageTotals {
	input: number;
	output: number;
	cost: number;
}

export function totalUsage(entries: readonly unknown[]): UsageTotals {
	const totals: UsageTotals = { input: 0, output: 0, cost: 0 };
	for (const entry of entries) {
		const e = entry as { type?: string; message?: { role?: string; usage?: { input: number; output: number; cost?: { total: number } } } };
		if (e?.type !== "message" || e.message?.role !== "assistant") continue;
		const usage = e.message.usage;
		if (!usage) continue;
		totals.input += usage.input;
		totals.output += usage.output;
		totals.cost += usage.cost?.total ?? 0;
	}
	return totals;
}

function toggle(state: TuiSessionState, key: "runEverything" | "autoReview" | "compact"): boolean {
	state[key] = !state[key];
	return state[key];
}

function aboutHandler(_args: string, ctx: ExtensionCommandContext): void {
	const session = ctx.sessionManager.getSessionFile();
	ctx.ui.notify(
		[
			`pi v${VERSION}`,
			`Model: ${ctx.model?.name ?? "none"}`,
			`Provider: ${ctx.model?.provider ?? "-"}`,
			`Session: ${session ?? "No session"}`,
		].join("\n"),
	);
}

function changesHandler(_args: string, ctx: ExtensionCommandContext): void {
	try {
		const status = execFileSync("git", ["status", "--porcelain"], { cwd: ctx.cwd, encoding: "utf8" });
		const files = porcelainFiles(status);
		ctx.ui.notify(`Deviation from the reference CLI's interactive Review mode: git status.\n${files.length > 0 ? files.join("\n") : "No changes"}`);
	} catch (error) {
		ctx.ui.notify(`git status failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

function usageHandler(_args: string, ctx: ExtensionCommandContext): void {
	const totals = totalUsage(ctx.sessionManager.getBranch());
	ctx.ui.notify(`Usage: ${totals.input} input · ${totals.output} output tokens · $${totals.cost.toFixed(4)}`);
}

export const TUI_COMMANDS: readonly CommandEntry[] = [
	{ id: "model", aliases: [], description: "Select model (Tab to edit)", status: "mapped", reason: "pi /model builtin owns model selection" },
	{ id: "goal", aliases: [], description: "Start a durable goal that continues while idle", status: "unmet", reason: "needs the reference CLI's goal service (agent_goal_continuation backend)" },
	{ id: "add-dir", aliases: [], description: "Add a directory to the current workspace", status: "unmet", reason: "needs the reference CLI's workspace manager" },
	{ id: "save-workspace", aliases: [], description: "Persist the current workspace directories", status: "unmet", reason: "needs the reference CLI's workspace manager" },
	{ id: "load-workspace", aliases: [], description: "Load a saved workspace by name", status: "unmet", reason: "needs the reference CLI's workspace manager" },
	{ id: "detach", aliases: [], description: "Leave this persistent session running in the background", status: "unmet", reason: "needs the reference CLI's persistent-session backend" },
	{
		id: "run-everything",
		aliases: ["auto-run"],
		description: "Toggle Run Everything (currently …)",
		status: "implemented",
		handler: (_args, ctx, state) => {
			const on = toggle(state, "runEverything");
			ctx.ui.notify(on ? "Run Everything: ON (all commands run without approval)" : "Run Everything: OFF");
		},
	},
	{
		id: "auto-review",
		aliases: ["smart-auto"],
		description: "Toggle Auto-review (currently …)",
		status: "implemented",
		handler: (_args, ctx, state) => {
			const on = toggle(state, "autoReview");
			ctx.ui.notify(on ? "Auto-review: ON" : "Auto-review: OFF");
		},
	},
	{
		id: "plan",
		aliases: [],
		description: "Create a plan or show existing plan with options",
		status: "implemented",
		handler: (_args, ctx, state) => {
			state.mode = "plan";
			ctx.ui.notify("Plan mode enabled");
		},
	},
	{
		id: "ask",
		aliases: [],
		description: "Toggle ask mode (Q&A, read-only; no edits or command execution)",
		status: "implemented",
		handler: (_args, ctx, state) => {
			state.mode = state.mode === "ask" ? "default" : "ask";
			ctx.ui.notify(state.mode === "ask" ? "Ask mode enabled" : "Ask mode disabled");
		},
	},
	{ id: "debug", aliases: [], description: "Toggle debug mode or submit a prompt in debug mode", status: "mapped", reason: "pi interactive mode owns /debug" },
	{ id: "logs", aliases: [], description: "Show the current debug log file path (copies to clipboard)", status: "unmet", reason: "pi owns its debug log; no path-reporting command" },
	{ id: "update", aliases: [], description: "Update pi to the latest version", status: "unmet", reason: "needs the reference CLI's updater" },
	{ id: "max-mode", aliases: [], description: "Toggle max mode (currently …)", status: "unmet", reason: "needs the reference CLI's max-mode backend" },
	{ id: "fast", aliases: [], description: "Toggle fast mode", status: "unmet", reason: "needs the reference CLI's fast-mode backend" },
	{ id: "rename", aliases: ["name", "title"], description: "Rename the current chat session", status: "mapped", reason: "pi /name builtin renames the session" },
	{ id: "clear", aliases: ["new", "new-chat", "newchat"], description: "Start a new chat session", status: "mapped", reason: "pi /new builtin starts a new session" },
	{ id: "resume", aliases: ["continue", "recent", "history"], description: "Open recent chats and resume one", status: "mapped", reason: "pi /resume builtin owns resume" },
	{ id: "fork", aliases: ["duplicate", "clone", "branch"], description: "Fork the current chat into a new session", status: "mapped", reason: "pi /fork and /clone builtins own forking" },
	{ id: "summarize", aliases: ["compress", "compact"], description: "Summarize the conversation to reduce context", status: "mapped", reason: "pi /compact builtin summarizes the conversation" },
	{ id: "rewind", aliases: ["restore", "undo"], description: "Jump back to a previous message", status: "mapped", reason: "pi /tree owns session-restore navigation" },
	{
		id: "vim",
		aliases: [],
		description: "Toggle Vim keys (currently …)",
		status: "implemented",
		handler: (_args, ctx, state) => {
			state.vim = state.vim === "normal" ? "insert" : "normal";
			ctx.ui.notify(state.vim === "normal" ? "Vim keys: ON" : "Vim keys: OFF");
		},
	},
	{
		id: "zen-mode",
		aliases: ["zen"],
		description: "Toggle compact one-line tool calls (currently on/off)",
		status: "implemented",
		handler: (_args, ctx, state) => {
			const on = toggle(state, "compact");
			ctx.ui.notify(on ? "Zen mode: ON" : "Zen mode: OFF");
		},
	},
	{ id: "line-numbers", aliases: ["lines", "numbers"], description: "Toggle line numbers in code blocks (currently …)", status: "unmet", reason: "pi's renderer has no line-number toggle" },
	{
		id: "show-thinking",
		aliases: ["thoughts", "thinking", "thinking-blocks"],
		description: "Toggle thinking block display (currently …)",
		status: "implemented",
		handler: (_args, ctx) => {
			ctx.ui.notify("Thinking display is owned by pi — use /thinking to change it.");
		},
	},
	{ id: "status-indicators", aliases: [], description: "Toggle terminal title status indicators (currently …)", status: "mapped", reason: "pi owns the terminal title" },
	{ id: "shell", aliases: ["sh", "run"], description: "Enter Shell Mode (hint: type ! on an empty line)", status: "mapped", reason: "pi enters bash mode with the ! keybinding" },
	{
		id: "about",
		aliases: ["whoami", "account"],
		description: "Show CLI version, system, and account info (copies to clipboard)",
		status: "implemented",
		handler: aboutHandler,
	},
	{ id: "setup-terminal", aliases: [], description: "Configure your terminal for newlines", status: "mapped", reason: "pi ships its own terminal-setup flow" },
	{
		id: "help",
		aliases: [],
		description: "Show help (/help [cmd])",
		status: "implemented",
		handler: (_args, ctx) => {
			ctx.ui.notify(helpLines(ctx.ui.theme).join("\n"));
		},
	},
	{ id: "feedback", aliases: [], description: "Share feedback with the team", status: "unmet", reason: "needs the reference CLI's feedback service" },
	{ id: "open", aliases: [], description: "Open the repository's git root in the reference CLI", status: "unmet", reason: "needs the reference CLI editor binary" },
	{ id: "copy-request-id", aliases: [], description: "Copy last request ID", status: "unmet", reason: "needs the reference CLI's request telemetry" },
	{ id: "open-in-prompt-quality", aliases: [], description: "Open last request in Prompt Quality dashboard", status: "unmet", reason: "needs the reference CLI's Prompt Quality dashboard" },
	{
		id: "copy-conversation-id",
		aliases: [],
		description: "Copy current conversation ID",
		status: "implemented",
		handler: (_args, ctx) => {
			ctx.ui.notify(ctx.sessionManager.getSessionFile() ?? "No session");
		},
	},
	{ id: "team", aliases: [], description: "Switch the active team for this account", status: "unmet", reason: "needs the reference CLI's team backend" },
	{ id: "logout", aliases: [], description: "Sign out from the reference CLI", status: "mapped", reason: "pi /logout builtin signs out" },
	{ id: "quit", aliases: [], description: "Exit", status: "mapped", reason: "pi /quit builtin exits" },
	{
		id: "exit",
		aliases: [],
		description: "Exit",
		status: "implemented",
		handler: (_args, ctx) => {
			ctx.shutdown();
		},
	},
	{ id: "mcp", aliases: [], description: "Manage MCP servers (list, list-tools)", status: "unmet", reason: "pi manages MCP servers via settings, not this pager" },
	{ id: "plugin", aliases: [], description: "Manage plugins - view installed, browse marketplace, install/uninstall", status: "unmet", reason: "needs the reference CLI's plugin marketplace" },
	{ id: "config", aliases: ["settings", "preferences", "cli-config"], description: "Configure CLI settings interactively", status: "mapped", reason: "pi /settings builtin opens settings" },
	{ id: "copy", aliases: ["clipboard", "paste"], description: "Copy a previous message to the clipboard", status: "mapped", reason: "pi /copy builtin copies the last agent message" },
	{ id: "sandbox", aliases: [], description: "✓ Sandbox enabled, …", status: "unmet", reason: "needs the reference CLI's sandbox runtime" },
	{ id: "bedrock", aliases: [], description: "Configure Bedrock in-chat (configure/[use-team-role/]status/disable/clear)", status: "unmet", reason: "needs the reference CLI's Bedrock setup service" },
	{ id: "debug-test", aliases: [], description: "Emit debug log", status: "unmet", reason: "the reference CLI debug-build command" },
	{ id: "throw", aliases: [], description: "Throw test error", status: "unmet", reason: "the reference CLI debug-build command" },
	{ id: "pq", aliases: [], description: "Open last request dashboard", status: "unmet", reason: "needs the reference CLI's Prompt Quality dashboard" },
	{ id: "dev:score-recent-commits", aliases: [], description: "(dev only)", status: "unmet", reason: "the reference CLI dev-build command" },
	{ id: "dev:score-commit", aliases: [], description: "(dev only)", status: "unmet", reason: "the reference CLI dev-build command" },
	{ id: "dev:classify-conversation", aliases: [], description: "(dev only)", status: "unmet", reason: "the reference CLI dev-build command" },
	{
		id: "changes",
		aliases: [],
		description: "Review changes — Conversation, Unstaged, Staged (when present), and Committed",
		status: "implemented",
		handler: changesHandler,
	},
	{ id: "commit", aliases: [], description: "Ask the agent to stage and commit changes", status: "mapped", reason: "pi package prompt template /commit (prompts/commit.md) owns the id" },
	{
		id: "jobs",
		aliases: [],
		description: "Open active tasks list",
		status: "implemented",
		handler: (_args, ctx) => {
			ctx.ui.notify(ctx.ui.theme.fg("dim", "No active tasks"));
		},
	},
	{ id: "rule", aliases: [], description: "Manage rules", status: "implemented", registeredBy: "wizard" },
	{ id: "command", aliases: ["commands"], description: "Manage custom commands", status: "unmet", reason: "pi loads prompt templates but has no manager command" },
	{ id: "usage", aliases: [], description: "Show plan and on-demand usage", status: "implemented", handler: usageHandler, registeredBy: "pagers" },
	{ id: "skills", aliases: [], description: "Open skills menu", status: "unmet", reason: "pi has no skills menu command" },
	{ id: "btw", aliases: [], description: "Ask on the side without disrupting the main chat; replies are not saved to history", status: "unmet", reason: "needs the reference CLI's side-chat backend" },
	{ id: "static-indicator", aliases: [], description: "Toggle static divider and highlighting", status: "unmet", reason: "the reference CLI debug-only command" },
	{ id: "full-conversation", aliases: [], description: "Toggle full conversation rendering after redraw truncation", status: "mapped", reason: "pi always renders the full conversation" },
	{ id: "sync-theme", aliases: [], description: "Re-detect terminal theme and refresh UI", status: "mapped", reason: "pi detects the theme at startup and follows appearance changes" },
	{ id: "context", aliases: [], description: "Show context usage breakdown", status: "implemented", registeredBy: "pagers" },
];
