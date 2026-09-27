import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.ts");
const child = spawn(
	"pi",
	["--no-extensions", "-e", extension, "--print", "ping", "--model", "claude-subscription/claude-sonnet-4-6"],
	{ stdio: ["ignore", "pipe", "pipe"] },
);
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
	stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
	stderr += chunk.toString();
});
const code = await new Promise<number>((resolveCode, reject) => {
	child.on("error", reject);
	child.on("close", (status) => resolveCode(status ?? 1));
});
const output = `${stdout}\n${stderr}`;
if (!output.includes("No API key found for claude-subscription")) {
	throw new Error(`pi did not resolve claude-subscription.\nexit=${code}\n${output}`);
}
if (output.includes("Unknown model") || output.includes("@anthropic-ai/sdk")) {
	throw new Error(output);
}
console.log("pi resolved claude-subscription/claude-sonnet-4-6 and asked for login");
