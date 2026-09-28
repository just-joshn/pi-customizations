import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	channelBrightness,
	effectiveRatio,
	isLightBackground,
	mixTint,
	nearestAnsi256,
	parseHex,
	getTokens,
	TUI_TOKENS,
} from "../src/palette.ts";

describe("tint mixing", () => {
	it("matches the the reference CLI formula on a black background", () => {
		const mixed = mixTint([0, 0, 0], [0x55, 0x55, 0x66], 0.82);
		assert.deepEqual(mixed, [31, 31, 37]);
	});

	it("matches the the reference CLI formula on a white background", () => {
		const mixed = mixTint([255, 255, 255], [0x55, 0x55, 0x66], 0.82);
		assert.deepEqual(mixed, [194, 194, 200]);
	});

	it("matches the the reference CLI formula near mid brightness", () => {
		const mixed = mixTint([128, 128, 128], [80, 80, 80], 0.82);
		assert.deepEqual(mixed, [119, 119, 119]);
	});

	it("clamps the effective ratio at 0.5", () => {
		assert.equal(effectiveRatio(0.4, 0.5), 0.5);
		assert.ok(Math.abs(effectiveRatio(0.82, 0) - 0.64) < 1e-9);
		assert.ok(Math.abs(effectiveRatio(0.82, 1) - 0.64) < 1e-9);
	});
});

describe("brightness and light/dark", () => {
	it("computes the weighted channel sum", () => {
		assert.equal(channelBrightness([0, 0, 0]), 0);
		assert.equal(channelBrightness([255, 255, 255]), 1);
		assert.ok(Math.abs(channelBrightness([153, 153, 153]) - 0.6) < 1e-9);
	});

	it("applies the strictly-greater-than-0.6 threshold", () => {
		assert.equal(isLightBackground([153, 153, 153]), false);
		assert.equal(isLightBackground([154, 154, 154]), true);
	});
});

describe("ANSI256 approximation", () => {
	it("excludes indices 0-15 and finds exact palette entries", () => {
		assert.equal(nearestAnsi256([0, 0, 0]), 16);
		assert.equal(nearestAnsi256([255, 255, 255]), 231);
	});
});

describe("tui tokens", () => {
	it("carries the exact research values for dark", () => {
		const t = TUI_TOKENS["tui-dark"];
		assert.equal(t.pagerAccent, "#F4E7A1");
		assert.equal(t.decisionPurple, "#A78BFA");
		assert.equal(t.debugPink, "#E34671");
		assert.deepEqual(t.userMessage, { tint: "#555566", ratio: 0.82, fallback: "#242428", ansi256: 235 });
		assert.deepEqual(t.userMessageFollowUp, { tint: "#6a6040", ratio: 0.78, fallback: "#2e2818", ansi256: 94 });
		assert.deepEqual(t.composerBg, { tint: "#505050", ratio: 0.95, fallback: "#151515", ansi256: 233 });
		assert.deepEqual(t.btwBar, { tint: "#707070", ratio: 0.9, fallback: "#333333", ansi256: 236 });
		assert.equal(t.diff.addedRowBg, "#2b3f2b");
		assert.equal(t.diff.removedRowBg, "#402626");
		assert.equal(t.diff.addedSignFg, "#3fb950");
		assert.equal(t.diff.removedSignFg, "#f85149");
	});

	it("carries the exact research values for light", () => {
		const t = TUI_TOKENS["tui-light"];
		assert.equal(t.pagerAccent, "#7A5A00");
		assert.deepEqual(t.userMessage, { tint: "#b0b0b0", ratio: 0.82, fallback: "#e8e8e8", ansi256: 254 });
		assert.deepEqual(t.composerBg, { tint: "#d0d0d0", ratio: 0.9, fallback: "#f2f2f2", ansi256: 255 });
		assert.deepEqual(t.btwBar, { tint: "#8a8a8a", ratio: 0.9, fallback: "#d6d6d6", ansi256: 252 });
		assert.equal(t.diff.addedRowBg, "#D0E8C5");
		assert.equal(t.diff.removedRowBg, "#F7D1BA");
		assert.equal(t.diff.addedSignFg, "#15803d");
		assert.equal(t.diff.removedSignFg, "#b91c1c");
	});

	it("falls back to dark tokens for unknown theme names", () => {
		assert.equal(getTokens("nord"), TUI_TOKENS["tui-dark"]);
		assert.equal(getTokens(undefined), TUI_TOKENS["tui-dark"]);
	});
});

describe("palette SGR output", () => {
	it("emits truecolor and 256-color escapes", async () => {
		const { paletteFg, paletteBg } = await import("../src/palette.ts");
		assert.equal(paletteFg("#F4E7A1", "truecolor", "x"), "\x1b[38;2;244;231;161mx\x1b[0m");
		const bg = parseHex("#F4E7A1");
		const idx = nearestAnsi256(bg);
		assert.equal(paletteBg("#F4E7A1", "256color", "x"), `\x1b[48;5;${idx}mx\x1b[0m`);
	});
});
