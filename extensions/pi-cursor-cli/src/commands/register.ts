/**
 * Installs the implemented Cursor commands as pi extension commands. Mapped ids
 * stay unregistered so pi built-ins win; unmet ids have no handler to run.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CursorSessionState } from "../state.ts";
import { CURSOR_COMMANDS } from "./registry.ts";

export function installCommands(pi: ExtensionAPI, state: CursorSessionState): void {
	for (const entry of CURSOR_COMMANDS) {
		const handler = entry.handler;
		if (entry.status !== "implemented" || !handler) continue;
		if (entry.registeredBy) continue;
		pi.registerCommand(entry.id, {
			description: entry.description,
			handler: async (args, ctx) => {
			await handler(args, ctx, state);
		},
		});
	}
}
