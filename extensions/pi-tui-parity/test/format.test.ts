import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
		assert.equal(cwdRelative("/home/u/proj", "/home/u/proj/a/b.ts"), "a/b.ts");
		assert.equal(cwdRelative("/home/u/proj", "/elsewhere/x.ts"), "/elsewhere/x.ts");
		assert.equal(cwdRelative("/home/u/proj", "/home/u/proj"), ".");
	});

	it("left-truncates with ...tail", () => {
		const long = `${"a".repeat(60)}.ts`;
		const out = truncatePathLeft(long, 50);
		assert.equal(out.length, 50);
		assert.ok(out.startsWith("..."));
		assert.equal(truncatePathLeft("short.ts", 50), "short.ts");
	});

	it("composes displayPath", () => {
		const cwd = "/home/u/proj";
		assert.equal(displayPath(cwd, `${cwd}/src/x.ts`, 50), "src/x.ts");
	});

	it("middle-ellipsizes cwd strings", () => {
		assert.equal(truncateMiddle("/very/long/path/that/exceeds", 10).length, 10);
		assert.ok(truncateMiddle("/very/long/path/that/exceeds", 10).includes("..."));
		assert.equal(truncateMiddle("/short", 10), "/short");
	});

	it("gives basenames", () => {
		assert.equal(basename("/a/b/c.ts"), "c.ts");
		assert.equal(basename("c.ts"), "c.ts");
	});
});

describe("line range notes", () => {
	it("formats line and lines notes", () => {
		assert.equal(lineRange(undefined, undefined), undefined);
		assert.equal(lineRange(5, undefined), "line 5");
		assert.equal(lineRange(5, 1), "line 5");
		assert.equal(lineRange(5, 10), "lines 5-14");
	});
});

describe("pattern truncation", () => {
	it("keeps short patterns and tails long ones", () => {
		assert.equal(truncatePatternHead("abc"), "abc");
		const long = "x".repeat(50);
		assert.equal(truncatePatternHead(long), `...${"x".repeat(37)}`);
	});
});

describe("token formatting", () => {
	it("formats like the Reference footer", () => {
		assert.equal(formatTokens(500), "500");
		assert.equal(formatTokens(1000), "1k");
		assert.equal(formatTokens(1200), "1.2k");
		assert.equal(formatTokens(1230), "1.23k");
		assert.equal(formatTokens(1_200_000), "1.2M");
		assert.equal(formatTokens(1_234_567), "1.23M");
	});
});

describe("elapsed formatting", () => {
	it("formats durations like the tasks list", () => {
		assert.equal(formatElapsed(5), "5s");
		assert.equal(formatElapsed(65), "1m 5s");
		assert.equal(formatElapsed(3725), "1h 2m 5s");
	});
});

describe("session time", () => {
	const now = new Date(2026, 8, 27, 12, 0, 0);

	it("labels today and yesterday", () => {
		assert.equal(formatSessionTime(new Date(2026, 8, 27, 9, 5), now), "Today 09:05");
		assert.equal(formatSessionTime(new Date(2026, 8, 26, 23, 59), now), "Yesterday 23:59");
	});

	it("counts days back then falls back to a date", () => {
		assert.equal(formatSessionTime(new Date(2026, 8, 24, 8, 0), now), "3 days ago");
		assert.equal(formatSessionTime(new Date(2026, 7, 27, 8, 0), now), "Aug 27");
	});
});
