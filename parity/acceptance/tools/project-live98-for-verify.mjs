#!/usr/bin/env node
/**
 * Project live-98 DRAFT oracles into an ACC-SETUP-shaped disposable package
 * that byte-identical verify-acceptance.mjs can structurally check.
 *
 * Does not modify live-98 oracle bytes. Does not freeze. Does not name an
 * acceptance owner. Governance in the projection is a packaging stub only.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACCEPTANCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(ACCEPTANCE_ROOT, "../..");
const DEFAULT_OUT = join(REPO_ROOT, "parity/research/acceptance-live98-schema-001/projected-acc");
const DEFAULT_PARITY_ROOT = join(REPO_ROOT, "parity/research/acceptance-live98-schema-001/parity-root");
const ORACLE_DEFS = join(ACCEPTANCE_ROOT, "setup-pstack/definitions.json");
const ORACLE_CFGS = join(ACCEPTANCE_ROOT, "setup-pstack/configurations.json");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function requireValue(flag, value) {
	if (value === undefined || value === "" || String(value).startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function parseArgs(argv) {
	const args = {
		referenceRoot: null,
		parityRoot: join(REPO_ROOT, "parity"),
		out: DEFAULT_OUT,
		parityOut: DEFAULT_PARITY_ROOT,
		gapOut: join(REPO_ROOT, "parity/research/acceptance-live98-schema-001/schema-gap.json"),
	};
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		if (flag === "--reference-root") args.referenceRoot = requireValue(flag, argv[++i]);
		else if (flag === "--parity-root") args.parityRoot = requireValue(flag, argv[++i]);
		else if (flag === "--out") args.out = requireValue(flag, argv[++i]);
		else if (flag === "--parity-out") args.parityOut = requireValue(flag, argv[++i]);
		else if (flag === "--gap-out") args.gapOut = requireValue(flag, argv[++i]);
		else throw new Error(`unknown argument ${flag}`);
	}
	if (!args.referenceRoot) {
		throw new Error(
			"usage: project-live98-for-verify.mjs --reference-root <cursor-plugins> [--parity-root <parity>] [--out <dir>] [--parity-out <dir>] [--gap-out <file>]",
		);
	}
	return args;
}

function lineSpan(content, excerpt) {
	const index = content.indexOf(excerpt);
	if (index < 0) return null;
	const start = content.slice(0, index).split("\n").length;
	const end = start + excerpt.split("\n").length - 1;
	const unique = content.indexOf(excerpt, index + 1) < 0;
	return { start, end, unique };
}

function locatorLines(start, end) {
	return start === end ? String(start) : `${start}-${end}`;
}

function uniqueExcerpt(content, candidate) {
	const span = lineSpan(content, candidate);
	if (span?.unique) return { excerpt: candidate, lines: locatorLines(span.start, span.end) };
	return null;
}

function resolveCitation(content, cite) {
	if (cite.excerpt) {
		const exact = uniqueExcerpt(content, cite.excerpt);
		if (exact) return exact;
		const first = cite.excerpt.split("\n")[0];
		const firstHit = uniqueExcerpt(content, first);
		if (firstHit) return firstHit;
		for (let n = cite.excerpt.length; n >= 24; n -= 1) {
			const frag = cite.excerpt.slice(0, n);
			if (content.split(frag).length - 1 === 1) {
				const hit = uniqueExcerpt(content, frag);
				if (hit) return hit;
			}
		}
	}

	const loc = cite.locator ?? "";
	const lines = content.split("\n");

	const headingMatch = /^(#{1,6}\s+.+?)(?:,|\s+paragraph|\s+beginning|$)/.exec(loc);
	if (headingMatch) {
		const heading = headingMatch[1].trim();
		for (let i = 0; i < lines.length; i += 1) {
			if (lines[i].trim() !== heading) continue;
			const single = uniqueExcerpt(content, lines[i]);
			if (single) return single;
			const chunk = [lines[i]];
			for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
				chunk.push(lines[j]);
				const hit = uniqueExcerpt(content, chunk.join("\n"));
				if (hit) return hit;
			}
		}
	}

	for (const q of [...loc.matchAll(/"([^"]+)"/g), ...loc.matchAll(/`([^`]+)`/g)].map((m) => m[1])) {
		if (q.length >= 8) {
			const hit = uniqueExcerpt(content, q);
			if (hit) return hit;
		}
	}

	if (/frontmatter/i.test(loc) || /^YAML/i.test(loc)) {
		for (let i = 0; i < lines.length; i += 1) {
			if (lines[i].startsWith("description:")) {
				const hit = uniqueExcerpt(content, lines[i]);
				if (hit) return hit;
			}
		}
		const fm = content.match(/^---\n[\s\S]*?\n---/);
		if (fm) {
			const hit = uniqueExcerpt(content, fm[0]);
			if (hit) return hit;
		}
	}

	if (loc.startsWith("# ")) {
		const title = loc.split(" opening")[0].split(" companion")[0].trim();
		for (let i = 0; i < lines.length; i += 1) {
			if (lines[i].trim() === title || lines[i].trim().startsWith(title.slice(0, Math.min(24, title.length)))) {
				const hit = uniqueExcerpt(content, lines[i]);
				if (hit) return hit;
			}
		}
	}

	const targeted = [
		[/JSON keys skills and agents/i, '"skills"', '"agents"'],
		[/not a slash skill/i, "The plugin manifest exposes only pstack's normal skill root"],
		[/run evidence before reporting/i, "Keep a PR body to one primary number"],
		[/writeup-only safety/i, "## Don't trust your own writeup"],
		[/without jargon|no jargon/i, "Restate your last message. Stop using jargon and speak coherently."],
		[/Playbooks section requires matching a playbook/i, "Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos."],
		[/writes alwaysApply pstack-models/i, "### 5. Write the rule"],
		[/runs how and why/i, "Teach sits on top of `how` and `why`."],
		[/scans patterns then rewrites/i, "1. Scan for the patterns below."],
		[/host edit-card observation after write/i, "### 5. Write the rule"],
		[/secrets boundary/i, "Never put a secret value in plugin files, prompts,"],
	];
	for (const [re, ...needles] of targeted) {
		if (!re.test(loc)) continue;
		for (const needle of needles) {
			const hit = uniqueExcerpt(content, needle);
			if (hit) return hit;
			for (let i = 0; i < lines.length; i += 1) {
				if (lines[i].includes(needle)) {
					const lineHit = uniqueExcerpt(content, lines[i]);
					if (lineHit) return lineHit;
				}
			}
		}
	}

	const words = loc.match(/[A-Za-z0-9_./-]{4,}/g) ?? [];
	for (let width = Math.min(6, words.length); width >= 3; width -= 1) {
		for (let i = 0; i <= words.length - width; i += 1) {
			const toks = words.slice(i, i + width);
			const hits = lines
				.map((line, index) => ({ line, index }))
				.filter(({ line }) => toks.every((t) => line.toLowerCase().includes(t.toLowerCase())));
			if (hits.length === 1) {
				const hit = uniqueExcerpt(content, hits[0].line);
				if (hit) return hit;
			}
		}
	}

	return null;
}

function evidenceKey(ref) {
	if (!ref.includes("/")) return `sym-${ref}`;
	return `path-${sha256(ref).slice(0, 12)}`;
}

function project(args) {
	args = {
		...args,
		referenceRoot: resolve(args.referenceRoot),
		parityRoot: resolve(args.parityRoot),
		out: resolve(args.out),
		parityOut: resolve(args.parityOut),
		gapOut: resolve(args.gapOut),
	};
	const liveDefs = JSON.parse(readFileSync(ORACLE_DEFS, "utf8"));
	const liveCfgs = JSON.parse(readFileSync(ORACLE_CFGS, "utf8"));
	const oracleDigests = {
		definitions: sha256(readFileSync(ORACLE_DEFS)),
		configurations: sha256(readFileSync(ORACLE_CFGS)),
	};

	const gap = {
		kind: "live98-vs-acc-setup-schema-gap",
		oracleDigests,
		live98TopLevelMissingForVerifier: ["sources", "evidence"],
		live98CitationShape: {
			has: ["key", "revision", "file", "locator", "sha256", "excerptStatus", "observedSha256"],
			verifierRequires: ["key", "lines", "excerpt"],
			citesTotal: 0,
			citesWithExcerptField: 0,
			citesWithLinesField: 0,
			excerptStatusCounts: {},
		},
		packagingMissingBesideOracles: ["governance.json", "MANIFEST.sha256", "setup-pstack/record-hashes.json"],
		resolution: { resolved: 0, unresolved: [] },
		symbolicEvidenceRefs: [],
		notes: [
			"ACC-SETUP verifier expects top-level definitions.sources and definitions.evidence maps.",
			"Live-98 stores per-definition source locators; many lack verbatim excerpt/lines.",
			"This projector fills those ACC-SETUP fields in a disposable package only.",
		],
	};

	const sourceMap = {};
	const evidenceMap = {};
	const projectedDefs = [];
	const contentsCache = {};

	for (const def of liveDefs.definitions) {
		const cites = [];
		for (const cite of def.sources ?? []) {
			gap.live98CitationShape.citesTotal += 1;
			if (cite.excerpt !== undefined) gap.live98CitationShape.citesWithExcerptField += 1;
			if (cite.lines !== undefined) gap.live98CitationShape.citesWithLinesField += 1;
			const status = cite.excerptStatus ?? "absent";
			gap.live98CitationShape.excerptStatusCounts[status] =
				(gap.live98CitationShape.excerptStatusCounts[status] ?? 0) + 1;

			const key = cite.key;
			const abs = join(args.referenceRoot, cite.file);
			const content = contentsCache[cite.file] ?? readFileSync(abs, "utf8");
			contentsCache[cite.file] = content;
			const digest = sha256(content);
			if (digest !== cite.sha256) {
				throw new Error(`${def.id} source ${cite.file} sha256 drifted: ${digest} != ${cite.sha256}`);
			}
			if (!sourceMap[key]) {
				sourceMap[key] = { path: cite.file, sha256: digest };
			}

			const resolved = resolveCitation(content, cite);
			if (!resolved) {
				gap.resolution.unresolved.push({
					id: def.id,
					file: cite.file,
					locator: cite.locator,
					excerptStatus: cite.excerptStatus ?? null,
				});
				continue;
			}
			gap.resolution.resolved += 1;
			cites.push({ key, lines: resolved.lines, excerpt: resolved.excerpt });
		}

		const refs = [];
		for (const ref of def.referenceEvidence?.refs ?? []) {
			const key = evidenceKey(ref);
			if (!evidenceMap[key]) {
				if (!ref.includes("/")) {
					gap.symbolicEvidenceRefs.push(ref);
					evidenceMap[key] = {
						path: `evidence/_live98-schema-stubs/${ref}.txt`,
						sha256: null,
						stub: true,
						label: ref,
					};
				} else {
					const rel = ref.startsWith("parity/") ? ref.slice("parity/".length) : ref;
					const abs = join(args.parityRoot, rel);
					const digest = sha256(readFileSync(abs));
					evidenceMap[key] = { path: rel, sha256: digest };
				}
			}
			refs.push(key);
		}

		projectedDefs.push({
			...def,
			sources: cites,
			referenceEvidence: {
				...(def.referenceEvidence ?? {}),
				refs,
			},
		});
	}

	if (gap.resolution.unresolved.length) {
		mkdirSync(dirname(args.gapOut), { recursive: true });
		writeFileSync(args.gapOut, `${JSON.stringify(gap, null, 2)}\n`);
		throw new Error(
			`projection incomplete: ${gap.resolution.unresolved.length} citations lack resolvable excerpt/lines; see ${args.gapOut}`,
		);
	}

	rmSync(args.parityOut, { recursive: true, force: true });
	mkdirSync(join(args.parityOut, "evidence/_live98-schema-stubs"), { recursive: true });
	const linked = new Set();
	for (const value of Object.values(evidenceMap)) {
		if (value.stub) {
			const body = `live98-schema-001 symbolic evidence stub for ${value.label}\n`;
			writeFileSync(join(args.parityOut, value.path), body);
			value.sha256 = sha256(body);
			continue;
		}
		mkdirSync(dirname(join(args.parityOut, value.path)), { recursive: true });
		const dest = join(args.parityOut, value.path);
		if (linked.has(dest)) continue;
		try {
			symlinkSync(join(args.parityRoot, value.path), dest);
		} catch {
			cpSync(join(args.parityRoot, value.path), dest);
		}
		linked.add(dest);
	}

	const projectedPartition = {
		...liveDefs,
		sources: sourceMap,
		evidence: Object.fromEntries(
			Object.entries(evidenceMap).map(([key, value]) => [key, { path: value.path, sha256: value.sha256 }]),
		),
		definitions: projectedDefs,
	};

	const governance = {
		schemaVersion: 1,
		implementationOwner: {
			id: "live98-schema-adapter-packaging-stub",
			family: "none",
			basis:
				"Packaging stub required by verify-acceptance.mjs governance checks. Not an acceptance owner, custody holder, freeze authority, or authenticated identity.",
		},
	};

	rmSync(args.out, { recursive: true, force: true });
	mkdirSync(join(args.out, "setup-pstack"), { recursive: true });
	writeFileSync(join(args.out, "governance.json"), `${JSON.stringify(governance, null, 2)}\n`);
	writeFileSync(join(args.out, "setup-pstack/definitions.json"), `${JSON.stringify(projectedPartition, null, 2)}\n`);
	writeFileSync(join(args.out, "setup-pstack/configurations.json"), `${JSON.stringify(liveCfgs, null, 2)}\n`);
	writeFileSync(
		join(args.out, "PACKAGING.md"),
		[
			"# Live-98 projected ACC-SETUP package",
			"",
			"Disposable projection for structural verify only.",
			"Oracle digests under parity/acceptance/setup-pstack/ are unchanged.",
			"Governance here is a packaging stub, not an owner designation.",
			"",
		].join("\n"),
	);

	mkdirSync(dirname(args.gapOut), { recursive: true });
	writeFileSync(args.gapOut, `${JSON.stringify(gap, null, 2)}\n`);

	const summary = {
		kind: "live98-acc-setup-projection",
		oracleDigests,
		out: relative(REPO_ROOT, args.out),
		parityOut: relative(REPO_ROOT, args.parityOut),
		gapOut: relative(REPO_ROOT, args.gapOut),
		definitions: projectedDefs.length,
		sources: Object.keys(sourceMap).length,
		evidence: Object.keys(evidenceMap).length,
		resolvedCitations: gap.resolution.resolved,
		authorizationClaim: "NONE",
	};
	process.stdout.write(`${JSON.stringify(summary)}\n`);
}

try {
	project(parseArgs(process.argv.slice(2)));
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
	process.exitCode = 1;
}
