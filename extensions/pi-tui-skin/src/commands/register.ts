/**
 * Installs the implemented Reference commands as pi extension commands. Mapped ids
 * stay unregistered so pi built-ins win; unmet ids have no handler to run.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReferenceSessionState } from "../state.ts";
import { REFERENCE_COMMANDS } from "./registry.ts";

export function installCommands(pi: ExtensionAPI, state: ReferenceSessionState): void {
	for (const entry of REFERENCE_COMMANDS) {
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
