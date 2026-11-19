import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ProcessOutcome {
	code: number | null;
	signal: NodeJS.Signals | null;
	spawnError?: Error;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function tmuxHasSession(session: string): boolean {
	try {
		execFileSync("tmux", ["has-session", "-t", `=${session}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function tmuxKillSession(session: string): void {
	try {
		execFileSync("tmux", ["kill-session", "-t", `=${session}`], { stdio: "ignore" });
	} catch {
		/* already gone */
	}
}

/**
 * Run `command args` inside a detached tmux session. Stdout/stderr are mirrored
 * into temp files so the parent can stream JSON events the same way a pipe did.
 */
export async function runPiInTmux(options: {
	command: string;
	args: string[];
	cwd: string;
	signal?: AbortSignal | undefined;
	onStdoutChunk: (chunk: string) => void;
	onStderrChunk: (chunk: string) => void;
	/** Test hook: called after the tmux session exists and before waiting for exit. */
	onSessionStarted?: ((session: string) => void) | undefined;
}): Promise<ProcessOutcome> {
	const session = `pi-subagent-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-tmux-"));
	const outFile = path.join(dir, "stdout.log");
	const errFile = path.join(dir, "stderr.log");
	const exitFile = path.join(dir, "exit");
	const wrapper = path.join(dir, "run.sh");
	fs.writeFileSync(outFile, "");
	fs.writeFileSync(errFile, "");
	const argv = [options.command, ...options.args].map(shellQuote).join(" ");
	fs.writeFileSync(
		wrapper,
		["#!/bin/bash", `${argv} > ${shellQuote(outFile)} 2> ${shellQuote(errFile)}`, `echo $? > ${shellQuote(exitFile)}`].join("\n") +
			"\n",
		{ mode: 0o755 },
	);

	try {
		execFileSync("tmux", ["new-session", "-d", "-s", session, "-c", options.cwd, "bash", wrapper], {
			stdio: "ignore",
		});
	} catch (error) {
		fs.rmSync(dir, { recursive: true, force: true });
		return {
			code: null,
			signal: null,
			spawnError: error instanceof Error ? error : new Error(String(error)),
		};
	}

	options.onSessionStarted?.(session);

	let outOffset = 0;
	let errOffset = 0;
	let wasAborted = false;
	const pump = () => {
		try {
			const outStat = fs.statSync(outFile);
			if (outStat.size > outOffset) {
				const fd = fs.openSync(outFile, "r");
				const buf = Buffer.alloc(outStat.size - outOffset);
				fs.readSync(fd, buf, 0, buf.length, outOffset);
				fs.closeSync(fd);
				outOffset = outStat.size;
				if (buf.length) options.onStdoutChunk(buf.toString("utf8"));
			}
		} catch {
			/* file may appear after start */
		}
		try {
			const errStat = fs.statSync(errFile);
			if (errStat.size > errOffset) {
				const fd = fs.openSync(errFile, "r");
				const buf = Buffer.alloc(errStat.size - errOffset);
				fs.readSync(fd, buf, 0, buf.length, errOffset);
				fs.closeSync(fd);
				errOffset = errStat.size;
				if (buf.length) options.onStderrChunk(buf.toString("utf8"));
			}
		} catch {
			/* ignore */
		}
	};

	const abort = () => {
		if (wasAborted) return;
		wasAborted = true;
		tmuxKillSession(session);
	};
	if (options.signal) {
		if (options.signal.aborted) abort();
		else options.signal.addEventListener("abort", abort, { once: true });
	}

	try {
		while (!fs.existsSync(exitFile)) {
			pump();
			if (wasAborted && !tmuxHasSession(session)) break;
			if (!wasAborted && !tmuxHasSession(session) && !fs.existsSync(exitFile)) {
				await new Promise((r) => setTimeout(r, 50));
				pump();
				if (!fs.existsSync(exitFile)) {
					return { code: null, signal: wasAborted ? "SIGTERM" : null };
				}
				break;
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		pump();
		if (wasAborted && !fs.existsSync(exitFile)) {
			return { code: null, signal: "SIGTERM" };
		}
		const codeText = fs.existsSync(exitFile) ? fs.readFileSync(exitFile, "utf8").trim() : "";
		const code = codeText === "" ? null : Number(codeText);
		return {
			code: Number.isFinite(code) ? code : null,
			signal: wasAborted ? "SIGTERM" : null,
		};
	} finally {
		if (options.signal) options.signal.removeEventListener("abort", abort);
		tmuxKillSession(session);
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
