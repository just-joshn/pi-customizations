/**
 * Terminal notification parity. Research: source-screens.md §5.
 * Per-terminal escapes: iTerm2 OSC 9; Ghostty/Warp OSC 777 notify;Title;Body;
 * kitty/VS Code OSC 99 with base64 title and body; Apple Terminal BEL.
 * tmux/screen receive DCS passthrough wrapping. Focus-gated via ESC[?1004h
 * focus reporting; under tmux only after a focus report was seen.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NOTIFY_MESSAGES } from "../constants.ts";

export type NotifyTerminal = "iterm2" | "ghostty" | "warp" | "kitty" | "vscode" | "apple" | "other";

export function detectTerminal(env: NodeJS.ProcessEnv): NotifyTerminal {
	if (env.TERM_PROGRAM === "iTerm.app") return "iterm2";
	if (env.TERM_PROGRAM === "Ghostty") return "ghostty";
	if (env.TERM_PROGRAM === "WarpTerminal") return "warp";
	if (env.TERM_PROGRAM === "vscode") return "vscode";
	if (env.KITTY_WINDOW_ID || env.KITTY_PID) return "kitty";
	if (env.TERM_PROGRAM === "Apple_Terminal") return "apple";
	return "other";
}

function dcsWrap(seq: string): string {
	return `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

export function notificationSequence(terminal: NotifyTerminal, title: string, body: string, insideTmux: boolean): string {
	let seq: string;
	switch (terminal) {
		case "iterm2":
			seq = `\x1b]9;${body}\x07`;
			break;
		case "ghostty":
		case "warp":
			seq = `\x1b]777;notify;${title};${body}\x07`;
			break;
		case "kitty":
		case "vscode":
			seq = `\x1b]99;i=1:d=0;${Buffer.from(title).toString("base64")},${Buffer.from(body).toString("base64")}\x07`;
			break;
		case "apple":
			seq = "\x07";
			break;
		default:
			return "";
	}
	if (insideTmux) return dcsWrap(seq);
	return seq;
}

export const FOCUS_ENABLE = "\x1b[?1004h";
export const FOCUS_IN = "\x1b[I";
export const FOCUS_OUT = "\x1b[O";

export class FocusGate {
	private seenReport = false;
	private focused = true;

	constructor(private readonly insideTmux: boolean) {}

	handleInput(data: string): void {
		if (data === FOCUS_IN) {
			this.seenReport = true;
			this.focused = true;
		} else if (data === FOCUS_OUT) {
			this.seenReport = true;
			this.focused = false;
		}
	}

	shouldNotify(): boolean {
		if (!this.focused) return true;
		if (this.insideTmux) return !this.seenReport;
		return !this.seenReport;
	}
}

export function installNotifications(pi: ExtensionAPI): void {
	const terminal = detectTerminal(process.env);
	const insideTmux = Boolean(process.env.TMUX);
	const gate = new FocusGate(insideTmux);
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		process.stdout.write(FOCUS_ENABLE);
	});
	pi.on("agent_settled", async () => {
		if (!gate.shouldNotify()) return;
		const seq = notificationSequence(terminal, "Reference", NOTIFY_MESSAGES.waitingForYou, insideTmux);
		if (seq) process.stdout.write(seq);
	});
}
