/**
 * Working-status parity: green braille spinner, 250 ms interval, bold label.
 * Research: source-conversation.md §4 (frames, interval, green spinner + bold
 * text). The live Thinking/Summarizing/verb label selection reads Reference's
 * pending-turn internals; pi owns that row's composition, so the label is a
 * static "Working" (deviation documented in docs/parity.md).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../constants.ts";
import { getTokens, paletteFg } from "../palette.ts";

export function spinnerFrames(colorMode: "truecolor" | "256color", themeName: string | undefined): string[] {
	const green = getTokens(themeName).green;
	return SPINNER_FRAMES.map((f) => paletteFg(green, colorMode, f));
}

export function installWorkingIndicator(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const frames = spinnerFrames(ctx.ui.theme.getColorMode(), ctx.ui.theme.name);
		ctx.ui.setWorkingIndicator({ frames, intervalMs: SPINNER_INTERVAL_MS });
		ctx.ui.setWorkingMessage("Working");
	});
}
