import { describe, it, expect } from "vitest";
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
		expect(mixed).toEqual([31, 31, 37]);
	});

	it("matches the the reference CLI formula on a white background", () => {
		const mixed = mixTint([255, 255, 255], [0x55, 0x55, 0x66], 0.82);
		expect(mixed).toEqual([194, 194, 200]);
	});

	it("matches the the reference CLI formula near mid brightness", () => {
		const mixed = mixTint([128, 128, 128], [80, 80, 80], 0.82);
		expect(mixed).toEqual([119, 119, 119]);
	});

	it("clamps the effective ratio at 0.5", () => {
		expect(effectiveRatio(0.4, 0.5)).toBe(0.5);
		expect(Math.abs(effectiveRatio(0.82, 0) - 0.64) < 1e-9).toBe(true);
		expect(Math.abs(effectiveRatio(0.82, 1) - 0.64) < 1e-9).toBe(true);
	});
});

describe("brightness and light/dark", () => {
	it("computes the weighted channel sum", () => {
		expect(channelBrightness([0, 0, 0])).toBe(0);
		expect(channelBrightness([255, 255, 255])).toBe(1);
		expect(Math.abs(channelBrightness([153, 153, 153]) - 0.6) < 1e-9).toBe(true);
	});

	it("applies the strictly-greater-than-0.6 threshold", () => {
		expect(isLightBackground([153, 153, 153])).toBe(false);
		expect(isLightBackground([154, 154, 154])).toBe(true);
	});
});

describe("ANSI256 approximation", () => {
	it("excludes indices 0-15 and finds exact palette entries", () => {
		expect(nearestAnsi256([0, 0, 0])).toBe(16);
		expect(nearestAnsi256([255, 255, 255])).toBe(231);
	});
});

describe("tui tokens", () => {
	it("carries the exact research values for dark", () => {
		const t = TUI_TOKENS["tui-dark"];
		expect(t.pagerAccent).toBe("#F4E7A1");
		expect(t.decisionPurple).toBe("#A78BFA");
		expect(t.debugPink).toBe("#E34671");
		expect(t.userMessage).toEqual({ tint: "#555566", ratio: 0.82, fallback: "#242428", ansi256: 235 });
		expect(t.userMessageFollowUp).toEqual({ tint: "#6a6040", ratio: 0.78, fallback: "#2e2818", ansi256: 94 });
		expect(t.composerBg).toEqual({ tint: "#505050", ratio: 0.95, fallback: "#151515", ansi256: 233 });
		expect(t.btwBar).toEqual({ tint: "#707070", ratio: 0.9, fallback: "#333333", ansi256: 236 });
		expect(t.diff.addedRowBg).toBe("#2b3f2b");
		expect(t.diff.removedRowBg).toBe("#402626");
		expect(t.diff.addedSignFg).toBe("#3fb950");
		expect(t.diff.removedSignFg).toBe("#f85149");
	});

	it("carries the exact research values for light", () => {
		const t = TUI_TOKENS["tui-light"];
		expect(t.pagerAccent).toBe("#7A5A00");
		expect(t.userMessage).toEqual({ tint: "#b0b0b0", ratio: 0.82, fallback: "#e8e8e8", ansi256: 254 });
		expect(t.composerBg).toEqual({ tint: "#d0d0d0", ratio: 0.9, fallback: "#f2f2f2", ansi256: 255 });
		expect(t.btwBar).toEqual({ tint: "#8a8a8a", ratio: 0.9, fallback: "#d6d6d6", ansi256: 252 });
		expect(t.diff.addedRowBg).toBe("#D0E8C5");
		expect(t.diff.removedRowBg).toBe("#F7D1BA");
		expect(t.diff.addedSignFg).toBe("#15803d");
		expect(t.diff.removedSignFg).toBe("#b91c1c");
	});

	it("falls back to dark tokens for unknown theme names", () => {
		expect(getTokens("nord")).toBe(TUI_TOKENS["tui-dark"]);
		expect(getTokens(undefined)).toBe(TUI_TOKENS["tui-dark"]);
	});
});

describe("palette SGR output", () => {
	it("emits truecolor and 256-color escapes", async () => {
		const { paletteFg, paletteBg } = await import("../src/palette.ts");
		expect(paletteFg("#F4E7A1", "truecolor", "x")).toBe("\x1b[38;2;244;231;161mx\x1b[0m");
		const bg = parseHex("#F4E7A1");
		const idx = nearestAnsi256(bg);
		expect(paletteBg("#F4E7A1", "256color", "x")).toBe(`\x1b[48;5;${idx}mx\x1b[0m`);
	});
});
