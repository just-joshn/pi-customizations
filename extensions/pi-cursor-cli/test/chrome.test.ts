import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.FORCE_COLOR = "3";

const ThemeCtor = (await import("@earendil-works/pi-coding-agent")).Theme;
	type Theme = InstanceType<typeof ThemeCtor>;
const { renderHeaderLine } = await import("../src/chrome/header.ts");
const { countEditedFiles, formatContextPercent, formatContextWindow, renderFooterRows } = await import("../src/chrome/footer.ts");
const { spinnerFrames } = await import("../src/chrome/working.ts");
const { createState } = await import("../src/index.ts");

const themeJson = JSON.parse(readFileSync(fileURLToPath(new URL("../themes/cursor-dark.json", import.meta.url)), "utf8"));

function darkTheme(): Theme {
	const colors = themeJson.colors as Record<string, string>;
	const fgRoles = [
		"accent", "bashMode", "border", "borderAccent", "borderMuted", "customMessageLabel",
		"customMessageText", "dim", "error", "mdCode", "mdCodeBlock", "mdCodeBlockBorder",
		"mdHeading", "mdHr", "mdLink", "mdLinkUrl", "mdListBullet", "mdQuote", "mdQuoteBorder",
		"muted", "success", "syntaxComment", "syntaxFunction", "syntaxKeyword", "syntaxNumber",
		"syntaxOperator", "syntaxPunctuation", "syntaxString", "syntaxType", "syntaxVariable",
		"text", "thinkingHigh", "thinkingLow", "thinkingMax", "thinkingMedium", "thinkingMinimal",
		"thinkingOff", "thinkingText", "thinkingXhigh", "toolDiffAdded", "toolDiffContext",
		"toolDiffRemoved", "toolOutput", "toolTitle", "userMessageText", "warning",
	];
	const bgRoles = ["customMessageBg", "searchMatchBg", "selectedBg", "toolErrorBg", "toolPendingBg", "toolSuccessBg", "userMessageBg"];
	const fg = Object.fromEntries(fgRoles.map((r) => [r, colors[r]!]));
	const bg = Object.fromEntries(bgRoles.map((r) => [r, colors[r]!]));
	return new ThemeCtor(fg as never, bg as never, "truecolor", { name: "cursor-dark" });
}

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

describe("header", () => {
	it("renders the bold title and dim version", () => {
		const theme = darkTheme();
		const line = renderHeaderLine(theme, "0.87.1");
		assert.equal(strip(line), "Cursor Agent v0.87.1");
		assert.ok(line.includes("\x1b[1mCursor Agent"), "title is bold");
		assert.ok(line.includes("38;2;110;110;112m"), "version uses the dim hex #6E6E70");
	});
});

describe("footer helpers", () => {
	it("formats context percent like Cursor", () => {
		assert.equal(formatContextPercent(42, 999), "42%");
		assert.equal(formatContextPercent(42.44, 999), "42.4%");
		assert.equal(formatContextPercent(42.45, 999), "42.5%");
		assert.equal(formatContextPercent(null, 1230), "1.23k");
		assert.equal(formatContextPercent(null, null), "-");
	});

	it("formats the context window as a k summary", () => {
		assert.equal(formatContextWindow(200000), "200k");
		assert.equal(formatContextWindow(1000000), "1000k");
	});

	it("counts distinct edited files from assistant tool calls", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", toolCalls: [{ name: "edit", arguments: { path: "/a.ts" } }, { name: "write", arguments: { path: "/b.ts" } }] } },
			{ type: "message", message: { role: "assistant", toolCalls: [{ name: "edit", arguments: `{"path":"/a.ts"}` }] } },
			{ type: "message", message: { role: "assistant", toolCalls: [{ name: "read", arguments: { path: "/c.ts" } }] } },
			{ type: "message", message: { role: "user", content: "hi" } },
		];
		assert.equal(countEditedFiles(entries), 2);
		assert.equal(countEditedFiles([]), 0);
	});
});

describe("footer rows", () => {
	const theme = darkTheme();
	const base = {
		theme,
		modelName: "Test Model",
		contextWindow: 200000,
		contextPercent: 42,
		contextTokens: null as number | null,
		filesEdited: 2,
		cwd: "/home/u/proj",
		home: "/home/u",
		branch: "main" as string | undefined,
		width: 80,
	};

	it("renders headline, status row and location row", () => {
		const state = createState();
		state.mode = "plan";
		state.autoReview = true;
		const lines = renderFooterRows({ ...base, state });
		assert.equal(lines.length, 3);
		assert.equal(strip(lines[0]!), "  Plan (shift+tab to cycle)");
		const rowB = strip(lines[1]!);
		assert.ok(rowB.includes("Test Model · 200k"), `left group: ${rowB}`);
		assert.ok(rowB.includes("42%"), `left group: ${rowB}`);
		assert.ok(rowB.includes("2 files edited"), `left group: ${rowB}`);
		assert.ok(rowB.includes("Auto-review"), `right group: ${rowB}`);
		assert.ok(lines[1]!.includes("\x1b[35m"), "autorun label uses ANSI magenta");
		assert.ok(rowB.trimEnd().endsWith("-- INSERT --"), `vim label trails: ${rowB}`);
		const rowC = strip(lines[2]!);
		assert.equal(rowC, "  ~/proj · main");
	});

	it("hides headline in default mode and empty location bits when absent", () => {
		const state = createState();
		const lines = renderFooterRows({ ...base, state, branch: undefined });
		assert.equal(lines.length, 2);
		const rowC = strip(lines[1]!);
		assert.equal(rowC, "  ~/proj");
	});

	it("right-aligns the right group of row B", () => {
		const state = createState();
		state.runEverything = true;
		const lines = renderFooterRows({ ...base, state, filesEdited: 0 });
		const rowB = lines[0]!;
		const stripped = strip(rowB);
		assert.ok(stripped.includes("Run Everything"));
		const tailStart = rowB.indexOf("\x1b[35mRun Everything");
		assert.ok(tailStart > 40, `autorun label is right-aligned near column ${tailStart}`);
	});
});

describe("working indicator", () => {
	it("colors the eight braille frames green", () => {
		const frames = spinnerFrames("truecolor", "cursor-dark");
		assert.equal(frames.length, 8);
		assert.ok(frames.every((f) => f.includes("38;2;88;214;141m")), "green #58D68D");
		assert.equal(strip(frames[0]!), "⠀⠞");
	});
});
