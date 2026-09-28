#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
	buildTheme,
	parseRoleMap,
	readThemeSchema,
	THEME_NAME,
	themeSchemaPath,
	UPSTREAM_SHA256,
} from "../parity/theme.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPORT_PREFIX = "export.";
const HEX = /^#[0-9a-f]{6}$/i;

function themeFromArgs(args) {
	if (args.length === 0) return join(root, "themes", `${THEME_NAME}.json`);
	if (args.length === 2 && args[0] === "--theme" && args[1].length > 0)
		return resolve(args[1]);
	throw new Error("usage: check-parity.mjs [--theme <path>]");
}

function themeLabel(themePath) {
	const relativePath = relative(root, themePath);
	return relativePath.startsWith("..") ? themePath : relativePath;
}

function checkUpstream(text) {
	const digest = createHash("sha256").update(text).digest("hex");
	return digest === UPSTREAM_SHA256
		? []
		: [
				`upstream/OneDark-Pro-flat.json sha256 is ${digest}, expected ${UPSTREAM_SHA256}`,
			];
}

function checkRoleMap(rows, schema) {
	const colors = new Set([...schema.required, ...schema.optional]);
	const exported = new Set(schema.exportProps);
	const problems = [];
	for (const row of rows) {
		if (!row.role.startsWith(EXPORT_PREFIX)) {
			if (!colors.has(row.role))
				problems.push(
					`role map role ${row.role} is not a color in Pi's theme schema`,
				);
			continue;
		}
		const key = row.role.slice(EXPORT_PREFIX.length);
		if (!exported.has(key))
			problems.push(
				`role map role ${row.role} is not an export color in Pi's theme schema`,
			);
	}
	return problems;
}

function checkCoverage(rows, schema) {
	const counts = new Map();
	for (const row of rows) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
	const roles = [
		...schema.required,
		...schema.optional,
		...schema.exportProps.map((key) => `${EXPORT_PREFIX}${key}`),
	];
	const problems = [];
	for (const role of roles) {
		const count = counts.get(role) ?? 0;
		if (count === 0)
			problems.push(`theme schema role ${role} has no role map row`);
		else if (count > 1)
			problems.push(`theme schema role ${role} has ${count} role map rows`);
	}
	return problems;
}

function checkTheme(committed, built, label) {
	if (isDeepStrictEqual(committed, built)) return [];
	const differences = describeDifferences(committed, built);
	return [
		`${label} differs from a fresh build: ${differences.join("; ") || "unexpected shape"}`,
	];
}

function describeDifferences(committed, built) {
	const problems = [];
	for (const key of new Set([
		...Object.keys(committed),
		...Object.keys(built),
	])) {
		if (key !== "colors" && key !== "export") {
			if (committed[key] !== built[key])
				problems.push(
					`${key} is ${JSON.stringify(committed[key])}, built ${JSON.stringify(built[key])}`,
				);
			continue;
		}
		const expected = built[key];
		const actual = committed[key] ?? {};
		for (const entry of new Set([
			...Object.keys(expected),
			...Object.keys(actual),
		])) {
			if (actual[entry] !== expected[entry]) {
				problems.push(
					`${key}.${entry} is ${JSON.stringify(actual[entry] ?? null)}, built ${JSON.stringify(expected[entry] ?? null)}`,
				);
			}
		}
	}
	return problems;
}

function checkValues(built) {
	const problems = [];
	for (const section of ["colors", "export"]) {
		for (const [key, value] of Object.entries(built[section])) {
			const valid =
				typeof value === "string"
					? HEX.test(value)
					: Number.isInteger(value) && value >= 0 && value <= 255;
			if (!valid)
				problems.push(
					`built ${section}.${key} is ${JSON.stringify(value)}, not #rrggbb or an integer from 0 to 255`,
				);
		}
	}
	return problems;
}

function checkIdentity(committed, themePath) {
	const problems = [];
	if (basename(themePath) !== `${THEME_NAME}.json`)
		problems.push(
			`theme file is ${basename(themePath)}, expected ${THEME_NAME}.json`,
		);
	if (committed.name !== THEME_NAME)
		problems.push(
			`theme name is ${JSON.stringify(committed.name)}, expected ${THEME_NAME}`,
		);
	if (typeof committed.name === "string" && committed.name.includes("/"))
		problems.push(`theme name ${committed.name} contains "/"`);
	return problems;
}

function main(themePath) {
	const upstreamText = readFileSync(
		join(root, "upstream", "OneDark-Pro-flat.json"),
		"utf8",
	);
	const document = JSON.parse(upstreamText);
	const rows = parseRoleMap(
		readFileSync(join(root, "parity", "role-map.tsv"), "utf8"),
	);
	const schema = readThemeSchema(
		JSON.parse(readFileSync(themeSchemaPath(root), "utf8")),
	);
	const built = buildTheme(document, rows);
	const committed = JSON.parse(readFileSync(themePath, "utf8"));
	return {
		rows,
		built,
		problems: [
			...checkUpstream(upstreamText),
			...checkRoleMap(rows, schema),
			...checkCoverage(rows, schema),
			...checkTheme(committed, built, themeLabel(themePath)),
			...checkValues(built),
			...checkIdentity(committed, themePath),
		],
	};
}

const reason = (error) =>
	error instanceof Error ? error.message : String(error);

try {
	const themePath = themeFromArgs(process.argv.slice(2));
	const { rows, built, problems } = main(themePath);
	if (problems.length > 0) {
		process.stderr.write(
			`${problems.join("\n")}\n${problems.length} parity problem(s) in ${themeLabel(themePath)}.\n`,
		);
		process.exit(1);
	}
	const colors = Object.keys(built.colors).length;
	const exported = Object.keys(built.export).length;
	process.stdout.write(
		`one-dark-pro-flat parity OK: ${rows.length} role map rows, ${colors} colors, ${exported} export colors, upstream sha256 verified\n`,
	);
} catch (error) {
	process.stderr.write(`check:parity failed: ${reason(error)}\n`);
	process.exit(1);
}
