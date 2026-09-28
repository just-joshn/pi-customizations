#!/usr/bin/env node
/**
 * Live tmux smoke harness for the theme package.
 *
 * Proves the theme renders in a real interactive pi, not just that the JSON parses:
 *   - isolated tmux server (`tmux -L pi-theme-smoke-<pid> -f /dev/null`), pane 110x36
 *   - fresh HOME, PI_CODING_AGENT_DIR, and workspace per run, so no real user config loads
 *   - run A loads the theme with `--theme`, run B loads the package with `-e` and lets
 *     `pi.themes` discover it, so both delivery paths are exercised
 *   - captures with `capture-pane -p -e` so the SGR sequences are visible
 *
 * The load-bearing assertion is that the built-in `dark` theme's accent never appears.
 * Without it, a silent fallback to `dark` would satisfy every other check.
 *
 * Exits 0 only when every assertion passes.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const CAPTURE_DIR = path.join(PACKAGE_ROOT, "scripts", "smoke-captures");
const SOCKET = `pi-theme-smoke-${process.pid}`;

const ACCENT = "\u001b[38;2;97;175;239m";
const DIM = "\u001b[38;2;107;113;125m";
const USER_MESSAGE_BG = "\u001b[48;2;33;37;43m";
const THINKING_BORDER = "\u001b[38;2;74;165;240m";
const BUILT_IN_DARK_ACCENT = "\u001b[38;2;138;190;183m";

const results = [];
const temporaryPaths = [];

const shquote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;
const tmux = (args, options = {}) =>
	execFileSync("tmux", ["-L", SOCKET, ...args], {
		encoding: "utf8",
		timeout: 20_000,
		...options,
	});

function piBinary() {
	return (
		process.env.PI_BIN ??
		execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim()
	);
}

function makeWorkspace(label) {
	const dir = mkdtempSync(path.join(tmpdir(), `pi-theme-smoke-${label}-`));
	temporaryPaths.push(dir);
	mkdirSync(path.join(dir, "agent"), { recursive: true });
	return dir;
}

function record(name, ok, captureName) {
	results.push({ name, status: ok ? "pass" : "fail", captureName });
}

function saveCapture(name, text) {
	mkdirSync(CAPTURE_DIR, { recursive: true });
	writeFileSync(path.join(CAPTURE_DIR, name), text);
}

function capture(session) {
	return tmux(["capture-pane", "-p", "-e", "-t", session]);
}

function sleep(seconds) {
	execFileSync("sleep", [String(seconds)]);
}

const FOOTER = "$0.000 (sub)";

function readUntilIdle(session) {
	let text = "";
	for (let attempt = 0; attempt < 60; attempt += 1) {
		sleep(1);
		text = capture(session);
		// The footer only paints once startup finished, and it repaints on every tick,
		// so a second identical sample means the screen has settled.
		if (text.includes(FOOTER) && text === capture(session)) return text;
	}
	return text;
}

/** Launch pi in its own session and return the capture once the editor is idle. */
function runPi(label, extraArgs, session) {
	const workspace = makeWorkspace(label);
	const command = [
		shquote(piBinary()),
		"--use-theme",
		"one-dark-pro-flat",
		...extraArgs.map(shquote),
		"--no-session",
		"--no-context-files",
		"--offline",
		"--approve",
		"--verbose",
	].join(" ");
	// Keepalive: a pi crash should leave its error on screen for the failure capture.
	tmux([
		"-f",
		"/dev/null",
		"new-session",
		"-d",
		"-x",
		"110",
		"-y",
		"36",
		"-s",
		session,
		"-c",
		workspace,
		`${command}; echo PI-EXITED-$?; sleep 600`,
	]);
	return readUntilIdle(session);
}

function exerciseThemePath() {
	const session = "theme-path";
	const idle = runPi(
		"path",
		["--theme", path.join(PACKAGE_ROOT, "themes")],
		session,
	);
	saveCapture("01-theme-path-idle", idle);

	record(
		"pi reaches an idle TUI without exiting",
		idle.includes(FOOTER) && !idle.includes("PI-EXITED"),
		"01-theme-path-idle",
	);
	record(
		"verbose listing names the package theme file",
		idle.includes("themes/one-dark-pro-flat.json"),
		"01-theme-path-idle",
	);
	record(
		"accent #61afef reaches the terminal",
		idle.includes(ACCENT),
		"01-theme-path-idle",
	);
	record(
		"dim tier #6b717d reaches the terminal",
		idle.includes(DIM),
		"01-theme-path-idle",
	);
	record(
		"thinking border #4aa5f0 reaches the terminal",
		idle.includes(THINKING_BORDER),
		"01-theme-path-idle",
	);
	record(
		"built-in dark accent never appears",
		!idle.includes(BUILT_IN_DARK_ACCENT),
		"01-theme-path-idle",
	);

	tmux(["send-keys", "-l", "-t", session, "trace the palette"]);
	tmux(["send-keys", "-t", session, "Enter"]);
	sleep(4);
	const busy = capture(session);
	saveCapture("02-theme-path-composing", busy);
	record(
		"user message box paints #21252b behind the message",
		busy.includes(USER_MESSAGE_BG),
		"02-theme-path-composing",
	);
	record(
		"user message box keeps the built-in dark accent away",
		!busy.includes(BUILT_IN_DARK_ACCENT),
		"02-theme-path-composing",
	);
}

function exercisePackagePath() {
	const session = "package-path";
	const idle = runPi("package", ["-e", PACKAGE_ROOT], session);
	saveCapture("03-package-path-idle", idle);
	record(
		"pi.themes discovery loads the package theme through -e",
		idle.includes(ACCENT),
		"03-package-path-idle",
	);
	record(
		"package loading also keeps the built-in dark accent away",
		!idle.includes(BUILT_IN_DARK_ACCENT),
		"03-package-path-idle",
	);
}

function cleanup() {
	try {
		tmux(["kill-server"]);
	} catch {
		// The server may already be gone.
	}
	for (const dir of temporaryPaths)
		rmSync(dir, { recursive: true, force: true });
}

function summarize(failure) {
	process.stdout.write("\n=== theme smoke summary ===\n");
	for (const result of results) {
		const where = result.captureName
			? ` (capture: scripts/smoke-captures/${result.captureName})`
			: "";
		process.stdout.write(
			`[${result.status.toUpperCase()}] ${result.name}${where}\n`,
		);
	}
	const failed = results.filter((result) => result.status === "fail");
	if (failure) {
		process.stdout.write(`\nFAIL: ${failure.message}\n`);
		return 1;
	}
	if (failed.length > 0) {
		process.stdout.write(`\nFAIL: ${failed.length} assertion(s) failed\n`);
		return 1;
	}
	process.stdout.write("\nPASS: all theme smoke assertions held\n");
	return 0;
}

let failure;
let exitCode = 1;
try {
	exerciseThemePath();
	exercisePackagePath();
	exitCode = summarize();
} catch (error) {
	failure = error;
	try {
		saveCapture("99-failure", `${error.message}\n${capture("theme-path")}`);
	} catch {
		// The pane is gone too; the original error matters more.
	}
	exitCode = summarize(failure);
} finally {
	cleanup();
}

process.exit(exitCode);
