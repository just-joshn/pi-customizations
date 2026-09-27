import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAllowlist, isAllowlisted, installDecisionGate } from "../src/decisions/gate.ts";
import { DecisionSurface, decisionTitle, shellOptions, writeOptions } from "../src/decisions/surface.ts";
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
		assert.deepEqual(sorted.map((t) => t.id), ["2", "3", "1"]);
	});

	it("renders the Reference TodosUI rows and status line", async () => {
		const theme = await makeTheme();
		const todos = [
			{ id: "1", content: "done thing", status: "completed" as const },
			{ id: "2", content: "current thing", status: "in_progress" as const },
			{ id: "3", content: "later thing", status: "pending" as const },
		];
		assert.equal(todoStatusLine(todos, false), "Working on 3 to-do(s) • 1 done");
		assert.equal(todoStatusLine(todos, true), "All done");
		const rows = todoRows(theme, todos).map(strip);
		assert.equal(rows[0], "  ✔ done thing");
		assert.equal(rows[1], "  ◐ current thing");
		assert.equal(rows[2], "  ○ later thing");
	});

	it("execute stores todos in details and reports to the model", async () => {
		const defs = new Map<string, { execute: (id: string, params: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }> }>();
		registerTodosTool({ registerTool: (def: { name: string; execute: (id: string, params: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }> }) => defs.set(def.name, def) } as unknown as ExtensionAPI);
		const todo = defs.get("todo_update")!;
		const out = await todo.execute("t1", { todos: [{ id: "1", content: "x", status: "pending" }] });
		assert.equal(out.content[0].text, "Updated 1 to-do(s); 0 completed.");
		assert.deepEqual(out.details, { todos: [{ id: "1", content: "x", status: "pending" }] });
	});
});

describe("decision gate", () => {
	it("allowlists exact shell commands and paths", () => {
		const allowlist = createAllowlist();
		assert.equal(isAllowlisted(allowlist, "bash", { command: "ls" }), false);
		allowlist.shells.add("ls");
		assert.equal(isAllowlisted(allowlist, "bash", { command: "ls" }), true);
		assert.equal(isAllowlisted(allowlist, "edit", { path: "/a" }), false);
		allowlist.paths.add("/a");
		assert.equal(isAllowlisted(allowlist, "write", { path: "/a" }), true);
	});

	it("titles follow the Reference decision table", () => {
		assert.equal(decisionTitle("bash"), "Run this command?");
		assert.equal(decisionTitle("write"), "Write to this file?");
		assert.equal(decisionTitle("edit"), "Write to this file?");
	});

	it("option sets carry the Reference labels and keys", () => {
		const shell = shellOptions("git status");
		assert.deepEqual(shell.map((o) => o.action), ["approve", "allow", "reject"]);
		assert.ok(shell[1]!.label.startsWith("Add Shell(git status)"));
		assert.equal(shell[2]!.hint, "(esc or n)");
		const write = writeOptions("write(/a/b.ts)");
		assert.equal(write[0]!.label, "Proceed");
		assert.equal(write[1]!.label, "Add write(/a/b.ts) to allowlist");
	});

	function driveVia(keys: string[]): ExtensionContext["ui"]["custom"] {
		return (factory) => {
			return new Promise((resolve) => {
				void makeTheme().then((theme) => {
					const tui = { requestRender: () => {} } as never;
					const surface = factory(tui, theme, {} as never, (outcome) => resolve(outcome)) as DecisionSurface;
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
		const { handler } = gateFor(tuiCtx(driveVia(["y"])));
		const result = await handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "echo hi" } }, tuiCtx(driveVia(["y"])));
		assert.equal(result, undefined);
	});

	it("n blocks with a reason", async () => {
		const { handler } = gateFor(tuiCtx(driveVia(["n"])));
		const result = await handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "rm -rf /" } }, tuiCtx(driveVia(["n"])));
		assert.deepEqual(result, { block: true, reason: "The user declined this action." });
	});

	it("tab allows and records the allowlist entry", async () => {
		const g = gateFor(tuiCtx(driveVia(["\t"])));
		const result = await g.handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "npm test" } }, tuiCtx(driveVia(["\t"])));
		assert.equal(result, undefined);
		assert.ok(g.allowlist.shells.has("npm test"));
	});

	it("runEverything bypasses the gate", async () => {
		const g = gateFor(tuiCtx(driveVia([])));
		g.state.runEverything = true;
		const result = await g.handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "anything" } }, g.handler as never as ExtensionContext);
		assert.equal(result, undefined);
	});

	it("non-TUI modes proceed without approval", async () => {
		const { handler } = gateFor({ mode: "print", hasUI: false, ui: {} } as unknown as ExtensionContext);
		const result = await handler({ type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "ls" } }, { mode: "print", hasUI: false, ui: {} } as unknown as ExtensionContext);
		assert.equal(result, undefined);
	});
});

describe("decision surface keys", () => {
	it("renders the purple frame, title, and selected arrow row", async () => {
		const theme = await makeTheme();
		const surface = new DecisionSurface({ requestRender: () => {} }, theme, { operation: "bash", title: "Run this command?", preview: ["$ ls", "in /proj"], allowlistLabel: "" }, shellOptions("ls"), () => {});
		const rows = surface.render(80).map(strip);
		assert.equal(rows[0], "─".repeat(80));
		assert.ok(rows.some((r) => r.includes("$ ls")));
		assert.ok(rows.some((r) => r.includes("Run this command?")));
		assert.ok(rows.some((r) => r.includes("→ Run (once) (y)")), `rows: ${JSON.stringify(rows)}`);
		assert.ok(rows.some((r) => r.includes("↑/↓ to navigate")));
	});

	it("escape rejects", async () => {
		const theme = await makeTheme();
		const outcome = await new Promise<unknown>((resolve) => {
			const surface = new DecisionSurface({ requestRender: () => {} }, theme, { operation: "shell", title: "Run this command?", preview: [], allowlistLabel: "" }, shellOptions("ls"), resolve);
			surface.handleInput("\x1b");
		});
		assert.deepEqual(outcome, { action: "reject", reason: "The user skipped this action." });
	});
});
