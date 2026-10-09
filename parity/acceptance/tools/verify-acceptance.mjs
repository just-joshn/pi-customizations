#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ACCEPTANCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "MANIFEST.sha256";
const RECORD_HASHES = "setup-pstack/record-hashes.json";
const GOVERNANCE = "governance.json";
const GOVERNANCE_FIELDS = new Set(["schemaVersion", "implementationOwner"]);
const SCOPE = "DRAFT integrity only. Not review, freezing, custody, evidence truth or acceptance.";
const STATUSES = new Set(["DRAFT", "REVIEWED", "FROZEN"]);
const BASES = new Set(["source-explicit", "source-inferred", "reference-observed-once", "unobserved-runtime-control"]);

function requireValue(flag, value) {
	if (value === undefined || value === "" || String(value).startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function parsePin(value) {
	if (value === undefined || value === "" || String(value).startsWith("--")) {
		throw new Error("--expect-manifest-sha256 requires a sha256 hex digest");
	}
	if (!/^[0-9a-f]{64}$/i.test(value)) {
		throw new Error(`--expect-manifest-sha256 value is not a sha256 hex digest: ${value}`);
	}
	return value.toLowerCase();
}

function parseArgs(argv) {
	const args = { write: false, referenceRoot: null, parityRoot: null, acceptanceRoot: ACCEPTANCE_ROOT, pin: null };
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		if (flag === "--write-hashes") args.write = true;
		else if (flag === "--reference-root") args.referenceRoot = requireValue(flag, argv[++i]);
		else if (flag === "--parity-root") args.parityRoot = requireValue(flag, argv[++i]);
		else if (flag === "--acceptance-root") args.acceptanceRoot = requireValue(flag, argv[++i]);
		else if (flag === "--expect-manifest-sha256") args.pin = parsePin(argv[++i]);
		else throw new Error(`unknown argument ${flag}`);
	}
	if (!args.referenceRoot || !args.parityRoot || (args.write && args.pin)) {
		throw new Error("usage: verify-acceptance.mjs --reference-root <cursor-plugins checkout> --parity-root <parity dir with evidence/> [--acceptance-root <dir>] [--write-hashes | --expect-manifest-sha256 <sha256>]");
	}
	return args;
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
	}
	return value;
}

const recordHash = (record) => sha256(JSON.stringify(canonical(record)));

function listFiles(root) {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			throw new Error(`symlink at ${path}; acceptance tree traversal must not follow symlinks`);
		}
		return stat.isDirectory() ? listFiles(path) : [path];
	});
}

function lineSpan(content, excerpt) {
	const index = content.indexOf(excerpt);
	if (index < 0) return null;
	const start = content.slice(0, index).split("\n").length;
	return { start, end: start + excerpt.split("\n").length - 1, unique: content.indexOf(excerpt, index + 1) < 0 };
}

function parseLocator(lines) {
	const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(String(lines));
	if (!match) return null;
	const from = Number(match[1]);
	const to = match[2] === undefined ? from : Number(match[2]);
	if (to < from) return null;
	return { from, to };
}

function checkSources(defs, referenceRoot, fail) {
	const head = execFileSync("git", ["-C", referenceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	if (head !== defs.reference.revision) fail(`reference checkout HEAD ${head} is not locked revision ${defs.reference.revision}`);
	const contents = {};
	for (const [key, source] of Object.entries(defs.sources)) {
		const content = readFileSync(join(referenceRoot, source.path), "utf8");
		if (sha256(content) !== source.sha256) fail(`source ${key} ${source.path} sha256 drifted`);
		contents[key] = content;
	}
	for (const def of defs.definitions) {
		for (const cite of def.sources) {
			const content = contents[cite.key];
			if (content === undefined) {
				fail(`${def.id} cites unknown source key ${cite.key}`);
				continue;
			}
			const span = lineSpan(content, cite.excerpt);
			const want = parseLocator(cite.lines);
			if (!want) fail(`${def.id} has invalid locator ${cite.lines}; positive ordered integer locators only`);
			else if (!span) fail(`${def.id} excerpt not found verbatim in ${cite.key}: ${cite.excerpt.slice(0, 60)}`);
			else if (span.start < want.from || span.end > want.to) fail(`${def.id} excerpt in ${cite.key} spans lines ${span.start}-${span.end}, locator says ${cite.lines}`);
		}
	}
}

function checkEvidence(defs, parityRoot, fail) {
	for (const [key, evidence] of Object.entries(defs.evidence)) {
		const digest = sha256(readFileSync(join(parityRoot, evidence.path)));
		if (digest !== evidence.sha256) fail(`evidence ${key} ${evidence.path} sha256 drifted`);
	}
}

function checkGovernance(governance, fail) {
	for (const key of Object.keys(governance)) {
		if (!GOVERNANCE_FIELDS.has(key)) fail(`governance has unsupported field ${key}; declared authority or approval metadata is not authentication`);
	}
	if (!governance.implementationOwner?.id || !governance.implementationOwner?.family) fail("governance lacks the implementation owner id and model family");
}

const family = (value) => String(value ?? "").toLowerCase();

const reviewersOf = (review) => review.reviewers ?? (review.reviewer ? [{ id: review.reviewer, family: review.modelFamily }] : []);

function checkClaimedReview(def, defs, owner, fail) {
	if (def.status === "DRAFT" && def.review === undefined) return;
	fail(`${def.id} declares ${def.status}${def.review ? " with review metadata" : ""} but no authenticated review or freeze transition exists; declared metadata is not approval`);
	const review = def.review ?? {};
	const reviewers = reviewersOf(review);
	if (reviewers.length < 2) fail(`${def.id} names ${reviewers.length} reviewer${reviewers.length === 1 ? "" : "s"}; two reviewers on distinct model families are required`);
	const families = reviewers.map((reviewer) => family(reviewer.family));
	for (const reviewer of reviewers) {
		if (!reviewer.family) fail(`${def.id} reviewer ${reviewer.id} has no model family`);
		if (reviewer.id === owner.id) fail(`${def.id} reviewer ${reviewer.id} is the implementation owner`);
		if (family(reviewer.family) === family(owner.family)) fail(`${def.id} reviewer family ${family(reviewer.family)} is the implementation owner family`);
	}
	const shared = families.find((name, index) => name && families.indexOf(name) !== index);
	if (shared) fail(`${def.id} reviewers share model family ${shared}`);
	const runs = review.referenceRuns ?? [];
	if (runs.length === 0) fail(`${def.id} has no reference runs`);
	for (const run of runs) fail(`${def.id} reference run ${run} is not in an authenticated reference-run registry; none exists`);
	if (def.status === "FROZEN" && !defs.denominatorComplete) fail(`${def.id} is FROZEN while the partition denominator is incomplete`);
}

function checkDefinitions(defs, configs, owner, fail) {
	const seen = new Set();
	let denominator = 0;
	if (defs.status !== "DRAFT" || defs.frozen !== false) fail(`partition claims status ${defs.status} and frozen ${defs.frozen} but no authenticated freeze transition exists`);
	if (defs.frozen && !defs.denominatorComplete) fail("partition is frozen with an incomplete denominator");
	for (const def of defs.definitions) {
		if (seen.has(def.id)) fail(`duplicate id ${def.id}`);
		seen.add(def.id);
		if (!STATUSES.has(def.status)) fail(`${def.id} has unknown status ${def.status}`);
		checkClaimedReview(def, defs, owner, fail);
		if (!def.basis?.length || def.basis.some((basis) => !BASES.has(basis))) fail(`${def.id} has missing or unknown basis`);
		if (def.basis.some((basis) => basis.startsWith("source-")) && def.sources.length === 0) fail(`${def.id} claims a source basis with no cited source`);
		if (def.basis.includes("reference-observed-once") && def.referenceEvidence.refs.length === 0) fail(`${def.id} claims a reference observation with no evidence`);
		for (const ref of def.referenceEvidence.refs) if (!defs.evidence[ref]) fail(`${def.id} cites unknown evidence ${ref}`);
		if (!def.actions?.length) fail(`${def.id} has no actions`);
		let product = 1;
		for (const [axis, values] of Object.entries(def.matrix)) {
			if (!configs.axes[axis]) fail(`${def.id} uses unknown axis ${axis}`);
			for (const value of values) if (!configs.axes[axis]?.[value]) fail(`${def.id} uses unknown ${axis} value ${value}`);
			product *= values.length;
		}
		denominator += product;
	}
	if (defs.frozen && defs.definitions.some((def) => def.status !== "FROZEN")) fail("partition marked frozen with unfrozen definitions");
	return denominator;
}

function recordedEntries(defs, configs, governance) {
	const { definitions, ...partition } = defs;
	const { axes, ...configurationMetadata } = configs;
	const values = Object.entries(axes).flatMap(([axis, entries]) =>
		Object.entries(entries).map(([value, description]) => [`configuration ${axis}/${value}`, recordHash(description)]),
	);
	return {
		records: Object.fromEntries(definitions.map((def) => [def.id, recordHash(def)])),
		metadata: Object.fromEntries([
			["partition metadata", recordHash(partition)],
			["configuration metadata", recordHash(configurationMetadata)],
			...values,
			["governance", recordHash(governance)],
		]),
	};
}

function compareRecorded(stored, current, allowNew, fail) {
	const groups = [
		["records", (id, old) => `definition ${id} changed since hashes were recorded; evidence bound to ${old ?? "none"} is stale`],
		["metadata", (key) => `${key} changed since hashes were recorded`],
	];
	for (const [group, message] of groups) {
		const before = stored[group] ?? {};
		const after = current[group];
		const keys = allowNew ? Object.keys(before) : [...new Set([...Object.keys(before), ...Object.keys(after)])];
		for (const key of keys) if (before[key] !== after[key]) fail(message(key, before[key]));
	}
}

function openBlockers(defs, pinned) {
	return [
		"NO_AUTHENTICATED_TRANSITION_AUTHORITY",
		"NO_REFERENCE_RUN_REGISTRY",
		"NO_EXTERNAL_CUSTODY",
		...(defs.denominatorComplete ? [] : ["DENOMINATOR_INCOMPLETE"]),
		"FINAL_ACCEPTANCE_GATE_ABSENT",
		...(pinned ? [] : ["EXTERNAL_PIN_ABSENT"]),
	];
}

function hashArtifacts(acceptanceRoot) {
	return listFiles(acceptanceRoot)
		.map((path) => relative(acceptanceRoot, path))
		.filter((path) => path !== MANIFEST && path !== RECORD_HASHES)
		.sort()
		.map((path) => `${sha256(readFileSync(join(acceptanceRoot, path)))}  ${path}`)
		.join("\n");
}

function rejectUnsafeOutputs(acceptanceRoot, fail) {
	for (const name of [MANIFEST, RECORD_HASHES]) {
		const parts = name.split("/");
		let current = acceptanceRoot;
		for (let i = 0; i < parts.length; i += 1) {
			current = join(current, parts[i]);
			const prefix = parts.slice(0, i + 1).join("/");
			const stat = lstatSync(current, { throwIfNoEntry: false });
			if (!stat) {
				fail(`${name} is missing; hash files must be regular unlinked files inside the acceptance root`);
				break;
			}
			if (stat.isSymbolicLink()) {
				fail(
					i === parts.length - 1
						? `${name} is a symlink; hash files must be regular files inside the acceptance root`
						: `${name}: path component ${prefix} is a symlink; hash files must stay inside the acceptance root`,
				);
				break;
			}
			if (i < parts.length - 1) {
				if (!stat.isDirectory()) {
					fail(`${name}: path component ${prefix} is not a directory`);
					break;
				}
				continue;
			}
			if (!stat.isFile()) {
				fail(`${name} is not a regular file; hash files must be regular files inside the acceptance root`);
				break;
			}
			if (stat.nlink > 1) {
				fail(`${name} has ${stat.nlink} hard links; hash files must be unlinked regular files inside the acceptance root`);
			}
		}
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const failures = [];
	const fail = (message) => failures.push(message);
	rejectUnsafeOutputs(args.acceptanceRoot, fail);
	if (failures.length) {
		process.stderr.write(`${failures.map((message) => `FAIL ${message}`).join("\n")}\n`);
		process.exitCode = 1;
		return;
	}
	const defs = JSON.parse(readFileSync(join(args.acceptanceRoot, "setup-pstack/definitions.json"), "utf8"));
	const configs = JSON.parse(readFileSync(join(args.acceptanceRoot, "setup-pstack/configurations.json"), "utf8"));
	const governance = JSON.parse(readFileSync(join(args.acceptanceRoot, GOVERNANCE), "utf8"));

	checkGovernance(governance, fail);
	checkSources(defs, args.referenceRoot, fail);
	checkEvidence(defs, args.parityRoot, fail);
	const denominator = checkDefinitions(defs, configs, governance.implementationOwner ?? {}, fail);
	const current = recordedEntries(defs, configs, governance);
	const stored = JSON.parse(readFileSync(join(args.acceptanceRoot, RECORD_HASHES), "utf8"));
	compareRecorded(stored, current, args.write, fail);
	const recordsJson = `${JSON.stringify({ algorithm: "sha256 of key-sorted JSON of each definition record, partition metadata, configuration value and governance file", ...current }, null, 2)}\n`;
	const manifest = `${[hashArtifacts(args.acceptanceRoot), `${sha256(recordsJson)}  ${RECORD_HASHES}`].join("\n")}\n`;

	if (args.write) {
		if (failures.length === 0) {
			writeFileSync(join(args.acceptanceRoot, RECORD_HASHES), recordsJson);
			writeFileSync(join(args.acceptanceRoot, MANIFEST), manifest);
		}
	} else {
		const actualRecords = readFileSync(join(args.acceptanceRoot, RECORD_HASHES), "utf8");
		if (actualRecords !== recordsJson) fail(`${RECORD_HASHES} bytes do not match the canonical recorded hashes`);
		if (readFileSync(join(args.acceptanceRoot, MANIFEST), "utf8") !== manifest) fail("acceptance manifest does not match current files");
		const manifestSha = sha256(readFileSync(join(args.acceptanceRoot, MANIFEST)));
		if (args.pin && manifestSha !== args.pin) fail(`manifest sha256 ${manifestSha} differs from externally pinned ${args.pin}`);
	}

	if (failures.length) {
		process.stderr.write(`${failures.map((message) => `FAIL ${message}`).join("\n")}\n`);
		process.exitCode = 1;
		return;
	}
	const summary = {
		kind: "acceptance-structural-check",
		structural: "PASS",
		authorization: "NONE",
		scope: SCOPE,
		partition: { status: defs.status, definitions: defs.definitions.length, configurationCells: denominator, denominatorComplete: defs.denominatorComplete },
		externalPin: args.pin ? "matched" : "absent",
		openBlockers: openBlockers(defs, args.pin),
		digests: {
			definitions: sha256(readFileSync(join(args.acceptanceRoot, "setup-pstack/definitions.json"))),
			recordHashes: sha256(readFileSync(join(args.acceptanceRoot, RECORD_HASHES))),
			manifest: sha256(readFileSync(join(args.acceptanceRoot, MANIFEST))),
		},
	};
	process.stdout.write(`${JSON.stringify(summary)}\n`);
}

try {
	main();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
	process.exitCode = 1;
}
