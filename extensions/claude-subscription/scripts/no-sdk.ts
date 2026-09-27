import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};
const declared = { ...packageJson.dependencies, ...packageJson.peerDependencies };
if (declared["@anthropic-ai/sdk"]) {
	throw new Error("package.json must not depend on @anthropic-ai/sdk");
}

function walk(dir: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files.push(...walk(path));
		else if (name.endsWith(".ts")) files.push(path);
	}
	return files;
}

const src = new URL("src", root);
for (const file of walk(src.pathname)) {
	const text = readFileSync(file, "utf8");
	if (text.includes("@anthropic-ai/sdk")) throw new Error(`${file} imports @anthropic-ai/sdk`);
}
console.log("no Anthropic SDK dependency");
