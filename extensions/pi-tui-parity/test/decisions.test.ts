import { describe, it, expect } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAllowlist, isAllowlisted, installDecisionGate } from "../src/decisions/gate.ts";
import { DecisionSurface, decisionTitle, shellOptions, writeOptions } from "../src/decisions/surface.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createSessionState } from "../src/state.ts";
import { registerTodosTool, sortTodos, todoRows, todoStatusLine } from "../src/tools/todos.ts";
import { makeTheme } from "./theme.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

describe("todos tool", () => {
	it("orders completed, in progress, then pending", () => {
		const sorted = sortTodos([
			{ id: "1", content: "a", status: "pending" },
			{ id: "2", content: "b", status: "completed" },
			{ id: "3", content: "c", status: "in_progress" },
		]);
		expect(sorted.map((t) => t.id)).toEqual(["2", "3", "1"]);
		expect(sortTodos([])).toEqual([]);
	});

	it("renders the Reference TodosUI rows and status line", async () => {
		const theme = await makeTheme();
		const todos = [
			{ id: "1", content: "done thing", status: "completed" as const },
			{ id: "2", content: "current thing", status: "in_progress" as const },
			{ id: "3", content: "later thing", status: "pending" as const },
		];
		expect(todoStatusLine(todos, false)).toBe("Working on 3 to-do(s) • 1 done");
		expect(todoStatusLine(todos, true)).toBe("All done");
		expect(todoStatusLine([], false)).toBe("Working on 0 to-do(s) • 0 done");
		const rows = todoRows(theme, todos).map(strip);
		expect(rows[0]).toBe("  ✔ done thing");
		expect(rows[1]).toBe("  ◐ current thing");
		expect(rows[2]).toBe("  ○ later thing");
		expect(todoRows(theme, [])).toEqual([]);
	});

	it("execute stores todos in details and reports to the model", async () => {
		const defs = new Map<string, { execute: (id: string, params: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }> }>();
		registerTodosTool({ registerTool: (def: { name: string; execute: (id: string, params: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }> }) => defs.set(def.name, def) } as unknown as ExtensionAPI);
		const todo = defs.get("todo_update")!;
		const out = await todo.execute("t1", { todos: [{ id: "1", content: "x", status: "pending" }] });
		expect(out.content[0].text).toBe("Updated 1 to-do(s); 0 completed.");
		expect(out.details).toEqual({ todos: [{ id: "1", content: "x", status: "pending" }] });
		const empty = await todo.execute("t2", { todos: [] });
		expect(empty.content[0].text).toBe("Updated 0 to-do(s); 0 completed.");
		expect(empty.details).toEqual({ todos: [] });
	});
});

describe("decision gate", () => {
	it("allowlists exact shell commands and paths", () => {
		const allowlist = createAllowlist();
		expect(isAllowlisted(allowlist, "bash", { command: "ls" })).toBe(false);
		expect(isAllowlisted(allowlist, "bash", {})).toBe(false);
		allowlist.shells.add("ls");
		expect(isAllowlisted(allowlist, "bash", { command: "ls" })).toBe(true);
		allowlist.paths.add("/a");
		expect(isAllowlisted(allowlist, "write", { path: "/a" })).toBe(true);
		expect(isAllowlisted(allowlist, "edit", { path: "/b" })).toBe(false);
	});

	it("titles follow the the reference CLI decision table", () => {
		expect(decisionTitle("bash")).toBe("Run this command?");
		expect(decisionTitle("write")).toBe("Write to this file?");
		expect(decisionTitle("edit")).toBe("Write to this file?");
	});

	it("option sets carry the the reference CLI labels and keys", () => {
		const shell = shellOptions("git status");
		expect(shell.map((o) => o.action)).toEqual(["approve", "allow", "reject"]);
		expect(shell[1]!.label.startsWith("Add Shell(git status)")).toBe(true);
		expect(shell[2]!.hint).toBe("(esc or n)");
		const write = writeOptions("write(/a/b.ts)");
		expect(write[0]!.label).toBe("Proceed");
		expect(write[1]!.label).toBe("Add write(/a/b.ts) to allowlist");
	});

	function driveVia(keys: string[], outcomes: unknown[] = []): ExtensionContext["ui"]["custom"] {
		return (factory) => {
			return new Promise((resolve) => {
				void makeTheme().then((theme) => {
					const tui = { requestRender: () => {} } as never;
					const surface = factory(tui, theme, {} as never, (outcome) => { outcomes.push(outcome); resolve(outcome); }) as DecisionSurface;
					for (const k of keys) surface.handleInput(k);
				});
			});
		};
	}

	function gateFor(ctx: ExtensionContext): { handler: (event: unknown, ctx2: ExtensionContext) => Promise<unknown>; state: ReturnType<typeof createSessionState>; allowlist: ReturnType<typeof createAllowlist> } {
		let captured: ((event: unknown, ctx: ExtensionContext) => Promise<unknown>) | undefined;
		const pi = { on: (event: string, handler: never) => { if (event === "tool_call") captured = handler; } } as unknown as ExtensionAPI;
		const state = createSessionState();
		const allowlist = createAllowlist();
		installDecisionGate(pi, state, allowlist);
		return { handler: captured!, state, allowlist };
	}

	function tuiCtx(uiCustom: ExtensionContext["ui"]["custom"]): ExtensionContext {
		return { mode: "tui", hasUI: true, ui: { custom: uiCustom } } as unknown as ExtensionContext;
	}

	it("y approves through the real surface", async () => {
		const outcomes: unknown[] = [];
		const ctx = tuiCtx(driveVia(["y"], outcomes));
		const { handler } = gateFor(ctx);
		const result = await handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "echo hi" } }, ctx);
		expect(outcomes).toEqual([{ action: "approve" }]);
		expect(result).toBeUndefined();
	});

	it("n blocks with a reason", async () => {
		const { handler } = gateFor(tuiCtx(driveVia(["n"])));
		const result = await handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "rm -rf /" } }, tuiCtx(driveVia(["n"])));
		expect(result).toEqual({ block: true, reason: "The user declined this action." });
	});

	it("tab allows and records the allowlist entry", async () => {
		const g = gateFor(tuiCtx(driveVia(["\t"])));
		const result = await g.handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "npm test" } }, tuiCtx(driveVia(["\t"])));
		expect(result).toBeUndefined();
		expect(g.allowlist.shells.has("npm test")).toBe(true);
	});

	it("runEverything bypasses the gate while the same command still asks otherwise", async () => {
		const bypassedOutcomes: unknown[] = [];
		const bypassCtx = tuiCtx(driveVia(["y"], bypassedOutcomes));
		const bypass = gateFor(bypassCtx);
		bypass.state.runEverything = true;
		const bypassed = await bypass.handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "anything" } }, bypassCtx);

		const gatedOutcomes: unknown[] = [];
		const gatedCtx = tuiCtx(driveVia(["n"], gatedOutcomes));
		const gated = await gateFor(gatedCtx).handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "anything" } }, gatedCtx);

		expect(bypassed).toBeUndefined();
		expect(gated).toEqual({ block: true, reason: "The user declined this action." });
		expect(bypassedOutcomes).toEqual([]);
		expect(gatedOutcomes).toEqual([{ action: "reject", reason: "The user declined this action." }]);
	});

	it("non-TUI modes proceed without approval while TUI mode asks", async () => {
		const printCtx = { mode: "print", hasUI: false, ui: {} } as unknown as ExtensionContext;
		const printed = await gateFor(printCtx).handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "ls" } }, printCtx);

		const outcomes: unknown[] = [];
		const tui = tuiCtx(driveVia(["n"], outcomes));
		const gated = await gateFor(tui).handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "ls" } }, tui);

		expect(printed).toBeUndefined();
		expect(gated).toEqual({ block: true, reason: "The user declined this action." });
		expect(outcomes).toEqual([{ action: "reject", reason: "The user declined this action." }]);
	});
});

describe("decision surface keys", () => {
	it("renders the purple frame, title, and selected arrow row", async () => {
		const theme = await makeTheme();
		const surface = new DecisionSurface({ requestRender: () => {} }, theme, { operation: "bash", title: "Run this command?", preview: ["$ ls", "in /proj"], allowlistLabel: "" }, shellOptions("ls"), () => {});
		const rows = surface.render(80).map(strip);
		expect(rows[0]).toBe("─".repeat(80));
		expect(rows.some((r) => r.includes("$ ls"))).toBe(true);
		expect(rows.some((r) => r.includes("Run this command?"))).toBe(true);
		expect(rows.some((r) => r.includes("→ Run (once) (y)"))).toBe(true);
		expect(rows.some((r) => r.includes("↑/↓ to navigate"))).toBe(true);
	});

	it("escape rejects", async () => {
		const theme = await makeTheme();
		const outcome = await new Promise<unknown>((resolve) => {
			const surface = new DecisionSurface({ requestRender: () => {} }, theme, { operation: "shell", title: "Run this command?", preview: [], allowlistLabel: "" }, shellOptions("ls"), resolve);
			surface.handleInput("\x1b");
		});
		expect(outcome).toEqual({ action: "reject", reason: "The user skipped this action." });
	});

	it("truncates all rendered rows to width when command and paths exceed terminal width", async () => {
		const theme = await makeTheme();
		const longCommand = "cat ~/.pi/agent/settings.json 2>/dev/null || cat ~/.pi/agent/config.json 2>/dev/null || ls -la ~/.pi/agent/";
		const surface = new DecisionSurface(
			{ requestRender: () => {} },
			theme,
			{
				operation: "bash",
				title: "Run this command?",
				preview: [`$ ${longCommand}`, "in /Users/josh-desktop/src/personal/pi-customizations"],
				allowlistLabel: "",
			},
			shellOptions(longCommand),
			() => {},
		);
		const rows = surface.render(87);
		for (const [idx, row] of rows.entries()) {
			const w = visibleWidth(row);
			expect(w <= 87).toBe(true);
		}
	});
});
