/**
 * AppHeader parity: bold "pi" title with a dim version.
 * the reference CLI research: source-screens.md §3 AppHeader (marginX 1, paddingX 1,
 * bold title, dim version, optional dim tip). The Statsig tip pool has no
 * local equivalent, so the tip line is omitted rather than invented.
 */

import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export function renderHeaderLine(theme: Theme, version: string, title = "pi"): string {
	return `${theme.bold(title)} ${theme.fg("dim", `v${version}`)}`;
}

export function installHeader(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((tui, theme) => {
			void tui;
			let cached: { themeName: string | undefined; line: string } | undefined;
			return {
				invalidate() {
					cached = undefined;
				},
				render(): string[] {
					if (!cached || cached.themeName !== theme.name) {
						cached = { themeName: theme.name, line: renderHeaderLine(theme, VERSION) };
					}
					return [cached.line];
				},
			};
		});
	});
}
