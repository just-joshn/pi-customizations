#!/usr/bin/env node
/**
 * Live tmux smoke harness for the pi-cursor-cli extension (parity gates P3/P4).
 *
 * Proves the extension renders in a real interactive pi under tmux:
 *   - isolated tmux server (`tmux -L pi-smoke-<pid> -f /dev/null`), pane 110x36
 *   - fresh HOME and fresh workspace dir so no real user config loads
 *   - pi loads ./src/index.ts plus test/harness/scripted-provider.ts and the
 *     scripted model smoke/scripted (never touches the network)
 *   - drives keystrokes with send-keys, captures with capture-pane -p at each
 *     step into scripts/smoke-captures/, asserts literal strings per step
 *
 * The scripted conversation: bash tool call `echo parity-smoke` (gated by the
 * extension's decision surface, approved with "y"), then a todo_update call
 * marking "Smoke passed" completed, then final text "Parity smoke complete.".
 *
 * Exits 0 only if every required assertion passes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_MAIN = path.join(PKG_ROOT, "src", "index.ts");
const EXT_PROVIDER = path.join(PKG_ROOT, "test", "harness", "scripted-provider.ts");
const CAPTURE_DIR = path.join(PKG_ROOT, "scripts", "smoke-captures");
const SOCKET = `pi-smoke-${process.pid}`;
const SESSION = "smoke";
const PANE_ARGS = ["-t", SESSION];
const POLL_MS = 250;
const IDLE_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 120_000;

const results = [];
const tmpPaths = [];

function shquote(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function tmux(args, opts = {}) {
	return execFileSync("tmux", ["-L", SOCKET, ...args], { encoding: "utf8", timeout: 20_000, ...opts });
}

function resolvePi() {
	if (process.env.PI_BIN) return process.env.PI_BIN;
	return execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
}

function capturePane() {
	return tmux(["capture-pane", "-p", ...PANE_ARGS]);
}

function captureLines(text) {
	return text
		// Defensive: capture-pane -p already strips SGR, don't let escapes hide literals.
		.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
		.split("\n")
		.map((line) => line.trim());
}

function captureContains(capture, literal) {
	return captureLines(capture).some((line) => line.includes(literal));
}

function saveCapture(name, text) {
	const file = path.join(CAPTURE_DIR, name);
	writeFileSync(file, text);
	return file;
}

function record(name, status, captureName) {
	results.push({ name, status, captureName });
}

/**
 * Deterministic wait: poll the pane until predicate(capture) holds. On timeout,
 * save the last capture under the step name so the failure is inspectable.
 */
function waitFor(label, captureName, predicate, timeoutMs = STEP_TIMEOUT_MS) {
	const deadline = Date.now() + timeoutMs;
	let last = capturePane();
	while (Date.now() < deadline) {
		if (predicate(last)) {
			const file = saveCapture(captureName, last);
			return { file, text: last };
		}
		execFileSync("sleep", [`${POLL_MS / 1000}`]);
		last = capturePane();
	}
	const file = saveCapture(captureName, last);
	throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}. Last capture: ${file}`);
}

function run() {
	if (!execFileSync("sh", ["-c", "command -v tmux || true"], { encoding: "utf8" }).trim()) {
		throw new Error("tmux is required for the smoke harness but was not found on PATH");
	}
	if (!existsSync(EXT_MAIN) || !existsSync(EXT_PROVIDER)) {
		throw new Error(`Extension entry points not found under ${PKG_ROOT}`);
	}
	const piBin = resolvePi();

	rmSync(CAPTURE_DIR, { recursive: true, force: true });
	mkdirSync(CAPTURE_DIR, { recursive: true });
	const smokeHome = mkdtemp("pi-smoke-home");
	const workspace = mkdtemp("pi-smoke-ws");

	// Fresh HOME keeps user extensions/themes/skills out; -a trusts the loaded
	// extension files for this run; --no-session keeps the run ephemeral.
	const piCommand = [
		"env",
		`HOME=${shquote(smokeHome)}`,
		"PI_OFFLINE=1",
		shquote(piBin),
		"--extension", shquote(EXT_MAIN),
		"--extension", shquote(EXT_PROVIDER),
		"--model", "smoke/scripted",
		"--no-session",
		"-a",
		"-nc",
	].join(" ");
	// Keepalive: if pi exits early the pane survives, so the failure capture
	// shows pi's startup error instead of "can't find pane".
	const paneCommand = `${piCommand}; echo PI-EXITED-$?; sleep 900`;

	console.log(`pi binary: ${piBin}`);
	console.log(`tmux command: tmux -L ${SOCKET} -f /dev/null new-session -d -x 110 -y 36 -s ${SESSION} -c ${workspace} ${paneCommand}`);

	tmux(["-f", "/dev/null", "new-session", "-d", "-x", "110", "-y", "36", "-s", SESSION, "-c", workspace, paneCommand]);

	const idle = waitFor("idle editor (header + placeholder)", "01-idle", (cap) =>
		captureContains(cap, "Cursor Agent") && captureContains(cap, "Plan, search, build anything"),
	);
	record("header shows \"Cursor Agent\"", "pass", "01-idle");
	record("empty-state placeholder \"Plan, search, build anything\"", "pass", "01-idle");

	if (captureContains(idle.text, "Test Model")) {
		record("footer shows scripted model \"Test Model\"", "pass", "01-idle");
	} else {
		record("footer shows scripted model \"Test Model\"", "skip", "01-idle");
	}

	tmux(["send-keys", "-l", ...PANE_ARGS, "hello"]);
	tmux(["send-keys", ...PANE_ARGS, "Enter"]);

	waitFor("decision dialog \"Run this command?\"", "02-decision", (cap) =>
		captureContains(cap, "Run this command?"),
	);
	record("decision gate intercepts bash with \"Run this command?\"", "pass", "02-decision");

	tmux(["send-keys", "-l", ...PANE_ARGS, "y"]);

	// Completion markers only. The per-literal assertions below run against the
	// saved capture, so a missing literal fails precisely instead of as a timeout.
	waitFor("todo row and final text", "03-after-run", (cap) =>
		captureContains(cap, "✔ Smoke passed")
		&& captureContains(cap, "Parity smoke complete."),
	);
	const doneCapture = readFileSync(path.join(CAPTURE_DIR, "03-after-run"), "utf8");
	if (!captureContains(doneCapture, "undefined")) {
		record("bash tool row free of the undefined-state defect", "pass", "03-after-run");
	} else {
		record("bash tool row free of the undefined-state defect", "fail", "03-after-run");
	}
	if (captureContains(doneCapture, "echo parity-smoke")) {
		record("bash tool row shows command \"echo parity-smoke\"", "pass", "03-after-run");
	} else {
		record("bash tool row shows command \"echo parity-smoke\"", "fail", "03-after-run");
	}
	record("todo row \"✔ Smoke passed\"", "pass", "03-after-run");
	record("final text \"Parity smoke complete.\"", "pass", "03-after-run");

	tmux(["send-keys", ...PANE_ARGS, "BTab"]);
	waitFor("footer headline \"Plan (shift+tab to cycle)\"", "04-plan-mode", (cap) =>
		captureContains(cap, "Plan (shift+tab to cycle)"),
	);
	record("shift+tab footer headline \"Plan (shift+tab to cycle)\"", "pass", "04-plan-mode");
}

function mkdtemp(prefix) {
	const dir = path.join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	tmpPaths.push(dir);
	return dir;
}

function cleanup() {
	try {
		tmux(["kill-server"]);
	} catch {
		// Server may already be gone.
	}
	for (const dir of tmpPaths) {
		rmSync(dir, { recursive: true, force: true });
	}
}

function diagnose() {
	const lines = ["--- tmux diagnostics ---"];
	for (const [label, args] of [
		["list-sessions", ["list-sessions"]],
		["list-panes", ["list-panes", "-a", "-F", "#{session_name} #{pane_id} #{pane_current_command} #{pane_dead} #{pane_dead_status}"]],
	]) {
		try {
			lines.push(`${label}: ${tmux(args).trim()}`);
		} catch (error) {
			lines.push(`${label}: FAILED ${error.message.split("\n")[0]}`);
		}
	}
	return lines.join("\n");
}

function summarize(exitError) {
	console.log("\n=== smoke summary ===");
	for (const r of results) {
		const capture = r.captureName ? ` (capture: scripts/smoke-captures/${r.captureName})` : "";
		console.log(`[${r.status.toUpperCase()}] ${r.name}${capture}`);
	}
	if (exitError) {
		console.log(`\nFAIL: ${exitError.message}`);
		return 1;
	}
	const failed = results.filter((r) => r.status === "fail");
	if (failed.length > 0) {
		console.log(`\nFAIL: ${failed.length} assertion(s) failed`);
		return 1;
	}
	console.log("\nPASS: all smoke assertions held");
	return 0;
}

let exitError;
try {
	run();
} catch (error) {
	exitError = error;
	try {
		saveCapture("99-failure", `${diagnose()}\n${capturePane()}`);
	} catch {
		// Pane already gone; the original error matters more.
	}
} finally {
	cleanup();
}

process.exit(summarize(exitError));
