import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderContextScreen } from "../src/pagers/context.ts";
import { ContextPager, CopyPager, UsagePager, copyRows, installPagers, usageRows } from "../src/pagers/pagers.ts";
import { makeTheme } from "./theme.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");
const tui = { requestRender: () => {} };

const CONTEXT_OPTS = {
	modelName: "claude-sonnet-4",
	contextWindow: 200000,
	tokens: 84000,
	percent: 42,
	categories: [
		{ label: "System prompt", tokens: 2000 },
		{ label: "Messages", tokens: 82000 },
	],
};

function usageEntry(model: string, input: number, output: number, cost: number) {
	return { type: "message", message: { role: "assistant", model, usage: { input, output, cost: { total: cost } } } };
}

function userEntry(text: string) {
	return { type: "message", message: { role: "user", content: text } };
}

describe("context pager screen", () => {
	it("renders the Cursor header, scale, and free-space rows", async () => {
		const theme = await makeTheme();
		const rows = renderContextScreen({ ...CONTEXT_OPTS, width: 80, theme }).map(strip);
		assert.ok(rows.some((r) => r.includes("Context • claude-sonnet-4")), `rows: ${JSON.stringify(rows)}`);
		assert.ok(rows.some((r) => r.includes("84k / 200k") && r.includes("42%")));
		assert.ok(rows.some((r) => r.includes("Current context usage by category.")));
		const scale = rows.find((r) => r.includes("25") && r.includes("50") && r.includes("75") && r.includes("100%"));
		assert.ok(scale?.trimStart().startsWith("0"), `scale: ${scale}`);
		assert.ok(rows.some((r) => r.includes("System prompt 2k • 1.0%")));
		assert.ok(rows.some((r) => r.includes("Messages 82k • 41.0%")));
		assert.ok(rows.some((r) => r.includes("Free space 116k • 58.0%")));
	});

	it("builds the bar from background-colored space segments", async () => {
		const theme = await makeTheme();
		const raw = renderContextScreen({ ...CONTEXT_OPTS, width: 80, theme }).join("\n");
		assert.match(raw, /\x1b\[48;2;\d+;\d+;\d+m|\x1b\[48;5;\d+m/);
		const bar = raw.split("\n").find((l) => /48;(2|5);\d+/.test(l) && l.replace(ANSI, "").trim() === "");
		assert.ok(bar, "expected a bar row of only colored spaces");
		assert.ok(bar!.replace(ANSI, "").length >= 80);
	});

	it("shows the empty state when tokens are unknown", async () => {
		const theme = await makeTheme();
		const rows = renderContextScreen({ ...CONTEXT_OPTS, tokens: null, percent: null, width: 80, theme }).map(strip);
		assert.ok(rows.some((r) => r.includes("No context usage breakdown to show yet.")));
		assert.equal(rows.some((r) => r.includes("Free space")), false);
	});
});

describe("usage pager", () => {
	it("totals tokens and cost per model from branch entries", () => {
		const rows = usageRows([usageEntry("m1", 900, 300, 0.0123), usageEntry("m1", 300, 50, 0.001), usageEntry("m2", 10, 5, 0)]);
		assert.deepEqual(rows, [
			{ model: "m1", input: 1200, output: 350, cost: 0.0133 },
			{ model: "m2", input: 10, output: 5, cost: 0 },
		]);
	});

	it("renders model in out cost rows", async () => {
		const theme = await makeTheme();
		const pager = new UsagePager(tui, theme, usageRows([usageEntry("claude-sonnet-4", 900, 300, 0.0123), usageEntry("claude-sonnet-4", 300, 0, 0)]), () => {});
		const rows = pager.render(80).map(strip);
		const row = rows.find((r) => r.startsWith("claude-sonnet-4"));
		assert.ok(row?.includes("1.2k") && row?.includes("300") && row?.includes("$0.012"), `row: ${row}`);
		assert.ok(rows.some((r) => r.includes("Usage")));
		assert.ok(rows.some((r) => r.includes("Esc to close")));
	});

	it("escape resolves the pager", async () => {
		const theme = await makeTheme();
		const result = await new Promise<undefined>((resolve) => {
			new UsagePager(tui, theme, [], resolve).handleInput("\x1b");
		});
		assert.equal(result, undefined);
	});
});

describe("copy pager", () => {
	it("truncates previews at 60 chars with You/Agent prefixes", async () => {
		const theme = await makeTheme();
		const entries = [userEntry("x".repeat(80)), { type: "message", message: { role: "assistant", content: [{ type: "text", text: "y".repeat(70) }] } }];
		const pager = new CopyPager(tui, theme, copyRows(entries), () => {});
		const rows = pager.render(80).map(strip);
		const you = rows.find((r) => r.includes("You"));
		assert.ok(you?.includes("x".repeat(60)) && !you?.includes("x".repeat(61)), `you: ${you}`);
		const agent = rows.find((r) => r.includes("Agent"));
		assert.ok(agent?.includes("y".repeat(60)) && !agent?.includes("y".repeat(61)), `agent: ${agent}`);
	});

	it("copies the selected message text on Enter and closes on Escape", async () => {
		const theme = await makeTheme();
		const rows = copyRows([userEntry("first"), userEntry("second")]);
		const copied = await new Promise<string | undefined>((resolve) => {
			const pager = new CopyPager(tui, theme, rows, resolve);
			pager.handleInput("j");
			pager.handleInput("\r");
		});
		assert.equal(copied, "second");
		const closed = await new Promise<string | undefined>((resolve) => {
			new CopyPager(tui, theme, rows, resolve).handleInput("\x1b");
		});
		assert.equal(closed, undefined);
	});
});

describe("context pager component and install", () => {
	it("escape resolves the custom component promise", async () => {
		const theme = await makeTheme();
		const result = await new Promise<undefined>((resolve) => {
			new ContextPager(tui, theme, CONTEXT_OPTS, resolve).handleInput("\x1b");
		});
		assert.equal(result, undefined);
	});

	it("registers the context, usage, and copy commands", () => {
		const names: string[] = [];
		installPagers({ registerCommand: (name: string) => names.push(name) } as unknown as ExtensionAPI);
		assert.deepEqual(names, ["context", "usage"]);
	});
});
