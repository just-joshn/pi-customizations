import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReferenceTools } from "../src/tools/renderers.ts";
import type { ToolRowState } from "../src/tools/ui.ts";
import { makeTheme } from "./theme.ts";

type AnyDef = {
	name: string;
	renderCall?: (args: unknown, theme: unknown, context: unknown) => { render: (w: number) => string[] };
	renderResult?: (result: unknown, options: unknown, theme: unknown, context: unknown) => { render: (w: number) => string[] };
	execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown) => Promise<unknown>;
};

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

function capture(): Map<string, AnyDef> {
	const defs = new Map<string, AnyDef>();
	const fakePi = { registerTool: (def: AnyDef) => defs.set(def.name, def) } as unknown as ExtensionAPI;
	registerReferenceTools(fakePi);
	return defs;
}

function makeContext(args: unknown): { ctx: unknown; state: () => ToolRowState | undefined } {
	const holder: { toolCallId: string; invalidate: () => void; state: ToolRowState | undefined; args: unknown; cwd: string } = {
		toolCallId: "t1",
		invalidate: () => {},
		state: {} as ToolRowState,
		args,
		cwd: "/proj",
	};
	return { ctx: holder, state: () => holder.state };
}

function result(text: string, details?: unknown): unknown {
	return { content: [{ type: "text", text }], details };
}

describe("reference tool renderers", () => {
	it("registers all seven built-in tool renderers", () => {
		assert.deepEqual([...capture().keys()].sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);
	});

	it("read: progressive verb, path, lines note, then past verb", async () => {
		const theme = await makeTheme();
		const read = capture().get("read")!;
		const { ctx, state } = makeContext({ path: "x.ts", offset: 4, limit: 10 });
		const comp = read.renderCall!({ path: "x.ts", offset: 4, limit: 10 }, theme, ctx);
		assert.equal(strip(comp.render(200)[0]!), " Reading x.ts lines 5-14");
		read.renderResult!(result("file body"), { expanded: false, isPartial: false }, theme, ctx);
		assert.equal(state()?.verb, "Read");
	});

	it("edit: +N -M note from the patch and the bordered diff block", async () => {
		const theme = await makeTheme();
		const edit = capture().get("edit")!;
		const { ctx } = makeContext({ path: "/proj/src/a.ts" });
		edit.renderCall!({ path: "/proj/src/a.ts" }, theme, ctx);
		const patch = ["@@ -1,2 +1,2 @@", "-old line", "+new line", " context"].join("\n");
		const comp = edit.renderResult!(result("", { diff: "-old line\n+new line\n context", patch }), { expanded: false, isPartial: false }, theme, ctx);
		const rows = comp.render(120).map(strip);
		assert.deepEqual(rows.map((r) => r.trimEnd()), ["  ▎ -old line", "  ▎ +new line", "  ▎  context"]);
	});

	it("bash: collapsed output shows 2 lines plus the hidden hint", async () => {
		const theme = await makeTheme();
		const bash = capture().get("bash")!;
		const { ctx } = makeContext({ command: "echo one" });
		bash.renderCall!({ command: "echo one" }, theme, ctx);
		const output = ["l1", "l2", "l3", "l4", "l5"].join("\n");
		const callRow = bash.renderCall!({ command: "echo one" }, theme, ctx) as { render: (w: number) => string[] };
		bash.renderResult!(result(`${output}\nexit code: 0`), { expanded: false, isPartial: false }, theme, ctx);
		const header = strip(callRow.render(200)[0]!);
		assert.ok(header.includes("$ echo one"), `header: ${header}`);
		const rows = (bash.renderResult!(result(`${output}\nexit code: 0`), { expanded: false, isPartial: false }, theme, ctx) as { render: (w: number) => string[] }).render(200).map(strip);
		assert.ok(rows.some((r) => r.includes("l1")));
		assert.ok(rows.some((r) => r.includes("l2")));
		assert.ok(rows.some((r) => r.includes("… 3 output lines hidden · ctrl+o to expand")), `rows: ${JSON.stringify(rows)}`);
	});

	it("bash: failure suffix carries the exit code", async () => {
		const theme = await makeTheme();
		const bash = capture().get("bash")!;
		const { ctx } = makeContext({ command: "false" });
		bash.renderCall!({ command: "false" }, theme, ctx);
		const callRow = bash.renderCall!({ command: "false" }, theme, ctx) as { render: (w: number) => string[] };
		bash.renderResult!(result("boom\nexit code: 2"), { expanded: false, isPartial: false }, theme, ctx);
		const header = strip(callRow.render(200)[0]!);
		assert.ok(header.includes("exit 2"), `header: ${header}`);
	});

	it("grep: 40-char pattern rule and Found N matches", async () => {
		const theme = await makeTheme();
		const grep = capture().get("grep")!;
		const longPattern = "y".repeat(50);
		const { ctx } = makeContext({ pattern: longPattern });
		const comp = grep.renderCall!({ pattern: longPattern }, theme, ctx);
		assert.ok(strip(comp.render(200)[0]!).includes(`"...${"y".repeat(37)}"`), `header: ${strip(comp.render(200)[0]!)}`);
		const res = grep.renderResult!(result("a:1:x\na:2:y"), { expanded: false, isPartial: false }, theme, ctx);
		assert.equal(res.render(120).map((r) => strip(r).trimEnd()).join("\n"), "  Found 2 matches");
	});

	it("find: Found N files with glob phrasing", async () => {
		const theme = await makeTheme();
		const find = capture().get("find")!;
		const { ctx } = makeContext({ pattern: "*.ts" });
		find.renderCall!({ pattern: "*.ts" }, theme, ctx);
		const res = find.renderResult!(result("a.ts\nb.ts\nc.ts"), { expanded: false, isPartial: false }, theme, ctx);
		assert.equal(res.render(120).map((r) => strip(r).trimEnd()).join("\n"), "  Found 3 files");
	});

	it("ls: files and directories note", async () => {
		const theme = await makeTheme();
		const ls = capture().get("ls")!;
		const { ctx } = makeContext({});
		ls.renderCall!({}, theme, ctx);
		const res = ls.renderResult!(result("a.txt\nsrc/\nREADME.md\ndocs/"), { expanded: false, isPartial: false }, theme, ctx);
		assert.equal(res.render(120).map((r) => strip(r).trimEnd()).join("\n"), "  2 files, 2 directories");
	});

	it("write: additions-only note from content lines", async () => {
		const theme = await makeTheme();
		const write = capture().get("write")!;
		const { ctx, state } = makeContext({ path: "/proj/new.ts", content: "a\nb\nc" });
		write.renderCall!({ path: "/proj/new.ts", content: "a\nb\nc" }, theme, ctx);
		assert.equal(state()?.note, "+3");
		write.renderResult!(result("ok"), { expanded: false, isPartial: false }, theme, ctx);
		assert.equal(state()?.verb, "Wrote");
	});

	it("executes are delegated: bash runs a real command", async () => {
		const bash = capture().get("bash")!;
		const out = (await bash.execute("x", { command: "printf hi" }, undefined, undefined)) as { content: { type: string; text?: string }[] };
		assert.ok(out.content[0]!.type === "text" && out.content[0]!.text!.includes("hi"));
	});
});
