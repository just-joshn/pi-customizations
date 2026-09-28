import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = join(ROOT, "..", "..", ".audit", "pi-tui-parity", "inventory.tsv");
const MATRIX = join(ROOT, "parity", "matrix.tsv");

function inventoryIds(): string[] {
	return readFileSync(INVENTORY, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.slice(1)
		.map((l) => l.split("\t")[0]!);
}

function matrixIds(): string[] {
	return readFileSync(MATRIX, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => l.split("⇥")[0]!);
}

describe("parity matrix", () => {
	it("covers every inventory id exactly once", () => {
		expect(matrixIds().sort()).toEqual([...new Set(inventoryIds())].sort());
	});

	it("check-parity gate passes with the expected status counts", () => {
		const out = execFileSync("node", [join(ROOT, "scripts", "check-parity.mjs")], { encoding: "utf8" });
		const countsLine = out.split("\n").find((l) => l.startsWith("counts: "));
		expect(countsLine).toBeDefined();
		expect(JSON.parse(countsLine!.slice("counts: ".length))).toEqual({
			implemented: 94,
			mapped: 104,
			deviation: 33,
			unmet: 131,
		});
	});
});
