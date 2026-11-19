#!/usr/bin/env node
/**
 * Fail-closed style audit for extensions/pi-pstack-v2.
 * Encodes Coding Style Rules + CODING_STYLE.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILE_LINES = 800;
const MAX_FN_LINES = 50;
const MAX_NESTING = 4;
const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
	"node_modules",
	"coverage",
	".vitest",
	"dist",
	".git",
]);

/** @typedef {{ file: string, rule: string, detail: string }} Violation */

/** @param {string} filePath */
const rel = (filePath) => path.relative(ROOT, filePath);

/** @param {string} line */
const indentDepth = (line) => {
	if (!line.trim()) return 0;
	if (line.startsWith("\t")) return (line.match(/^\t*/) ?? [""])[0].length;
	return Math.floor(((line.match(/^ */) ?? [""])[0].length) / 2);
};

/** @param {string} dir @param {string[]} acc */
const walkCode = (dir, acc) =>
	fs.readdirSync(dir, { withFileTypes: true }).reduce((next, ent) => {
		if (SKIP_DIRS.has(ent.name)) return next;
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) return walkCode(full, next);
		if (!CODE_EXTS.has(path.extname(ent.name))) return next;
		return [...next, full];
	}, acc);

/** @returns {string[]} */
const listCodeFiles = () => walkCode(ROOT, []).toSorted();

/**
 * @param {string} source
 * @param {string} state
 * @param {number} i
 * @param {string} out
 * @returns {{ state: string, i: number, out: string }}
 */
const stepStrip = (source, state, i, out) => {
	const c = source[i];
	const n = source[i + 1];
	if (state === "code") {
		if (c === "/" && n === "/") return { state: "line", i: i + 2, out };
		if (c === "/" && n === "*") return { state: "block", i: i + 2, out };
		if (c === "'") return { state: "squote", i: i + 1, out: out + "''" };
		if (c === '"') return { state: "dquote", i: i + 1, out: out + '""' };
		if (c === "`") return { state: "template", i: i + 1, out: out + "``" };
		return { state, i: i + 1, out: out + c };
	}
	if (state === "line") {
		if (c === "\n") return { state: "code", i: i + 1, out: `${out}\n` };
		return { state, i: i + 1, out };
	}
	if (state === "block") {
		if (c === "*" && n === "/") return { state: "code", i: i + 2, out };
		return { state, i: i + 1, out: c === "\n" ? `${out}\n` : out };
	}
	if (state === "squote" || state === "dquote") {
		if (c === "\\") return { state, i: i + 2, out };
		const end = state === "squote" ? "'" : '"';
		if (c === end) return { state: "code", i: i + 1, out };
		return { state, i: i + 1, out };
	}
	// template
	if (c === "\\") return { state, i: i + 2, out };
	if (c === "`") return { state: "code", i: i + 1, out };
	return { state, i: i + 1, out: c === "\n" ? `${out}\n` : out };
};

/** @param {string} source */
const stripNoise = (source) => {
	let state = "code";
	let i = 0;
	let out = "";
	while (i < source.length) {
		({ state, i, out } = stepStrip(source, state, i, out));
	}
	return out;
};

/**
 * @param {string[]} lines
 * @param {number} start
 * @param {number} baseIndent
 */
const functionEnd = (lines, start, baseIndent) => {
	let end = start + 1;
	let seenBody = lines[start]?.includes("{") || lines[start]?.includes("=>");
	while (end < lines.length) {
		const L = lines[end] ?? "";
		if (!L.trim()) {
			end += 1;
			continue;
		}
		const d = indentDepth(L);
		if (seenBody && d <= baseIndent && !L.trim().startsWith(".")) break;
		if (L.includes("{") || L.includes("=>")) seenBody = true;
		end += 1;
	}
	return end;
};

/**
 * @param {string} source
 * @returns {{ name: string, startLine: number, lines: number }[]}
 */
const findFunctions = (source) => {
	const lines = source.split("\n");
	return lines.flatMap((line, i) => {
		const m =
			line.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/) ??
			line.match(
				/^(\s*)(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\(|(?:[^=])*=>)/,
			);
		if (!m?.[2]) return [];
		const end = functionEnd(lines, i, indentDepth(line));
		return [{ name: m[2], startLine: i + 1, lines: end - i }];
	});
};

/** @param {string} file */
const isTestFile = (file) =>
	file.startsWith(`test${path.sep}`) ||
	file.includes(`${path.sep}test${path.sep}`) ||
	/\.test\.(ts|tsx|js|mjs|cjs)$/.test(file) ||
	file.endsWith(".test-helper.ts");

/**
 * @param {string} file
 * @param {string} source
 * @param {string} stripped
 * @returns {Violation[]}
 */
const fileSizeViolations = (file, source) => {
	const n = source.split("\n").length;
	if (n <= MAX_FILE_LINES) return [];
	return [{ file, rule: "file-size", detail: `${n} lines > ${MAX_FILE_LINES} max` }];
};

/** @param {string} file @param {string[]} lines */
const nestingViolations = (file, lines) => {
	const hit = lines.findIndex((line) => indentDepth(line) > MAX_NESTING);
	if (hit < 0) return [];
	return [
		{
			file,
			rule: "nesting",
			detail: `line ${hit + 1}: indent depth ${indentDepth(lines[hit] ?? "")} > ${MAX_NESTING}`,
		},
	];
};

/** @param {string} file @param {string[]} strippedLines */
const consoleViolations = (file, strippedLines) => {
	if (isTestFile(file)) return [];
	return strippedLines.flatMap((L, i) =>
		/\bconsole\.log\s*\(/.test(L)
			? [{ file, rule: "no-console-log", detail: `line ${i + 1}: console.log` }]
			: [],
	);
};

/** @param {string} file @param {string[]} strippedLines */
const immutabilityViolations = (file, strippedLines) =>
	strippedLines.flatMap((L, i) => {
		const prop =
			/\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/.test(L) &&
			!/\bexports\./.test(L) &&
			!/\bmodule\.exports\b/.test(L);
		const arr = /\.(push|splice|pop|shift|unshift|sort|reverse)\s*\(/.test(L);
		if (!prop && !arr) return [];
		const kind = prop ? "property assignment" : "mutating array method";
		return [
			{
				file,
				rule: "immutability",
				detail: `line ${i + 1}: ${kind} ${L.trim().slice(0, 80)}`,
			},
		];
	});

/** @param {string} file @param {string} stripped */
const functionSizeViolations = (file, stripped) =>
	findFunctions(stripped)
		.filter((fn) => fn.lines > MAX_FN_LINES)
		.map((fn) => ({
			file,
			rule: "function-size",
			detail: `${fn.name} at line ${fn.startLine}: ${fn.lines} lines > ${MAX_FN_LINES}`,
		}));

/**
 * Structured external input (JSON bodies, CLI argv) needs zod.
 * Reading source text for this audit does not.
 * @param {string} file
 * @param {string} source
 * @param {string} stripped
 */
const inputValidationViolations = (file, source, stripped) => {
	if (isTestFile(file)) return [];
	if (file === `scripts${path.sep}style-audit.mjs`) return [];
	const usesZod = /from\s+['"]zod['"]|require\(['"]zod['"]\)/.test(source);
	if (usesZod) return [];
	const readsJson = /\bJSON\.parse\s*\(/.test(stripped);
	const readsArgv = /\bprocess\.argv\b/.test(stripped);
	if (!readsJson && !readsArgv) return [];
	return [
		{
			file,
			rule: "input-validation",
			detail:
				"parses external input without zod (TypeBox remains for Pi tool params only)",
		},
	];
};

/**
 * @param {string} filePath
 * @param {string} source
 * @returns {Violation[]}
 */
const auditFile = (filePath, source) => {
	const file = rel(filePath);
	const lines = source.split("\n");
	const stripped = stripNoise(source);
	const strippedLines = stripped.split("\n");
	return [
		...fileSizeViolations(file, source),
		...nestingViolations(file, lines),
		...consoleViolations(file, strippedLines),
		...immutabilityViolations(file, strippedLines),
		...functionSizeViolations(file, stripped),
		...inputValidationViolations(file, source, stripped),
	];
};

const main = () => {
	const violations = listCodeFiles().flatMap((filePath) =>
		auditFile(filePath, fs.readFileSync(filePath, "utf8")),
	);
	const byRule = violations.reduce((acc, v) => {
		const n = acc.get(v.rule) ?? 0;
		return new Map([...acc, [v.rule, n + 1]]);
	}, /** @type {Map<string, number>} */ (new Map()));

	console.error(`style-audit: ${violations.length} violation(s) in ${rel(ROOT) || "."}`);
	for (const [rule, n] of [...byRule.entries()].toSorted()) {
		console.error(`  ${rule}: ${n}`);
	}
	for (const v of violations) {
		console.error(`${v.file}: [${v.rule}] ${v.detail}`);
	}
	if (violations.length > 0) {
		process.exitCode = 1;
		return;
	}
	console.error("style-audit: clean");
};

main();
