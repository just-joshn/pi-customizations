import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { REFERENCE_COMMANDS, findCommand, helpLines, porcelainFiles, totalUsage, type CommandEntry } from "../src/commands/registry.ts";
import { installCommands } from "../src/commands/register.ts";
import { createSessionState, type ReferenceSessionState } from "../src/state.ts";
import { makeTheme } from "./theme.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

interface RegisteredCommand {
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

interface Notified {
	message: string;
	type: string;
}

interface FakeCtx {
	ctx: ExtensionCommandContext;
	notified: Notified[];
	shutdowns: number[];
}

function fakeCtx(opts: { entries?: unknown[]; sessionFile?: string; theme?: Theme } = {}): FakeCtx {
	const notified: Notified[] = [];
	const shutdowns: number[] = [];
	const ctx = {
		cwd: "/tmp/repo",
		ui: {
			notify: (message: string, type = "info") => notified.push({ message, type }),
			theme: opts.theme,
		},
		model: { name: "claude-opus-5-5-max", provider: "anthropic" },
		sessionManager: {
			getBranch: () => opts.entries ?? [],
			getSessionFile: () => opts.sessionFile,
		},
		shutdown: () => shutdowns.push(1),
	} as unknown as ExtensionCommandContext;
	return { ctx, notified, shutdowns };
}

function captureCommands(state: ReferenceSessionState): Map<string, RegisteredCommand> {
	const commands = new Map<string, RegisteredCommand>();
	const pi = {
		registerCommand: (name: string, options: RegisteredCommand) => commands.set(name, options),
	} as unknown as ExtensionAPI;
	installCommands(pi, state);
	return commands;
}

function entry(id: string): CommandEntry {
	const found = REFERENCE_COMMANDS.find((c) => c.id === id);
	assert.ok(found, `registry entry ${id}`);
	return found!;
}

describe("command registry", () => {
	it("keeps Reference ids and aliases", () => {
		assert.equal(findCommand("model")?.status, "mapped");
		assert.deepEqual(findCommand("resume")?.aliases, ["continue", "recent", "history"]);
		assert.deepEqual(findCommand("fork")?.aliases, ["duplicate", "clone", "branch"]);
		assert.deepEqual(findCommand("copy")?.aliases, ["clipboard", "paste"]);
		assert.equal(findCommand("compact")?.id, "summarize");
		assert.equal(findCommand("name")?.id, "rename");
		assert.equal(findCommand("new")?.id, "clear");
		assert.equal(findCommand("auto-run")?.id, "run-everything");
		assert.equal(findCommand("smart-auto")?.id, "auto-review");
		assert.equal(findCommand("zen")?.id, "zen-mode");
		assert.equal(findCommand("thoughts")?.id, "show-thinking");
		assert.equal(findCommand("MODEL")?.id, "model");
		assert.equal(findCommand("nope"), undefined);
	});

	it("maps pi-owned ids to pi builtins", () => {
		const mapped = ["model", "resume", "fork", "quit", "rewind", "debug", "summarize", "clear", "rename", "config", "logout"];
		for (const id of mapped) {
			assert.equal(entry(id).status, "mapped", id);
			assert.ok(entry(id).reason, `${id} explains the mapping`);
			assert.equal(entry(id).handler, undefined, `${id} must not register a handler`);
		}
	});

	it("implements the Reference-parity commands", () => {
		const implemented = ["run-everything", "auto-review", "plan", "ask", "zen-mode", "vim", "show-thinking", "about", "help", "changes", "exit", "jobs", "usage", "copy-conversation-id"];
		for (const id of implemented) {
			assert.equal(entry(id).status, "implemented", id);
			assert.equal(typeof entry(id).handler, "function", id);
		}
	});

	it("marks backend-only commands unmet with a reason", () => {
		const unmet = ["goal", "detach", "update", "max-mode", "fast", "feedback", "open", "reference", "team", "mcp", "plugin", "sandbox", "bedrock", "btw", "rule"];
		for (const id of unmet) {
			assert.equal(entry(id).status, "unmet", id);
			assert.ok(entry(id).reason && entry(id).reason!.length > 0, `${id} names the missing service`);
			assert.equal(entry(id).handler, undefined, `${id} must not register a handler`);
		}
	});

	it("matches Reference descriptions verbatim", () => {
		assert.equal(entry("model").description, "Select model (Tab to edit)");
		assert.equal(entry("run-everything").description, "Toggle Run Everything (currently …)");
		assert.equal(entry("ask").description, "Toggle ask mode (Q&A, read-only; no edits or command execution)");
		assert.equal(entry("bedrock").description, "Configure Bedrock in-chat (configure/[use-team-role/]status/disable/clear)");
		assert.equal(entry("summarize").description, "Summarize the conversation to reduce context");
		assert.equal(entry("changes").description, "Review changes — Conversation, Unstaged, Staged (when present), and Committed");
	});
});

describe("commands", () => {
	it("/help prints the Commands header, one line per entry, and the hint", async () => {
		const theme = await makeTheme();
		const state = createSessionState();
		const fake = fakeCtx({ theme });
		const commands = captureCommands(state);
		await commands.get("help")!.handler("", fake.ctx);
		assert.equal(fake.notified.length, 1);
		const lines = strip(fake.notified[0]!.message).split("\n");
		assert.equal(lines[0], "Commands:");
		assert.equal(lines.at(-1), "Hint: /help <command> for details");
		assert.ok(lines.includes("/run-everything - Toggle Run Everything (currently …)"));
		assert.ok(lines.includes("/model - Select model (Tab to edit) (pi builtin)"));
		assert.ok(lines.includes("/goal - Start a durable goal that continues while idle (unavailable in pi)"));
		assert.equal(lines.length, REFERENCE_COMMANDS.length + 2);
	});

	it("helpLines styles the header and hint through the theme", async () => {
		const theme = await makeTheme();
		const lines = helpLines(theme);
		assert.ok(lines[0]!.includes("Commands:"));
		assert.ok(lines[0]!.includes("\x1b["));
		assert.ok(strip(lines.at(-1)!).startsWith("Hint: /help"));
	});

	it("/run-everything toggles state.runEverything", async () => {
		const state = createSessionState();
		const commands = captureCommands(state);
		const first = fakeCtx();
		await commands.get("run-everything")!.handler("", first.ctx);
		assert.equal(state.runEverything, true);
		assert.equal(strip(first.notified[0]!.message), "Run Everything: ON (all commands run without approval)");
		const second = fakeCtx();
		await commands.get("run-everything")!.handler("", second.ctx);
		assert.equal(state.runEverything, false);
		assert.equal(strip(second.notified[0]!.message), "Run Everything: OFF");
	});

	it("/plan sets plan mode", async () => {
		const state = createSessionState();
		const commands = captureCommands(state);
		const fake = fakeCtx();
		await commands.get("plan")!.handler("", fake.ctx);
		assert.equal(state.mode, "plan");
		assert.equal(fake.notified[0]!.message, "Plan mode enabled");
	});

	it("/ask toggles ask mode", async () => {
		const state = createSessionState();
		const commands = captureCommands(state);
		const fake = fakeCtx();
		await commands.get("ask")!.handler("", fake.ctx);
		assert.equal(state.mode, "ask");
		assert.equal(fake.notified[0]!.message, "Ask mode enabled");
		await commands.get("ask")!.handler("", fake.ctx);
		assert.equal(state.mode, "default");
		assert.equal(fake.notified[1]!.message, "Ask mode disabled");
	});

	it("/zen-mode and /vim toggle their state", async () => {
		const state = createSessionState();
		const commands = captureCommands(state);
		const fake = fakeCtx();
		await commands.get("zen-mode")!.handler("", fake.ctx);
		assert.equal(state.compact, false);
		assert.equal(fake.notified[0]!.message, "Zen mode: OFF");
		await commands.get("vim")!.handler("", fake.ctx);
		assert.equal(state.vim, "normal");
		assert.equal(fake.notified[1]!.message, "Vim keys: ON");
	});

	it("/exit shuts pi down", async () => {
		const commands = captureCommands(createSessionState());
		const fake = fakeCtx();
		await commands.get("exit")!.handler("", fake.ctx);
		assert.equal(fake.shutdowns.length, 1);
	});

	it("/usage totals assistant usage from the branch", async () => {
		const state = createSessionState();
		const entries = [
			{ type: "message", message: { role: "assistant", usage: { input: 10, output: 5, cost: { total: 0.5 } } } },
			{ type: "message", message: { role: "user" } },
			{ type: "message", message: { role: "assistant", usage: { input: 1, output: 2, cost: { total: 0.25 } } } },
		];
		const fake = fakeCtx({ entries });
		await entry("usage")!.handler!("", fake.ctx, state);
		assert.equal(fake.notified[0]!.message, "Usage: 11 input · 7 output tokens · $0.7500");
	});

	it("/copy-conversation-id prints the session file or No session", async () => {
		const state = createSessionState();
		const commands = captureCommands(state);
		const withFile = fakeCtx({ sessionFile: "/tmp/.pi/sessions/a.jsonl" });
		await commands.get("copy-conversation-id")!.handler("", withFile.ctx);
		assert.equal(withFile.notified[0]!.message, "/tmp/.pi/sessions/a.jsonl");
		const withoutFile = fakeCtx();
		await commands.get("copy-conversation-id")!.handler("", withoutFile.ctx);
		assert.equal(withoutFile.notified[0]!.message, "No session");
	});

	it("installCommands registers exactly the implemented entries with Reference descriptions", () => {
		const commands = captureCommands(createSessionState());
		const implemented = REFERENCE_COMMANDS.filter((c) => c.status === "implemented" && !c.registeredBy);
		assert.equal(commands.size, implemented.length);
		assert.equal(commands.get("run-everything")!.description, "Toggle Run Everything (currently …)");
		assert.equal(commands.has("model"), false);
		assert.equal(commands.has("goal"), false);
		assert.equal(commands.has("commit"), false);
	});
});

describe("usage and porcelain helpers", () => {
	it("totalUsage sums input, output, and cost", () => {
		const totals = totalUsage([
			{ type: "message", message: { role: "assistant", usage: { input: 10, output: 5, cost: { total: 0.5 } } } },
			{ type: "message", message: { role: "user" } },
			{ type: "message", message: { role: "assistant", usage: { input: 1, output: 2, cost: { total: 0.25 } } } },
			{ type: "model_change" },
		]);
		assert.deepEqual(totals, { input: 11, output: 7, cost: 0.75 });
		assert.deepEqual(totalUsage([]), { input: 0, output: 0, cost: 0 });
	});

	it("porcelainFiles trims and drops blank lines", () => {
		assert.deepEqual(porcelainFiles(" M a.ts\n?? b.ts\n\nA  c.ts\n"), ["M a.ts", "?? b.ts", "A  c.ts"]);
		assert.deepEqual(porcelainFiles(""), []);
	});
});
