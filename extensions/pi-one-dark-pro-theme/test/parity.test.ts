import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { RoleRow, UpstreamDocument } from "../parity/theme.ts";
import {
	buildTheme,
	parseRoleMap,
	readThemeSchema,
	resolveRow,
	THEME_NAME,
	themeSchemaPath,
	UPSTREAM_SHA256,
} from "../parity/theme.ts";
import { test } from "./harness/package-fixture.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(packageRoot, path), "utf8");
const upstreamText = read("upstream/OneDark-Pro-flat.json");
const upstream = JSON.parse(upstreamText) as UpstreamDocument;
const rows = parseRoleMap(read("parity/role-map.tsv"));
const committed = JSON.parse(read(`themes/${THEME_NAME}.json`)) as {
	$schema: string;
	name: string;
	colors: Record<string, string>;
	export: Record<string, string>;
};
const schema = readThemeSchema(
	JSON.parse(readFileSync(themeSchemaPath(packageRoot), "utf8")),
);
const checkerPath = join(packageRoot, "scripts", "check-parity.mjs");

function runChecker(themePath?: string) {
	const args =
		themePath === undefined
			? [checkerPath]
			: [checkerPath, "--theme", themePath];
	return spawnSync(process.execPath, args, {
		cwd: packageRoot,
		encoding: "utf8",
	});
}

describe("upstream pin", () => {
	it("matches the pinned upstream hash", () => {
		expect(createHash("sha256").update(upstreamText).digest("hex")).toBe(
			UPSTREAM_SHA256,
		);
	});
});

describe("committed theme", () => {
	it("deep-equals a fresh build from the pinned files", () => {
		expect(buildTheme(upstream, rows)).toEqual(committed);
	});

	it("assigns every schema color a valid value", () => {
		expect(Object.keys(committed.colors).sort()).toEqual(
			[...schema.required, ...schema.optional].sort(),
		);
		for (const role of [...schema.required, ...schema.optional]) {
			expect(committed.colors[role] ?? "").toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("assigns every schema export color a valid value", () => {
		expect(Object.keys(committed.export).sort()).toEqual(
			[...schema.exportProps].sort(),
		);
		for (const key of schema.exportProps) {
			expect(committed.export[key] ?? "").toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("names the theme after the package constant", () => {
		expect(committed.name).toBe(THEME_NAME);
	});
});

describe("role map against the real upstream file", () => {
	it("throws when a color row names a key the upstream file lacks", () => {
		const ghost: RoleRow = {
			role: "ghost",
			kind: "color",
			source: "no.such.key",
			base: "",
			why: "test fixture",
		};
		expect(() => resolveRow(upstream, ghost)).toThrow(
			'role ghost: upstream colors has no key "no.such.key"',
		);
	});

	it("resolves every committed role to the value in the theme file", () => {
		const targets = new Map<string, string>(Object.entries(committed.colors));
		for (const [key, value] of Object.entries(committed.export))
			targets.set(`export.${key}`, value);
		for (const row of rows) {
			expect(targets.get(row.role)).toBe(resolveRow(upstream, row));
		}
	});
});

describe("check-parity through the real CLI", () => {
	test("passes when the artifacts copy is the working copy", ({
		packageFixture,
	}) => {
		const result = runChecker(packageFixture.themePath);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			"one-dark-pro-flat parity OK: 59 role map rows",
		);
		const copiedUpstream = JSON.parse(
			readFileSync(packageFixture.upstreamPath, "utf8"),
		) as UpstreamDocument;
		const built = buildTheme(
			copiedUpstream,
			parseRoleMap(readFileSync(packageFixture.roleMapPath, "utf8")),
		);
		expect(JSON.parse(readFileSync(packageFixture.themePath, "utf8"))).toEqual(
			built,
		);
	});

	test("fails when the working copy has one changed color", ({
		packageFixture,
	}) => {
		const changed = readFileSync(packageFixture.themePath, "utf8").replace(
			'"accent": "#61afef"',
			'"accent": "#61afee"',
		);
		writeFileSync(packageFixture.themePath, changed);
		const result = runChecker(packageFixture.themePath);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			'colors.accent is "#61afee", built "#61afef"',
		);
	});
});
