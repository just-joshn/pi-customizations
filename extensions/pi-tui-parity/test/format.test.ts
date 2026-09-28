import { describe, it, expect } from "vitest";
import {
	basename,
	cwdRelative,
	displayPath,
	formatElapsed,
	formatSessionTime,
	formatTokens,
	lineRange,
	truncateMiddle,
	truncatePathLeft,
	truncatePatternHead,
} from "../src/format.ts";

describe("path helpers", () => {
	it("makes paths cwd-relative", () => {
		expect(cwdRelative("/home/u/proj", "/home/u/proj/a/b.ts")).toBe("a/b.ts");
		expect(cwdRelative("/home/u/proj", "/elsewhere/x.ts")).toBe("/elsewhere/x.ts");
		expect(cwdRelative("/home/u/proj", "/home/u/proj2/x.ts")).toBe("/home/u/proj2/x.ts");
		expect(cwdRelative("/home/u/proj", "/home/u/proj")).toBe(".");
	});

	it("left-truncates with ...tail", () => {
		const long = `${"a".repeat(60)}.ts`;
		const out = truncatePathLeft(long, 50);
		expect(out.length).toBe(50);
		expect(out.startsWith("...")).toBe(true);
		expect(truncatePathLeft("short.ts", 50)).toBe("short.ts");
	});

	it("composes displayPath", () => {
		const cwd = "/home/u/proj";
		expect(displayPath(cwd, `${cwd}/src/x.ts`, 50)).toBe("src/x.ts");
	});

	it("middle-ellipsizes cwd strings", () => {
		expect(truncateMiddle("/very/long/path/that/exceeds", 10).length).toBe(10);
		expect(truncateMiddle("/very/long/path/that/exceeds", 10).includes("...")).toBe(true);
		expect(truncateMiddle("/short", 10)).toBe("/short");
	});

	it("gives basenames", () => {
		expect(basename("/a/b/c.ts")).toBe("c.ts");
		expect(basename("c.ts")).toBe("c.ts");
	});
});

describe("line range notes", () => {
	it("formats line and lines notes", () => {
		expect(lineRange(undefined, undefined)).toBeUndefined();
		expect(lineRange(5, undefined)).toBe("line 5");
		expect(lineRange(5, 1)).toBe("line 5");
		expect(lineRange(5, 10)).toBe("lines 5-14");
	});
});

describe("pattern truncation", () => {
	it("keeps short patterns and tails long ones", () => {
		expect(truncatePatternHead("abc")).toBe("abc");
		const long = `${"x".repeat(13)}${"y".repeat(37)}`;
		expect(truncatePatternHead(long)).toBe(`...${"y".repeat(37)}`);
	});
});

describe("token formatting", () => {
	it("formats like the Reference footer", () => {
		expect(formatTokens(500)).toBe("500");
		expect(formatTokens(1000)).toBe("1k");
		expect(formatTokens(1200)).toBe("1.2k");
		expect(formatTokens(1230)).toBe("1.23k");
		expect(formatTokens(1_200_000)).toBe("1.2M");
		expect(formatTokens(1_234_567)).toBe("1.23M");
	});
});

describe("elapsed formatting", () => {
	it("formats durations like the tasks list", () => {
		expect(formatElapsed(5)).toBe("5s");
		expect(formatElapsed(65)).toBe("1m 5s");
		expect(formatElapsed(3725)).toBe("1h 2m 5s");
	});
});

describe("session time", () => {
	const now = new Date(2026, 8, 27, 12, 0, 0);

	it("labels today and yesterday", () => {
		expect(formatSessionTime(new Date(2026, 8, 27, 9, 5), now)).toBe("Today 09:05");
		expect(formatSessionTime(new Date(2026, 8, 26, 23, 59), now)).toBe("Yesterday 23:59");
	});

	it("counts days back then falls back to a date", () => {
		expect(formatSessionTime(new Date(2026, 8, 24, 8, 0), now)).toBe("3 days ago");
		expect(formatSessionTime(new Date(2026, 8, 20, 8, 0), now)).toBe("Sep 20");
		expect(formatSessionTime(new Date(2026, 7, 27, 8, 0), now)).toBe("Aug 27");
	});
});
