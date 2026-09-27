#!/usr/bin/env node
/**
 * P5 docs-conformance gate: every pi API member this extension uses must exist
 * in the installed declarations, and no source file may deep-import dist/.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");
const NODE_MODULES = join(ROOT, "node_modules");

const errors = [];

function listFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...listFiles(p));
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

const files = listFiles(SRC);

// Rule 1: no dist/ deep imports of pi packages.
for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/from\s+"([^"]*pi-(?:coding-agent|tui|ai)[^"]*)"/g)) {
		if (m[1].includes("/dist/")) errors.push(`${relative(ROOT, file)}: deep dist import ${m[1]}`);
	}
}

// Rule 2: every named import from the pi packages must exist in the installed declarations.
function collectDeclares(dtsText, set) {
	for (const m of dtsText.matchAll(/(?:declare )?(?:abstract class|class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
		set.add(m[1]);
	}
}

function collectExportsIndex(dtsText, set) {
	for (const m of dtsText.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gs)) {
		for (let part of m[1].split(",")) {
			part = part.trim();
			if (!part) continue;
			const asMatch = part.match(/^(?:type\s+)?[\w$]+\s+as\s+([\w$]+)$/);
			const name = asMatch ? asMatch[1] : part.replace(/^type\s+/, "");
			if (/^[\w$]+$/.test(name)) set.add(name);
		}
	}
}

const decls = {
	"@earendil-works/pi-coding-agent": new Set(),
	"@earendil-works/pi-tui": new Set(),
};

{
	const agentDist = join(NODE_MODULES, "@earendil-works/pi-coding-agent/dist");
	const rootIndex = readFileSync(join(agentDist, "index.d.ts"), "utf8");
	collectExportsIndex(rootIndex, decls["@earendil-works/pi-coding-agent"]);
	const tuiIndex = readFileSync(join(NODE_MODULES, "@earendil-works/pi-tui/dist/index.d.ts"), "utf8");
	collectExportsIndex(tuiIndex, decls["@earendil-works/pi-tui"]);
}

for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*"(?:@earendil-works\/(pi-coding-agent|pi-tui))"/g)) {
		const pkg = `@earendil-works/${m[2]}`;
		for (const raw of m[1].split(",")) {
			const name = raw.trim().replace(/^type\s+/, "");
			if (!name) continue;
			if (!decls[pkg].has(name)) {
				errors.push(`${relative(ROOT, file)}: ${pkg} has no export "${name}"`);
			}
		}
	}
}

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}
console.log(`check-docs: ${files.length} source files conform to installed pi declarations`);
